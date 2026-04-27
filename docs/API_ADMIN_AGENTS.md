# Admin API 명세 - 인증, 에이전트 조회 및 수정

> Admin dashboard에서 SIWE 지갑 서명으로 로그인하고, 에이전트 목록 조회·상세 메모리 조회·프롬프트 수정을 위한 API 명세

---

## 인증 (SIWE + JWT)

Admin API는 정적 시크릿(`X-Admin-Secret`)을 폐기하고 **SIWE(EIP-4361) 지갑 서명 + JWT** 방식을 사용한다. **Coinbase Smart Wallet (Base mainnet, chainId 8453)** 으로 로그인하며, 서버는 EIP-1271 / ERC-6492 검증을 모두 지원한다.

### 흐름

1. **Nonce 발급**: `GET /api/admin/auth/nonce?address={address}` → `{ nonce, expiresAt }`
2. **클라이언트**: 발급받은 nonce + dashboard 도메인 + chainId `8453` 등을 포함한 SIWE 메시지를 생성하고 지갑(Coinbase Smart Wallet)으로 서명한다.
3. **검증 + JWT 발급**: `POST /api/admin/auth/verify` body `{ message, signature }` → `{ token, expiresAt }`
4. **이후 요청**: `Authorization: Bearer <token>` 헤더로 admin 라우트 호출.

### 환경변수 요구사항 (서버)

| 변수 | 필수 | 설명 |
|---|---|---|
| `ADMIN_WALLETS` | O | 쉼표 구분 admin 지갑 주소 목록 (예: `0xabc,0xdef`). 여기에 없는 주소는 verify 단계에서 403. |
| `JWT_SECRET` | O | JWT(HS256) 서명·검증 키. 미설정 시 verify는 500, admin 라우트는 401 반환. |
| `ADMIN_DASHBOARD_URL` | O | CORS origin 및 SIWE message `domain` 검증의 기준 host. SIWE `domain`이 이 host와 다르면 401. |
| `ADMIN_RPC_URL` | X | Base mainnet RPC URL. 미설정 시 `https://mainnet.base.org`(공식 public RPC) 사용. 운영 트래픽이 늘면 유료 RPC로 교체 권장. |

### JWT 속성

- 알고리즘: `HS256`
- TTL: 8시간 (refresh 없음)
- Payload: `{ address }` + 표준 claim(`iat`, `exp`)

### Status Code 매핑

| 상태 | 의미 |
|---|---|
| 401 | Authorization 헤더 누락/형식 오류, JWT 만료/서명 불일치, `JWT_SECRET` 미설정, nonce 불일치, SIWE 도메인/만료 검증 실패, 서명 검증 실패 |
| 403 | JWT는 유효하나 address가 더 이상 `ADMIN_WALLETS`에 없음 (또는 verify 시점에 미허용) |
| 400 | SIWE chainId가 8453 아님, body/parameter 누락, SIWE 메시지 파싱 실패 |

---

## 권장 사용 흐름

1. `GET /api/admin/auth/nonce?address=0x...` → nonce 발급
2. SIWE 메시지 생성 + Coinbase Smart Wallet 서명
3. `POST /api/admin/auth/verify` + `{ message, signature }` → JWT 발급
4. `GET /api/admin/agents` + `Authorization: Bearer <token>` → 전체 에이전트 목록 + 메모리 요약 확인
5. `memorySummary`에서 factCount가 높은 에이전트/intent 식별
6. `GET /api/agents/{agentId}/status?intent=xxx&username=yyy` → 해당 에이전트의 상세 메모리 텍스트 조회 (인증 불필요)
7. 필요 시 `POST /api/admin/agents/{agentId}` + `Authorization: Bearer <token>` + `{ prompt }` body → 에이전트 시스템 프롬프트 수정
8. `GET /api/admin/agents`로 다시 조회하여 prompt 갱신을 확인

---

## 1. Admin 로그인 - Nonce 발급

### Request

```
GET /api/admin/auth/nonce
```

**Query Parameters:**

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `address` | O | 로그인하려는 지갑 주소. 서버는 `toLowerCase()`로 정규화하여 nonce를 저장한다. |

> 이 엔드포인트는 인증을 요구하지 않는다 (로그인 시작점).

### Response

#### 200 OK

```json
{
  "nonce": "9f1c1c2e-2d6c-4f8b-9e7a-1234567890ab",
  "expiresAt": "2025-01-01T12:05:00.000Z"
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `nonce` | string | UUID v4. SIWE 메시지의 `Nonce` 필드에 사용한다. address 당 1개만 유지되며, 새 요청 시 기존 값을 덮어쓴다. |
| `expiresAt` | string | nonce 만료 시각 (ISO 8601). TTL = 5분. |

#### 400 Bad Request

`address` 쿼리 파라미터가 누락된 경우.

```json
{ "error": "Missing required parameter: address" }
```

### 요청 예시

```bash
curl "https://your-server.com/api/admin/auth/nonce?address=0x1234abcd...5678"
```

---

## 2. Admin 로그인 - SIWE 검증 + JWT 발급

### Request

```
POST /api/admin/auth/verify
```

**Headers:**

| 헤더 | 필수 | 설명 |
|---|---|---|
| `Content-Type` | O | `application/json` |

**Request Body:**

```json
{
  "message": "your-server.com wants you to sign in with your Ethereum account:\n0x1234...\n\n...\n\nURI: https://your-server.com\nVersion: 1\nChain ID: 8453\nNonce: 9f1c1c2e-2d6c-4f8b-9e7a-1234567890ab\nIssued At: 2025-01-01T12:00:00.000Z\nExpiration Time: 2025-01-01T12:05:00.000Z",
  "signature": "0x..."
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `message` | string | O | EIP-4361 형식의 SIWE 메시지 원문. `Chain ID: 8453` 필수, `Domain`은 `ADMIN_DASHBOARD_URL` host와 일치해야 한다. |
| `signature` | string | O | 지갑(Coinbase Smart Wallet)으로 서명된 hex 문자열. EIP-1271 / ERC-6492 wrapped 서명 모두 허용. |

> 이 엔드포인트는 인증을 요구하지 않는다 (로그인 과정의 일부).

### Response

#### 200 OK

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2025-01-01T20:00:00.000Z"
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `token` | string | HS256 JWT. `Authorization: Bearer <token>` 헤더로 사용. |
| `expiresAt` | string | 토큰 만료 시각 (ISO 8601, 발급 시각 + 8시간). |

#### 400 Bad Request

```json
{ "error": "Missing required fields: message, signature" }
```
```json
{ "error": "Invalid SIWE message" }
```
```json
{ "error": "Unsupported chain" }
```

#### 401 Unauthorized

- 메시지 만료: `{ "error": "Message expired" }`
- 도메인 불일치: `{ "error": "Domain mismatch" }`
- 서명 검증 실패: `{ "error": "Invalid signature" }`
- nonce 누락/불일치/만료: `{ "error": "Invalid or expired nonce" }`

#### 403 Forbidden

서명은 유효하나 해당 주소가 `ADMIN_WALLETS`에 등록되지 않은 경우.

```json
{ "error": "Address not authorized as admin" }
```

#### 500 Internal Server Error

`JWT_SECRET` 미설정 또는 RPC 호출 실패 등.

```json
{ "error": "Server misconfiguration" }
```
```json
{ "error": "Verification failed" }
```

### 요청 예시

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "message": "your-server.com wants you to sign in...\nChain ID: 8453\nNonce: 9f1c...",
    "signature": "0x..."
  }' \
  https://your-server.com/api/admin/auth/verify
```

---

## 3. 에이전트 목록 조회 (Admin 모드)

### Request

```
GET /api/admin/agents
```

**Headers:**

| 헤더 | 필수 | 설명 |
|---|---|---|
| `Authorization` | O | `Bearer <jwt>` 형식. `POST /api/admin/auth/verify`로 발급받은 JWT를 사용한다. |

**Query Parameters:**

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `address` | X | 특정 지갑 주소로 필터링. 생략 시 전체 에이전트 반환 |

### Response

#### 200 OK

```json
{
  "agents": [
    {
      "id": "a1b2c3d4e5",
      "card": {
        "name": "My Agent",
        "description": "A helpful assistant",
        "url": "https://example.com/api/agents/a1b2c3d4e5",
        "protocolVersion": "0.3.0",
        "version": "1.0.0",
        "capabilities": {},
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "skills": [
          {
            "id": "general-chat",
            "name": "General Chat",
            "description": "General conversation",
            "tags": ["chat"]
          }
        ]
      },
      "prompt": "You are a helpful assistant...",
      "modelProvider": "google",
      "modelName": "gemini-2.0-flash",
      "creator": "0x1234...abcd",
      "intents": [
        {
          "name": "greeting",
          "description": "User greetings",
          "prompt": "Respond warmly to greetings"
        }
      ],
      "memorySummary": {
        "thinkingIntents": [
          { "intent": "greeting", "factCount": 5 },
          { "intent": "support", "factCount": 12 }
        ],
        "caringUsers": [
          { "username": "user1", "factCount": 3 },
          { "username": "0x5678...efgh", "factCount": 7 }
        ],
        "intentPatternCount": 2
      }
    }
  ]
}
```

**응답 필드:**

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 에이전트 고유 ID |
| `card` | object | A2A 프로토콜 AgentCard 전체 |
| `card.name` | string | 에이전트 이름 |
| `card.description` | string | 에이전트 설명 |
| `card.url` | string | 에이전트 엔드포인트 URL |
| `card.skills` | array | 스킬 목록 (id, name, description, tags) |
| `prompt` | string | 에이전트 시스템 프롬프트 |
| `modelProvider` | string | LLM 제공자 (`google`, `openai`, `anthropic`) |
| `modelName` | string | 모델명 |
| `creator` | string \| undefined | 생성자 지갑 주소 |
| `intents` | array \| undefined | Intent 목록 (name, description, prompt) |
| `memorySummary.thinkingIntents` | array | Intent별 thinking 메모리 fact 개수 |
| `memorySummary.caringUsers` | array | User별 caring 메모리 fact 개수 |
| `memorySummary.intentPatternCount` | number | 등록된 intent 패턴 수 |

#### 401 Unauthorized

`Authorization` 헤더가 누락/잘못되었거나, JWT가 만료/서명 불일치이거나, `JWT_SECRET`이 미설정된 경우.

```json
{ "error": "Unauthorized" }
```

#### 403 Forbidden

JWT는 유효하나 payload의 address가 더 이상 `ADMIN_WALLETS`에 없는 경우.

```json
{ "error": "Forbidden" }
```

### 요청 예시

```bash
# 전체 에이전트 조회
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  https://your-server.com/api/admin/agents

# 특정 지갑의 에이전트만 조회
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  "https://your-server.com/api/admin/agents?address=0x1234...abcd"
```

---

## 4. 에이전트 상세 메모리 조회

> 기존 API. 인증 불필요. 목록에서 확인한 에이전트의 상세 메모리 텍스트를 조회할 때 사용.

### Request

```
GET /api/agents/{agentId}/status
```

**Query Parameters:**

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `intent` | X | 조회할 intent 이름. 해당 intent의 thinking 메모리 상세 반환 |
| `username` | X | 조회할 사용자명. 해당 user의 caring 메모리 상세 반환 |

### Response

응답 구조는 query parameter 조합에 따라 달라진다. `thinking`과 `caring`은 각각 해당 파라미터가 있을 때만 데이터가 채워지고, 없으면 `null`이다. `allIntents`는 항상 반환된다.

#### 200 OK — 파라미터 없이 호출

`intent`와 `username` 모두 생략 시. intent 목록 + fact 개수 요약만 반환된다.

```bash
curl "https://your-server.com/api/agents/a1b2c3d4e5/status"
```

```json
{
  "agentId": "a1b2c3d4e5",
  "thinking": null,
  "caring": null,
  "allIntents": [
    { "intent": "greeting", "factCount": 5 },
    { "intent": "support", "factCount": 12 },
    { "intent": "general", "factCount": 0 }
  ]
}
```

#### 200 OK — `intent`만 지정

해당 intent의 thinking fact 목록이 반환된다. caring은 `null`.

```bash
curl "https://your-server.com/api/agents/a1b2c3d4e5/status?intent=greeting"
```

```json
{
  "agentId": "a1b2c3d4e5",
  "thinking": {
    "intent": "greeting",
    "facts": [
      "Users prefer casual tone",
      "Morning greetings are most common",
      "Some users greet in Korean"
    ],
    "factCount": 3
  },
  "caring": null,
  "allIntents": [
    { "intent": "greeting", "factCount": 3 },
    { "intent": "support", "factCount": 12 },
    { "intent": "general", "factCount": 0 }
  ]
}
```

#### 200 OK — `username`만 지정

해당 user의 caring fact 목록이 반환된다. thinking은 `null`.

```bash
curl "https://your-server.com/api/agents/a1b2c3d4e5/status?username=user1"
```

```json
{
  "agentId": "a1b2c3d4e5",
  "thinking": null,
  "caring": {
    "username": "user1",
    "facts": [
      "Prefers short responses",
      "Interested in blockchain topics"
    ],
    "factCount": 2
  },
  "allIntents": [
    { "intent": "greeting", "factCount": 3 },
    { "intent": "support", "factCount": 12 },
    { "intent": "general", "factCount": 0 }
  ]
}
```

#### 200 OK — `intent` + `username` 둘 다 지정

thinking과 caring 모두 반환된다.

```bash
curl "https://your-server.com/api/agents/a1b2c3d4e5/status?intent=greeting&username=user1"
```

```json
{
  "agentId": "a1b2c3d4e5",
  "thinking": {
    "intent": "greeting",
    "facts": [
      "Users prefer casual tone",
      "Morning greetings are most common",
      "Some users greet in Korean"
    ],
    "factCount": 3
  },
  "caring": {
    "username": "user1",
    "facts": [
      "Prefers short responses",
      "Interested in blockchain topics"
    ],
    "factCount": 2
  },
  "allIntents": [
    { "intent": "greeting", "factCount": 3 },
    { "intent": "support", "factCount": 12 },
    { "intent": "general", "factCount": 0 }
  ]
}
```

#### 200 OK — 존재하지 않는 intent/username 지정 시

해당 key에 메모리가 없으면 `null`로 반환된다 (404가 아님).

```bash
curl "https://your-server.com/api/agents/a1b2c3d4e5/status?intent=nonexistent"
```

```json
{
  "agentId": "a1b2c3d4e5",
  "thinking": null,
  "caring": null,
  "allIntents": [
    { "intent": "greeting", "factCount": 3 },
    { "intent": "support", "factCount": 12 }
  ]
}
```

**응답 필드:**

| 필드 | 타입 | 설명 |
|---|---|---|
| `agentId` | string | 에이전트 ID |
| `thinking` | object \| null | `?intent=` 지정 시 해당 intent의 thinking 메모리. 미지정이거나 해당 intent에 데이터 없으면 `null` |
| `thinking.intent` | string | Intent 이름 |
| `thinking.facts` | string[] | Thinking fact 목록 (메모리 텍스트를 `\n` 기준 split) |
| `thinking.factCount` | number | Fact 개수 |
| `caring` | object \| null | `?username=` 지정 시 해당 user의 caring 메모리. 미지정이거나 해당 user에 데이터 없으면 `null` |
| `caring.username` | string | 사용자명 |
| `caring.facts` | string[] | Caring fact 목록 |
| `caring.factCount` | number | Fact 개수 |
| `allIntents` | array | 전체 intent 목록과 각 thinking fact 개수. 항상 반환됨. caring user 목록은 포함되지 않음 |
| `allIntents[].intent` | string | Intent 이름 |
| `allIntents[].factCount` | number | 해당 intent의 fact 개수. `(empty)` 값은 0으로 처리 |

> **참고:** `allIntents`는 thinking 메모리 기준 목록만 제공한다. caring 메모리의 전체 user 목록은 이 API에서 제공하지 않으며, admin list API의 `memorySummary.caringUsers`에서 확인할 수 있다.

#### 404 Not Found

agentId에 해당하는 에이전트가 존재하지 않는 경우.

```json
{ "error": "Agent not found" }
```

---

## 5. 에이전트 프롬프트 수정 (Admin 모드)

> Admin이 creator 검증 없이 에이전트의 시스템 프롬프트를 수정할 수 있는 경량 엔드포인트.
> 일반 creator 기반 수정은 `PUT /api/agents/{agentId}/edit`를 사용한다 (이 엔드포인트와 무관).

### Request

```
POST /api/admin/agents/{agentId}
```

**Headers:**

| 헤더 | 필수 | 설명 |
|---|---|---|
| `Authorization` | O | `Bearer <jwt>` 형식. `POST /api/admin/auth/verify`로 발급받은 JWT를 사용한다. |
| `Content-Type` | O | `application/json` |

**Path Parameters:**

| 파라미터 | 설명 |
|---|---|
| `agentId` | 수정할 에이전트의 ID |

**Request Body:**

```json
{
  "prompt": "You are a helpful assistant. Always respond concisely."
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `prompt` | string | O | 새로운 시스템 프롬프트. 빈 문자열은 허용되지 않음. 그 외 필드는 무시된다. |

### Response

#### 200 OK

```json
{
  "success": true,
  "agentId": "a1b2c3d4e5",
  "prompt": "You are a helpful assistant. Always respond concisely."
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `success` | boolean | 항상 `true` |
| `agentId` | string | 수정된 에이전트 ID |
| `prompt` | string | 저장된 새로운 프롬프트 |

#### 400 Bad Request

`prompt` 필드가 누락되었거나 빈 문자열인 경우.

```json
{ "error": "Missing required field: prompt" }
```

#### 401 Unauthorized

`Authorization` 헤더가 누락/잘못되었거나, JWT가 만료/서명 불일치이거나, `JWT_SECRET`이 미설정된 경우.

```json
{ "error": "Unauthorized" }
```

#### 403 Forbidden

JWT는 유효하나 payload의 address가 더 이상 `ADMIN_WALLETS`에 없는 경우.

```json
{ "error": "Forbidden" }
```

#### 404 Not Found

`agentId`에 해당하는 에이전트가 존재하지 않는 경우.

```json
{ "error": "Agent not found" }
```

#### 500 Internal Server Error

저장 중 예상치 못한 오류가 발생한 경우.

```json
{ "error": "Failed to update agent prompt" }
```

### 요청 예시

```bash
curl -X POST \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"prompt": "You are a helpful assistant. Always respond concisely."}' \
  https://your-server.com/api/admin/agents/a1b2c3d4e5
```
