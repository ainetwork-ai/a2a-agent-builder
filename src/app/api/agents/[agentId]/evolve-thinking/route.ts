import { NextRequest, NextResponse } from "next/server";
import { evolveThinking, getThinkingSummary } from "@/lib/thinkingEvolution";
import { withLLMRouting } from "@/lib/requestContext";

/**
 * POST /api/agents/[agentId]/evolve-thinking
 *
 * Manually trigger thinking evolution for an agent on a specific intent
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  try {
    const params = await context.params;
    const agentId = params.agentId;
    const body = await request.json();

    const { intent, conversationContext, cycles } = body;

    if (!intent) {
      return NextResponse.json(
        { error: "Intent is required" },
        { status: 400 }
      );
    }

    console.log(`🧬 [API] Evolving thinking for agent "${agentId}", intent: "${intent}"`);

    return await withLLMRouting(request, { agentId }, async () => {
      const result = await evolveThinking({
        agentId,
        intent,
        conversationContext,
        cycles: cycles || 2
      });

      if (!result.success) {
        return NextResponse.json(
          { error: "Failed to evolve thinking" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        intent,
        factsAdded: result.factsAdded,
        previousFactCount: result.previousThinking === '(empty)'
          ? 0
          : result.previousThinking.split('\n').filter(f => f.trim()).length,
        newFactCount: result.newThinking.split('\n').filter(f => f.trim()).length,
        newThinking: result.newThinking
      });
    });

  } catch (error) {
    console.error("❌ [API] Error evolving thinking:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/agents/[agentId]/evolve-thinking?intent=<intent>
 *
 * Get a summary of an agent's thinking on a specific intent
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  try {
    const params = await context.params;
    const agentId = params.agentId;
    const { searchParams } = new URL(request.url);
    const intent = searchParams.get('intent');

    if (!intent) {
      return NextResponse.json(
        { error: "Intent parameter is required" },
        { status: 400 }
      );
    }

    const summary = await getThinkingSummary(agentId, intent);

    return NextResponse.json({
      agentId,
      intent,
      summary
    });

  } catch (error) {
    console.error("❌ [API] Error getting thinking summary:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
