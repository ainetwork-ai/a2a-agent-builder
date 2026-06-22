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
