# Skills as Answer-Generation Aids — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an A2A agent's `skills` actively shape its answers — each skill carries a private `instructions` body that is loaded into the system prompt only when an LLM selection step judges it relevant (Claude Code-style progressive disclosure).

**Architecture:** Skill instructions are stored privately in a new Redis key `skill:{agentId}` (mirroring `intent:{agentId}`), never in the public A2A card. At message time, if the agent's `useSkills` toggle is on and at least one skill has instructions, a dedicated lightweight LLM call (`selectSkills`) picks 0–3 relevant skill ids; their instructions are injected into the system prompt as an `ACTIVE SKILLS` block. Agents with the toggle off skip the selection step entirely (zero added cost). Rollout is non-breaking: agents without stored instructions behave exactly as today.

**Tech Stack:** Next.js 15 (App Router) · `@a2a-js/sdk` · OpenAI SDK via `llmManager` · Upstash/ioredis via `src/lib/redis.ts` · TypeScript.

## Global Constraints

- **No test runner exists.** Follow the repo convention: pure-logic unit tests are standalone `tsx` assertion scripts under `scripts/` (like `scripts/test-redis.ts`), run with `npx tsx scripts/<file>.ts`, exiting non-zero on failure. For everything else the verification gate is `npm run build` (tsc) **and** `npm run lint`, plus the documented manual check in Task 8.
- **Privacy invariant (must hold after every task):** the stored `AgentCard.skills` and the public `GET /api/agents/{id}/.well-known/agent.json` response contain ONLY `{ id, name, description, tags }` — never `instructions`.
- **Non-breaking:** an agent with no stored skill instructions, or `useSkills` falsy, must behave exactly as before (no extra LLM call, no prompt change).
- **Selection cap:** at most **3** skills selected per message.
- Skill instructions live in Redis key `skill:{agentId}` as `Record<skillId, string>`; absent/blank instructions are never stored.
- `instructions?` on the `Skill` type is the authoring/transport carrier only; it is stripped before building the card.
- Node ≥ 22 (`package.json` engines). Use `@/...` path alias for `src` imports.

---

### Task 1: Data model — types, Redis key, `skillStore`

**Files:**
- Modify: `src/types/agent.ts`
- Modify: `src/lib/redis.ts:194-198` (REDIS_KEYS)
- Modify: `src/lib/agentStore.ts` (StoredAgent / SerializableAgent + serialize round-trip)
- Create: `src/lib/skillStore.ts`
- Test: `scripts/test-skill-store.ts`

**Interfaces:**
- Produces:
  - `Skill` now has optional `instructions?: string`
  - `AgentConfig.useSkills?: boolean`, `AgentBuilderForm.useSkills?: boolean`
  - `StoredAgent.useSkills?: boolean`
  - `REDIS_KEYS.SKILL(agentId: string): string` → `skill:${agentId}`
  - `getSkillInstructions(agentId: string): Promise<Record<string, string>>`
  - `setSkillInstructions(agentId: string, map: Record<string, string>): Promise<void>` (deletes key when map empty)
  - `deleteSkillInstructions(agentId: string): Promise<void>`
  - `extractSkillInstructions(skills: Skill[] | undefined): Record<string, string>` (pure; `{ skillId: trimmed instructions }`, omits blank/absent)
  - `toPublicSkills(skills: Skill[] | undefined): Skill[]` (pure; strips `instructions`, keeps `id/name/description/tags`)

- [ ] **Step 1: Extend the types**

In `src/types/agent.ts`, add `instructions?` to `Skill` and `useSkills?` to both `AgentConfig` and `AgentBuilderForm`:

```typescript
export interface Skill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  // Private authoring/transport body — stripped from the public AgentCard,
  // persisted separately under skill:{agentId}. Never exposed in .well-known.
  instructions?: string;
}
```

In `AgentConfig` (after `intents?: Intent[];`) add:

```typescript
  // When true, the runtime runs the skill-selection step and injects matched
  // skill instructions. Defaults (at deploy/edit time) to "on if any skill has
  // instructions".
  useSkills?: boolean;
```

In `AgentBuilderForm` (after `intents?: Intent[];`) add:

```typescript
  useSkills?: boolean;
```

- [ ] **Step 2: Add the Redis key**

In `src/lib/redis.ts`, extend `REDIS_KEYS`:

```typescript
export const REDIS_KEYS = {
  AGENT: (agentId: string) => `agent:${agentId}`,
  AGENT_LIST: "agents:list",
  SKILL: (agentId: string) => `skill:${agentId}`,
  ADMIN_NONCE: (address: string) => `admin:nonce:${address}`,
} as const;
```

- [ ] **Step 3: Persist `useSkills` on the stored agent**

In `src/lib/agentStore.ts`:
- Add `useSkills?: boolean;` to `StoredAgent` (after `intentPatterns?` on line 27) and to `SerializableAgent` (after its `intentPatterns?`).
- In `toSerializable` add `useSkills: agent.useSkills,`.
- In `fromSerializable` add `useSkills: data.useSkills,`.

- [ ] **Step 4: Create `src/lib/skillStore.ts`**

```typescript
import { redis, REDIS_KEYS } from "./redis";
import type { Skill } from "@/types/agent";

/**
 * Skill Instruction Storage
 *
 * Stores the private `instructions` body for each skill in its own Redis key,
 * separate from the public AgentCard. Mirrors intentStore's pattern.
 * Shape: { [skillId]: instructions }
 */

export async function getSkillInstructions(
  agentId: string
): Promise<Record<string, string>> {
  const data = await redis.get<Record<string, string>>(REDIS_KEYS.SKILL(agentId));
  return data || {};
}

export async function setSkillInstructions(
  agentId: string,
  map: Record<string, string>
): Promise<void> {
  const key = REDIS_KEYS.SKILL(agentId);
  if (!map || Object.keys(map).length === 0) {
    await redis.del(key);
  } else {
    await redis.set(key, map);
  }
}

export async function deleteSkillInstructions(agentId: string): Promise<void> {
  await redis.del(REDIS_KEYS.SKILL(agentId));
}

/**
 * Pure helper: build the private { skillId: instructions } map from a skills
 * array, keeping only non-blank trimmed instructions. Shared by deploy & edit.
 */
export function extractSkillInstructions(
  skills: Skill[] | undefined
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of skills ?? []) {
    if (s.instructions && s.instructions.trim()) {
      map[s.id] = s.instructions.trim();
    }
  }
  return map;
}

/**
 * Pure helper: strip `instructions` so only public card fields remain.
 * Shared by deploy & edit to enforce the privacy invariant in one place.
 */
export function toPublicSkills(skills: Skill[] | undefined): Skill[] {
  return (skills ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    tags: s.tags,
  }));
}
```

- [ ] **Step 5: Write the round-trip test (will fail until redis is reachable)**

Create `scripts/test-skill-store.ts`:

```typescript
#!/usr/bin/env tsx
/** Run with: npx tsx scripts/test-skill-store.ts (round-trip requires REDIS_URL or KV_REST_API_*) */
import {
  getSkillInstructions,
  setSkillInstructions,
  deleteSkillInstructions,
  extractSkillInstructions,
  toPublicSkills,
} from "../src/lib/skillStore";
import type { Skill } from "../src/types/agent";

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("❌ FAIL:", msg); process.exit(1); }
  console.log("✅", msg);
}

// --- Pure helper tests (no redis) ---
const skills: Skill[] = [
  { id: "a", name: "A", description: "da", tags: ["t"], instructions: "  do A  " },
  { id: "b", name: "B", description: "db", tags: [], instructions: "   " },
  { id: "c", name: "C", description: "dc", tags: [] },
];
const extracted = extractSkillInstructions(skills);
assert(extracted["a"] === "do A", "extract trims instructions");
assert(!("b" in extracted), "extract omits blank instructions");
assert(!("c" in extracted), "extract omits absent instructions");
assert(Object.keys(extractSkillInstructions(undefined)).length === 0, "extract handles undefined");

const pub = toPublicSkills(skills);
assert(pub.every((s) => !("instructions" in s)), "toPublicSkills strips instructions");
assert(pub[0].id === "a" && pub[0].name === "A" && pub[0].tags.length === 1, "toPublicSkills keeps public fields");

async function main() {
  const agentId = "test-skill-store-agent";
  await deleteSkillInstructions(agentId);

  assert(Object.keys(await getSkillInstructions(agentId)).length === 0, "empty when unset");

  await setSkillInstructions(agentId, { "skill-1": "do X", "skill-2": "do Y" });
  const got = await getSkillInstructions(agentId);
  assert(got["skill-1"] === "do X" && got["skill-2"] === "do Y", "round-trips two skills");

  await setSkillInstructions(agentId, {});
  assert(Object.keys(await getSkillInstructions(agentId)).length === 0, "empty map deletes key");

  await deleteSkillInstructions(agentId);
  console.log("🎉 skillStore OK");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Run the test**

Run: `npx tsx scripts/test-skill-store.ts`
Expected: the pure-helper assertions pass first, then prints `🎉 skillStore OK` and exits 0. (The round-trip portion needs Redis env vars — `REDIS_URL` or `KV_REST_API_URL`/`KV_REST_API_TOKEN`, e.g. from `.env`. If absent it exits 1 at the first redis call, but the pure-helper assertions above will already have passed.)

- [ ] **Step 7: Compile gate**

Run: `npm run build && npm run lint`
Expected: build and lint succeed with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/types/agent.ts src/lib/redis.ts src/lib/agentStore.ts src/lib/skillStore.ts scripts/test-skill-store.ts
git commit -m "feat(skills): add skill instructions data model and skillStore"
```

---

### Task 2: `skillSelector` — pure parser (TDD) + LLM selection call

**Files:**
- Create: `src/lib/skillSelector.ts`
- Test: `scripts/test-skill-selector.ts`

**Interfaces:**
- Consumes: `callLLM` from `@/lib/llmManager`; `withoutLLMRouting` from `@/lib/requestContext`.
- Produces:
  - `parseSelectedSkillIds(text: string, validIds: string[], cap?: number): string[]` (pure; default cap 3)
  - `SkillCatalogItem = { id: string; name: string; description: string }`
  - `selectSkills(modelName: string, catalog: SkillCatalogItem[], latestMessage: string, cap?: number): Promise<string[]>`

- [ ] **Step 1: Write the failing parser test**

Create `scripts/test-skill-selector.ts`:

```typescript
#!/usr/bin/env tsx
/** Run with: npx tsx scripts/test-skill-selector.ts (no network, no redis) */
import { parseSelectedSkillIds } from "../src/lib/skillSelector";

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("❌ FAIL:", msg); process.exit(1); }
  console.log("✅", msg);
}

const valid = ["a", "b", "c", "d"];

assert(JSON.stringify(parseSelectedSkillIds('["a","c"]', valid)) === '["a","c"]', "parses a JSON array");
assert(JSON.stringify(parseSelectedSkillIds('blah ["b"] trailing', valid)) === '["b"]', "extracts first array from noise");
assert(JSON.stringify(parseSelectedSkillIds('["a","x","b"]', valid)) === '["a","b"]', "drops ids not in valid set");
assert(JSON.stringify(parseSelectedSkillIds('["a","a","b"]', valid)) === '["a","b"]', "dedupes");
assert(JSON.stringify(parseSelectedSkillIds('["a","b","c","d"]', valid, 3)) === '["a","b","c"]', "caps at limit");
assert(JSON.stringify(parseSelectedSkillIds('[]', valid)) === '[]', "empty array -> none");
assert(JSON.stringify(parseSelectedSkillIds('not json at all', valid)) === '[]', "unparsable -> none");
assert(JSON.stringify(parseSelectedSkillIds('', valid)) === '[]', "empty string -> none");

console.log("🎉 skillSelector parser OK");
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-skill-selector.ts`
Expected: FAIL — `Cannot find module '../src/lib/skillSelector'` (module not yet created).

- [ ] **Step 3: Implement `src/lib/skillSelector.ts`**

```typescript
import { callLLM } from "@/lib/llmManager";
import { withoutLLMRouting } from "@/lib/requestContext";

export interface SkillCatalogItem {
  id: string;
  name: string;
  description: string;
}

const DEFAULT_CAP = 3;

/**
 * Parse the selector LLM output into a clean list of skill ids:
 * extract the first JSON array, keep only ids present in `validIds`,
 * dedupe, and cap. Any failure yields [].
 */
export function parseSelectedSkillIds(
  text: string,
  validIds: string[],
  cap: number = DEFAULT_CAP
): string[] {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const allowed = new Set(validIds);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    if (!allowed.has(item) || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= cap) break;
  }
  return result;
}

/**
 * Ask the LLM which skills (by id) would help answer the latest message.
 * Returns up to `cap` ids. Never throws — on any error returns [].
 */
export async function selectSkills(
  modelName: string,
  catalog: SkillCatalogItem[],
  latestMessage: string,
  cap: number = DEFAULT_CAP
): Promise<string[]> {
  if (catalog.length === 0) return [];

  const validIds = catalog.map((s) => s.id);
  const catalogText = catalog
    .map((s) => `- id: ${s.id}\n  name: ${s.name}\n  when_useful: ${s.description}`)
    .join("\n");

  const systemPrompt = `You are a skill router for an AI agent.
Given the user's latest message and a list of available skills (each with an id, name, and when it is useful), choose ONLY the skills whose detailed instructions would genuinely help answer THIS message.
- Choose none if no skill clearly applies.
- Choose at most ${cap}.
- Match on meaning, across languages.
Respond with ONLY a JSON array of the chosen skill ids, e.g. ["skill-1","skill-2"]. If none apply, respond with [].`;

  const userPrompt = `Available skills:\n${catalogText}\n\nUser's latest message:\n${latestMessage}`;

  try {
    const text = await withoutLLMRouting(() =>
      callLLM([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ])
    );
    return parseSelectedSkillIds(text, validIds, cap);
  } catch (error) {
    console.error("❌ Skill selection failed:", error);
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-skill-selector.ts`
Expected: PASS — prints `🎉 skillSelector parser OK`, exits 0.

- [ ] **Step 5: Compile gate**

Run: `npm run build && npm run lint`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add src/lib/skillSelector.ts scripts/test-skill-selector.ts
git commit -m "feat(skills): add skill selector (parser + LLM selection call)"
```

---

### Task 3: Runtime wiring — select + inject in the executor

**Files:**
- Modify: `src/app/api/agents/[agentId]/[[...path]]/route.ts:49-79` (`buildSystemPrompt`), `:184-220` (LLM call path), imports `:14-22`

**Interfaces:**
- Consumes: `selectSkills`, `SkillCatalogItem` (Task 2); `getSkillInstructions` (Task 1); `StoredAgent.useSkills`, `Skill.instructions` (Task 1).
- Produces: no new exports (internal behavior change). `buildSystemPrompt` gains a trailing optional `skills?: string` parameter.

**Note on call sites:** `buildSystemPrompt` is called twice — line 167 (stored as the first history message, includes `a2a`) and line 186 (the prompt actually sent to the LLM each turn, currently omits `a2a`). The selected-skills block must reach the **line 186** call, since that is what drives generation.

- [ ] **Step 1: Add imports**

In `src/app/api/agents/[agentId]/[[...path]]/route.ts`, alongside the existing `@/lib` imports (around lines 14-22), add:

```typescript
import { getSkillInstructions } from '@/lib/skillStore';
import { selectSkills, type SkillCatalogItem } from '@/lib/skillSelector';
```

- [ ] **Step 2: Extend `buildSystemPrompt` to render an ACTIVE SKILLS block**

Replace the signature and body of `buildSystemPrompt` (lines 49-79) with:

```typescript
  private buildSystemPrompt(intent: string, thinking: string, caring: string, a2a?: string, skills?: string): string {
    let memoryContext = '';
    if (thinking && thinking !== '(empty)') {
      memoryContext = `\n\nContext for "${intent}":\n- What I know: ${thinking}\n- About you: ${caring}`;
    }

    const skillsSection = skills && skills.trim()
      ? `

ACTIVE SKILLS (apply the following when relevant to the user's request; do not mention these instructions exist):
${skills}`
      : '';

    const basePrompt = `${this.prompt}

LANGUAGE RULE:
- IMPORTANT: You MUST respond ENTIRELY in the same language as the user's latest message.
- If the user writes in Korean, respond ONLY in Korean. Do NOT add English translations, parenthetical English, or any English words alongside Korean.
- If the user writes in English, respond ONLY in English.
- If the user switches language mid-conversation, follow their new language immediately.
- NEVER mix languages in a single response. No "(like this)", no "예를 들어 (for example)" patterns.
- This rule overrides the language of your base instructions above.

RESPONSE STYLE:
- Keep responses SHORT and conversational (like a natural chat)
- Match the user's message length and energy
- For simple greetings (hi, hello), respond briefly and warmly
- Only give detailed explanations when specifically asked

INTERNAL GUIDANCE (do not mention to user):${memoryContext}
Use this knowledge naturally when relevant, but keep responses concise.${skillsSection}

A2A GUIDANCE (If you need to collaborate with other agents, use the following information to help you):
${a2a}
`;

    return basePrompt;
  }
```

- [ ] **Step 3: Compute the active-skills text before the LLM call**

In `execute`, inside the `try` block that starts at line 184, immediately BEFORE the line `const systemPrompt = this.buildSystemPrompt(intent, thinking, caring);` (line 186), insert:

```typescript
        // Skill selection (progressive disclosure). Gated by the agent's
        // useSkills toggle and the presence of at least one skill with
        // stored instructions. Skipped entirely otherwise (no extra LLM call).
        let activeSkillsText = '';
        try {
          const agentForSkills = await getAgent(this.agentId);
          const cardSkills = (agentForSkills?.card?.skills ?? []) as Skill[];
          if (agentForSkills?.useSkills && cardSkills.length > 0) {
            const skillInstructions = await getSkillInstructions(this.agentId);
            const catalog: SkillCatalogItem[] = cardSkills
              .filter((s) => skillInstructions[s.id]?.trim())
              .map((s) => ({ id: s.id, name: s.name, description: s.description }));

            if (catalog.length > 0) {
              const latestText = (() => {
                const part = incomingMessage.parts.find((p) => p.kind === 'text');
                return part && 'text' in part ? part.text : '';
              })();
              const selectedIds = await selectSkills(this.modelName, catalog, latestText);
              activeSkillsText = selectedIds
                .map((id) => {
                  const skill = cardSkills.find((s) => s.id === id);
                  return `## ${skill?.name ?? id}\n${skillInstructions[id].trim()}`;
                })
                .join('\n\n');
              if (selectedIds.length > 0) {
                console.log('🛠️ [Skills] Selected:', selectedIds.join(', '));
              }
            }
          }
        } catch (error) {
          console.error('Error selecting skills:', error);
          activeSkillsText = '';
        }
```

- [ ] **Step 4: Pass the skills text into the prompt actually sent to the LLM**

Change line 186 from:

```typescript
        const systemPrompt = this.buildSystemPrompt(intent, thinking, caring);
```

to:

```typescript
        const systemPrompt = this.buildSystemPrompt(intent, thinking, caring, undefined, activeSkillsText);
```

- [ ] **Step 5: Compile gate**

Run: `npm run build && npm run lint`
Expected: success. (Confirms `incomingMessage.parts` typing and the new params line up.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/agents/[agentId]/[[...path]]/route.ts"
git commit -m "feat(skills): select and inject skill instructions at message time"
```

---

### Task 4: Persist skill instructions on deploy

**Files:**
- Modify: `src/app/api/deploy-agent/route.ts`

**Interfaces:**
- Consumes: `setSkillInstructions`, `extractSkillInstructions`, `toPublicSkills` (Task 1); `Skill.instructions`, `AgentConfig.useSkills` (Task 1).
- Produces: deployed agents have `skill:{agentId}` populated and `useSkills` set; the stored card carries no `instructions`.

- [ ] **Step 1: Import the skill store helpers**

Add to the imports at the top of `src/app/api/deploy-agent/route.ts`:

```typescript
import { setSkillInstructions, extractSkillInstructions, toPublicSkills } from '@/lib/skillStore';
```

- [ ] **Step 2: Build the instruction map and strip the card**

Replace the `agentCard` construction (lines 16-26) with a stripped-skills version, and compute the instruction map using the shared helpers:

```typescript
    // Private instructions map: { skillId: instructions } — never on the card.
    const skillInstructions = extractSkillInstructions(agentConfig.skills);

    const agentCard: AgentCard = {
      name: agentConfig.name,
      description: agentConfig.description,
      protocolVersion: agentConfig.protocolVersion,
      version: agentConfig.version,
      url: agentConfig.url,
      capabilities: agentConfig.capabilities,
      defaultInputModes: agentConfig.defaultInputModes,
      defaultOutputModes: agentConfig.defaultOutputModes,
      // Strip instructions — the public card keeps only id/name/description/tags.
      skills: toPublicSkills(agentConfig.skills),
    };
```

- [ ] **Step 3: Persist instructions and `useSkills`**

After the existing intents block (lines 28-33), add:

```typescript
    // Store private skill instructions in their own redis key
    await setSkillInstructions(agentId, skillInstructions);
```

Then change the `setAgent(...)` call (lines 37-43) to include `useSkills` (default: on if any skill has instructions):

```typescript
    await setAgent(agentId, {
      card: agentCard,
      prompt: agentConfig.prompt,
      modelProvider: agentConfig.modelProvider,
      modelName: agentConfig.modelName,
      creator: creatorAddress,
      useSkills: agentConfig.useSkills ?? Object.keys(skillInstructions).length > 0,
    });
```

- [ ] **Step 4: Compile gate**

Run: `npm run build && npm run lint`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/deploy-agent/route.ts
git commit -m "feat(skills): persist skill instructions and useSkills on deploy"
```

---

### Task 5: Persist skill instructions on edit

**Files:**
- Modify: `src/app/api/agents/[agentId]/edit/route.ts`

**Interfaces:**
- Consumes: `setSkillInstructions`, `extractSkillInstructions`, `toPublicSkills` (Task 1); `Skill.instructions`, `StoredAgent.useSkills`.
- Produces: edits update `skill:{agentId}` and `useSkills`; the updated card carries no `instructions`.

- [ ] **Step 1: Import the skill store helpers**

Add to imports in `src/app/api/agents/[agentId]/edit/route.ts`:

```typescript
import { setSkillInstructions, extractSkillInstructions, toPublicSkills } from '@/lib/skillStore';
```

And add `useSkills` to the destructured body (line 14):

```typescript
    const { name, description, url, skills, modelProvider, modelName, prompt, address, intents, useSkills } = body;
```

- [ ] **Step 2: Build the instruction map, persist it, and strip the card**

After the intents update block (lines 42-47), add (using the shared helpers — `skills as Skill[]` because the body field is untyped):

```typescript
    // Build and persist the private skill-instructions map
    const skillInstructions = extractSkillInstructions(skills as Skill[]);
    await setSkillInstructions(agentId, skillInstructions);
```

Change the `updatedCard` (lines 50-56) so card skills are stripped:

```typescript
    const updatedCard = {
      ...agent.card,
      name,
      description,
      url,
      skills: toPublicSkills(skills as Skill[]),
    };
```

Change `updatedAgent` (lines 59-65) to set `useSkills`:

```typescript
    const updatedAgent = {
      ...agent,
      card: updatedCard,
      modelProvider: modelProvider as 'google' | 'openai' | 'anthropic',
      modelName,
      prompt,
      useSkills: useSkills ?? Object.keys(skillInstructions).length > 0,
    };
```

- [ ] **Step 3: Compile gate**

Run: `npm run build && npm run lint`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/agents/[agentId]/edit/route.ts"
git commit -m "feat(skills): persist skill instructions and useSkills on edit"
```

---

### Task 6: Return instructions + `useSkills` in the owner list view

**Files:**
- Modify: `src/app/api/agents/list/route.ts`

**Interfaces:**
- Consumes: `getSkillInstructions` (Task 1); `StoredAgent.useSkills`.
- Produces: each listed agent's `skills[]` includes `instructions` (when present) and the agent object includes `useSkills`, so the edit form can repopulate. (This is the owner/management view, already returning the full system `prompt`; it is CORS-gated and is NOT the public card.)

- [ ] **Step 1: Import the skill store**

Add to imports in `src/app/api/agents/list/route.ts`:

```typescript
import { getSkillInstructions } from '@/lib/skillStore';
```

- [ ] **Step 2: Merge instructions and `useSkills` into the response**

Inside the `filteredAgents.map(async (agent) => { ... })` (lines 26-43), after `const intents = await getIntents(agentId);` add:

```typescript
      const skillInstructions = await getSkillInstructions(agentId);
```

Then change the returned object's `skills` line and add `useSkills`:

```typescript
        skills: agent.card.skills.map((s) => ({
          ...s,
          ...(skillInstructions[s.id] ? { instructions: skillInstructions[s.id] } : {}),
        })),
        intents: intents.length > 0 ? intents : undefined,
        useSkills: agent.useSkills ?? false,
        deployed: true,
        creator: agent.creator,
```

- [ ] **Step 3: Compile gate**

Run: `npm run build && npm run lint`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/agents/list/route.ts
git commit -m "feat(skills): include skill instructions and useSkills in owner list view"
```

---

### Task 7: Auto-generate skill instructions

**Files:**
- Modify: `src/app/api/generate-agent/route.ts`

**Interfaces:**
- Consumes: nothing new (Skill type already has `instructions?`).
- Produces: generated skills include an `instructions` string in the same language as the user's input.

- [ ] **Step 1: Add `instructions` to the full-generation skill schema and rules**

In the non-partial branch `systemPrompt` (lines 84-111), change the `skills` example to include `instructions`:

```typescript
  "skills": [
    {
      "id": "skill-id",
      "name": "Skill Name",
      "description": "When this skill is useful (one line, used to decide relevance)",
      "tags": ["tag1", "tag2"],
      "instructions": "Detailed guidance and knowledge the agent should apply when this skill is relevant. Several sentences."
    }
  ],
```

And add two rule lines to the `IMPORTANT RULES` list in the same branch:

```
- Each skill MUST include an "instructions" field: a concrete, self-contained block of guidance/knowledge the agent applies when that skill is selected (distinct from the one-line description).
- Write "instructions" in the SAME LANGUAGE as the user's request.
```

- [ ] **Step 2: Add `instructions` to the partial-generation skill schema**

In the partial branch `systemPrompt` (lines 53-77), change the default skills example (line 64) so a generated skill includes instructions:

```typescript
  "skills": ${partialData.skills && partialData.skills.length > 0 ? JSON.stringify(partialData.skills) : '[{"id": "skill-id", "name": "Skill Name", "description": "When this skill is useful", "tags": ["tag1", "tag2"], "instructions": "Detailed guidance the agent applies when this skill is relevant."}]'},
```

And add to that branch's `IMPORTANT RULES`:

```
- When generating skills, include an "instructions" field per skill (concrete guidance the agent applies when the skill is relevant), in the same language as the existing fields.
```

- [ ] **Step 3: Compile gate**

Run: `npm run build && npm run lint`
Expected: success.

- [ ] **Step 4: Manual generation check**

Run `npm run dev`, open the builder in AI mode, generate an agent from a prompt (e.g. "crypto trading tutor"), and confirm in the network response for `POST /api/generate-agent` that each skill object now has a non-empty `instructions` string. (Requires a configured LLM endpoint.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/generate-agent/route.ts
git commit -m "feat(skills): auto-generate per-skill instructions"
```

---

### Task 8: Builder UI — instructions field, useSkills toggle, wiring

**Files:**
- Modify: `src/components/AgentForm.tsx` (instructions textarea, useSkills toggle, addSkill default)
- Modify: `src/components/AgentBuilder.tsx` (initial form `useSkills`, pass-through on create)
- Modify: `src/components/EditAgentModal.tsx` (carry `skills` instructions + `useSkills`)

**Interfaces:**
- Consumes: `AgentBuilderForm.useSkills`, `Skill.instructions` (Task 1); list response shape (Task 6).
- Produces: the form authors instructions per skill and toggles `useSkills`; create/edit submit these through to the deploy/edit endpoints.

- [ ] **Step 1: Add an instructions textarea per skill in `AgentForm`**

In `src/components/AgentForm.tsx`, inside the skill card body, AFTER the Tags block's closing `</div>` (the one closing the tags wrapper at line 312) and BEFORE the card body's closing `</div>` (line 313), add:

```tsx
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5">
                    Instructions
                  </label>
                  <p className="text-[11px] text-gray-400 mb-1.5">
                    Loaded into the agent only when this skill is relevant to the user&apos;s message.
                  </p>
                  <textarea
                    value={skill.instructions || ''}
                    onChange={(e) => handleSkillChange(skill.id, 'instructions', e.target.value)}
                    onFocus={(e) => (e.target.rows = 6)}
                    onBlur={(e) => (e.target.rows = 3)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none bg-gray-50 focus:bg-white transition-all text-base"
                    rows={3}
                    placeholder="Concrete guidance/knowledge the agent applies when this skill is selected..."
                  />
                </div>
```

(`handleSkillChange`'s `field` is `keyof Skill`, which now includes `'instructions'` — no signature change needed.)

- [ ] **Step 2: Default `instructions` on new skills**

In `addSkill` (lines 77-85), add `instructions: ''` to `newSkill`:

```typescript
    const newSkill: Skill = {
      id: `skill-${Date.now()}`,
      name: '',
      description: '',
      tags: [],
      instructions: '',
    };
```

- [ ] **Step 3: Add the `useSkills` toggle to the Skills section header**

In `src/components/AgentForm.tsx`, replace the Skills section header block (lines 193-198) with one that includes a toggle:

```tsx
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <label className="block text-lg font-bold text-gray-900">Skills</label>
            <p className="text-sm text-gray-500 mt-1">
              Set up your agent&apos;s capabilities and tools
            </p>
          </div>
          <label className="flex items-center gap-2 mt-1 shrink-0 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={formData.useSkills ?? false}
              onChange={(e) => setFormData({ ...formData, useSkills: e.target.checked })}
              className="h-4 w-4 accent-purple-600"
            />
            <span className="text-sm font-medium text-gray-700">Use skills in replies</span>
          </label>
        </div>
```

- [ ] **Step 4: Initialize `useSkills` in `AgentBuilder` manual form**

In `src/components/AgentBuilder.tsx`, add `useSkills: false,` to the `manualFormData` initial state object (the `useState<AgentBuilderForm>({...})` at lines 49-57), after `intents: [],`.

- [ ] **Step 5: Pass `useSkills` through when building the AgentConfig**

In `src/components/AgentBuilder.tsx`, locate the `AgentConfig` object built in `createAgent` (the `const newAgent: AgentConfig = { ... }` near lines 212-229; it sets `skills: agentData.skills`). Add, alongside the other fields copied from `agentData`:

```typescript
        useSkills: agentData.useSkills ?? agentData.skills.some((s) => s.instructions?.trim()),
```

(`agentData.skills` already carries each skill's `instructions` from the form, so they flow into the deploy payload unchanged.)

- [ ] **Step 6: Carry instructions + `useSkills` through the edit modal**

In `src/components/EditAgentModal.tsx`:
- Add `useSkills?: boolean;` to the `agent` prop type (after `prompt: string;`, line 23).
- Add `useSkills: agent.useSkills ?? false,` to BOTH the initial `useState` object (lines 30-39) and the `useEffect` reset object (lines 45-54), after `prompt: agent.prompt,`.

The skills passed in already include `instructions` (from the Task 6 list response), and `handleSave` spreads `...data`, so instructions and `useSkills` reach `PUT /edit` without further change.

- [ ] **Step 7: Compile gate**

Run: `npm run build && npm run lint`
Expected: success.

- [ ] **Step 8: Manual end-to-end verification**

With a configured LLM + Redis, run `npm run dev` and:
1. Create an agent (manual mode), add a skill with a clear `description` and distinctive `instructions` (e.g. skill "Refunds", instructions "Always cite policy code R-7 and offer a 14-day window."), turn **Use skills in replies** ON, and deploy.
2. `curl` the public card and confirm NO instructions leak:
   `curl -s localhost:3001/api/agents/<id>/.well-known/agent.json | grep -i instructions` → expect **no match**.
3. Send a message that should trigger the skill (e.g. "I want a refund") via the chat/JSON-RPC path and confirm the reply reflects the instructions (mentions "R-7" / "14-day"); confirm a server log line `🛠️ [Skills] Selected: ...`.
4. Send an unrelated message ("what's the weather?") and confirm the skill content does NOT appear.
5. Toggle **Use skills in replies** OFF (edit), repeat step 3, and confirm no `[Skills] Selected` log appears (selection skipped).
6. Re-open the edit modal and confirm the instructions text and toggle state reload correctly.

- [ ] **Step 9: Commit**

```bash
git add src/components/AgentForm.tsx src/components/AgentBuilder.tsx src/components/EditAgentModal.tsx
git commit -m "feat(skills): builder UI for skill instructions and useSkills toggle"
```

---

## Self-Review

**Spec coverage:**
- Data model (`instructions` private, `useSkills`, separate `skill:{id}` store) → Task 1. ✓
- LLM selection step (Approach A), gated by toggle, cap 3, withoutLLMRouting → Tasks 2 & 3. ✓
- Inject as ACTIVE SKILLS block in the prompt sent to the LLM → Task 3. ✓
- deploy / edit persist + strip card → Tasks 4 & 5. ✓
- Owner read path returns instructions for editing → Task 6. ✓
- generate-agent produces instructions → Task 7. ✓
- Builder UI (textarea + toggle + auto-gen populate) → Task 8. ✓
- Privacy invariant (card excludes instructions) → enforced at Tasks 4/5, verified at Task 8 step 2. ✓
- Backward compatibility (no instructions / toggle off ⇒ unchanged) → Task 3 gating, verified Task 8 step 5. ✓
- Testing convention (tsx scripts + build/lint + manual) → Tasks 1, 2, 8. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `parseSelectedSkillIds`, `selectSkills`, `SkillCatalogItem`, `getSkillInstructions`/`setSkillInstructions`/`deleteSkillInstructions`, `extractSkillInstructions`/`toPublicSkills` (shared by Tasks 4 & 5 — no duplicated logic), `REDIS_KEYS.SKILL`, `Skill.instructions`, `useSkills` are named identically across producing and consuming tasks. `buildSystemPrompt(intent, thinking, caring, a2a?, skills?)` is called with `(intent, thinking, caring, undefined, activeSkillsText)` in Task 3 step 4. ✓
