import { NextRequest, NextResponse } from "next/server";
import { getAgent, setAgent } from '@/lib/agentStore';
import { classifyIntent, getThinkingMemory, getUserCaring, getLastIntent } from '@/lib/intentClassifier';
import { evolveThinking } from '@/lib/thinkingEvolution';
import type { Message } from "@a2a-js/sdk";

// Track last update time per agent (in-memory rate limiting)
const lastUpdateTime: Record<string, number> = {};
const MIN_UPDATE_INTERVAL_MS = 60000; // 60 seconds (1 minute)

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  const params = await context.params;
  const agentId = params.agentId;

  try {
    const { contextId, conversationHistory, intent: providedIntent, username } = await request.json();

    // Rate limiting: skip if called within 30 seconds
    const now = Date.now();
    const lastUpdate = lastUpdateTime[agentId];

    if (lastUpdate && (now - lastUpdate) < MIN_UPDATE_INTERVAL_MS) {
      const waitTime = Math.ceil((MIN_UPDATE_INTERVAL_MS - (now - lastUpdate)) / 1000);
      console.log(`⏭️ Skipping update for ${agentId} - called too soon (wait ${waitTime}s)`);
      return NextResponse.json({
        success: true,
        skipped: true,
        message: `Rate limited - please wait ${waitTime} seconds`
      });
    }

    // Update last update time
    lastUpdateTime[agentId] = now;

    if (!contextId || !conversationHistory) {
      return NextResponse.json({ error: "Missing contextId or conversationHistory" }, { status: 400 });
    }

    // Use contextId as username if not provided
    const effectiveUsername = username || contextId;

    const agent = await getAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    if (agent.modelProvider !== 'google') {
      return NextResponse.json({ error: "Only Google models are supported" }, { status: 400 });
    }

    console.log('🧠 updateMemory called for', agentId, 'contextId:', contextId);

    const recentMessages = conversationHistory.slice(-6);
    const conversationText = recentMessages.map((msg: Message) => {
      const textPart = msg.parts.find(part => part.kind === "text");
      return `${msg.role}: ${textPart?.text || ""}`;
    }).join('\n');

    // Step 1: Use provided intent or classify if not provided
    let intent: string;
    if (providedIntent) {
      console.log('🎯 Using provided intent:', providedIntent);
      intent = providedIntent;
    } else {
      console.log('📝 Classifying intent...');
      // Get previous intent for continuity
      const previousIntent = await getLastIntent(agentId);
      intent = await classifyIntent(agentId, conversationText, previousIntent);
      console.log('🎯 Classified intent:', intent, previousIntent ? `(previous: ${previousIntent})` : '');
    }

    // Step 2: Get existing memories
    const currentThinking = await getThinkingMemory(agentId, intent);
    const currentCaring = await getUserCaring(agentId, effectiveUsername);
    console.log('📝 Current memories:', {
      intent,
      thinking: currentThinking,
      username: effectiveUsername,
      caring: currentCaring
    });

    // Step 3: Evolve Thinking using LogicalReasoningEngine
    console.log('🧠 Evolving THINKING using logical reasoning...');
    const thinkingResult = await evolveThinking({
      agentId,
      intent,
      conversationContext: conversationText,
      cycles: 1, // One cycle per update
      modelName: agent.modelName
    });

    // Step 4: Evolve Caring using LogicalReasoningEngine
    console.log('💝 Evolving CARING using logical reasoning...');

    // Use LogicalReasoningEngine for caring as well
    const { LogicalReasoningEngine } = await import('@/lib/logicalReasoning');

    const caringEngine = new LogicalReasoningEngine(
      agent.modelName,
      currentCaring !== '(empty)' ? currentCaring : undefined,
      `Understanding how user "${effectiveUsername}" thinks and reasons`
    );

    // Evolve caring about user's thought patterns
    const newCaring = await caringEngine.evolve(
      `user_${effectiveUsername}_thinking`,
      1,
      conversationText
    );

    let thinkingUpdated = false;
    let caringUpdated = false;

    // Check if thinking was updated
    if (thinkingResult.success && thinkingResult.factsAdded > 0) {
      thinkingUpdated = true;
      console.log('✏️ Thinking updated with', thinkingResult.factsAdded, 'new facts');
    } else {
      console.log('⏭️ Thinking not significantly updated');
    }

    // Check if caring was updated
    if (newCaring && newCaring !== currentCaring && newCaring !== '(empty)') {
      caringUpdated = true;
      console.log('✏️ Caring updated');
    } else {
      console.log('⏭️ Caring not significantly updated');
    }

    // Get the latest thinking and caring values
    const latestThinking = thinkingResult.success ? thinkingResult.newThinking : currentThinking;
    const latestCaring = newCaring || currentCaring;

    // Persist to Redis if updated
    if (thinkingUpdated || caringUpdated) {
      console.log('💾 Persisting to Redis...');

      // Update thinking by intent
      const thinkingMemories = agent.thinkingMemories || {};
      const updatedThinkingMemories = thinkingUpdated
        ? { ...thinkingMemories, [intent]: latestThinking }
        : thinkingMemories;

      // Update caring by username
      const caringMemories = agent.caringMemories || {};
      const updatedCaringMemories = caringUpdated
        ? { ...caringMemories, [effectiveUsername]: latestCaring }
        : caringMemories;

      await setAgent(agentId, {
        ...agent,
        thinkingMemories: updatedThinkingMemories,
        caringMemories: updatedCaringMemories
      });

      console.log(`💾 Saved to Redis for ${agentId}:`, {
        intent,
        thinkingFacts: thinkingUpdated ? latestThinking.split('\n').length : '(not updated)',
        username: effectiveUsername,
        caringFacts: caringUpdated ? latestCaring.split('\n').length : '(not updated)',
        totalIntents: Object.keys(updatedThinkingMemories).length,
        totalUsers: Object.keys(updatedCaringMemories).length
      });

      return NextResponse.json({
        success: true,
        intent,
        username: effectiveUsername,
        updated: { thinkingUpdated, caringUpdated },
        thinking: latestThinking,
        caring: latestCaring,
        thinkingFactCount: latestThinking.split('\n').filter(f => f.trim()).length,
        caringFactCount: latestCaring.split('\n').filter(f => f.trim()).length
      });
    } else {
      console.log('⏭️ No updates to persist');
      return NextResponse.json({
        success: true,
        intent,
        username: effectiveUsername,
        updated: { thinkingUpdated: false, caringUpdated: false },
        thinking: latestThinking,
        caring: latestCaring
      });
    }

  } catch (error) {
    console.error("Error updating memory:", error);
    return NextResponse.json({ error: "Failed to update memory" }, { status: 500 });
  }
}
