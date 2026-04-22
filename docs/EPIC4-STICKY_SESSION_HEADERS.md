# EPIC4 - Sticky Session Headers (vLLM prefix cache 극대화를 위한 라우팅 헤더 전달)

> 모든 LLM 호출에 `X-Thread-Id`, `X-Agent-Id` 커스텀 헤더를 주입하여, nginx consistent hash 라우팅으로 같은 대화가 같은 vLLM 인스턴스에 고정되도록 한다. prefix cache hit rate 30% → 70%+ 목표.

## 의존성
- 없음 (nginx 설정 변경은 별도 인프라 작업으로, 코드 배포 후 동시 적용)

## 설계 결정: AsyncLocalStorage + incoming header passthrough

**왜 AsyncLocalStorage인가**
`callLLM`은 5개 경로(DynamicAgentExecutor, intentClassifier, ReasoningPrompt×2, LogicalVerifier, thinkingEvolution)에서 호출되고, 호출 스택이 깊다. 각 함수 시그니처에 `threadId`/`agentId`를 뚫어가는 방식은 변경량이 크고, 이후 새 LLM 호출이 추가될 때마다 또 뚫어야 한다. AsyncLocalStorage(ALS)로 request 스코프 컨텍스트를 만들고 `llmManager` 한 곳에서만 읽으면, 하위 호출은 자동으로 수혜를 받고 추가 파라미터도 필요 없다.

**왜 incoming header passthrough인가**
오케스트레이터가 한 thread에서 빌더 에이전트를 여러 번 호출할 때 A2A `task.contextId`는 호출마다 달라질 수 있다. 빌더가 `contextId`를 그대로 `X-Thread-Id`로 쓰면 같은 thread인데도 다른 vLLM 인스턴스로 라우팅되어 prefix cache miss가 발생한다. 오케스트레이터가 보낸 `X-Thread-Id` 헤더를 빌더가 passthrough하면 오케스트레이터 thread 단위로 라우팅이 일관된다.

**우선순위**: incoming `X-Thread-Id` 헤더 → `contextId` (빌더 standalone 호출 fallback) → 없음.

## 목표
- `src/lib/requestContext.ts`에 AsyncLocalStorage 신설
- API route에서 incoming `X-Thread-Id` 헤더를 ALS에 저장
- `DynamicAgentExecutor.execute()`에서 effective threadId + `agentId`를 ALS 하위 스코프에 주입
- `llmManager`가 ALS에서 읽어 OpenAI SDK per-request 헤더로 자동 전달
- `intentClassifier`, `logicalReasoning`, `thinkingEvolution`은 **코드 변경 없이** 자동 수혜

---

## Story 4.1: RequestContextStorage (AsyncLocalStorage) 신설

**신규 파일:** `src/lib/requestContext.ts`

### 배경
Node.js의 `AsyncLocalStorage`는 request-scoped 컨텍스트를 async 호출 체인 전체에 전파한다. Next.js App Router의 route handler는 Node.js runtime에서 실행되므로 (이 프로젝트에 `export const runtime = 'edge'` 설정 없음), ALS가 정상 동작한다.

ALS에 `threadId`와 `agentId`를 저장해두면 `llmManager.generateChatResponse` 내부에서 `als.getStore()`로 읽어 헤더를 구성할 수 있다.

### 태스크

#### ALS 모듈 작성
- [x] `src/lib/requestContext.ts` 파일을 생성한다.
- [x] `AsyncLocalStorage`를 `node:async_hooks`에서 import하고, 다음 타입/싱글턴을 export한다:
  ```typescript
  import { AsyncLocalStorage } from 'node:async_hooks';

  export interface LLMRoutingContext {
    threadId?: string;
    agentId?: string;
  }

  export const llmRoutingStorage = new AsyncLocalStorage<LLMRoutingContext>();

  export function getLLMRoutingContext(): LLMRoutingContext {
    return llmRoutingStorage.getStore() ?? {};
  }
  ```

### 주의사항
- `node:async_hooks` import prefix 유지 (bundler가 edge runtime으로 오인하지 않도록).
- ALS 인스턴스는 모듈 싱글턴이어야 하며, 두 번 import되어도 같은 인스턴스가 유지되어야 한다.

---

## Story 4.2: POST 핸들러에서 incoming 헤더를 ALS에 저장

**수정 파일:** `src/app/api/agents/[agentId]/[[...path]]/route.ts`

### 배경
빌더 에이전트 호출은 `POST /api/agents/[agentId]` 또는 `POST /api/agents/[agentId]/deploy`로 들어온다. 대화 실행 경로는 currentPath가 `''`인 분기(482행)이다. 이 분기에서 `agent.transportHandler.handle(body)`가 호출되며, A2A SDK 내부에서 `DynamicAgentExecutor.execute()`가 호출된다.

이 호출 체인 전체를 `llmRoutingStorage.run()`으로 감싸면 executor까지 threadId가 전파된다.

```typescript
// route.ts:481-548 (대화 실행 분기)
if (currentPath === '') {
  let agent = await getAgent(agentId);
  // ... ensureAgentHandlers ...
  const rpcResponseOrStream = await agent.transportHandler!.handle(body);
  // ...
}
```

### 참고 파일
- `src/lib/requestContext.ts` — Story 4.1에서 생성

### 태스크

#### 대화 실행 경로에 ALS 스코프 적용
- [x] 파일 상단에 `import { llmRoutingStorage } from '@/lib/requestContext';`를 추가한다.
- [x] `currentPath === ''` 분기(482행) 시작부에서 incoming 헤더를 읽는다:
  ```typescript
  const incomingThreadId = request.headers.get('X-Thread-Id') ?? undefined;
  ```
- [x] 이 분기의 `try { ... }` 블록 전체를 `llmRoutingStorage.run({ threadId: incomingThreadId }, async () => { ... })`로 감싼다. 반환값을 핸들러가 그대로 반환하도록 구조를 유지한다.
- [x] `agentId`는 Story 4.3에서 executor가 자체 스코프에 세팅하므로 여기서는 **세팅하지 않는다** (역할 분리: Story 4.2 = incoming passthrough, Story 4.3 = executor-local).

### 주의사항
- `llmRoutingStorage.run()`의 콜백은 async 함수여야 하며, 내부에서 await되는 모든 비동기 호출이 같은 컨텍스트를 공유한다.
- `deploy` 분기는 LLM 호출이 없으므로 ALS 스코프로 감쌀 필요 없다.
- `generate-agent`는 별도 라우트 파일이므로 이 변경의 영향을 받지 않는다 (의도된 동작).

---

## Story 4.3: DynamicAgentExecutor에서 contextId fallback 적용

**수정 파일:** `src/app/api/agents/[agentId]/[[...path]]/route.ts`

### 배경
Story 4.2에서 ALS에 저장된 `threadId`는 오케스트레이터에서 온 것이다. 빌더 대시보드에서 직접 호출하는 경우 헤더가 없어 `undefined`다. 이 경우 `contextId`를 fallback으로 사용해야 같은 대시보드 대화가 같은 인스턴스에 유지된다.

`DynamicAgentExecutor.execute()`는 `requestContext.contextId`(84행)에 접근할 수 있으므로, 여기서 effective threadId를 계산하고 ALS 하위 스코프를 만든다.

### 참고 파일
- `src/lib/requestContext.ts` — `llmRoutingStorage`, `getLLMRoutingContext`

### 태스크

#### execute() 시작부에 fallback + 하위 스코프 적용
- [x] 파일 상단 import에 `getLLMRoutingContext`를 추가한다.
- [x] `execute()` 메서드(80행) 시작부에서 현재 ALS 값을 읽어 contextId fallback을 적용한다:
  ```typescript
  const incoming = getLLMRoutingContext();
  const effectiveThreadId = incoming.threadId ?? requestContext.contextId;
  ```
- [x] execute() 본문 전체를 `llmRoutingStorage.run({ threadId: effectiveThreadId, agentId: this.agentId }, async () => { ... })`로 감싼다. 기존 try/catch/finally 구조를 콜백 내부에 유지한다.

### 주의사항
- `this.agentId`는 생성자(34행)에서 이미 보관되어 있다.
- `autoEvolveAfterConversation`(243행)은 백그라운드 async이지만 ALS는 Promise chain으로 자동 전파되므로 별도 조치 불필요.
- 상위 스코프(Story 4.2)에서는 incoming `threadId`만 저장하고, 이 하위 스코프에서 `contextId` fallback 적용 + `agentId` 추가. 스코프 중첩이 역할 분리를 표현한다.

---

## Story 4.4: LLMManager가 ALS에서 자동으로 헤더 구성

**수정 파일:** `src/lib/llmManager.ts`

### 배경
현재 `generateChatResponse`(89행)는 `client.chat.completions.create({ messages, ...tokenParam, model })`만 호출한다. OpenAI SDK는 두 번째 인자로 `{ headers: {...} }`를 받아 per-request 헤더를 전송한다. Azure OpenAI 클라이언트도 동일한 API를 지원한다.

ALS에서 `threadId`/`agentId`를 읽어 헤더를 구성하고, 값이 하나라도 있을 때만 requestOptions를 전달한다.

```typescript
// 현재 코드 (llmManager.ts:101-105)
const response = await client.chat.completions.create({
  messages,
  ...tokenParam,
  model: this.config.modelName,
});
```

### 참고 파일
- `src/lib/requestContext.ts` — `getLLMRoutingContext`

### 태스크

#### 헤더 구성 로직 추가
- [x] 파일 상단 import에 `import { getLLMRoutingContext } from './requestContext';`를 추가한다.
- [x] `generateChatResponse`(89행) 내부, `client.chat.completions.create` 호출 직전에 헤더를 구성한다:
  ```typescript
  const routing = getLLMRoutingContext();
  const requestHeaders: Record<string, string> = {};
  if (routing.threadId) requestHeaders['X-Thread-Id'] = routing.threadId;
  if (routing.agentId) requestHeaders['X-Agent-Id'] = routing.agentId;
  ```
- [x] `client.chat.completions.create` 호출을 두 번째 인자 포함으로 변경한다:
  ```typescript
  const response = await client.chat.completions.create(
    { messages, ...tokenParam, model: this.config.modelName },
    Object.keys(requestHeaders).length > 0 ? { headers: requestHeaders } : undefined
  );
  ```

### 주의사항
- `generateChatResponse` 시그니처는 변경하지 않는다. ALS에서 읽으므로 파라미터 추가 불필요.
- `callLLM` 시그니처도 변경하지 않는다.
- ALS 스코프 밖에서 호출되는 경우(예: `generate-agent`) `getStore()`는 `undefined`를 반환하므로 헤더가 없는 기존 동작을 유지한다 (의도된 fallback).

---

## Story 4.5: 하위 호출지 코드 변경 없음 확인

**수정 파일:** 없음 (검증만)

### 배경
`intentClassifier.ts:104`, `logicalReasoning.ts:201, 263, 324`, `thinkingEvolution.ts:192`의 `callLLM` 호출은 모두 `DynamicAgentExecutor.execute()`의 ALS 스코프 내부에서 실행되므로 자동으로 라우팅 헤더를 받는다.

- `classifyIntent()`는 route.ts:132에서 호출됨 → execute() 스코프 내
- `autoEvolveAfterConversation()`는 route.ts:243에서 백그라운드 호출 → Promise chain으로 ALS 전파
- `LogicalReasoningEngine.evolve()`은 `evolveThinking()` 내부에서 호출 → 같은 chain
- `findIntentConnections()`는 별도 호출 경로가 있다면 해당 경로도 ALS 스코프 필요

### 태스크

#### 호출 경로 검증
- [x] `grep -rn "evolveThinking\|findIntentConnections\|classifyIntent" src/` 실행하여 모든 호출지를 나열한다.
- [x] 각 호출지가 Story 4.2/4.3의 ALS 스코프 내부에 있는지 확인한다.
- [x] 스코프 밖 호출지가 발견되면 (예: `/api/agents/[agentId]/evolve-thinking/route.ts` 같은 별도 엔드포인트) 해당 route handler에도 `llmRoutingStorage.run({ agentId }, ...)`를 적용한다. URL에서 `agentId`를 얻을 수 있으므로 최소한 `agentId`는 전달 가능하다.

### 주의사항
- `evolve-thinking/route.ts`가 존재한다면 (agentId route param 있음) `{ agentId, threadId: request.headers.get('X-Thread-Id') ?? undefined }`로 스코프 설정.
- 기타 수동 엔드포인트(예: admin trigger)도 동일 패턴 적용.

---

## Story 4.6: generate-agent 경로 (변경 없음)

**수정 파일:** 없음

### 배경
`src/app/api/generate-agent/route.ts:116`은 새 에이전트 생성 시점이라 `agentId`/`contextId`가 없다. ALS 스코프를 설정하지 않으므로 `getLLMRoutingContext()`는 빈 객체를 반환하고, 헤더가 붙지 않는다. nginx 쪽에서 `$request_id` fallback으로 분산된다.

이 경로는 호출 빈도가 낮고 프롬프트가 매번 다르므로 prefix cache 효과가 미미하다.

### 태스크
- [x] `generate-agent/route.ts`를 변경하지 않음을 확인한다.

---

## 구현 규칙

### AsyncLocalStorage 사용 원칙
- ALS는 request 스코프 전용이다. 모듈 레벨이나 장기 실행 context에 사용하지 않는다.
- `llmRoutingStorage.run(ctx, async () => { ... })`의 콜백은 반드시 async이며, 내부 모든 await가 같은 컨텍스트를 공유한다.
- 스코프 중첩 시 내부 스코프 값이 우선한다 (Story 4.3이 Story 4.2 값을 덮어씀).

### 헤더 이름 규칙
- `X-Thread-Id`, `X-Agent-Id` 정확히 사용 (대시, 단수형, 오케스트레이터와 통일).

### 금지사항
- OpenAI 클라이언트의 `defaultHeaders`를 수정하지 않는다 (싱글턴이라 전역 영향).
- `callLLM`이나 `generateChatResponse`의 시그니처를 변경하지 않는다 (ALS로 해결).
- `intentClassifier`, `logicalReasoning`, `thinkingEvolution`의 시그니처를 변경하지 않는다.
- ALS를 동기 전역 상태처럼 사용하지 않는다 (항상 `run()` 스코프 안에서만 유효).

---

## 리스크

### SSE streaming 경로에서 ALS 경계
`agent.transportHandler.handle(body)`가 async generator를 반환하는 경우(streaming), `ReadableStream`으로 래핑되어 route handler의 Promise가 resolve된 후 consumer가 pull할 수도 있다. 이 경우 Story 4.2의 상위 ALS 스코프가 stream consume 시점에 이미 닫혀 있을 수 있다.

**완화**: Story 4.3의 `execute()` 내부 ALS 스코프가 **LLM 호출 직전에 새로 열리므로**, 설령 상위 스코프가 소실되어도 executor 내부 LLM 호출은 안전하게 컨텍스트를 받는다. 단, 상위 스코프 값(incoming threadId)은 executor 진입 시점에 `getLLMRoutingContext()`로 읽은 직후 로컬 변수로 저장하므로, 그 이후 상위 스코프가 사라져도 문제없다.

### 인스턴스 편중
consistent hash 특성상 인기 thread나 agent가 특정 vLLM 인스턴스에 몰릴 수 있다. 빌더 코드로는 해결 불가이며, 운영 중 인스턴스별 요청 분포를 모니터링하여 편중이 심하면 hash key 전략 재검토 필요.

---

## 완료 조건
- [x] `src/lib/requestContext.ts`가 `llmRoutingStorage`와 `getLLMRoutingContext`를 export한다
- [x] POST `/api/agents/[agentId]` 대화 호출 시 incoming `X-Thread-Id` 헤더가 있으면 그대로 LLM 요청에 전달된다
- [x] incoming 헤더가 없으면 `contextId`가 `X-Thread-Id`로 사용된다
- [x] 모든 LLM 요청에 `X-Agent-Id` 헤더가 붙는다 (agentId 스코프 내)
- [x] `intentClassifier.classifyIntent` 호출의 LLM 요청에도 헤더가 자동으로 붙는다 (코드 변경 없이)
- [x] `logicalReasoning`의 3개 `callLLM` 호출에도 헤더가 자동으로 붙는다 (코드 변경 없이)
- [x] `thinkingEvolution.findIntentConnections`의 LLM 요청에도 헤더가 자동으로 붙는다 (코드 변경 없이)
- [x] `generate-agent` 요청의 LLM 호출에는 헤더가 붙지 않는다 (의도된 동작)
- [x] TypeScript 빌드(`npm run build`)가 에러 없이 통과한다
- [ ] 빌더 대시보드에서 대화 시나리오 확인 — 기존 동작 그대로 유지
