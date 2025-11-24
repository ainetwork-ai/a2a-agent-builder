import type { AgentCard } from "@a2a-js/sdk";
import type {
  AgentExecutor,
  DefaultRequestHandler,
  JsonRpcTransportHandler,
} from "@a2a-js/sdk/server";
import { redis, REDIS_KEYS } from "./redis";

// Intent-based memory structure (legacy)
export interface IntentMemory {
  thinking: string;
  caring: string;
}

export interface StoredAgent {
  card: AgentCard;
  prompt: string;
  modelProvider: string;
  modelName: string;
  // Creator's wallet address (for ownership verification)
  creator?: string;
  // Intent-based thinking: { [intent]: thinking }
  thinkingMemories?: Record<string, string>;
  // User-based caring: { [username]: caring }
  caringMemories?: Record<string, string>;
  // Intent pattern matching: { [intent]: [keywords] }
  intentPatterns?: Record<string, string[]>;
  // Legacy fields for backward compatibility
  memories?: Record<string, IntentMemory>;
  thinking?: string;
  caring?: string;
  thinkingHistory?: string[];
  caringHistory?: string[];
  executor?: AgentExecutor;
  requestHandler?: DefaultRequestHandler;
  transportHandler?: JsonRpcTransportHandler;
}

// Serializable version of StoredAgent (without function handlers)
export interface SerializableAgent {
  card: AgentCard;
  prompt: string;
  modelProvider: string;
  modelName: string;
  creator?: string;
  thinkingMemories?: Record<string, string>;
  caringMemories?: Record<string, string>;
  intentPatterns?: Record<string, string[]>;
  // Legacy
  memories?: Record<string, IntentMemory>;
  thinking?: string;
  caring?: string;
  thinkingHistory?: string[];
  caringHistory?: string[];
}

// Convert StoredAgent to SerializableAgent for Redis storage
function toSerializable(agent: StoredAgent): SerializableAgent {
  return {
    card: agent.card,
    prompt: agent.prompt,
    modelProvider: agent.modelProvider,
    modelName: agent.modelName,
    creator: agent.creator,
    thinkingMemories: agent.thinkingMemories,
    caringMemories: agent.caringMemories,
    intentPatterns: agent.intentPatterns,
    memories: agent.memories,
    thinking: agent.thinking,
    caring: agent.caring,
    thinkingHistory: agent.thinkingHistory,
    caringHistory: agent.caringHistory,
  };
}

// Convert SerializableAgent back to StoredAgent
function fromSerializable(data: SerializableAgent): StoredAgent {
  return {
    ...data,
    creator: data.creator,
    thinkingMemories: data.thinkingMemories,
    caringMemories: data.caringMemories,
    intentPatterns: data.intentPatterns,
    memories: data.memories,
    thinking: data.thinking,
    caring: data.caring,
    thinkingHistory: data.thinkingHistory,
    caringHistory: data.caringHistory,
    executor: undefined,
    requestHandler: undefined,
    transportHandler: undefined,
  };
}

export async function getAgent(agentId: string): Promise<StoredAgent | undefined> {
  const data = await redis.get<SerializableAgent>(REDIS_KEYS.AGENT(agentId));
  return data ? fromSerializable(data) : undefined;
}

export async function setAgent(agentId: string, agent: StoredAgent): Promise<void> {
  const serializable = toSerializable(agent);
  await redis.set(REDIS_KEYS.AGENT(agentId), serializable);

  // Add to agent list (using a Redis Set for efficient lookups)
  await redis.sadd(REDIS_KEYS.AGENT_LIST, agentId);
}

export async function getAllAgents(): Promise<StoredAgent[]> {
  // Get all agent IDs from the set
  const agentIds = await redis.smembers(REDIS_KEYS.AGENT_LIST);

  if (!agentIds || agentIds.length === 0) {
    return [];
  }

  // Fetch all agents in parallel
  const agents = await Promise.all(
    agentIds.map(async (id) => {
      const data = await redis.get<SerializableAgent>(REDIS_KEYS.AGENT(id));
      return data ? fromSerializable(data) : null;
    })
  );

  // Filter out null values (in case an agent was deleted but still in the set)
  return agents.filter((agent): agent is StoredAgent => agent !== null);
}

export async function hasAgent(agentId: string): Promise<boolean> {
  const exists = await redis.exists(REDIS_KEYS.AGENT(agentId));
  return exists === 1;
}

export async function deleteAgent(agentId: string): Promise<void> {
  await redis.del(REDIS_KEYS.AGENT(agentId));
  await redis.srem(REDIS_KEYS.AGENT_LIST, agentId);
}
