# Admin Dashboard 통합 가이드

> Admin dashboard(별도 프로젝트)에서 a2a-agent-builder 서버와 통합하기 위한 클라이언트 가이드. 인증·API·에러 처리·코드 예시를 포함.

> ✅ **상태**: EPIC6 (Wallet JWT Auth) 적용 완료. 본 문서는 현재 서버 동작 기준이다. `X-Admin-Secret` 정적 키 인증은 폐기되었다.

---

## 0. 개요

- **인증 방식**: Coinbase Smart Wallet → SIWE 서명 → JWT 발급 → Bearer 토큰
- **지원 체인**: Base mainnet (chainId 8453) **only**
- **JWT 수명**: 8시간, refresh token 없음 (만료 시 재로그인)
- **Wallet 종류**: Coinbase Smart Wallet **only** (EIP-1271 + ERC-6492 검증)
- **Base URL**: `https://<server-host>` (운영 서버 URL은 별도 전달)

---

## 1. 사전 준비

### 1.1 서버 측 환경변수 (참고용)

서버에 다음이 설정되어 있어야 dashboard가 동작합니다:

| 변수 | 설명 |
|---|---|
| `ADMIN_DASHBOARD_URL` | Dashboard origin (CORS 및 SIWE domain 검증) |
| `ADMIN_WALLETS` | 허용된 admin smart wallet 주소 CSV (`0xabc,0xdef`) |
| `JWT_SECRET` | JWT 서명 키 |
| `ADMIN_RPC_URL` | Base mainnet RPC (옵션, 기본값 `https://mainnet.base.org`) |

**Dashboard 사용자가 admin이 되려면** 본인의 Coinbase Smart Wallet 주소를 서버 운영자에게 전달해 `ADMIN_WALLETS`에 추가해야 합니다.

### 1.2 클라이언트 측 라이브러리 권장

```bash
npm install viem siwe
# 또는 wagmi + RainbowKit / ConnectKit 등 wallet 연결 라이브러리
```

- `viem`: Coinbase Smart Wallet 연결, 서명 요청
- `siwe`: SIWE 메시지 생성

---

## 2. 인증 흐름

### 2.1 시퀀스

```
[Dashboard]                         [Server]
    │                                  │
    │ 1. 지갑 연결 (Coinbase Smart Wallet)
    │    → address 추출
    │                                  │
    │ 2. GET /api/admin/auth/nonce?address=0x...
    │ ───────────────────────────────► │
    │                                  │ Redis SETEX admin:nonce:<addr> <nonce> 300
    │ ◄─────────────── { nonce, expiresAt }
    │                                  │
    │ 3. SIWE 메시지 구성 (EIP-4361)
    │    + chainId=8453, domain=<dashboard host>
    │    + 받은 nonce 삽입
    │                                  │
    │ 4. wallet.signMessage(siweMessage)
    │    → signature                   │
    │                                  │
    │ 5. POST /api/admin/auth/verify
    │    body: { message, signature }
    │ ───────────────────────────────► │
    │                                  │ - SIWE 파싱 + chainId/domain 검증
    │                                  │ - viem.verifyMessage (EIP-1271 / ERC-6492)
    │                                  │ - Redis nonce 일치 확인 + 삭제 (1회용)
    │                                  │ - ADMIN_WALLETS 체크
    │                                  │ - JWT 발급 (HS256, 8h)
    │ ◄────────────── { token, expiresAt }
    │                                  │
    │ 6. localStorage/메모리에 토큰 저장
    │                                  │
    │ 7. 이후 admin 요청에 첨부:
    │    Authorization: Bearer <token>
    │                                  │
```

### 2.2 SIWE 메시지 형식 (EIP-4361)

```
admin.example.com wants you to sign in with your Ethereum account:
0xABC123...

URI: https://admin.example.com
Version: 1
Chain ID: 8453
Nonce: <서버에서 받은 nonce>
Issued At: 2026-04-27T10:00:00.000Z
Expiration Time: 2026-04-27T10:05:00.000Z
```

**필수 필드:**
- `domain`: Dashboard origin host (server `ADMIN_DASHBOARD_URL` host와 일치 필수)
- `address`: Coinbase Smart Wallet 주소
- `chainId`: **반드시 8453** (Base mainnet) — 다른 값이면 서버 거부
- `nonce`: nonce 엔드포인트에서 받은 값 그대로
- `issuedAt`, `expirationTime`: 클라이언트가 5분 내 시간 권장

---

## 3. API 엔드포인트

모든 엔드포인트의 base URL은 서버 운영자가 전달한 값을 사용. 응답은 `application/json`.

### 3.1 `GET /api/admin/auth/nonce`

로그인 시작 — nonce 발급.

**Query:**
| 이름 | 필수 | 설명 |
|---|---|---|
| `address` | ✓ | 지갑 주소 (소문자/체크섬 무관) |

**Response 200:**
```json
{
  "nonce": "uuid-v4-string",
  "expiresAt": "2026-04-27T10:05:00.000Z"
}
```

**Response 400:**
```json
{ "error": "Missing required parameter: address" }
```

**curl 예:**
```bash
curl "https://server.com/api/admin/auth/nonce?address=0xabc..."
```

---

### 3.2 `POST /api/admin/auth/verify`

SIWE 서명 검증 + JWT 발급.

**Request body:**
```json
{
  "message": "<SIWE 메시지 전체 텍스트>",
  "signature": "0x<hex signature>"
}
```

**Response 200:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "expiresAt": "2026-04-27T18:00:00.000Z"
}
```

**Error responses:**
| 코드 | 케이스 |
|---|---|
| 400 | body 누락 / SIWE 메시지 파싱 실패 / chainId ≠ 8453 |
| 401 | 서명 검증 실패 / nonce 불일치/만료 / domain 불일치 / 메시지 만료 |
| 403 | 지갑이 `ADMIN_WALLETS`에 없음 |
| 500 | `JWT_SECRET` 미설정 또는 서버 내부 에러 |

**curl 예:**
```bash
curl -X POST https://server.com/api/admin/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"message":"...","signature":"0x..."}'
```

---

### 3.3 `GET /api/admin/agents`

에이전트 목록 + 메모리 요약.

**Headers:**
| 이름 | 필수 | 설명 |
|---|---|---|
| `Authorization` | ✓ | `Bearer <jwt>` |

**Query:**
| 이름 | 필수 | 설명 |
|---|---|---|
| `address` | ✗ | 특정 creator 지갑으로 필터링 (대소문자 무관) |

**Response 200:**
```json
{
  "agents": [
    {
      "id": "a1b2c3d4e5",
      "card": {
        "name": "My Agent",
        "description": "...",
        "url": "https://server.com/api/agents/a1b2c3d4e5",
        "skills": [{"id":"...", "name":"...", "description":"...", "tags":[]}],
        "protocolVersion": "0.3.0",
        "version": "1.0.0",
        "capabilities": {},
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"]
      },
      "prompt": "You are a helpful...",
      "modelProvider": "google",
      "modelName": "gemini-2.0-flash",
      "creator": "0x...",
      "intents": [
        { "name": "greeting", "description": "...", "prompt": "..." }
      ],
      "memorySummary": {
        "thinkingIntents": [{ "intent": "greeting", "factCount": 5 }],
        "caringUsers": [{ "username": "user1", "factCount": 3 }],
        "intentPatternCount": 2
      }
    }
  ]
}
```

**Error responses:**
| 코드 | 케이스 |
|---|---|
| 401 | JWT 누락/만료/서명 불일치 |
| 403 | JWT 유효하지만 address가 `ADMIN_WALLETS`에서 제거됨 |

---

### 3.4 `POST /api/admin/agents/{agentId}`

에이전트 prompt 수정 (admin 전용 — creator 검증 우회).

**Headers:**
| 이름 | 필수 | 설명 |
|---|---|---|
| `Authorization` | ✓ | `Bearer <jwt>` |
| `Content-Type` | ✓ | `application/json` |

**Request body:**
```json
{ "prompt": "새로운 시스템 프롬프트" }
```

**Response 200:**
```json
{
  "success": true,
  "agentId": "a1b2c3d4e5",
  "prompt": "새로운 시스템 프롬프트"
}
```

**Error responses:**
| 코드 | 케이스 |
|---|---|
| 400 | prompt 누락 또는 빈 문자열 |
| 401 | JWT 누락/만료 |
| 403 | address가 `ADMIN_WALLETS`에서 제거됨 |
| 404 | 에이전트 미존재 |
| 500 | 서버 내부 에러 |

---

### 3.5 `GET /api/agents/{agentId}/status`

에이전트 메모리 상세 조회. **인증 불필요** (기존 공개 API).

**Query:**
| 이름 | 필수 | 설명 |
|---|---|---|
| `intent` | ✗ | thinking 메모리 fact 목록 조회 |
| `username` | ✗ | caring 메모리 fact 목록 조회 |

**Response 200:**
```json
{
  "agentId": "a1b2c3d4e5",
  "thinking": {
    "intent": "greeting",
    "facts": ["fact1", "fact2"],
    "factCount": 2
  },
  "caring": null,
  "allIntents": [
    { "intent": "greeting", "factCount": 2 }
  ]
}
```

`thinking`/`caring`은 해당 query parameter가 없거나 데이터가 없으면 `null`. `allIntents`는 항상 반환.

**Response 404:** 에이전트 미존재.

---

## 4. 클라이언트 구현 가이드

### 4.1 권장 라이브러리 조합

- **Wallet 연결**: `wagmi` + `@coinbase/wallet-sdk` 또는 `viem`+`@coinbase/wallet-sdk`
- **SIWE 메시지 생성**: `siwe`
- **HTTP 클라이언트**: `fetch` 또는 `axios`

### 4.2 로그인 코드 예시 (TypeScript)

```typescript
import { SiweMessage } from 'siwe';
import { createWalletClient, custom } from 'viem';
import { base } from 'viem/chains';

async function loginAdmin(): Promise<string> {
  // 1. wallet 연결
  const provider = window.ethereum; // Coinbase Smart Wallet provider
  const walletClient = createWalletClient({
    chain: base,
    transport: custom(provider),
  });
  const [address] = await walletClient.requestAddresses();

  // 2. nonce 요청
  const nonceRes = await fetch(
    `${SERVER_URL}/api/admin/auth/nonce?address=${address}`
  );
  if (!nonceRes.ok) throw new Error('Failed to get nonce');
  const { nonce } = await nonceRes.json();

  // 3. SIWE 메시지 구성
  const message = new SiweMessage({
    domain: window.location.host,
    address,
    statement: 'Sign in to Admin Dashboard',
    uri: window.location.origin,
    version: '1',
    chainId: 8453, // Base mainnet
    nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 5 * 60_000).toISOString(),
  }).prepareMessage();

  // 4. 지갑으로 서명
  const signature = await walletClient.signMessage({
    account: address,
    message,
  });

  // 5. verify 요청
  const verifyRes = await fetch(`${SERVER_URL}/api/admin/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRes.ok) {
    const err = await verifyRes.json();
    throw new Error(err.error ?? 'Verify failed');
  }
  const { token, expiresAt } = await verifyRes.json();

  // 6. 토큰 저장
  localStorage.setItem('adminToken', token);
  localStorage.setItem('adminTokenExpiresAt', expiresAt);
  return token;
}
```

### 4.3 인증된 요청 예시

```typescript
async function fetchAdminAgents() {
  const token = localStorage.getItem('adminToken');
  if (!token || isExpired(token)) {
    await loginAdmin(); // 재로그인
  }

  const res = await fetch(`${SERVER_URL}/api/admin/agents`, {
    headers: {
      Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('adminToken');
    await loginAdmin();
    return fetchAdminAgents();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function updateAgentPrompt(agentId: string, prompt: string) {
  const token = localStorage.getItem('adminToken');
  const res = await fetch(
    `${SERVER_URL}/api/admin/agents/${agentId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ prompt }),
    }
  );
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}
```

### 4.4 토큰 만료 처리

JWT는 8시간 후 만료. dashboard는:
1. 응답 401을 받으면 토큰 폐기 + 재로그인 흐름 트리거
2. 토큰 발급 시 받은 `expiresAt`을 저장하고, 만료 시점 직전에 미리 재로그인 트리거 (선택)

---

## 5. Smart Wallet 특이사항

### 5.1 Coinbase Smart Wallet 연결

Coinbase Smart Wallet은 passkey 기반이며, 표준 `window.ethereum` provider 또는 `@coinbase/wallet-sdk`를 통해 연결.

```typescript
import { CoinbaseWalletSDK } from '@coinbase/wallet-sdk';

const sdk = new CoinbaseWalletSDK({
  appName: 'Admin Dashboard',
  appChainIds: [8453], // Base only
});
const provider = sdk.makeWeb3Provider({ options: 'smartWalletOnly' });
```

### 5.2 첫 로그인 (Counterfactual Wallet)

신규 Coinbase Smart Wallet 사용자는 **컨트랙트가 아직 배포되지 않은 상태**에서 첫 서명을 만듭니다. 이 경우 서명은 ERC-6492 wrapper 형식으로 반환되며, 서버는 viem `verifyMessage`로 자동 검증합니다.

→ **Dashboard 측에서 별도 처리 불필요**. wallet SDK가 자동으로 ERC-6492 wrapping을 수행.

### 5.3 chainId 주의

SIWE 메시지의 `chainId`는 **반드시 8453** (Base mainnet)이어야 합니다. wallet의 현재 체인이 다른 경우, 메시지 서명 전에 Base로 스위치해야 합니다:

```typescript
await walletClient.switchChain({ id: 8453 });
```

---

## 6. CORS

서버는 `ADMIN_DASHBOARD_URL` 환경변수로 등록된 origin만 허용합니다. Dashboard 도메인이 변경되면 서버 운영자에게 통보해 env 업데이트 필요.

허용 헤더: `Content-Type, Authorization`
허용 메서드: `GET, POST, OPTIONS`

---

## 7. 에러 응답 공통 포맷

모든 에러 응답은:
```json
{ "error": "<영문 메시지>" }
```

UI에서 표시 시 사용자 친화 메시지로 변환 권장. 예:
- `"Invalid signature"` → "지갑 서명에 실패했습니다. 다시 시도해 주세요."
- `"Address not authorized as admin"` → "이 지갑은 admin 권한이 없습니다."
- `"Invalid or expired nonce"` → "로그인 시간이 초과되었습니다. 다시 시도해 주세요."

---

## 8. 변경 이력

- **v1 (현재, EPIC6 적용)**: SIWE + JWT, Coinbase Smart Wallet only, Base mainnet only
- v0 (EPIC5): `X-Admin-Secret` 단일 키 — 폐기됨
