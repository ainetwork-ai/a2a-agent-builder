# EPIC5 - Admin Route Separation (관리자 라우트 분리 + 프롬프트 수정 API)

> 기존 `/api/agents/list`에 혼재된 admin 분기를 `/api/admin/agents`로 분리하고, 프롬프트 수정 POST 엔드포인트를 추가한다. 인증은 기존 `X-Admin-Secret` 방식을 유지한다.

## 의존성
- EPIC3 (Admin Agent List API) — 현재 `list/route.ts`의 admin 분기 코드가 이전 대상

## 목표
- Admin 전용 라우트를 `/api/admin/agents` 하위로 분리하여 일반 API와 관심사 분리
- `X-Admin-Secret` 검증 로직을 공용 헬퍼로 추출하여 중복 제거
- Admin이 에이전트의 prompt를 수정할 수 있는 POST 엔드포인트 추가
- `/api/agents/list`에서 admin 분기를 제거하여 코드 단순화
- 일반 모드(`/api/agents/list`) 응답은 기존과 완전히 동일하게 유지

---

## Story 5.1: Admin 인증 헬퍼 추출

**생성 파일:** `src/lib/adminAuth.ts`

### 배경
현재 admin 인증 로직은 `src/app/api/agents/list/route.ts:20-30`에 인라인으로 구현되어 있다:

```typescript
// route.ts:20-30
const adminSecret = request.headers.get('X-Admin-Secret');
let isAdmin = false;

if (adminSecret) {
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (!adminApiKey || adminSecret !== adminApiKey) {
    const corsHeaders = getCorsHeaders(request);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }
  isAdmin = true;
}
```

이 로직이 새로운 admin GET/POST 라우트에서도 동일하게 필요하므로, 공용 헬퍼로 추출한다. `countFacts` 헬퍼(route.ts:10-13)도 admin 목록에서만 사용되므로 함께 이동한다.

### 참고 파일
- `src/app/api/agents/list/route.ts:10-30` — 현재 admin 인증 + countFacts 로직
- `src/lib/utils/cors.ts` — CORS 헤더 유틸 (인증 실패 응답에서 사용)

### 태스크

#### adminAuth 모듈 생성
- [x] `src/lib/adminAuth.ts` 파일을 생성한다.
- [x] `verifyAdminSecret(request: NextRequest): NextResponse | null` 함수를 구현한다:
  - `request.headers.get('X-Admin-Secret')`로 헤더 값을 읽는다.
  - 헤더가 없으면 `NextResponse.json({ error: 'Unauthorized' }, { status: 401 })` + CORS 헤더를 반환한다.
  - `process.env.ADMIN_API_KEY`가 미설정이거나 헤더 값과 불일치하면 동일한 401 응답을 반환한다.
  - 인증 성공이면 `null`을 반환한다 (호출자가 `null` 체크로 분기).
- [x] `countFacts(text: string): number` 함수를 이동한다. 로직은 기존과 동일: `text.split('\n').filter(f => f.trim()).length`, `'(empty)'`이면 0 반환.
- [x] 두 함수 모두 export한다.

### 주의사항
- `verifyAdminSecret`은 admin 라우트에서만 호출된다. 일반 라우트(`/api/agents/list`)에서는 사용하지 않는다 — 일반 라우트에는 더 이상 admin 인증 코드가 없다.
- CORS 헤더는 반드시 에러 응답에도 포함해야 한다 (대시보드가 CORS 에러 대신 401을 받아야 함).

---

## Story 5.2: Admin 에이전트 목록 GET 라우트 이전

**생성 파일:** `src/app/api/admin/agents/route.ts`
**수정 파일:** `src/app/api/agents/list/route.ts`, `src/lib/utils/cors.ts`

### 배경
현재 `list/route.ts:48-73`의 `isAdmin` 분기가 admin 전용 응답을 생성한다:

```typescript
// route.ts:48-73
if (isAdmin) {
  const thinkingMemories = agent.thinkingMemories || {};
  const caringMemories = agent.caringMemories || {};
  const intentPatterns = agent.intentPatterns || {};
  return {
    id: agentId,
    card: agent.card,
    prompt: agent.prompt,
    ...
    memorySummary: { thinkingIntents, caringUsers, intentPatternCount },
  };
}
```

이 코드를 새 라우트 `src/app/api/admin/agents/route.ts`로 이동하고, 기존 `list/route.ts`에서는 admin 분기, `countFacts`, `isAdmin` 관련 코드를 모두 제거한다.

### 참고 파일
- `src/app/api/agents/list/route.ts` — 이전 대상 코드 (admin 분기 전체)
- `src/lib/agentStore.ts:108-126` — `getAllAgents()` 함수
- `src/lib/intentStore.ts:21-25` — `getIntents()` 함수
- `src/lib/adminAuth.ts` — Story 5.1에서 생성한 인증 헬퍼

### 태스크

#### Admin GET 라우트 생성
- [x] `src/app/api/admin/agents/route.ts` 파일을 생성한다.
- [x] `OPTIONS` 핸들러를 추가한다 (`corsOptions(request)` 호출).
- [x] `GET` 핸들러를 구현한다:
  1. `verifyAdminSecret(request)`를 호출하여 인증 실패 시 401 응답을 즉시 반환한다.
  2. `searchParams.get('address')`로 선택적 지갑 필터를 읽는다.
  3. `getAllAgents()`로 전체 에이전트를 조회하고, `address`가 있으면 `creator` 기준으로 필터링한다 (기존 route.ts:35-39 로직 동일).
  4. 각 에이전트에 대해 `getIntents(agentId)`를 호출하고 admin 응답 형태를 생성한다:
     ```typescript
     {
       id, card, prompt, modelProvider, modelName, creator, intents,
       memorySummary: { thinkingIntents, caringUsers, intentPatternCount }
     }
     ```
  5. `NextResponse.json({ agents }, { headers: corsHeaders })`로 반환한다.

#### 기존 list 라우트 정리
- [x] `list/route.ts`에서 다음을 제거한다:
  - `countFacts` 함수 (route.ts:10-13)
  - `X-Admin-Secret` 헤더 읽기 및 검증 로직 (route.ts:19-30)
  - `isAdmin` 변수 및 admin 분기 (route.ts:48-73)
  - 로그의 `isAdmin ? '(admin)' : ''` 부분 (route.ts:97)
- [x] 일반 모드 응답 로직만 남긴다 (route.ts:77-89의 return 블록).

#### CORS 업데이트
- [x] `src/lib/utils/cors.ts`의 `getCorsHeaders` 함수에서 `Access-Control-Allow-Methods`에 `POST`를 추가한다: `'GET, POST, OPTIONS'`.

### 주의사항
- 일반 모드의 응답 형태는 한 글자도 바꾸지 않는다. 프론트엔드(`DeployedAgents.tsx`)가 이 응답에 의존한다.
- `getAllAgents`, `getIntents` import는 새 admin 라우트에도 동일하게 필요하다.
- address 필터링 시 `toLowerCase()` 비교는 기존 로직을 그대로 가져간다.

---

## Story 5.3: Admin 프롬프트 수정 POST 라우트 추가

**생성 파일:** `src/app/api/admin/agents/[agentId]/route.ts`

### 배경
현재 에이전트 수정은 `/api/agents/[agentId]/edit` PUT 엔드포인트(edit/route.ts)에서 creator 지갑 주소 기반으로 권한을 검증한다:

```typescript
// edit/route.ts:26-32
if (agent.creator && agent.creator !== address) {
  return NextResponse.json(
    { error: 'Unauthorized: Only the creator can edit this agent' },
    { status: 403 }
  );
}
```

Admin은 creator가 아니어도 prompt를 수정할 수 있어야 한다. 기존 PUT은 모든 필드를 필수로 요구하므로(edit/route.ts:35), prompt만 수정하는 admin 전용 경량 엔드포인트가 필요하다.

### 참고 파일
- `src/app/api/agents/[agentId]/edit/route.ts` — 기존 creator 기반 PUT (수정하지 않음)
- `src/lib/agentStore.ts:95-106` — `getAgent()`, `setAgent()` 함수
- `src/lib/adminAuth.ts` — Story 5.1에서 생성한 인증 헬퍼

### 태스크

#### Admin POST 라우트 생성
- [ ] `src/app/api/admin/agents/[agentId]/route.ts` 파일을 생성한다.
- [ ] `OPTIONS` 핸들러를 추가한다.
- [ ] `POST` 핸들러를 구현한다. 시그니처: `POST(request: NextRequest, { params }: { params: Promise<{ agentId: string }> })`.
  1. `verifyAdminSecret(request)`를 호출하여 인증 실패 시 401을 반환한다.
  2. `params`에서 `agentId`를 추출한다.
  3. `request.json()`으로 body를 파싱하고 `prompt` 필드를 추출한다.
  4. `prompt`가 없거나 빈 문자열이면 `{ error: 'Missing required field: prompt' }`, 400을 반환한다.
  5. `getAgent(agentId)`를 호출하고, 에이전트가 없으면 `{ error: 'Agent not found' }`, 404를 반환한다.
  6. `setAgent(agentId, { ...agent, prompt })`로 prompt만 갱신한다.
  7. 성공 시 `{ success: true, agentId, prompt }`를 반환한다.
  8. 모든 응답에 CORS 헤더를 포함한다.
- [ ] try-catch로 감싸고 에러 시 `{ error: 'Failed to update agent prompt' }`, 500을 반환한다.

### 주의사항
- Body에서 `prompt` 외의 필드는 무시한다. 향후 수정 가능 필드 확장 시 이 라우트에 추가할 수 있다.
- 기존 `/api/agents/[agentId]/edit` PUT은 수정하지 않는다 — creator 기반 수정 경로는 그대로 유지한다.
- `setAgent`은 전체 `StoredAgent`를 받으므로 반드시 기존 agent에 spread 후 prompt만 덮어씌운다.

---

## Story 5.4: API 명세 문서 업데이트

**수정 파일:** `docs/API_ADMIN_AGENTS.md`

### 배경
EPIC3(Story 3.2)에서 작성한 API 명세 문서가 기존 경로(`/api/agents/list` + `X-Admin-Secret`)를 기준으로 되어 있다. 라우트 분리 후 경로가 변경되므로 문서를 갱신해야 한다.

### 참고 파일
- `docs/API_ADMIN_AGENTS.md` — 현재 명세 (경로 변경 대상)
- `src/app/api/admin/agents/route.ts` — Story 5.2에서 생성한 라우트
- `src/app/api/admin/agents/[agentId]/route.ts` — Story 5.3에서 생성한 라우트

### 태스크

#### 명세 문서 갱신
- [ ] 엔드포인트 1(에이전트 목록 조회)의 경로를 `GET /api/agents/list`에서 `GET /api/admin/agents`로 변경한다.
- [ ] 엔드포인트 2(에이전트 상세 메모리 조회)는 경로 변경 없음 (`GET /api/agents/{agentId}/status`). 인증 불필요인 점 유지.
- [ ] 엔드포인트 3을 추가한다: `POST /api/admin/agents/{agentId}` (프롬프트 수정).
  - 인증: `X-Admin-Secret` 헤더 필수
  - Request Body: `{ "prompt": "new system prompt text" }`
  - 성공 응답 (200): `{ "success": true, "agentId": "...", "prompt": "..." }`
  - 에러 응답: 400 (prompt 누락), 401 (인증 실패), 404 (에이전트 없음)
  - 요청/응답 예시 (curl + JSON)
- [ ] 권장 사용 흐름 섹션에 prompt 수정 흐름을 추가한다.
- [ ] curl 예시의 URL을 새 경로로 변경한다.

### 주의사항
- 기존 status API 관련 내용은 그대로 유지한다.
- 실제 구현된 응답 구조와 일치하도록 Story 5.2, 5.3 완료 후에 작성한다.

---

## 구현 규칙

### 인증
- `X-Admin-Secret` 헤더로만 인증한다. 이 EPIC에서 인증 방식 자체를 변경하지 않는다 (JWT/Wallet 인증은 별도 EPIC).
- 모든 `/api/admin/*` 라우트는 `verifyAdminSecret` 헬퍼를 사용한다.
- 환경변수 `ADMIN_API_KEY`가 미설정이면 admin 요청은 항상 401을 반환한다.

### API 설계
- Admin 라우트는 `src/app/api/admin/` 하위에만 생성한다.
- POST body에서 명시적으로 허용한 필드 외에는 무시한다.
- 모든 admin 라우트에 OPTIONS 핸들러를 포함한다 (CORS preflight).

### 금지사항
- 프론트엔드 코드를 수정하지 않는다.
- 기존 `/api/agents/list`의 일반 모드 응답 구조를 변경하지 않는다.
- 기존 `/api/agents/[agentId]/edit` PUT 라우트를 수정하지 않는다.
- 기존 `/api/agents/[agentId]/status` 라우트를 수정하지 않는다.
- Redis 스키마나 StoredAgent 타입을 변경하지 않는다.

---

## 완료 조건
- [ ] `GET /api/admin/agents` + `X-Admin-Secret`으로 에이전트 목록 + `memorySummary`가 반환된다
- [ ] `GET /api/admin/agents?address=0x...` + `X-Admin-Secret`으로 특정 지갑 에이전트만 필터링된다
- [ ] `POST /api/admin/agents/{agentId}` + `X-Admin-Secret` + `{ prompt }` body로 prompt가 수정된다
- [ ] 수정된 prompt가 `GET /api/admin/agents`에서 반영되어 조회된다
- [ ] `X-Admin-Secret` 없이 `/api/admin/*`를 호출하면 401이 반환된다
- [ ] `X-Admin-Secret`에 잘못된 키를 보내면 401이 반환된다
- [ ] `ADMIN_API_KEY` 환경변수 미설정 시 admin 요청은 401을 반환한다
- [ ] 기존 `GET /api/agents/list` (헤더 없이)는 이전과 동일한 응답을 반환한다 (일반 모드 무변경)
- [ ] 기존 `GET /api/agents/list` + `X-Admin-Secret` 호출 시 admin 분기 없이 일반 응답만 반환된다 (호환성 미제공, 하드 컷오버)
- [ ] `docs/API_ADMIN_AGENTS.md`가 새 경로 기준으로 갱신된다
