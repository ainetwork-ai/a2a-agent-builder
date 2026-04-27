# EPIC6 - Admin Wallet JWT Auth (관리자 지갑 서명 + JWT 인증)

> 기존 `X-Admin-Secret` 정적 키 인증을 SIWE(EIP-4361) 지갑 서명 + JWT 토큰 방식으로 교체한다. Admin은 **Coinbase Smart Wallet (Base mainnet)** 으로만 로그인하며, smart contract wallet 서명 검증을 위해 **EIP-1271 + ERC-6492**를 지원한다.

## 의존성
- EPIC5 (Admin Route Separation) — `/api/admin/*` 라우트 및 `adminAuth.ts` 헬퍼가 존재해야 함

## 목표
- SIWE 표준으로 admin 지갑 서명 검증, JWT 발급
- **Coinbase Smart Wallet (Base mainnet, chainId 8453)** 지원: EIP-1271(배포된 smart wallet) + ERC-6492(미배포 counterfactual smart wallet) 검증
- 서명 검증은 이미 설치된 `viem`의 `client.verifyMessage()` 사용 (EOA·EIP-1271·ERC-6492 모두 투명 처리, 추가 ethers 의존성 불필요)
- `ADMIN_WALLETS` 환경변수로 허용 지갑 관리 (smart wallet 주소)
- JWT(8시간, refresh 없음)로 후속 admin 요청 인증
- Nonce는 Redis 5분 TTL, 1회용
- `X-Admin-Secret` 완전 제거 (하드 컷오버)
- 기존 일반 API는 영향 없음

---

## Story 6.1: Redis TTL 지원 + Nonce 엔드포인트

**수정 파일:** `src/lib/redis.ts`
**생성 파일:** `src/app/api/admin/auth/nonce/route.ts`

### 배경
Nonce를 Redis에 5분 TTL로 저장해야 하나, 현재 `RedisClient` 인터페이스(redis.ts:6-15)에는 TTL을 지정할 수 있는 메서드가 없다:

```typescript
// redis.ts:6-15
interface RedisClient {
  ping(): Promise<string>;
  get<T = string>(key: string): Promise<T | null>;
  set(key: string, value: any): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, ...members: string[]): Promise<number>;
}
```

`setex`(key, seconds, value)를 인터페이스와 두 wrapper 클래스(IORedisWrapper, UpstashRedisWrapper)에 추가한 뒤, nonce 엔드포인트에서 활용한다.

### 참고 파일
- `src/lib/redis.ts` — RedisClient 인터페이스(6-15행), IORedisWrapper(18-80행), UpstashRedisWrapper(83-128행), REDIS_KEYS(178-181행)
- `src/lib/utils/cors.ts` — CORS 유틸 (nonce 라우트에서도 사용)

### 태스크

#### Redis setex 추가
- [x] `RedisClient` 인터페이스(redis.ts:6-15)에 `setex(key: string, seconds: number, value: any): Promise<string | null>` 메서드를 추가한다.
- [x] `IORedisWrapper`에 `setex` 구현을 추가한다: `value`를 JSON.stringify 후 `this.client.setex(key, seconds, serialized)`를 호출한다.
- [x] `UpstashRedisWrapper`에 `setex` 구현을 추가한다: `this.client.setex(key, seconds, value)`를 호출한다. Upstash 클라이언트는 자체 직렬화를 처리한다.
- [x] `REDIS_KEYS`에 `ADMIN_NONCE: (address: string) => \`admin:nonce:${address}\`` 패턴을 추가한다.

#### Nonce 엔드포인트 생성
- [x] `src/app/api/admin/auth/nonce/route.ts` 파일을 생성한다.
- [x] `OPTIONS` 핸들러를 추가한다 (`corsOptions(request)` 호출).
- [x] `GET` 핸들러를 구현한다:
  1. `searchParams.get('address')`로 지갑 주소를 읽는다. 없으면 `{ error: 'Missing required parameter: address' }`, 400을 반환한다.
  2. `crypto.randomUUID()`로 nonce를 생성한다 (Node.js 내장, 충분한 엔트로피).
  3. `redis.setex(REDIS_KEYS.ADMIN_NONCE(address.toLowerCase()), 300, nonce)`로 저장한다 (5분 TTL).
  4. `expiresAt`를 ISO 8601 형식으로 계산한다 (`new Date(Date.now() + 300_000).toISOString()`).
  5. `{ nonce, expiresAt }`를 반환한다. CORS 헤더를 포함한다.
- [x] 이 엔드포인트는 admin 인증을 요구하지 않는다 (로그인 시작점).

### 주의사항
- address는 항상 `toLowerCase()`로 정규화한다 (EIP-55 checksum 주소와 소문자 주소 모두 동일하게 처리).
- nonce는 address 단위로 1개만 유지된다. 새 nonce 요청 시 기존 nonce를 덮어쓴다 (Redis key 동일).
- `REDIS_KEYS` 외 다른 Redis 구조(AGENT, AGENT_LIST 등)는 변경하지 않는다.

---

## Story 6.2: SIWE 검증 + JWT 발급 엔드포인트

**생성 파일:** `src/app/api/admin/auth/verify/route.ts`, `src/lib/adminViemClient.ts`

### 배경
Dashboard 클라이언트가 SIWE 메시지를 Coinbase Smart Wallet으로 서명한 후, 서버에서 검증하고 JWT를 발급해야 한다.

**Smart wallet 서명 검증의 차이점:**
- EOA(MetaMask 등)는 ECDSA 개인키 기반 → `ecrecover`로 순수 암호학 검증 (RPC 불필요)
- Smart Wallet(Coinbase Smart Wallet 등)은 컨트랙트가 서명을 인증 → **EIP-1271** 표준의 `isValidSignature(hash, sig)` 호출 필요 (RPC 필요)
- 첫 로그인 시 wallet 컨트랙트가 아직 배포되지 않은 경우(counterfactual) → **ERC-6492** wrapper로 deploy 시뮬레이션 + isValidSignature 검증 (RPC 필요)
- `siwe` 패키지의 `verify({ signature })`는 EOA만 처리하므로 사용 불가
- 이미 설치된 `viem` v2의 `client.verifyMessage()`는 EOA + EIP-1271 + ERC-6492를 universalSignatureValidator로 모두 투명하게 처리

**검증 흐름:**
1. SIWE 메시지 파싱 → address, nonce, domain, chainId, expirationTime 추출 (`siwe` 패키지)
2. 메시지 필드 유효성 검증 (chainId === 8453, expirationTime 미만료, domain 일치)
3. **viem `client.verifyMessage()`로 서명 검증** (Base mainnet RPC 통해 eth_call)
4. Nonce 검증 (Redis에 저장된 nonce와 일치하는지)
5. Admin 허용 지갑 확인 (`ADMIN_WALLETS` env에 포함되는지)
6. Nonce 삭제 (1회용)
7. JWT 발급 (jose, HS256, 8시간)

### 참고 파일
- `src/lib/redis.ts` — Redis 클라이언트, REDIS_KEYS (Story 6.1에서 ADMIN_NONCE 추가됨)
- `src/lib/utils/cors.ts` — CORS 유틸
- `package.json` — `viem` v2가 이미 설치되어 있음 (smart wallet 검증에 사용)

### 태스크

#### 의존성 설치
- [x] `siwe` 패키지를 설치한다: `yarn add siwe`. SIWE 메시지 파싱(`new SiweMessage(string)`)에만 사용하며 `siweMessage.verify()`는 호출하지 않으므로 `ethers` peer dependency 설치는 생략한다 (런타임에서 ethers를 import하지 않음).
- [x] `jose` 패키지를 설치한다: `yarn add jose`.
- [x] `viem` 추가 설치 불필요 (이미 `package.json`에 `^2.21.53` 설치됨).

#### viem public client 헬퍼 생성
- [x] `src/lib/adminViemClient.ts` 파일을 생성한다.
- [x] `viem`과 `viem/chains`에서 필요한 심볼을 import한다: `createPublicClient`, `http`, `base`.
- [x] `getAdminViemClient()` 함수를 export한다:
  - `process.env.ADMIN_RPC_URL`이 설정되어 있으면 해당 URL을, 미설정이면 기본값 `'https://mainnet.base.org'`(Base 공식 public RPC)을 사용한다.
  - `createPublicClient({ chain: base, transport: http(rpcUrl) })`를 반환한다.
  - 모듈 레벨 캐시를 사용해 중복 생성하지 않는다.
- [x] `EXPECTED_CHAIN_ID = 8453` 상수를 export한다 (Base mainnet).

#### Verify 엔드포인트 생성
- [x] `src/app/api/admin/auth/verify/route.ts` 파일을 생성한다.
- [x] `OPTIONS` 핸들러를 추가한다.
- [x] `POST` 핸들러를 구현한다:
  1. `request.json()`으로 `{ message, signature }` body를 파싱한다. 둘 중 하나라도 없으면 400을 반환한다.
  2. `new SiweMessage(message)`로 SIWE 메시지를 파싱한다. 파싱 실패 시 `{ error: 'Invalid SIWE message' }`, 400을 반환한다.
  3. SIWE 메시지 필드 검증:
     - `siweMessage.chainId === EXPECTED_CHAIN_ID(8453)` 아니면 `{ error: 'Unsupported chain' }`, 400.
     - `siweMessage.expirationTime`가 있고 현재 시각보다 과거면 `{ error: 'Message expired' }`, 401.
     - `siweMessage.domain`이 `process.env.ADMIN_DASHBOARD_URL`의 host와 일치하는지 확인. 불일치 시 `{ error: 'Domain mismatch' }`, 401.
  4. `address = siweMessage.address.toLowerCase()`로 정규화한다.
  5. `getAdminViemClient().verifyMessage({ address, message, signature })`를 호출하여 서명을 검증한다 (await 필수). false 반환 시 `{ error: 'Invalid signature' }`, 401을 반환한다. viem이 EOA·EIP-1271·ERC-6492를 모두 처리한다.
  6. `redis.get(REDIS_KEYS.ADMIN_NONCE(address))`로 저장된 nonce를 읽는다. 없거나 `siweMessage.nonce`와 불일치하면 `{ error: 'Invalid or expired nonce' }`, 401을 반환한다.
  7. `ADMIN_WALLETS` 환경변수를 `,`로 split하고 모든 항목을 `toLowerCase()` + `trim()`한 뒤 `address`가 포함되는지 확인한다. 미포함이면 `{ error: 'Address not authorized as admin' }`, 403을 반환한다.
  8. `redis.del(REDIS_KEYS.ADMIN_NONCE(address))`로 nonce를 삭제한다 (1회용).
  9. `jose`의 `SignJWT`로 JWT를 발급한다:
     - Payload: `{ address }`
     - Algorithm: `HS256`
     - Secret: `new TextEncoder().encode(process.env.JWT_SECRET)`
     - ExpirationTime: `'8h'`
     - IssuedAt: 현재 시각
  10. `{ token, expiresAt }`를 반환한다. `expiresAt`는 `new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()`.
- [x] try-catch로 전체를 감싸고 에러 시 500을 반환한다. RPC 에러는 503으로 분리하지 않고 500으로 통일한다 (단순화).
- [x] 이 엔드포인트는 admin 인증을 요구하지 않는다 (로그인 과정의 일부).

### 주의사항
- `siweMessage.verify({ signature })`는 절대 호출하지 않는다 — EOA만 지원하여 smart wallet 서명을 거부한다. 반드시 viem `client.verifyMessage()`를 사용한다.
- viem `verifyMessage`는 비동기이며 RPC 호출(`eth_call`)을 동반한다. 호출 빈도는 낮지만(로그인 시점만) 네트워크 지연 가능성을 고려한다.
- ERC-6492 검증은 wallet 미배포 상태에서도 동작한다. wallet 배포 여부를 별도 검사하지 않는다.
- `JWT_SECRET` 미설정 시 JWT 발급 불가 → 500 에러를 반환하고 로그에 경고를 출력한다.
- `ADMIN_WALLETS` 미설정 시 모든 지갑이 거부된다 (빈 배열 취급).
- address 비교는 항상 소문자로 정규화한다.
- `ADMIN_RPC_URL` 미설정 시 Base 공식 public RPC(`https://mainnet.base.org`)를 사용한다 — rate limit이 있으니 운영 트래픽 증가 시 유료 RPC로 교체.

---

## Story 6.3: Admin 인증 JWT 전환 + X-Admin-Secret 제거

**수정 파일:** `src/lib/adminAuth.ts`, `src/app/api/admin/agents/route.ts`, `src/app/api/admin/agents/[agentId]/route.ts`, `src/lib/utils/cors.ts`

### 배경
현재 admin 라우트는 `verifyAdminSecret`(adminAuth.ts:11-24)으로 `X-Admin-Secret` 헤더를 검증한다:

```typescript
// adminAuth.ts:11-24
export function verifyAdminSecret(request: NextRequest): NextResponse | null {
  const adminSecret = request.headers.get('X-Admin-Secret');
  const adminApiKey = process.env.ADMIN_API_KEY;

  if (!adminSecret || !adminApiKey || adminSecret !== adminApiKey) {
    const corsHeaders = getCorsHeaders(request);
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: corsHeaders }
    );
  }

  return null;
}
```

이를 JWT 검증 함수 `verifyAdminJwt`로 교체한다. `Authorization: Bearer <token>` 헤더에서 JWT를 추출하고, `jose`의 `jwtVerify`로 검증한다. 추가로 JWT payload의 address가 여전히 `ADMIN_WALLETS`에 포함되는지 확인한다 (방어적 이중 검증).

### 참고 파일
- `src/lib/adminAuth.ts` — 현재 verifyAdminSecret, countFacts (countFacts는 유지)
- `src/app/api/admin/agents/route.ts:5,12-13` — verifyAdminSecret import 및 호출
- `src/app/api/admin/agents/[agentId]/route.ts:4,16-17` — verifyAdminSecret import 및 호출
- `src/lib/utils/cors.ts:15` — `Access-Control-Allow-Headers`에 X-Admin-Secret 포함

### 태스크

#### adminAuth.ts 교체
- [ ] `verifyAdminSecret` 함수를 삭제한다.
- [ ] `verifyAdminJwt` 함수를 추가한다. 시그니처: `async function verifyAdminJwt(request: NextRequest): Promise<NextResponse | null>`. 비동기 함수이다 (`jwtVerify`가 async).
  1. `request.headers.get('Authorization')`에서 `Bearer ` prefix를 제거하여 token을 추출한다. 헤더가 없거나 형식이 틀리면 401을 반환한다.
  2. `process.env.JWT_SECRET`이 없으면 401을 반환한다.
  3. `jose.jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET))`를 호출한다. 실패(만료, 서명 불일치 등) 시 401을 반환한다.
  4. payload에서 `address`를 추출하고, `ADMIN_WALLETS` env에 포함되는지 확인한다. 미포함이면 403을 반환한다 (토큰 발급 후 allowlist에서 제거된 경우).
  5. 검증 성공이면 `null`을 반환한다.
- [ ] `verifyAdminJwt`와 `countFacts`를 export한다 (`verifyAdminSecret` export 제거).

#### Admin 라우트 import 교체
- [ ] `src/app/api/admin/agents/route.ts`에서:
  - `import { verifyAdminSecret, countFacts }` → `import { verifyAdminJwt, countFacts }`
  - `verifyAdminSecret(request)` 호출을 `await verifyAdminJwt(request)`로 변경. GET 함수를 `async`로 유지 (이미 async).
- [ ] `src/app/api/admin/agents/[agentId]/route.ts`에서:
  - `import { verifyAdminSecret }` → `import { verifyAdminJwt }`
  - `verifyAdminSecret(request)` 호출을 `await verifyAdminJwt(request)`로 변경.

#### CORS 헤더 업데이트
- [ ] `src/lib/utils/cors.ts`의 `getCorsHeaders`에서 `Access-Control-Allow-Headers`를 `'Content-Type, Authorization'`으로 변경한다 (`X-Admin-Secret` 제거, `Authorization` 추가).

### 주의사항
- `countFacts` 함수는 변경하지 않는다 — admin 목록 라우트에서 계속 사용 중이다.
- `ADMIN_API_KEY` 환경변수는 이 EPIC 이후 더 이상 사용되지 않는다. 환경변수 자체를 삭제하는 것은 배포 관리 영역이므로 코드에서는 참조를 제거하기만 한다.
- JWT 검증이 비동기이므로 호출부에서 반드시 `await`를 추가한다.
- nonce/verify 엔드포인트(Story 6.1, 6.2)는 인증 없이 접근 가능해야 하므로 `verifyAdminJwt`를 사용하지 않는다.

---

## Story 6.4: API 명세 문서 갱신

**수정 파일:** `docs/API_ADMIN_AGENTS.md`

### 배경
EPIC5에서 갱신된 API 명세가 `X-Admin-Secret` 기반이다. JWT 전환 후 인증 섹션 전체와 새 엔드포인트(nonce, verify)를 문서에 반영해야 한다.

### 참고 파일
- `docs/API_ADMIN_AGENTS.md` — 현재 명세
- `src/app/api/admin/auth/nonce/route.ts` — Story 6.1에서 생성
- `src/app/api/admin/auth/verify/route.ts` — Story 6.2에서 생성

### 태스크

#### 인증 흐름 문서 추가
- [ ] 문서 상단에 "인증" 섹션을 추가한다. SIWE + JWT 흐름을 단계별로 설명한다:
  1. `GET /api/admin/auth/nonce?address=` → nonce 발급
  2. 클라이언트: SIWE 메시지 생성 + 지갑 서명
  3. `POST /api/admin/auth/verify` → JWT 발급
  4. 이후 요청: `Authorization: Bearer <token>`
- [ ] 환경변수 요구사항을 정리한다: `ADMIN_WALLETS`, `JWT_SECRET`, `ADMIN_DASHBOARD_URL`.

#### 새 엔드포인트 명세 추가
- [ ] `GET /api/admin/auth/nonce` 엔드포인트 명세를 추가한다:
  - Query: `address` (필수)
  - 200: `{ nonce, expiresAt }`
  - 400: address 누락
  - curl 예시
- [ ] `POST /api/admin/auth/verify` 엔드포인트 명세를 추가한다:
  - Body: `{ message, signature }`
  - 200: `{ token, expiresAt }`
  - 400: body 누락, 401: 서명/nonce 불일치, 403: 허용되지 않은 지갑
  - curl 예시

#### 기존 명세 갱신
- [ ] 기존 엔드포인트(에이전트 목록 GET, 프롬프트 수정 POST)의 인증 설명에서 `X-Admin-Secret` 헤더를 `Authorization: Bearer <token>` 헤더로 교체한다.
- [ ] curl 예시에서 `-H "X-Admin-Secret: ..."` 를 `-H "Authorization: Bearer ..."` 로 변경한다.
- [ ] 권장 사용 흐름을 업데이트한다: 로그인 → 토큰 발급 → 목록 조회 → 상세 조회 → 프롬프트 수정.

### 주의사항
- 상세 메모리 조회(`GET /api/agents/{agentId}/status`) 명세는 그대로 유지한다 (인증 없음, 경로 변경 없음).
- Story 6.1~6.3 구현 완료 후에 작성한다 (응답 구조 확정 후).

---

## 구현 규칙

### 인증
- SIWE 메시지는 EIP-4361 표준을 따른다.
- JWT는 HS256 알고리즘, `jose` 라이브러리를 사용한다.
- 모든 address 비교는 소문자 정규화 후 수행한다.
- Nonce는 address 당 1개, 5분 TTL, 검증 후 즉시 삭제 (1회용).
- JWT payload에는 최소한의 claim만 포함한다: `{ address }` + 표준 claim (`iat`, `exp`).
- `verifyAdminJwt`는 JWT 검증 + ADMIN_WALLETS 재확인을 모두 수행한다.

### 서명 검증
- 서명 검증은 **항상 viem `client.verifyMessage()`** 를 사용한다 (EOA + EIP-1271 + ERC-6492 일괄 처리).
- 체인은 **Base mainnet (chainId 8453) 고정**. SIWE 메시지의 chainId가 8453이 아니면 거부.
- `siwe` 패키지는 메시지 파싱 용도로만 사용하며 `siweMessage.verify()`는 호출하지 않는다.

### 환경변수
- `ADMIN_WALLETS`: 쉼표 구분 지갑 주소 목록 (예: `0xabc,0xdef`). Coinbase Smart Wallet 주소(EOA가 아님)를 등록한다. 미설정 시 모든 지갑 거부.
- `JWT_SECRET`: JWT 서명 키. 미설정 시 JWT 발급/검증 불가 → 에러 반환.
- `ADMIN_RPC_URL`: Base mainnet RPC. 미설정 시 `https://mainnet.base.org` 기본값 사용 (rate limit 있음).
- `ADMIN_DASHBOARD_URL`: CORS origin 및 SIWE domain 검증에 사용 (기존 그대로).
- `ADMIN_API_KEY`: 이 EPIC 이후 미사용. 코드에서 참조 제거.

### 금지사항
- 기존 일반 API(`/api/agents/list`, `/api/agents/[agentId]/edit`, `/api/agents/[agentId]/status`)를 수정하지 않는다.
- `StoredAgent` 타입이나 Redis 데이터 스키마를 변경하지 않는다 (`RedisClient` 인터페이스에 `setex` 추가는 스키마 변경이 아님).
- 프론트엔드 코드를 수정하지 않는다.
- Refresh token을 구현하지 않는다.
- JWT blacklist/revocation 메커니즘을 구현하지 않는다.

---

## 완료 조건
- [ ] `GET /api/admin/auth/nonce?address=0x...` 호출 시 nonce + expiresAt가 반환된다
- [ ] nonce가 Redis에 5분 TTL로 저장된다
- [ ] `POST /api/admin/auth/verify` + 유효한 SIWE 서명 + 올바른 nonce → JWT가 발급된다
- [ ] **배포된 Coinbase Smart Wallet의 EIP-1271 서명이 검증 통과한다** (Base mainnet RPC 호출 동반)
- [ ] **미배포 (counterfactual) Coinbase Smart Wallet의 ERC-6492 wrapped 서명이 검증 통과한다**
- [ ] SIWE 메시지의 `chainId`가 8453이 아니면 verify가 400으로 거부된다
- [ ] SIWE 메시지의 `domain`이 `ADMIN_DASHBOARD_URL` host와 다르면 verify가 401로 거부된다
- [ ] verify 후 동일 nonce로 재시도하면 401이 반환된다 (1회용)
- [ ] `ADMIN_WALLETS`에 없는 지갑이 verify하면 403이 반환된다
- [ ] 발급된 JWT로 `GET /api/admin/agents` 호출 시 에이전트 목록이 반환된다
- [ ] 발급된 JWT로 `POST /api/admin/agents/{agentId}` 호출 시 prompt가 수정된다
- [ ] JWT 없이 admin 라우트 호출 시 401이 반환된다
- [ ] 만료된 JWT(8시간 이후)로 호출 시 401이 반환된다
- [ ] `X-Admin-Secret` 헤더로 admin 라우트 호출 시 인증되지 않는다 (하드 컷오버)
- [ ] `JWT_SECRET` 미설정 시 verify는 500, admin 라우트는 401을 반환한다
- [ ] `ADMIN_RPC_URL` 미설정 시 Base 공식 public RPC로 서명 검증이 동작한다
- [ ] 기존 `GET /api/agents/list` (일반 모드)는 영향 없이 동작한다
- [ ] `docs/API_ADMIN_AGENTS.md`가 새 인증 흐름 기준으로 갱신된다
