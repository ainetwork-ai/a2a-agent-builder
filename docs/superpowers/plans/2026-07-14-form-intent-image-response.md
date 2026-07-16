# 폼 인텐트 이미지 답변 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폼 인텐트가 매칭되면 그 인텐트에 첨부해둔 이미지를 텍스트 답변과 함께 A2A `FilePart`로 전송하고, 같은 대화에서의 이미지 도배를 방지한다.

**Architecture:** 생성 호출과 별개로 매 턴 폼 인텐트를 분류하는 경량 LLM 호출(`classifyFormIntent`)을 두어 코드가 매칭 인텐트와 `sendImage` 여부를 확정한다. 매칭된 인텐트의 prompt만 생성 프롬프트에 주입하고, 이미지가 있으면 `FilePart`로 붙인다. 도배 방지 상태는 `contextId`별 Redis sent-set에 둔다. 이미지는 GCP 버킷에 업로드하고 응답엔 URL만 싣는다.

**Tech Stack:** Next.js(App Router) · TypeScript · `@a2a-js/sdk` 0.3.3 · Redis(`@upstash/redis` / `ioredis` 래퍼) · `@google-cloud/storage` · OpenAI/Azure LLM(`callLLM`) · 검증은 `tsx` 어서션 스크립트

## Global Constraints

- 테스트 러너 없음. 순수 로직은 `scripts/`의 standalone `tsx` 어서션 스크립트(`scripts/test-redis.ts` 패턴), 실패 시 `process.exit(1)`. 실행: `npx tsx scripts/<file>.ts`.
- Redis를 건드리는 스크립트는 `.env` 주입 필요: `node --env-file=.env --import tsx scripts/<file>.ts`.
- 타입/컴파일 게이트: `npm run build`. Lint 게이트: 변경 파일에 **신규** 에러를 추가하지 않음(`npx eslint <file>`로 개별 확인). 기존 lint 에러는 무시.
- A2A 타입: `Part = TextPart | FilePart | DataPart`. `FilePart = { kind: "file", file: FileWithUri, metadata? }`. `FileWithUri = { uri: string, mimeType?: string, name?: string }`.
- 허용 이미지 MIME: `image/png`, `image/jpeg`, `image/webp`, `image/gif`. 용량 상한 5MB/장. 인텐트당 최대 3장.
- 이미지 소스는 GCP 버킷 공개 URL만(응답은 `FilePart.uri`). base64/서명URL 미사용.
- 기존 커밋 컨벤션: 커밋 메시지 마지막 줄 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. 브랜치는 현재 `develop`에서 작업.

---

## File Structure

- `src/types/agent.ts` — `Intent`에 `images?: IntentImage[]` + `IntentImage` 추가 (Task 1)
- `src/lib/redis.ts` — `REDIS_KEYS.INTENT_IMAGES_SENT` 추가 (Task 2)
- `src/lib/imageSentStore.ts` — 도배 방지 sent-set read/add (신규, Task 2)
- `src/lib/formIntentClassifier.ts` — 폼 인텐트 분류기 + 순수 파서 (신규, Task 3)
- `src/lib/promptBuilder.ts` — 선택된 인텐트 하나만 주입하는 섹션 빌더 (Task 4)
- `src/lib/imageUploadValidation.ts` — 업로드 검증 순수 함수 (신규, Task 5)
- `src/lib/gcsUpload.ts` — GCS 업로드 (신규, Task 5)
- `src/app/api/upload-image/route.ts` — 업로드 엔드포인트 (신규, Task 5)
- `src/app/api/agents/[agentId]/[[...path]]/route.ts` — executor 통합 + parts 조립 + 카드 outputModes (Task 6, 9)
- `src/lib/responseParts.ts` — `buildResponseParts` 순수 함수 (신규, Task 6)
- `src/components/AgentForm.tsx` — 인텐트별 이미지 업로드 UI (Task 7)
- `src/app/chat/HomeContent.tsx` — `FilePart` 이미지 렌더 (Task 8)

---

## Task 1: `Intent` 타입에 이미지 필드 추가

**Files:**
- Modify: `src/types/agent.ts:23-27`
- Test: `scripts/test-intent-image-type.ts`

**Interfaces:**
- Produces:
  - `interface IntentImage { url: string; mimeType: string }`
  - `Intent.images?: IntentImage[]`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `scripts/test-intent-image-type.ts`:
```ts
import { Intent, IntentImage } from '../src/types/agent';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1); }
}

const img: IntentImage = { url: 'https://bucket/x.png', mimeType: 'image/png' };
const intent: Intent = {
  name: 'welcome',
  description: 'greeting',
  prompt: 'say hi',
  images: [img],
};

// JSON round-trip preserves images (mirrors intentStore set/get)
const round = JSON.parse(JSON.stringify(intent)) as Intent;
assert(round.images?.length === 1, 'images survives round-trip');
assert(round.images![0].url === 'https://bucket/x.png', 'url preserved');
assert(round.images![0].mimeType === 'image/png', 'mimeType preserved');

// images is optional — an intent without it is still valid
const bare: Intent = { name: 'x', description: 'y', prompt: 'z' };
assert(bare.images === undefined, 'images optional');

console.log('✅ intent image type OK');
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx tsx scripts/test-intent-image-type.ts`
Expected: FAIL — `IntentImage`가 export되지 않아 컴파일/실행 에러.

- [ ] **Step 3: 타입 추가**

`src/types/agent.ts`의 `Intent` 인터페이스(23-27)를 다음으로 교체:
```ts
export interface IntentImage {
  url: string;      // GCS bucket public URL
  mimeType: string; // e.g. "image/png" — used for FilePart.file.mimeType
}

export interface Intent {
  name: string;
  description: string;
  prompt: string;
  images?: IntentImage[]; // optional; up to 3
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx tsx scripts/test-intent-image-type.ts`
Expected: PASS — `✅ intent image type OK`

- [ ] **Step 5: 커밋**

```bash
git add src/types/agent.ts scripts/test-intent-image-type.ts
git commit -m "feat(intent): add optional images field to Intent type

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 도배 방지 sent-set 저장소

`contextId`별로 "이미 이미지를 전송한 폼 인텐트 name" Set을 Redis에 JSON 배열로 저장(`setex`로 TTL 24h). 기존 래퍼에 `expire`가 없어 set 자료형 대신 `get<string[]>`+`setex`를 사용한다.

**Files:**
- Modify: `src/lib/redis.ts:194-199`
- Create: `src/lib/imageSentStore.ts`
- Test: `scripts/test-image-sent-store.ts`

**Interfaces:**
- Consumes: `redis` (from `./redis`), `REDIS_KEYS`
- Produces:
  - `REDIS_KEYS.INTENT_IMAGES_SENT: (contextId: string) => string`
  - `getSentImageIntents(contextId: string): Promise<string[]>`
  - `markImageIntentSent(contextId: string, intentName: string): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `scripts/test-image-sent-store.ts`:
```ts
import { getSentImageIntents, markImageIntentSent } from '../src/lib/imageSentStore';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1); }
}

async function main() {
  const ctx = `test-ctx-${process.pid}`;
  const start = await getSentImageIntents(ctx);
  assert(Array.isArray(start) && start.length === 0, 'empty initially');

  await markImageIntentSent(ctx, 'welcome');
  await markImageIntentSent(ctx, 'pricing');
  await markImageIntentSent(ctx, 'welcome'); // dedupe

  const after = await getSentImageIntents(ctx);
  assert(after.includes('welcome'), 'has welcome');
  assert(after.includes('pricing'), 'has pricing');
  assert(after.length === 2, `no duplicates (got ${after.length})`);

  console.log('✅ image sent store OK');
  process.exit(0);
}
main();
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node --env-file=.env --import tsx scripts/test-image-sent-store.ts`
Expected: FAIL — `imageSentStore` 모듈 없음.

- [ ] **Step 3: REDIS_KEYS에 키 추가**

`src/lib/redis.ts:194-199`의 `REDIS_KEYS` 객체에 항목 추가:
```ts
export const REDIS_KEYS = {
  AGENT: (agentId: string) => `agent:${agentId}`,
  AGENT_LIST: "agents:list",
  SKILL: (agentId: string) => `skill:${agentId}`,
  ADMIN_NONCE: (address: string) => `admin:nonce:${address}`,
  INTENT_IMAGES_SENT: (contextId: string) => `intent-images-sent:${contextId}`,
} as const;
```

- [ ] **Step 4: 저장소 구현**

Create `src/lib/imageSentStore.ts`:
```ts
import { redis, REDIS_KEYS } from './redis';

/**
 * Per-conversation record of which form intents have already delivered their
 * images. Stored as a JSON string array with a TTL so stale conversations
 * expire. Used to suppress re-sending the same intent's images every turn.
 */
const TTL_SECONDS = 60 * 60 * 24; // 24h

export async function getSentImageIntents(contextId: string): Promise<string[]> {
  const key = REDIS_KEYS.INTENT_IMAGES_SENT(contextId);
  const data = await redis.get<string[]>(key);
  return data || [];
}

export async function markImageIntentSent(contextId: string, intentName: string): Promise<void> {
  const key = REDIS_KEYS.INTENT_IMAGES_SENT(contextId);
  const current = await getSentImageIntents(contextId);
  if (current.includes(intentName)) {
    // refresh TTL even if already present
    await redis.setex(key, TTL_SECONDS, current);
    return;
  }
  await redis.setex(key, TTL_SECONDS, [...current, intentName]);
}
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `node --env-file=.env --import tsx scripts/test-image-sent-store.ts`
Expected: PASS — `✅ image sent store OK`

- [ ] **Step 6: 커밋**

```bash
git add src/lib/redis.ts src/lib/imageSentStore.ts scripts/test-image-sent-store.ts
git commit -m "feat(images): per-context sent-intent store for dedup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 폼 인텐트 분류기

생성과 별개로 매 턴 실행하여 매칭 인텐트와 `sendImage`를 확정한다. 파싱은 순수 함수로 분리해 단위 테스트하고, LLM 호출부는 그 파서를 감싼다.

**Files:**
- Create: `src/lib/formIntentClassifier.ts`
- Test: `scripts/test-form-intent-classifier.ts`

**Interfaces:**
- Consumes: `callLLM` (from `./llmManager`), `Intent` (from `@/types/agent`)
- Produces:
  - `interface FormIntentResult { intent: string | null; sendImage: boolean }`
  - `parseFormIntentResponse(text: string): FormIntentResult` (pure)
  - `classifyFormIntent(intents: Intent[], conversationText: string, alreadySentIntentNames: string[]): Promise<FormIntentResult>`

- [ ] **Step 1: 실패하는 테스트 작성 (순수 파서)**

Create `scripts/test-form-intent-classifier.ts`:
```ts
import { parseFormIntentResponse } from '../src/lib/formIntentClassifier';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1); }
}

let r = parseFormIntentResponse('INTENT: pricing\nSEND_IMAGE: yes');
assert(r.intent === 'pricing', 'parses intent name');
assert(r.sendImage === true, 'parses sendImage yes');

r = parseFormIntentResponse('INTENT: NONE\nSEND_IMAGE: no');
assert(r.intent === null, 'NONE -> null');
assert(r.sendImage === false, 'sendImage no');

r = parseFormIntentResponse('INTENT: welcome\nSEND_IMAGE: NO');
assert(r.intent === 'welcome' && r.sendImage === false, 'case-insensitive no');

r = parseFormIntentResponse('garbage with no fields');
assert(r.intent === null && r.sendImage === false, 'garbage -> {null,false}');

r = parseFormIntentResponse('INTENT:   Spaced Name  \nSEND_IMAGE: yes');
assert(r.intent === 'Spaced Name', 'trims intent name');

console.log('✅ form intent parser OK');
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx tsx scripts/test-form-intent-classifier.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 분류기 구현**

Create `src/lib/formIntentClassifier.ts`:
```ts
import { callLLM } from './llmManager';
import { Intent } from '@/types/agent';

export interface FormIntentResult {
  intent: string | null; // matched form intent name, or null
  sendImage: boolean;     // whether to attach images this turn
}

/** Pure parser for the classifier LLM response. */
export function parseFormIntentResponse(text: string): FormIntentResult {
  const intentMatch = text.match(/INTENT:\s*(.+?)(?=\n|$)/i);
  const sendMatch = text.match(/SEND_IMAGE:\s*(.+?)(?=\n|$)/i);

  let intent: string | null = null;
  if (intentMatch) {
    const raw = intentMatch[1].trim();
    if (raw && raw.toUpperCase() !== 'NONE') {
      intent = raw;
    }
  }

  const sendImage = !!sendMatch && sendMatch[1].trim().toLowerCase() === 'yes';

  return { intent, sendImage };
}

/**
 * Classify the user's message against the agent's form intents and decide
 * whether to send the matched intent's images this turn. Returns
 * {intent:null, sendImage:false} on any parse/call failure.
 */
export async function classifyFormIntent(
  intents: Intent[],
  conversationText: string,
  alreadySentIntentNames: string[]
): Promise<FormIntentResult> {
  if (!intents || intents.length === 0) {
    return { intent: null, sendImage: false };
  }

  const catalog = intents
    .map(i => `- ${i.name}: ${i.description}`)
    .join('\n');

  const alreadySent = alreadySentIntentNames.length > 0
    ? alreadySentIntentNames.join(', ')
    : '(none)';

  const systemPrompt = `You classify a user's latest message against a list of predefined intents, and decide whether an image should be attached to the reply this turn.

Intents (name: when to use):
${catalog}

Rules for INTENT:
- Choose the single intent whose description best matches the user's latest message.
- If none clearly apply, answer NONE.

Rules for SEND_IMAGE (only meaningful when an intent is chosen):
- Answer "yes" if the user is asking about this topic for the first time, or explicitly asks to see the image again.
- Answer "no" if the conversation is simply continuing on the same topic and the image was already shown.
- Intents whose images were already shown in this conversation: [${alreadySent}]

Respond in EXACTLY this format, nothing else:
INTENT: <intent name or NONE>
SEND_IMAGE: <yes or no>`;

  try {
    const response = await callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: conversationText },
    ]);
    return parseFormIntentResponse(response);
  } catch (error) {
    console.error('Error classifying form intent:', error);
    return { intent: null, sendImage: false };
  }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx tsx scripts/test-form-intent-classifier.ts`
Expected: PASS — `✅ form intent parser OK`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/formIntentClassifier.ts scripts/test-form-intent-classifier.ts
git commit -m "feat(intent): form intent classifier with sendImage decision

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 선택된 인텐트 하나만 주입하는 프롬프트 섹션

기존 `buildPromptWithIntents`(전체 카탈로그 주입)는 그대로 두고(하위호환), 매칭된 인텐트 하나의 prompt만 주입하는 함수를 새로 추가한다. Task 6에서 executor가 이걸 사용한다.

**Files:**
- Modify: `src/lib/promptBuilder.ts` (함수 추가)
- Test: `scripts/test-selected-intent-section.ts`

**Interfaces:**
- Consumes: `Intent` (from `@/types/agent`)
- Produces: `buildSelectedIntentSection(intent: Intent): string`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `scripts/test-selected-intent-section.ts`:
```ts
import { buildSelectedIntentSection } from '../src/lib/promptBuilder';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1); }
}

const section = buildSelectedIntentSection({
  name: 'pricing',
  description: 'when asked about price',
  prompt: 'Explain the pricing tiers clearly.',
});

assert(section.includes('Explain the pricing tiers clearly.'), 'contains intent prompt');
assert(!section.includes('when asked about price') || section.includes('pricing'),
  'may reference name/desc but must carry the prompt');
assert(section.trim().length > 0, 'non-empty');

console.log('✅ selected intent section OK');
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx tsx scripts/test-selected-intent-section.ts`
Expected: FAIL — 함수 없음.

- [ ] **Step 3: 함수 추가**

`src/lib/promptBuilder.ts` 끝에 추가:
```ts
/**
 * Build a prompt section injecting ONLY the matched intent's guidance.
 * Used when a separate classifier has already selected the intent, so the
 * full intent catalog does not need to be injected every turn.
 */
export function buildSelectedIntentSection(intent: Intent): string {
  return `

You are responding under a matched intent. Follow this guidance exactly, including any tone or format it specifies:
- Intent: ${intent.name}
- Guidance: ${intent.prompt}`;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx tsx scripts/test-selected-intent-section.ts`
Expected: PASS — `✅ selected intent section OK`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/promptBuilder.ts scripts/test-selected-intent-section.ts
git commit -m "feat(intent): buildSelectedIntentSection for single-intent injection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: GCP 버킷 업로드 (검증 + 라이브러리 + 엔드포인트)

`@google-cloud/storage`로 업로드. 검증 로직은 순수 함수로 분리해 단위 테스트한다. 업로드 엔드포인트는 에이전트 생성 전에도 쓸 수 있도록 에이전트 스코프가 아닌 최상위 `/api/upload-image`로 둔다(스펙의 agent-scoped 안에서 lifecycle 결합을 피하기 위한 정제).

**Files:**
- Create: `src/lib/imageUploadValidation.ts`
- Create: `src/lib/gcsUpload.ts`
- Create: `src/app/api/upload-image/route.ts`
- Test: `scripts/test-image-upload-validation.ts`
- Modify: `package.json` (의존성 추가)

**Interfaces:**
- Produces:
  - `ALLOWED_IMAGE_MIME_TYPES: string[]`
  - `MAX_IMAGE_BYTES: number`
  - `validateImageUpload(mimeType: string, sizeBytes: number): { ok: true } | { ok: false; error: string }`
  - `uploadImageToGcs(buffer: Buffer, mimeType: string): Promise<{ url: string; mimeType: string }>`

- [ ] **Step 1: 실패하는 테스트 작성 (순수 검증)**

Create `scripts/test-image-upload-validation.ts`:
```ts
import { validateImageUpload, MAX_IMAGE_BYTES } from '../src/lib/imageUploadValidation';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1); }
}

assert(validateImageUpload('image/png', 1000).ok === true, 'png ok');
assert(validateImageUpload('image/jpeg', 1000).ok === true, 'jpeg ok');
assert(validateImageUpload('image/webp', 1000).ok === true, 'webp ok');
assert(validateImageUpload('image/gif', 1000).ok === true, 'gif ok');

const bad = validateImageUpload('application/pdf', 1000);
assert(bad.ok === false, 'pdf rejected');

const tooBig = validateImageUpload('image/png', MAX_IMAGE_BYTES + 1);
assert(tooBig.ok === false, 'oversized rejected');

console.log('✅ image upload validation OK');
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx tsx scripts/test-image-upload-validation.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 검증 모듈 구현**

Create `src/lib/imageUploadValidation.ts`:
```ts
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

export function validateImageUpload(
  mimeType: string,
  sizeBytes: number
): { ok: true } | { ok: false; error: string } {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
    return { ok: false, error: `Unsupported type: ${mimeType}` };
  }
  if (sizeBytes > MAX_IMAGE_BYTES) {
    return { ok: false, error: `File too large (max ${MAX_IMAGE_BYTES} bytes)` };
  }
  if (sizeBytes <= 0) {
    return { ok: false, error: 'Empty file' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx tsx scripts/test-image-upload-validation.ts`
Expected: PASS — `✅ image upload validation OK`

- [ ] **Step 5: 의존성 설치**

Run: `npm install @google-cloud/storage`
Expected: `package.json` dependencies에 `@google-cloud/storage` 추가됨.

- [ ] **Step 6: GCS 업로드 라이브러리 구현**

Create `src/lib/gcsUpload.ts`:
```ts
import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';

/**
 * Uploads an image buffer to the configured GCS bucket (public-read) and
 * returns its public URL. Requires GCS_BUCKET_NAME and application default
 * credentials (GOOGLE_APPLICATION_CREDENTIALS) in the environment.
 */
let storage: Storage | null = null;
function getStorage(): Storage {
  if (!storage) storage = new Storage();
  return storage;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function uploadImageToGcs(
  buffer: Buffer,
  mimeType: string
): Promise<{ url: string; mimeType: string }> {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('GCS_BUCKET_NAME is not configured');
  }

  const ext = EXT_BY_MIME[mimeType] || 'bin';
  const objectName = `intent-images/${uuidv4()}.${ext}`;
  const bucket = getStorage().bucket(bucketName);
  const file = bucket.file(objectName);

  await file.save(buffer, { contentType: mimeType, resumable: false });

  const url = `https://storage.googleapis.com/${bucketName}/${objectName}`;
  return { url, mimeType };
}
```

- [ ] **Step 7: 업로드 엔드포인트 구현**

Create `src/app/api/upload-image/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { validateImageUpload } from '@/lib/imageUploadValidation';
import { uploadImageToGcs } from '@/lib/gcsUpload';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const mimeType = file.type;
    const sizeBytes = file.size;
    const check = validateImageUpload(mimeType, sizeBytes);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadImageToGcs(buffer, mimeType);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Image upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
```

- [ ] **Step 8: 빌드 게이트**

Run: `npm run build`
Expected: 컴파일 성공(신규 파일 타입 에러 없음). 실패 시 수정.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/imageUploadValidation.ts src/lib/gcsUpload.ts src/app/api/upload-image/route.ts scripts/test-image-upload-validation.ts package.json package-lock.json
git commit -m "feat(images): GCS upload endpoint with validation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **수동 검증(구현자 메모):** 실제 업로드는 `GCS_BUCKET_NAME` + 서비스계정 자격증명이 있어야 동작한다. 자격증명 세팅 후 `curl -F file=@sample.png localhost:3000/api/upload-image`로 `{url, mimeType}` 반환 확인.

---

## Task 6: Executor 통합 (분류 → 선택 주입 → parts 조립 → sent-set 기록)

executor가 매 턴 폼 인텐트를 분류하고, 매칭 인텐트의 prompt만 생성 프롬프트에 주입하며, 이미지가 있고 `sendImage`면 `FilePart`를 붙이고 sent-set에 기록한다. parts 조립은 순수 함수로 분리해 단위 테스트한다.

**Files:**
- Create: `src/lib/responseParts.ts`
- Modify: `src/app/api/agents/[agentId]/[[...path]]/route.ts` (imports, `buildSystemPrompt`, `execute`, `ensureAgentHandlers`)
- Test: `scripts/test-response-parts.ts`

**Interfaces:**
- Consumes: `Intent`/`IntentImage` (types), `Part`/`FilePart`/`TextPart` (a2a), `classifyFormIntent`/`FormIntentResult`, `getSentImageIntents`/`markImageIntentSent`, `getIntents`, `buildSelectedIntentSection`
- Produces: `buildResponseParts(responseText: string, matchedIntent: Intent | null, sendImage: boolean): Part[]`

- [ ] **Step 1: 실패하는 테스트 작성 (순수 parts 조립)**

Create `scripts/test-response-parts.ts`:
```ts
import { buildResponseParts } from '../src/lib/responseParts';
import { Intent } from '../src/types/agent';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1); }
}

const withImages: Intent = {
  name: 'pricing', description: 'd', prompt: 'p',
  images: [
    { url: 'https://b/1.png', mimeType: 'image/png' },
    { url: 'https://b/2.jpg', mimeType: 'image/jpeg' },
  ],
};

// text + images when matched, has images, sendImage true
let parts = buildResponseParts('hello', withImages, true);
assert(parts.length === 3, `text + 2 images (got ${parts.length})`);
assert(parts[0].kind === 'text', 'first is text');
assert(parts[1].kind === 'file', 'second is file');
const fp = parts[1] as { file: { uri: string; mimeType?: string } };
assert(fp.file.uri === 'https://b/1.png', 'file uri');
assert(fp.file.mimeType === 'image/png', 'file mimeType');

// sendImage false -> text only
parts = buildResponseParts('hello', withImages, false);
assert(parts.length === 1 && parts[0].kind === 'text', 'sendImage false -> text only');

// no matched intent -> text only
parts = buildResponseParts('hello', null, true);
assert(parts.length === 1 && parts[0].kind === 'text', 'no intent -> text only');

// matched but no images -> text only
parts = buildResponseParts('hello', { name: 'x', description: 'd', prompt: 'p' }, true);
assert(parts.length === 1 && parts[0].kind === 'text', 'no images -> text only');

console.log('✅ response parts OK');
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx tsx scripts/test-response-parts.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: parts 조립 순수 함수 구현**

Create `src/lib/responseParts.ts`:
```ts
import type { Part } from '@a2a-js/sdk';
import { Intent } from '@/types/agent';

/**
 * Build the response message parts. Always includes the text part; appends a
 * FilePart per intent image only when an intent with images matched AND the
 * classifier decided to send images this turn.
 */
export function buildResponseParts(
  responseText: string,
  matchedIntent: Intent | null,
  sendImage: boolean
): Part[] {
  const parts: Part[] = [{ kind: 'text', text: responseText }];

  if (matchedIntent?.images?.length && sendImage) {
    for (const img of matchedIntent.images) {
      parts.push({
        kind: 'file',
        file: { uri: img.url, mimeType: img.mimeType },
      });
    }
  }

  return parts;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx tsx scripts/test-response-parts.ts`
Expected: PASS — `✅ response parts OK`

- [ ] **Step 5: executor imports 추가**

`src/app/api/agents/[agentId]/[[...path]]/route.ts:19-20` 부근의 import 블록을 다음으로 조정(기존 `getIntents`/`buildPromptWithIntents` import 유지, 신규 3줄 추가):
```ts
import { getIntents } from '@/lib/intentStore';
import { buildPromptWithIntents, buildSelectedIntentSection } from '@/lib/promptBuilder';
import { classifyFormIntent } from '@/lib/formIntentClassifier';
import { getSentImageIntents, markImageIntentSent } from '@/lib/imageSentStore';
import { buildResponseParts } from '@/lib/responseParts';
import type { Intent } from '@/types/agent';
```
그리고 파일 상단 타입 import에 `Part`가 없으면 line 3의 a2a 타입 import에 추가:
```ts
import type { AgentCard, Message, Part, JSONRPCErrorResponse, JSONRPCResponse, JSONRPCSuccessResponse } from "@a2a-js/sdk";
```

- [ ] **Step 6: `buildSystemPrompt`에 선택 인텐트 섹션 파라미터 추가**

`route.ts:51`의 시그니처와 basePrompt 구성을 수정. 시그니처에 `formIntentSection` 추가하고 basePrompt에 삽입:
```ts
  private buildSystemPrompt(intent: string, thinking: string, caring: string, a2a?: string, skills?: string, formIntentSection?: string): string {
```
그리고 `route.ts:64`의 `const basePrompt = \`${this.prompt}` 를 다음처럼 바꿔 `this.prompt` 바로 뒤에 인텐트 섹션을 붙인다:
```ts
    const basePrompt = `${this.prompt}${formIntentSection || ''}

LANGUAGE RULE:
```
(이하 기존 내용 동일)

- [ ] **Step 7: `ensureAgentHandlers`에서 전체 카탈로그 주입 제거**

`route.ts:337-339`를 수정하여 raw base prompt를 executor에 넘긴다(선택 주입은 execute에서 매 턴 수행):
```ts
  // Intents are now classified per-turn and injected selectively at execute()
  // time, so the base prompt is passed as-is here.
  const fullPrompt = agent.prompt;
```
(`buildPromptWithIntents` import는 다른 곳에서 안 쓰이면 제거. 사용처 없으면 line 20에서 `buildPromptWithIntents` 제거하고 `buildSelectedIntentSection`만 남긴다.)

- [ ] **Step 8: `execute`에 폼 인텐트 분류 + 선택 주입 + parts 조립 통합**

`route.ts`의 `execute` 내부를 다음과 같이 통합한다.

(8a) 폼 인텐트 로드 및 분류 — `route.ts:120` 부근의 `if (incomingMessage) {` 블록 내부, 기존 자동 `classifyIntent` 처리와 나란히, 생성 직전에 실행. 다음 블록을 스킬 선택(`route.ts:194`) 직전에 삽입:
```ts
        // Form-intent classification (separate from auto classifyIntent).
        // Decides which form intent matched and whether to attach its images.
        let matchedFormIntent: Intent | null = null;
        let sendImage = false;
        try {
          const formIntents = await getIntents(this.agentId);
          if (formIntents.length > 0) {
            const recent = (DynamicAgentExecutor.historyStore[key] || []).slice(-6);
            const convoText = [...recent, incomingMessage]
              .map(msg => {
                const tp = msg.parts.find(p => p.kind === 'text');
                return `${msg.role}: ${tp && 'text' in tp ? tp.text : ''}`;
              })
              .join('\n');
            const alreadySent = await getSentImageIntents(contextId);
            const result = await classifyFormIntent(formIntents, convoText, alreadySent);
            if (result.intent) {
              matchedFormIntent = formIntents.find(i => i.name === result.intent) || null;
              sendImage = result.sendImage;
            }
            console.log('🎯 [FormIntent]', { intent: result.intent, sendImage });
          }
        } catch (error) {
          console.error('Error classifying form intent:', error);
        }
```

(8b) 선택 인텐트 주입 — `route.ts:230`의 systemPrompt 빌드를 수정:
```ts
        const formIntentSection = matchedFormIntent ? buildSelectedIntentSection(matchedFormIntent) : undefined;
        const systemPrompt = this.buildSystemPrompt(intent, thinking, caring, undefined, activeSkillsText, formIntentSection);
```

(8c) parts 조립 + sent-set 기록 — `route.ts:266-274`의 responseMessage 생성을 수정:
```ts
        const parts = buildResponseParts(responseText, matchedFormIntent, sendImage);
        const imagesAttached = parts.some(p => p.kind === 'file');
        if (imagesAttached && matchedFormIntent) {
          await markImageIntentSent(contextId, matchedFormIntent.name);
        }

        const responseMessage: Message = {
          kind: "message",
          messageId: uuidv4(),
          role: "agent",
          parts,
          contextId,
          ...(intent && { metadata: { intent, formIntent: matchedFormIntent?.name } } as Partial<Message>)
        };
```

- [ ] **Step 9: 빌드 게이트**

Run: `npm run build`
Expected: 컴파일 성공. 타입 에러 시 수정(특히 `Part` import, `metadata` 캐스팅).

- [ ] **Step 10: 커밋**

```bash
git add src/lib/responseParts.ts scripts/test-response-parts.ts "src/app/api/agents/[agentId]/[[...path]]/route.ts" src/lib/promptBuilder.ts
git commit -m "feat(intent): classify form intent per-turn and attach images to response

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **수동 검증(구현자 메모):** 로컬 실행 후, 이미지가 붙은 인텐트를 트리거하는 메시지를 보내 SSE 응답 parts에 `kind:"file"`이 포함되는지, 같은 주제로 이어 물었을 때 두 번째 턴엔 이미지가 빠지는지 확인.

---

## Task 7: 빌더 폼 이미지 업로드 UI

인텐트 편집 카드에 이미지 업로드(최대 3장), 썸네일 미리보기, 삭제를 추가한다.

**Files:**
- Modify: `src/components/AgentForm.tsx` (핸들러 + 인텐트 카드 렌더 405-447)

**Interfaces:**
- Consumes: `Intent`/`IntentImage` types, `POST /api/upload-image`

- [ ] **Step 1: 이미지 핸들러 추가**

`src/components/AgentForm.tsx`의 `handleIntentChange`(110-117) 다음에 추가:
```tsx
  const MAX_INTENT_IMAGES = 3;

  const handleIntentImageUpload = async (index: number, file: File) => {
    const intents = formData.intents || [];
    const current = intents[index]?.images || [];
    if (current.length >= MAX_INTENT_IMAGES) {
      alert(`인텐트당 최대 ${MAX_INTENT_IMAGES}장까지 가능합니다.`);
      return;
    }
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/upload-image', { method: 'POST', body });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`업로드 실패: ${err.error || res.status}`);
      return;
    }
    const image = await res.json(); // { url, mimeType }
    setFormData(prev => ({
      ...prev,
      intents: (prev.intents || []).map((it, i) =>
        i === index ? { ...it, images: [...(it.images || []), image] } : it
      ),
    }));
  };

  const removeIntentImage = (index: number, imgIdx: number) => {
    setFormData(prev => ({
      ...prev,
      intents: (prev.intents || []).map((it, i) =>
        i === index
          ? { ...it, images: (it.images || []).filter((_, j) => j !== imgIdx) }
          : it
      ),
    }));
  };
```

- [ ] **Step 2: 인텐트 카드에 이미지 섹션 렌더 추가**

`src/components/AgentForm.tsx`의 Prompt textarea를 감싼 `<div>` 닫힘(446 `</div>`) 다음, 카드 본문 `</div>`(447) 직전에 이미지 섹션 삽입:
```tsx
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                    Images (max 3)
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(intent.images || []).map((img, imgIdx) => (
                      <div key={imgIdx} className="relative">
                        <img src={img.url} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                        <button
                          type="button"
                          onClick={() => removeIntentImage(idx, imgIdx)}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
                        >×</button>
                      </div>
                    ))}
                  </div>
                  {(intent.images || []).length < 3 && (
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleIntentImageUpload(idx, f);
                        e.target.value = '';
                      }}
                      className="text-sm"
                    />
                  )}
                </div>
```

- [ ] **Step 3: 빌드 + lint 게이트**

Run: `npm run build && npx eslint src/components/AgentForm.tsx`
Expected: 빌드 성공, `AgentForm.tsx`에 신규 lint 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/components/AgentForm.tsx
git commit -m "feat(builder): per-intent image upload UI (max 3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **수동 검증(구현자 메모):** 빌더 폼에서 인텐트에 이미지 3장 업로드 → 썸네일 표시, 4번째 시도 시 차단, 삭제 동작, 저장 후 편집 재진입 시 이미지 유지 확인.

---

## Task 8: 클라이언트 이미지 렌더

채팅 화면에서 `FilePart`(이미지 MIME)를 `<img>`로 렌더한다.

**Files:**
- Modify: `src/app/chat/HomeContent.tsx:7` (import), `:247-251` (renderMessageContent)

**Interfaces:**
- Consumes: `FilePart` (a2a)

- [ ] **Step 1: import에 FilePart 추가**

`src/app/chat/HomeContent.tsx:7`을 수정:
```tsx
import { Message, MessageSendParams, TextPart, FilePart } from "@a2a-js/sdk";
```

- [ ] **Step 2: renderMessageContent 수정**

`src/app/chat/HomeContent.tsx:247-251`을 교체:
```tsx
  const renderMessageContent = (message: Message) => {
    return message.parts.map((part, index) => {
      if (part.kind === 'text') {
        return <span key={index}>{(part as TextPart).text}</span>;
      }
      if (part.kind === 'file') {
        const file = (part as FilePart).file;
        const mime = 'mimeType' in file ? file.mimeType : undefined;
        const uri = 'uri' in file ? file.uri : undefined;
        if (uri && mime && mime.startsWith('image/')) {
          return (
            <img
              key={index}
              src={uri}
              alt=""
              className="max-w-full rounded-lg mt-2"
              onError={(e) => { (e.currentTarget.style.display = 'none'); }}
            />
          );
        }
      }
      return null;
    });
  };
```

- [ ] **Step 3: 빌드 + lint 게이트**

Run: `npm run build && npx eslint src/app/chat/HomeContent.tsx`
Expected: 빌드 성공, 신규 lint 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/app/chat/HomeContent.tsx
git commit -m "feat(chat): render image FileParts in agent responses

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **수동 검증(구현자 메모):** 이미지 인텐트 트리거 시 채팅 버블에 이미지가 표시되고, 깨진 URL은 조용히 숨겨지는지 확인.

---

## Task 9: 에이전트 카드 outputModes에 이미지 광고

이미지를 내보낼 수 있음을 A2A 카드에 광고한다. 배포 시 인텐트에 이미지가 하나라도 있으면 이미지 MIME을 `defaultOutputModes`에 추가한다.

**Files:**
- Modify: `src/app/api/deploy-agent/route.ts:20-38`

**Interfaces:**
- Consumes: `ALLOWED_IMAGE_MIME_TYPES` (from `@/lib/imageUploadValidation`)

- [ ] **Step 1: deploy 라우트에서 outputModes 확장**

`src/app/api/deploy-agent/route.ts` 상단 import에 추가:
```ts
import { ALLOWED_IMAGE_MIME_TYPES } from '@/lib/imageUploadValidation';
```
그리고 `agentCard` 생성(20-31)에서 `defaultOutputModes`를 계산해 넣는다. 카드 객체 생성 직전에:
```ts
    const hasIntentImages = (agentConfig.intents || []).some(i => (i.images?.length ?? 0) > 0);
    const outputModes = hasIntentImages
      ? Array.from(new Set([...(agentConfig.defaultOutputModes || ['text']), ...ALLOWED_IMAGE_MIME_TYPES]))
      : (agentConfig.defaultOutputModes || ['text']);
```
그리고 `agentCard`의 `defaultOutputModes: agentConfig.defaultOutputModes,`(28)를 `defaultOutputModes: outputModes,`로 교체.

- [ ] **Step 2: 빌드 게이트**

Run: `npm run build`
Expected: 컴파일 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/deploy-agent/route.ts
git commit -m "feat(agent-card): advertise image output modes when intents have images

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (작성자 체크)

**Spec coverage:**
- 이미지 타입/데이터 모델 → Task 1 ✅
- 도배 방지 Redis sent-set → Task 2 ✅
- 2콜 분리 분류 + sendImage → Task 3 ✅
- 매칭 인텐트만 주입(②-A) → Task 4 + Task 6(8b) ✅
- GCP 업로드/공개 URL/검증(4종·5MB·3장) → Task 5 + Task 7(3장) ✅
- 생산자 FilePart 조립 + sent-set 기록 → Task 6 ✅
- 폼 이미지 업로드 UI → Task 7 ✅
- 클라이언트 렌더 → Task 8 ✅
- 카드 outputModes → Task 9 ✅
- 폼 인텐트 0개면 분류기 스킵 → Task 3(early return) + Task 6(8a `formIntents.length > 0`) ✅
- 에이전트-투-에이전트 이미지 무시 → 스코프 밖(입력 파싱 미변경, 별도 태스크 없음) ✅

**Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. "적절히 처리" 류 없음. ✅

**Type consistency:**
- `FormIntentResult { intent: string|null; sendImage: boolean }` — Task 3 정의, Task 6 소비 일치.
- `buildResponseParts(responseText, matchedIntent, sendImage)` — Task 6 정의/소비 일치.
- `uploadImageToGcs → { url, mimeType }` == `IntentImage { url, mimeType }` — Task 5/1 일치, 업로드 응답이 그대로 `images[]`에 저장(Task 7).
- `getSentImageIntents`/`markImageIntentSent(contextId, name)` — Task 2 정의, Task 6 소비 일치.
- `buildSelectedIntentSection(intent)` — Task 4 정의, Task 6 소비 일치.

**남은 수동 검증(자동 테스트 불가 영역):** GCS 실제 업로드(Task 5), executor e2e(Task 6), 폼 UI(Task 7), 채팅 렌더(Task 8) — 각 태스크 하단 메모 참조.
