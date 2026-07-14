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
