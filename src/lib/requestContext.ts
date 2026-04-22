import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextRequest } from 'next/server';

export const HEADER_THREAD_ID = 'X-Thread-Id';
export const HEADER_AGENT_ID = 'X-Agent-Id';

export interface LLMRoutingContext {
  threadId?: string;
  agentId?: string;
}

export const llmRoutingStorage = new AsyncLocalStorage<LLMRoutingContext>();

export function getLLMRoutingContext(): LLMRoutingContext {
  return llmRoutingStorage.getStore() ?? {};
}

export function withLLMRouting<T>(
  request: NextRequest | Request,
  ctx: { agentId: string },
  fn: () => Promise<T>
): Promise<T> {
  const threadId = request.headers.get(HEADER_THREAD_ID) ?? undefined;
  return llmRoutingStorage.run({ threadId, agentId: ctx.agentId }, fn);
}
