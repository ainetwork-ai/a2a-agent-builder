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
