import { NextRequest, NextResponse } from "next/server";
import { getAgent } from '@/lib/agentStore';
import { getCorsHeaders, corsOptions } from '@/lib/utils/cors';

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  const params = await context.params;
  const agentId = params.agentId;
  const { searchParams } = new URL(request.url);
  const intent = searchParams.get('intent');
  const username = searchParams.get('username');
  const corsHeaders = getCorsHeaders(request);

  try {
    const agent = await getAgent(agentId);

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404, headers: corsHeaders });
    }

    // Get intent-based thinking
    let thinkingData = null;
    let thinkingFacts: string[] = [];
    if (intent) {
      const thinkingMemories = agent.thinkingMemories || {};
      const thinkingText = thinkingMemories[intent] || null;
      if (thinkingText && thinkingText !== '(empty)') {
        thinkingFacts = thinkingText.split('\n').filter(f => f.trim());
        thinkingData = {
          intent,
          facts: thinkingFacts,
          factCount: thinkingFacts.length
        };
      }
    }

    // Get user-based caring
    let caringData = null;
    let caringFacts: string[] = [];
    if (username) {
      const caringMemories = agent.caringMemories || {};
      const caringText = caringMemories[username] || null;
      if (caringText && caringText !== '(empty)') {
        caringFacts = caringText.split('\n').filter(f => f.trim());
        caringData = {
          username,
          facts: caringFacts,
          factCount: caringFacts.length
        };
      }
    }

    return NextResponse.json({
      agentId,
      thinking: thinkingData,
      caring: caringData,
      // All intents with fact counts
      allIntents: Object.entries(agent.thinkingMemories || {}).map(([intent, text]) => ({
        intent,
        factCount: text === '(empty)' ? 0 : text.split('\n').filter(f => f.trim()).length
      })),
    }, { headers: corsHeaders });
  } catch (error) {
    console.error("Error fetching agent status:", error);
    return NextResponse.json({ error: "Failed to fetch agent status" }, { status: 500, headers: corsHeaders });
  }
}
