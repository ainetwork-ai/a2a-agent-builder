import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents } from '@/lib/agentStore';
import { getIntents } from '@/lib/intentStore';
import { getCorsHeaders, corsOptions } from '@/lib/utils/cors';
import { verifyAdminJwt, countFacts } from '@/lib/adminAuth';

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

export async function GET(request: NextRequest) {
  const authError = await verifyAdminJwt(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get('address');

  const allAgents = await getAllAgents();

  // Filter agents by wallet address if provided
  const filteredAgents = walletAddress
    ? allAgents.filter(
        (agent) => agent.creator && agent.creator.toLowerCase() === walletAddress.toLowerCase()
      )
    : allAgents;

  const agents = await Promise.all(
    filteredAgents.map(async (agent) => {
      const agentId = agent.card.url.split('/').pop() || '';
      const intents = await getIntents(agentId);

      const thinkingMemories = agent.thinkingMemories || {};
      const caringMemories = agent.caringMemories || {};
      const intentPatterns = agent.intentPatterns || {};

      return {
        id: agentId,
        card: agent.card,
        prompt: agent.prompt,
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
        creator: agent.creator,
        intents: intents.length > 0 ? intents : undefined,
        memorySummary: {
          thinkingIntents: Object.entries(thinkingMemories).map(([intent, text]) => ({
            intent,
            factCount: countFacts(text),
          })),
          caringUsers: Object.entries(caringMemories).map(([username, text]) => ({
            username,
            factCount: countFacts(text),
          })),
          intentPatternCount: Object.keys(intentPatterns).length,
        },
      };
    })
  );

  console.log(
    '📋 [admin] Listing agents:',
    agents.length,
    walletAddress ? `(by ${walletAddress})` : '(all)'
  );

  const corsHeaders = getCorsHeaders(request);
  return NextResponse.json({ agents }, { headers: corsHeaders });
}
