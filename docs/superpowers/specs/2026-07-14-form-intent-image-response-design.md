# 폼 인텐트 이미지 답변 — 설계 문서

- 날짜: 2026-07-14
- 상태: 설계 확정 (구현 계획 작성 전)

## 1. 목표

에이전트 생성 폼에서 정의하는 **폼 인텐트**(`Intent { name, description, prompt }`)에
이미지를 첨부할 수 있게 하고, 대화 중 해당 인텐트가 매칭되면 **텍스트 답변과 함께 이미지를
답변으로 전송**한다.

핵심 사용 사례: **인텐트당 고정 이미지 여러 장**(최대 3장). 운영자가 인텐트를 만들 때
이미지를 업로드해두면, 그 인텐트가 매칭될 때 해당 이미지들이 답변에 실려 나간다.

## 2. 배경 / 현재 구조

두 가지 서로 다른 "인텐트" 개념이 있으며, 본 설계는 **폼 인텐트**만 다룬다.

| | 폼 인텐트 (본 설계 대상) | 자동 인텐트 (`classifyIntent`) |
|---|---|---|
| 정체 | 운영자가 폼에 입력하는 응답 규칙 | 런타임 생성 주제 라벨 |
| 형태 | `Intent { name, description, prompt }` | 문자열 하나 |
| 저장 | Redis `intent:{agentId}` (`intentStore.ts`) | agent 객체 내부 `intentPatterns`/`thinkingMemories` |
| 매칭 | LLM이 프롬프트 안에서 자체 선택 | 코드(패턴→LLM) |
| 상태 | 사용 중 | 프로덕션 미사용 |

두 시스템은 코드상 독립적이며 연결이 없다. 본 설계는 자동 인텐트 시스템을 건드리지 않는다.

### 현재 흐름의 제약

- **응답은 텍스트(`TextPart`)만** 나간다. executor가 LLM 응답 문자열을
  `parts: [{ kind: "text", text }]`로만 감싸 발행한다
  (`src/app/api/agents/[agentId]/[[...path]]/route.ts:266-277`).
- 폼 인텐트 매칭은 **LLM이 시스템 프롬프트 안에서 자체적으로** 수행한다
  (`buildPromptWithIntents`, `src/lib/promptBuilder.ts:13-45`). 즉 **코드는 어떤 폼
  인텐트가 매칭됐는지 알지 못한다.**
- 트랜스포트(A2A SDK → JSON-RPC → SSE)는 `parts`를 그대로 직렬화하므로
  `FilePart`를 이미 나를 수 있다. 변경 불필요.
- 클라이언트 렌더는 `TextPart`만 필터링한다 (`src/app/chat/HomeContent.tsx:247-251`).
- 프로젝트에 **파일/이미지 업로드·저장 인프라가 없다** (Redis만 사용, S3/blob/multipart 없음).

## 3. 결정 사항 요약

| 항목 | 결정 |
|---|---|
| 이미지 성격 | 인텐트당 고정 이미지 여러 장 (최대 3장) |
| 이미지 소스 | 파일 업로드 → GCP 버킷 저장, **응답엔 URL만**(`FilePart.uri`) |
| 버킷 접근 | 공개 URL (public-read) |
| 매칭 감지 | **2콜 분리 분류** — 생성과 별개의 분류 호출로 폼 인텐트를 코드가 확정 |
| 생성 프롬프트 | 매칭된 인텐트의 `prompt`만 주입(전체 카탈로그 대신) → 토큰 절약 |
| 답변 구성 | 텍스트 + 이미지 |
| 도배 방지 | 분류기가 `sendImage`까지 판별 + 코드가 "이미 보낸 인텐트" 힌트 주입(Redis sent-set 기반). 결정적 가드는 제외 |
| 허용 MIME | `image/png`, `image/jpeg`, `image/webp`, `image/gif` |
| 용량 상한 | 5MB/장 |
| 인텐트당 최대 | 3장 |

## 4. 아키텍처 & 실행 흐름

### 신규 컴포넌트: 폼 인텐트 분류기

`classifyFormIntent` — 기존 `classifyIntent`(자동 주제 라벨)와 **별개의 전용 함수**로 신설.
executor의 생성 호출 **직전**에 매 턴 실행한다(레이트리밋 없음 — 이미지 트리거는 해당
메시지가 왔을 때 즉시 잡아야 함). 분류는 경량 프롬프트라 비용이 작다. 모델은 생성과 동일
모델 사용.

- **폼 인텐트가 0개인 에이전트는 분류기를 완전히 스킵**하고 기존 텍스트 경로를 탄다
  (비용/지연 0). `buildPromptWithIntents`가 intents 없으면 base를 그대로 반환하는 것과
  동일 원칙.
- 분류 대상은 **전체 폼 인텐트**(이미지 유무 무관). intent 매칭과 `sendImage`를 한 번에
  판단하며, 이미지가 없는 인텐트로 매칭되면 `sendImage` 값은 코드가 무시한다.
- 턴당 LLM 콜은 자동 `classifyIntent`(1분 rate-limit·미사용) + `classifyFormIntent` +
  생성으로, 실질 2회. 지연 인지는 해둔다.

**입력**
- 사용자 메시지 + 최근 대화 맥락
- 폼 인텐트 목록의 `name` + `description`만 (전체 `prompt`는 불필요)
- **이번 대화에서 이미 이미지를 보낸 인텐트 목록** (코드가 history의 `metadata`에서 결정적으로 추출해 주입)

**출력**
```ts
{ intent: string | null, sendImage: boolean }
```
- `intent`: 매칭된 폼 인텐트 `name`, 매칭 없으면 `null`
- `sendImage`: 이번 턴에 이미지를 실을지 LLM이 판단

**분류기 지시 요지**
- 사용자가 이 주제를 처음 물었거나 다시 보여달라고 명시하면 `sendImage: true`
- 같은 주제를 이어서 대화 중이고 이미 이미지를 보여줬으면 `sendImage: false`
- (이미 보낸 인텐트 목록은 코드가 주입한 값을 근거로 사용)

파싱/호출 실패 시 `{ intent: null, sendImage: false }`로 폴백.

### 턴 실행 흐름 (`DynamicAgentExecutor.execute`)

```
사용자 메시지 도착
  ↓
① Redis sent-set(intent-images-sent:{contextId}) read → "이미 이미지를 보낸 인텐트 목록"
  ↓
② classifyFormIntent(폼인텐트[name,desc], 사용자메시지, 최근맥락, 이미보낸목록)
     → { intent, sendImage }                                   [신규 LLM 콜]
  ↓
③ 생성 프롬프트 구성
   - intent 매칭: base + 그 인텐트의 prompt만 주입
   - 매칭 없음:   base만
  ↓
④ callLLM → responseText                                       [기존 생성 콜]
  ↓
⑤ parts 조립
   - intent 있고, 그 인텐트에 images 있고, sendImage === true:
       [TextPart(responseText), FilePart(uri,mimeType)…]
       → Redis sent-set 에 intentName add (TTL 갱신)
   - 그 외:
       [TextPart(responseText)]
  ↓
⑥ responseMessage.metadata.intent = 매칭된 폼 인텐트 name (관측성)
  ↓
⑦ eventBus.publish → (SDK·JSON-RPC·SSE 무수정) → 클라이언트
```

> **도배 방지 상태는 Redis에 둔다.** "이미 이미지를 보낸 인텐트"는 휘발성
> `historyStore`가 아니라 Redis sent-set(`intent-images-sent:{contextId}`)에서 읽고 쓴다.
> 대화 메시지 히스토리 자체는 Redis에 저장되지 않으므로(§10 참조) 이 최소 상태만 영속화한다.
> 이로써 서버리스 콜드스타트/인스턴스 분리에도 도배 방지가 유지된다. `metadata.intent`는
> 관측성 용도로만 남긴다.

> **구조 변경 주의**: 현재 폼 인텐트는 `ensureAgentHandlers`
> (`route.ts:337-339`)에서 `buildPromptWithIntents`로 **핸들러 생성 시 1회** 전체
> 주입되어 executor 생성자에 넘어간다. ②-(A)의 "매칭된 하나만 주입"을 위해선 executor가
> raw 인텐트 목록에 접근해 **매 턴 프롬프트를 선택적으로 구성**하도록 옮겨야 한다.
> `buildPromptWithIntents`를 "선택된 인텐트 하나만 주입" 버전으로 조정하거나 신규 함수를
> 만든다. 자동 인텐트 시스템의 시스템 프롬프트 구성(`buildSystemPrompt`)과 충돌하지 않게
> 결합한다.

## 5. 데이터 모델

### `Intent` 타입 확장 (`src/types/agent.ts`)

```ts
interface Intent {
  name: string;
  description: string;
  prompt: string;
  images?: IntentImage[];   // 신규, optional (최대 3)
}

interface IntentImage {
  url: string;      // GCS 버킷 공개 URL
  mimeType: string; // 업로드 시점 확정 → FilePart.file.mimeType 에 사용
}
```

- `optional`이므로 **기존 인텐트 데이터 마이그레이션 불필요**. 이미지가 없으면 기존 동작 그대로.
- `mimeType`을 함께 저장해 응답 조립 시 확장자 추론 없이 정확한 `FilePart` 생성.

### 저장

폼 인텐트는 이미 `src/lib/intentStore.ts`의 `intent:{agentId}` Redis 키에 배열로 저장된다.
`images`는 그 배열 요소에 얹혀 자동 직렬화되므로 **저장 계층 스키마 변경 없음**. 배포
(`src/app/api/deploy-agent/route.ts`)·편집(`.../agents/[agentId]/edit/route.ts`) 경로 그대로.

### 도배 방지 상태 (신규 Redis 키)

- `REDIS_KEYS`(`src/lib/redis.ts:194`)에 `INTENT_IMAGES_SENT: (contextId) =>
  intent-images-sent:${contextId}` 추가.
- 값: 이미지가 이미 전송된 폼 인텐트 name의 Set (Redis set).
- TTL: 대화 만료를 위해 만료 시간 설정(예: 24h), 전송마다 갱신.
- `contextId`는 클라이언트가 대화 세션 동안 유지(`HomeContent.tsx:34`)하므로 연속 대화
  전체에서 동일 키를 공유한다. 새로고침 시 새 `contextId` → 새 대화로 리셋(기존 동작과 동일).

## 6. 업로드 경로 (신규)

```
POST /api/agents/[agentId]/upload-image   (multipart/form-data)
  → 검증: MIME(png/jpeg/webp/gif), 용량 ≤ 5MB
  → @google-cloud/storage 로 버킷 업로드 (public-read)
  → { url, mimeType } 반환
```

- 신규 의존성: `@google-cloud/storage`
- 신규 env: `GCS_BUCKET_NAME`, 서비스 계정 자격증명(`GOOGLE_APPLICATION_CREDENTIALS` 또는 ADC)
- 인텐트당 최대 3장 제약은 **폼 UI + 저장 검증** 양쪽에서 적용
  (업로드 엔드포인트는 단건 처리, 장수 제한은 폼/인텐트 저장 시점 검증).

## 7. 컴포넌트별 변경

### 생산자 (executor, `route.ts:266-277`)

```ts
const parts: Part[] = [{ kind: "text", text: responseText }];
if (matched?.images?.length && sendImage) {
  for (const img of matched.images) {
    parts.push({ kind: "file", file: { uri: img.url, mimeType: img.mimeType } });
  }
}
// responseMessage.parts = parts; metadata에 intent + 이미지첨부여부 기록
```

### 트랜스포트

변경 없음. SDK·JSON-RPC·SSE가 `parts`를 그대로 직렬화한다.

### 폼 UI (`src/components/AgentForm.tsx`)

- 인텐트 편집 영역에 이미지 업로드 UI 추가 (인텐트당 add/remove, 최대 3장).
- 파일 선택 시 `upload-image` 엔드포인트 호출 → 반환 `{url, mimeType}`를 해당 인텐트의
  `images[]`에 push. 썸네일 미리보기 + 삭제.
- 관련 연결: `src/components/AgentBuilder.tsx`, `src/components/EditAgentModal.tsx`.

### 클라이언트 렌더 (`src/app/chat/HomeContent.tsx:247-251`)

```tsx
message.parts.map((part, i) =>
  part.kind === 'text' ? <span key={i}>{part.text}</span> :
  part.kind === 'file' && isImageMime(part.file.mimeType)
      ? <img key={i} src={part.file.uri} onError={hide} className="max-w-full ..." /> :
  null
);
```
- `import`에 `FilePart` 추가. 깨진 URL은 `onError`로 조용히 숨김.

### 에이전트 카드 (`route.ts:387` 및 배포/샘플 경로)

- `defaultOutputModes: ["text"]`
  → `["text", "image/png", "image/jpeg", "image/webp", "image/gif"]`
  (A2A 클라이언트에 이미지 출력 능력 광고).

## 8. 에러 처리

- 분류 LLM 실패/파싱 실패 → `{ intent: null, sendImage: false }` 폴백, 정상 텍스트 응답.
- GCS 업로드 실패 → 엔드포인트 4xx/5xx + 폼 에러 표시. 이미지 없이 인텐트 저장은 가능.
- 깨진 이미지 URL → 클라이언트 `onError`로 조용히 숨김.

## 9. 테스트 (레포 컨벤션: 테스트 러너 없음 → `tsx` 어서션 스크립트)

- `classifyFormIntent` 파싱: 매칭/`null`/오염 응답 → 기대 반환. `sendImage` 파싱.
- 도배 방지 sent-set: Redis read/add 라운드트립, TTL 설정, `contextId`별 격리.
- 생산자 parts 조립: images 유무 × `sendImage` 조합에 따른 parts 배열.
- `intentStore` 라운드트립: `images` 포함 저장·로드.
- 업로드 엔드포인트 검증 로직: MIME/용량 단위 테스트, 인텐트당 ≤3 검증.

## 10. 알려진 한계 & 구현 시 검증

**히스토리 영속성 사실관계**
- 대화 메시지 히스토리는 **Redis에 저장되지 않는다.** Redis 키는 `agent:{id}`,
  `agents:list`, `skill:{id}`, `admin:nonce`, `intent:{id}`뿐이다(`redis.ts:194-199`).
  턴별 메시지는 인메모리 `historyStore`(`route.ts:30`, `private static`)와 A2A
  `InMemoryTaskStore`에만 있어 프로세스 로컬·휘발성이다.
- 따라서 "인메모리가 비면 Redis에서 히스토리를 복원" 은 소스가 없어 불가능하다. 대신
  §4·§5의 **도배 방지 sent-set**만 Redis에 영속화하여, 히스토리 유실과 무관하게 연속
  대화의 도배 방지를 유지한다.

**남은 degradation (수용)**
- 페이지 새로고침 시 클라이언트가 새 `contextId`를 생성하므로 sent-set이 비게 되어
  이미지가 다시 한 번 전송될 수 있다. 이는 새 대화의 시작으로 간주되는 지점이며 기존
  인메모리 히스토리도 동일하게 리셋되므로 퇴행이 아니다.

**구현 시 검증 항목**
- `@a2a-js/sdk`의 `FilePart` 실제 타입(`kind: "file"`, `file.uri`, `file.mimeType`
  필드명)을 코드 작성 시작 시 타입으로 확인. 본 스펙의 형태는 프로토콜 통례 기준 가정.
- 편집용 에이전트 로드 경로가 `intents`를 `getIntents`로 하이드레이션할 때 `images`까지
  포함하는지 확인(현재 편집 저장 경로는 `Intent[]`를 그대로 `setIntents` 하므로
  라운드트립 자체는 안전).

## 11. 범위 밖 (Non-goals)

- 자동 인텐트(`classifyIntent`)/지식 진화 시스템 변경.
- 동적으로 생성/선택되는 이미지 (본 설계는 인텐트당 고정 에셋만).
- 서명 URL(signed URL), 외부 스토리지 외 대안.
- base64 인라인 전송 (URL 방식만).
- **에이전트-투-에이전트 소비.** 입력 파싱이 text part만 읽으므로, 다른 에이전트가 이
  에이전트를 호출하면 `FilePart`는 무시된다. 이미지는 **사람 대상 채팅 전용**이며 A2A
  협업 경로의 이미지 수신은 다루지 않는다.
