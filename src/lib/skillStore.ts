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
