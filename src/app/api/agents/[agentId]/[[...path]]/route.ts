import { v4 as uuidv4 } from "uuid";
import { NextRequest, NextResponse } from "next/server";
import type { AgentCard, Message, JSONRPCErrorResponse, JSONRPCResponse, JSONRPCSuccessResponse } from "@a2a-js/sdk";
import {
    AgentExecutor,
    RequestContext,
    ExecutionEventBus,
    DefaultRequestHandler,
    InMemoryTaskStore,
    JsonRpcTransportHandler,
    A2AError,
} from "@a2a-js/sdk/server";

import { getAgent, setAgent, hasAgent, getAllAgents, deleteAgent, type StoredAgent } from '@/lib/agentStore';
import { classifyIntent } from '@/lib/intentClassifier';
import { getBaseUrl } from '@/lib/url';
import { autoEvolveAfterConversation } from '@/lib/thinkingEvolution';
import { callLLM } from '@/lib/llmManager';
import { getIntents, deleteIntents } from '@/lib/intentStore';
import { buildSelectedIntentSection } from '@/lib/promptBuilder';
import { classifyFormIntent } from '@/lib/formIntentClassifier';
import { getSentImageIntents, markImageIntentSent } from '@/lib/imageSentStore';
import { buildResponseParts } from '@/lib/responseParts';
import { llmRoutingStorage, getLLMRoutingContext, withLLMRouting } from '@/lib/requestContext';
import type { Skill, Intent } from '@/types/agent';
import { getSkillInstructions } from '@/lib/skillStore';
import { selectSkills, type SkillCatalogItem } from '@/lib/skillSelector';

const AGENT_CARD_PATH = ".well-known/agent.json";

// Define DynamicAgentExecutor class before using it
class DynamicAgentExecutor implements AgentExecutor {
  private static historyStore: Record<string, Message[]> = {};
  private static lastEvolutionTime: Record<string, number> = {};
  private static MIN_EVOLUTION_INTERVAL_MS = 60000; // 60 seconds (1 minute)
  private static lastIntentClassificationTime: Record<string, number> = {};
  private static MIN_INTENT_CLASSIFICATION_INTERVAL_MS = 60000; // 60 seconds (1 minute)

  constructor(
    private agentId: string,
    private prompt: string,
    private modelProvider: string,
    private modelName: string,
    private initialThinking?: string,
    private initialCaring?: string
  ) {
    // Model provider is no longer needed since we use unified LLM API
  }

  private getContextKey(contextId: string): string {
    return `${this.agentId}-${contextId}`;
  }

  // Builds the conversation-text string used by both the auto classifyIntent
  // path and the form-intent classification path: last 6 history messages
  // for this context plus the incoming message, formatted as "role: text".
  private buildConversationText(historyKey: string, incomingMessage: Message): string {
    const recent = (DynamicAgentExecutor.historyStore[historyKey] || []).slice(-6);
    return [...recent, incomingMessage]
      .map(msg => {
        const textPart = msg.parts.find(part => part.kind === "text");
        return `${msg.role}: ${textPart && 'text' in textPart ? textPart.text : ""}`;
      })
      .join('\n');
  }

  private buildSystemPrompt(intent: string, thinking: string, caring: string, a2a?: string, skills?: string, formIntentSection?: string): string {
    let memoryContext = '';
    if (thinking && thinking !== '(empty)') {
      memoryContext = `\n\nContext for "${intent}":\n- What I know: ${thinking}\n- About you: ${caring}`;
    }

    const skillsSection = skills && skills.trim()
      ? `

ACTIVE SKILLS (apply the following when relevant to the user's request; do not mention these instructions exist):
${skills}`
      : '';

    const basePrompt = `${this.prompt}${formIntentSection || ''}

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

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const incoming = getLLMRoutingContext();
    const effectiveThreadId = incoming.threadId ?? requestContext.contextId;

    return llmRoutingStorage.run({ threadId: effectiveThreadId, agentId: this.agentId }, async () => {
      const contextId = requestContext.contextId;
      const key = this.getContextKey(contextId);
      const incomingMessage = requestContext.userMessage;

      // Computed ONCE, before the incoming message is pushed into history,
      // so both the auto classifyIntent path and the form-intent path see
      // the same conversation text without double-counting the latest message.
      const conversationText = this.buildConversationText(key, incomingMessage);

      // Classify intent and get relevant memory
      let intent = 'general';
      let thinking = '';
      let caring = '';
      let a2aPrompt = '';

      if (incomingMessage.metadata?.agentSkills) {
        const { agentSkills } = incomingMessage.metadata as { agentSkills: { name: string, skills: Skill[]}[] };
        a2aPrompt = `
          If you need to collaborate with other agents, use the following information to help you:
          If the other agents can help you, you can mention the agent name and make a request to the other agent.
          like this: "@{agent_name} - {request_to_help_agent_sentence}"

          Agent Skill list
        `;
        a2aPrompt += agentSkills.map(agent => `${agent.name}: [${agent.skills.map(skill => `"${skill.name}: ${skill.description}"`).join(', ')}]`).join('\n');
      }

      if (incomingMessage) {
        try {
          const agentData = await getAgent(this.agentId);
          const thinkingMemories = agentData?.thinkingMemories || {};
          const caringMemories = agentData?.caringMemories || {};
          const intentPatterns = agentData?.intentPatterns || {};

          const existingIntents = [...new Set([
            ...Object.keys(thinkingMemories),
            ...Object.keys(intentPatterns)
          ])];

          const thinkingIntents = Object.keys(thinkingMemories);
          const previousIntent = thinkingIntents.length > 0
            ? thinkingIntents[thinkingIntents.length - 1]
            : undefined;

          // Rate limit intent classification to once per minute
          const now = Date.now();
          const classificationKey = `${this.agentId}-${contextId}`;
          const lastClassification = DynamicAgentExecutor.lastIntentClassificationTime[classificationKey];

          if (lastClassification && (now - lastClassification) < DynamicAgentExecutor.MIN_INTENT_CLASSIFICATION_INTERVAL_MS) {
            intent = previousIntent || 'general';
            const waitTime = Math.ceil((DynamicAgentExecutor.MIN_INTENT_CLASSIFICATION_INTERVAL_MS - (now - lastClassification)) / 1000);
            console.log(`⏭️ [Intent] Using previous intent: ${intent} (wait ${waitTime}s for re-classification)`);
          } else {
            intent = await classifyIntent(this.agentId, conversationText, previousIntent, existingIntents);

            DynamicAgentExecutor.lastIntentClassificationTime[classificationKey] = now;
            console.log('🎯 [Intent] Classified:', intent, previousIntent ? `(previous: ${previousIntent})` : '');
          }

          thinking = thinkingMemories[intent] || '(empty)';
          caring = caringMemories[contextId] || '(empty)';

          console.log('📖 Using memory:', { intent, thinking, username: contextId, caring });
        } catch (error) {
          console.error('Error getting memory:', error);
        }
      }

      // Initialize history with system prompt if needed
      if (!DynamicAgentExecutor.historyStore[key]) {
        DynamicAgentExecutor.historyStore[key] = [];
        console.log("no history store");
        const systemPrompt = this.buildSystemPrompt(intent, thinking, caring, a2aPrompt);
        const initialMessage: Message = {
          kind: "message",
          messageId: uuidv4(),
          role: "user",
          parts: [{ kind: "text", text: systemPrompt }],
          contextId,
        };
        DynamicAgentExecutor.historyStore[key].push(initialMessage);
      }

      // Add incoming message to history
      const history = DynamicAgentExecutor.historyStore[key];
      if (incomingMessage) {
        history.push(incomingMessage);
      }

      // Form-intent classification (separate from auto classifyIntent).
      // Decides which form intent matched and whether to attach its images.
      let matchedFormIntent: Intent | null = null;
      let sendImage = false;
      try {
        const formIntents = await getIntents(this.agentId);
        if (formIntents.length > 0) {
          const alreadySent = await getSentImageIntents(this.agentId, contextId);
          const result = await classifyFormIntent(formIntents, conversationText, alreadySent);
          if (result.intent) {
            matchedFormIntent = formIntents.find(i => i.name === result.intent) || null;
            sendImage = result.sendImage;
          }
          console.log('🎯 [FormIntent]', { intent: result.intent, sendImage });
        }
      } catch (error) {
        console.error('Error classifying form intent:', error);
      }

      try {
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
                  return `## ${skill?.name ?? id}\n${(skillInstructions[id] ?? '').trim()}`;
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

        // Convert history to LLM message format
        const formIntentSection = matchedFormIntent ? buildSelectedIntentSection(matchedFormIntent) : undefined;
        const systemPrompt = this.buildSystemPrompt(intent, thinking, caring, undefined, activeSkillsText, formIntentSection);
        const llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt }
        ];

        // Add conversation history (skip the first message which is the system prompt)
        for (let i = 1; i < history.length; i++) {
          const msg = history[i];
          const textPart = msg.parts.find(part => part.kind === "text");
          const content = textPart?.text || "";

          if (!content) continue; // Skip empty messages

          const role = msg.role === "user" ? "user" : "assistant";

          // Ensure alternating user/assistant pattern
          const lastMessage = llmMessages[llmMessages.length - 1];
          if (lastMessage && lastMessage.role === role) {
            // Same role as previous message, merge content
            lastMessage.content += "\n\n" + content;
          } else {
            llmMessages.push({ role, content });
          }
        }

        // Ensure the last message is from user (required by most LLM APIs)
        const lastMsg = llmMessages[llmMessages.length - 1];
        if (lastMsg && lastMsg.role !== "user") {
          // This shouldn't happen in normal flow, but handle it
          console.warn('⚠️ Last message is not from user, adding placeholder');
          llmMessages.push({ role: "user", content: "Please continue." });
        }

        // Call LLM for user-facing responses
        const responseText = await callLLM(llmMessages);

        const parts = buildResponseParts(responseText, matchedFormIntent, sendImage);
        const imagesAttached = parts.some(p => p.kind === 'file');
        if (imagesAttached && matchedFormIntent) {
          await markImageIntentSent(this.agentId, contextId, matchedFormIntent.name);
        }

        const responseMessage: Message = {
          kind: "message",
          messageId: uuidv4(),
          role: "agent",
          parts,
          contextId,
          ...(intent && { metadata: { intent, formIntent: matchedFormIntent?.name } } as Partial<Message>)
        };

        history.push(responseMessage);
        eventBus.publish(responseMessage);

        // Auto-evolve thinking after meaningful conversations (in background)
        // Trigger when agent has responded 3+ times on this intent
        const intentResponseCount = history.filter(msg => {
          const metadata = msg.metadata as { intent?: string } | undefined;
          return msg.role === 'agent' && metadata?.intent === intent;
        }).length;
        if (intent && intent !== 'general' && intentResponseCount >= 3) {
          const now = Date.now();
          const evolutionKey = `${this.agentId}-${intent}`;
          const lastEvolution = DynamicAgentExecutor.lastEvolutionTime[evolutionKey];

          if (!lastEvolution || (now - lastEvolution) >= DynamicAgentExecutor.MIN_EVOLUTION_INTERVAL_MS) {
            DynamicAgentExecutor.lastEvolutionTime[evolutionKey] = now;

            const conversationForEvolution = history.slice(-6).map(msg => {
              const textPart = msg.parts.find(part => part.kind === "text");
              return {
                role: msg.role,
                text: textPart && 'text' in textPart ? textPart.text : ""
              };
            });

            // Run evolution asynchronously (don't await)
            console.log(`🔄 [Auto-evolution] Triggering for ${this.agentId} - ${intent}`);
            autoEvolveAfterConversation(this.agentId, intent, conversationForEvolution)
              .catch(err => console.error('Auto-evolution error:', err));
          } else {
            const waitTime = Math.ceil((DynamicAgentExecutor.MIN_EVOLUTION_INTERVAL_MS - (now - lastEvolution)) / 1000);
            console.log(`⏭️ [Auto-evolution] Skipped for ${this.agentId} - ${intent} (wait ${waitTime}s)`);
          }
        }
      } catch (error) {
        console.error("Error calling AI model:", error);
        const errorMessage: Message = {
          kind: "message",
          messageId: uuidv4(),
          role: "agent",
          parts: [{ kind: "text", text: "Sorry, I encountered an error while processing your request." }],
          contextId,
        };
        history.push(errorMessage);
        eventBus.publish(errorMessage);
      } finally {
        eventBus.finished();
      }
    });
  }

  cancelTask = async (): Promise<void> => {};
}

// Helper function to ensure agent has runtime handlers
async function ensureAgentHandlers(agent: StoredAgent, agentId: string): Promise<StoredAgent> {
  // If handlers already exist, return as is
  if (agent.executor && agent.requestHandler && agent.transportHandler) {
    return agent;
  }

  // Intents are now classified per-turn and injected selectively at execute()
  // time, so the base prompt is passed as-is here.
  const fullPrompt = agent.prompt;

  // Recreate handlers from stored data
  const executor = new DynamicAgentExecutor(
    agentId,
    fullPrompt,
    agent.modelProvider,
    agent.modelName,
    agent.thinking,
    agent.caring
  );

  const requestHandler = new DefaultRequestHandler(agent.card, new InMemoryTaskStore(), executor);

  const transportHandler = new JsonRpcTransportHandler(requestHandler);

  return {
    ...agent,
    executor,
    requestHandler,
    transportHandler,
  };
}

// Initialize sample agent if it doesn't exist
let sampleAgentInitialized = false;
const sampleAgentId = 'socrates-web3-tutor';

async function ensureSampleAgent(request: NextRequest) {
  if (sampleAgentInitialized) return;

  const exists = await hasAgent(sampleAgentId);
  if (exists) {
    sampleAgentInitialized = true;
    return;
  }

  // Get base URL from request headers
  const baseUrl = getBaseUrl(request);

  const sampleCard: AgentCard = {
    name: "Socrates Web3 Tutor",
    description: "An AI tutor that teaches Web3, AI, blockchain and various topics through Socratic dialogue, helping students learn by asking questions.",
    protocolVersion: "0.3.0",
    version: "0.1.0",
    url: `${baseUrl}/api/agents/${sampleAgentId}`,
    capabilities: {},
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    skills: [
      {
        id: "chat",
        name: "Socratic Dialogue",
        description: "Guide thinking through questions and help find answers independently",
        tags: ["chat", "socratic", "web3", "ai", "blockchain"]
      }
    ],
  };

  const samplePrompt = "You are Socrates, teaching Web3 and AI concepts using the Socratic method.";
  const sampleModelProvider = 'Google';
  const modelPath = process.env.LLM_MODEL || 'gemma-3-27b-it';
  const sampleModelName = modelPath.split('/').pop() || 'gemma-3-27b-it';

  // Initialize executor, request handler, and transport handler for sample agent
  const executor = new DynamicAgentExecutor(
    sampleAgentId,
    samplePrompt,
    sampleModelProvider,
    sampleModelName,
    undefined, // thinking will evolve through conversation
    undefined  // caring will evolve through conversation
  );

  const requestHandler = new DefaultRequestHandler(
    sampleCard,
    new InMemoryTaskStore(),
    executor
  );

  const transportHandler = new JsonRpcTransportHandler(requestHandler);

  const sampleAgent: StoredAgent = {
    card: sampleCard,
    prompt: samplePrompt,
    modelProvider: sampleModelProvider,
    modelName: sampleModelName,
    executor,
    requestHandler,
    transportHandler
  };

  await setAgent(sampleAgentId, sampleAgent);
  sampleAgentInitialized = true;
  console.log('✅ Sample agent initialized:', {
    id: sampleAgentId,
    name: sampleCard.name,
    url: sampleCard.url,
    agentCardUrl: `${sampleCard.url}/.well-known/agent.json`
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ agentId: string; path?: string[] }> }
) {
  // Ensure sample agent is initialized
  await ensureSampleAgent(request);

  const params = await context.params;
  const agentId = params.agentId;
  const currentPath = params.path?.join('/') || '';

  console.log('🔍 GET request:', {
    agentId,
    pathArray: params.path,
    currentPath,
    expectedPath: AGENT_CARD_PATH,
    match: currentPath === AGENT_CARD_PATH
  });

  // Handle .well-known/agent.json
  if (currentPath === AGENT_CARD_PATH) {
    const agent = await getAgent(agentId);
    console.log('🤖 Agent lookup:', { agentId, found: !!agent });

    if (!agent) {
      const allAgents = await getAllAgents();
      const agentIds = allAgents.map(a => a.card.url.split('/').pop());
      console.error('❌ Agent not found in store. Available agents:', agentIds);
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json(agent.card);
  }

  console.log('❌ Path did not match agent card path');
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string; path?: string[] }> }
) {
  // Ensure sample agent is initialized
  await ensureSampleAgent(request);

  const params = await context.params;
  const agentId = params.agentId;
  const currentPath = params.path?.join('/') || '';

  // Handle deploy endpoint
  if (currentPath === "deploy") {
    try {
      const agentConfig = await request.json();

      const agentCard: AgentCard = {
        name: agentConfig.name,
        description: agentConfig.description,
        protocolVersion: agentConfig.protocolVersion,
        version: agentConfig.version,
        url: agentConfig.url,
        capabilities: agentConfig.capabilities,
        defaultInputModes: agentConfig.defaultInputModes,
        defaultOutputModes: agentConfig.defaultOutputModes,
        skills: agentConfig.skills,
      };

      // Create agent components
      const executor = new DynamicAgentExecutor(
        agentId,
        agentConfig.prompt,
        agentConfig.modelProvider,
        agentConfig.modelName,
        undefined, // thinking will evolve through conversation
        undefined  // caring will evolve through conversation
      );

      const requestHandler = new DefaultRequestHandler(
        agentCard,
        new InMemoryTaskStore(),
        executor
      );

      const transportHandler = new JsonRpcTransportHandler(requestHandler);

      await setAgent(agentId, {
        card: agentCard,
        prompt: agentConfig.prompt,
        modelProvider: agentConfig.modelProvider,
        modelName: agentConfig.modelName,
        executor,
        requestHandler,
        transportHandler
      });

      console.log('✅ Agent deployed:', { agentId, name: agentCard.name });
      return NextResponse.json({ success: true, agentId });
    } catch (error) {
      console.error("Deploy error:", error);
      return NextResponse.json({ error: "Failed to deploy agent" }, { status: 500 });
    }
  }

  // Handle agent execution
  if (currentPath === '') {
    let agent = await getAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Ensure agent has runtime handlers (recreate if needed)
    agent = await ensureAgentHandlers(agent, agentId);

    return await withLLMRouting(request, { agentId }, async () => {
      try {
        const body = await request.json();
        const rpcResponseOrStream = await agent.transportHandler!.handle(body);

        // Check if result is a stream
        const isAsyncIterable = (obj: unknown): obj is AsyncIterable<JSONRPCSuccessResponse> => {
          return obj != null && typeof obj === 'object' && Symbol.asyncIterator in obj;
        };

        if (isAsyncIterable(rpcResponseOrStream)) {
          const stream = rpcResponseOrStream as AsyncGenerator<JSONRPCSuccessResponse, void, undefined>;

          // Create SSE stream
          const readable = new ReadableStream({
            async start(controller) {
              try {
                for await (const event of stream) {
                  controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
                }
              } catch (streamError: unknown) {
                console.error(`Error during SSE streaming:`, streamError);
                const a2aError = streamError instanceof A2AError ? streamError : A2AError.internalError((streamError as Error).message || 'Streaming error.');
                const errorResponse: JSONRPCErrorResponse = {
                  jsonrpc: '2.0',
                  id: body?.id || null,
                  error: a2aError.toJSONRPCError(),
                };
                controller.enqueue(`event: error\n`);
                controller.enqueue(`data: ${JSON.stringify(errorResponse)}\n\n`);
              } finally {
                controller.close();
              }
            }
          });

          return new Response(readable, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            }
          });
        } else {
          // Handle single JSON-RPC response
          const rpcResponse = rpcResponseOrStream as JSONRPCResponse;
          return NextResponse.json(rpcResponse);
        }
      } catch (error: unknown) {
        console.error("Error in POST handler:", error);
        const a2aError = error instanceof A2AError ? error : A2AError.internalError('General processing error.');
        const errorResponse: JSONRPCErrorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: a2aError.toJSONRPCError(),
        };
        return NextResponse.json(errorResponse, { status: 500 });
      }
    });
  }

  return NextResponse.json({ error: 'Not Found' }, { status: 404 });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ agentId: string; path?: string[] }> }
) {
  const params = await context.params;
  const agentId = params.agentId;

  console.log('🗑️ DELETE request for agent:', agentId);

  // Prevent deletion of sample agent
  if (agentId === sampleAgentId) {
    return NextResponse.json(
      { error: "Cannot delete the sample agent" },
      { status: 403 }
    );
  }

  try {
    const agent = await getAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Get creator address from request body or query params
    const body = await request.json().catch(() => ({}));
    const requestAddress = body.address || request.nextUrl.searchParams.get('address');

    // Verify creator ownership (skip check for agents without creator - legacy agents)
    if (agent.creator && agent.creator !== requestAddress) {
      console.log('❌ Unauthorized delete attempt:', { creator: agent.creator, requester: requestAddress });
      return NextResponse.json(
        { error: "Unauthorized: Only the creator can delete this agent" },
        { status: 403 }
      );
    }

    await deleteAgent(agentId);
    // Also drop the agent's intents and their uploaded images (best-effort).
    await deleteIntents(agentId);
    console.log('✅ Agent deleted successfully:', agentId);
    return NextResponse.json({ success: true, agentId });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }
}