import { redis } from "./redis";
import { Intent } from "@/types/agent";

/**
 * Intent Storage Module
 *
 * Manages agent intents in separate Redis keys for easy management
 * and independent lifecycle from agent core data.
 */

/**
 * Get the Redis key for storing intents for a specific agent
 */
function getIntentKey(agentId: string): string {
  return `intent:${agentId}`;
}

/**
 * Retrieve all intents for an agent
 */
export async function getIntents(agentId: string): Promise<Intent[]> {
  const key = getIntentKey(agentId);
  const data = await redis.get<Intent[]>(key);
  return data || [];
}

/**
 * Save intents for an agent
 */
export async function setIntents(agentId: string, intents: Intent[]): Promise<void> {
  const key = getIntentKey(agentId);
  if (intents.length === 0) {
    // Delete key if no intents (cleanup)
    await redis.del(key);
  } else {
    await redis.set(key, intents);
  }
}

/**
 * Delete all intents for an agent
 */
export async function deleteIntents(agentId: string): Promise<void> {
  const key = getIntentKey(agentId);
  await redis.del(key);
}

/**
 * Check if an agent has any intents defined
 */
export async function hasIntents(agentId: string): Promise<boolean> {
  const intents = await getIntents(agentId);
  return intents.length > 0;
}
