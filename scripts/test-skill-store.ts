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
