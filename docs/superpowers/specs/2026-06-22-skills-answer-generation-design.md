# Skills as Answer-Generation Aids — Design

**Date:** 2026-06-22
**Status:** Approved (design), pending implementation plan

## Problem

Today an A2A agent's `skills` field (`Skill { id, name, description, tags }`,
`src/types/agent.ts:13-18`) is effectively decorative. It is:

- stored in the public `AgentCard` and returned at `.well-known/agent.json`
  (`src/app/api/agents/[agentId]/[[...path]]/route.ts:417-428`),
- shown in the builder/list UIs,
- shared as `name: description` when collaborating with *other* agents
  (`route.ts:108`).

It is **never used in the agent's own answer generation**. Meanwhile `Intent`
(`{ name, description, prompt }`) already carries a body and is injected into the
system prompt via `buildPromptWithIntents` (`src/lib/promptBuilder.ts:13-45`), so
intents currently do the "match-by-description, apply-body" job that Claude Code
skills do.

## Goal

Make `skills` contribute to answer generation the way Claude Code skills do:
descriptions are always available, and a skill's body (instructions) is loaded
into the prompt **only when the skill is relevant** (progressive disclosure).

## Decisions (locked during brainstorming)

1. **Skills vs intents — keep both, separate roles.** Intents remain short
   response rules (tone/format). Skills become a richer, on-demand
   knowledge/instruction bundle. No change to intent behavior.
2. **Skill body = `instructions` text** (markdown/plain). No executable tools
   (the runtime is LLM-only) and no external/RAG fetch in this iteration.
3. **Triggering = LLM selection, gated by a per-agent toggle.** A dedicated
   lightweight selection step picks relevant skills; agents with the toggle off
   skip the selection step entirely (zero added cost).
4. **Instructions are private.** They are stored separately and are **not**
   exposed in the public `AgentCard` / `.well-known/agent.json`. The public card
   keeps only `id/name/description/tags` (A2A-schema compliant; protects
   know-how). Inter-agent collaboration continues to share only name/description.
5. **Scope = full**: data model + storage + runtime select/inject + builder UI +
   auto-generation.
6. **Selection implementation = Approach A** (dedicated selection call), not
   folded into intent classification (which short-circuits on pattern match and
   would silently skip skills).

## Architecture

### Data model

- Public `Skill` type stays unchanged: `{ id, name, description, tags }`.
  The A2A card and discovery are untouched.
- Skill bodies stored privately, mirroring the intents pattern
  (`src/lib/intentStore.ts`, key `intent:{agentId}`):
  - New Redis key `skill:{agentId}` → `Record<skillId, string>`
    (skillId → instructions).
  - Add `REDIS_KEYS.SKILL(agentId) => \`skill:${agentId}\`` in
    `src/lib/redis.ts`.
  - New module `src/lib/skillStore.ts`:
    - `getSkillInstructions(agentId): Promise<Record<string,string>>`
    - `setSkillInstructions(agentId, map): Promise<void>` (delete key when empty)
    - `deleteSkillInstructions(agentId): Promise<void>`
- Per-agent toggle `useSkills?: boolean` added to `AgentConfig`,
  `AgentBuilderForm` (`src/types/agent.ts`) and `StoredAgent`
  (`src/lib/agentStore.ts`).
  - Default: **on** if at least one skill has non-empty instructions, otherwise
    **off**. Stored explicitly so the owner can override.

### Runtime flow — `DynamicAgentExecutor.execute`

(`src/app/api/agents/[agentId]/[[...path]]/route.ts`)

```
1. Load agent (existing).
2. If useSkills is OFF, or no skill has instructions:
     skip the entire selection step -> behaves exactly as today.
3. selectSkills(catalog, latestUserMessage):
     - catalog = skills that HAVE instructions, projected to {id,name,description}
     - one LLM call wrapped in withoutLLMRouting (consistent with intent
       classification, so the aux call does not carry sticky-session headers)
     - returns skillId[]  (parse failure / error -> [];  cap at 3)
4. Fetch instructions for the selected ids from skill:{agentId}.
5. Inject into the system prompt as a dedicated "ACTIVE SKILLS" section,
   separate from the intent and memory sections.
6. Run the main LLM completion (existing path).
```

- New helper `src/lib/skillSelector.ts` exporting
  `selectSkills(modelName, catalog, latestMessage): Promise<string[]>`.
  - Prompt: a skill-router system message + the catalog (name + description) +
    the latest user message; respond with a JSON array of ids (`[]` if none),
    max 3.
  - Robust parsing: extract first JSON array; on any failure return `[]`.
- `buildSystemPrompt` (`route.ts:49-79`) gains a `skills` argument and renders an
  `ACTIVE SKILLS` block, e.g.:

  ```
  ACTIVE SKILLS (apply when relevant to the user's request):
  ## {skill.name}
  {instructions}
  ```

### Endpoint impact

- **deploy-agent** (`src/app/api/deploy-agent/route.ts`): persist instructions via
  `setSkillInstructions(agentId, map)` and store `useSkills`. The public
  `agentCard.skills` continues to carry only `id/name/description/tags`.
- **edit** (`src/app/api/agents/[agentId]/edit/route.ts`): same — update
  instructions and `useSkills`; ownership check unchanged.
- **generate-agent** (`src/app/api/generate-agent/route.ts`): extend the
  generation prompt/JSON schema so each generated skill includes an
  `instructions` field (input-language-aware, same as other generated text).
- **Owner-facing read for editing**: the edit form must be able to load existing
  instructions. Default decision: include `instructions` (and `useSkills`) in the
  owner-facing `/api/agents/list` response (the management view already used to
  populate the builder/edit UIs), and **never** in the public card. The plan may
  substitute a dedicated agent GET if list payload size becomes a concern.
- **`.well-known/agent.json`** (`route.ts:417-428`): no change needed —
  instructions are not part of the card, so they are excluded automatically.

### Builder UI (`src/components/AgentForm.tsx`)

- Per-skill `instructions` textarea (alongside name/description/tags).
- Per-agent `useSkills` toggle switch.
- Auto-generated instructions populate the form and remain editable.
- `EditAgentModal` (`src/components/EditAgentModal.tsx`) loads and edits the same
  fields.

### Error handling & backward compatibility

- Selection LLM error or unparsable output → proceed with **zero** skills
  (response still succeeds); log only.
- A selected id with no stored instructions is skipped; selection is capped at 3.
- **Existing agents**: no stored instructions → empty catalog → selection step is
  skipped → current behavior preserved. No migration required; rollout is
  non-breaking.

## Testing

- `selectSkills` parsing: valid array, malformed JSON, empty, over-cap truncation.
- Toggle gating: `useSkills` off ⇒ `selectSkills` (and its LLM call) not invoked.
- Privacy invariant: `.well-known/agent.json` response never contains
  `instructions`.
- Persistence round-trip: deploy/edit store and reload instructions + `useSkills`.
- generate-agent produces `instructions` per skill.

## Out of scope

- Executable tools / function-calling.
- External document / RAG-backed skills.
- Folding skill selection into the intent-classification call (possible later
  optimization).
```
