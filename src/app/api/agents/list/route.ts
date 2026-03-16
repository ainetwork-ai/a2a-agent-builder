import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents } from '@/lib/agentStore';
import { getIntents } from '@/lib/intentStore';
import { getCorsHeaders, corsOptions } from '@/lib/utils/cors';

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

function countFacts(text: string): number {
  if (!text || text === '(empty)') return 0;
  return text.split('\n').filter(f => f.trim()).length;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get('address');

  // Admin authentication
  const adminSecret = request.headers.get('X-Admin-Secret');
  let isAdmin = false;

  if (adminSecret) {
    const adminApiKey = process.env.ADMIN_API_KEY;
    if (!adminApiKey || adminSecret !== adminApiKey) {
      const corsHeaders = getCorsHeaders(request);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }
    isAdmin = true;
  }

  const allAgents = await getAllAgents();

  // Filter agents by wallet address if provided
  const filteredAgents = walletAddress
    ? allAgents.filter(
        (agent) => agent.creator && agent.creator.toLowerCase() === walletAddress.toLowerCase()
      )
    : allAgents;

  // Convert StoredAgent to the format expected by the caller
  // Load each agent's intents from its own redis key
  const agents = await Promise.all(
    filteredAgents.map(async (agent) => {
      const agentId = agent.card.url.split('/').pop() || '';
      const intents = await getIntents(agentId);

      if (isAdmin) {
        // Admin mode: full metadata + memory summary
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
      }

      // Normal mode: existing response format
      return {
        id: agentId,
        name: agent.card.name,
        description: agent.card.description,
        url: agent.card.url,
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
        prompt: agent.prompt,
        skills: agent.card.skills,
        intents: intents.length > 0 ? intents : undefined,
        deployed: true,
        creator: agent.creator,
      };
    })
  );

  console.log(
    '📋 Listing agents:',
    agents.length,
    walletAddress ? `(by ${walletAddress})` : '(all)',
    isAdmin ? '(admin)' : ''
  );

  const corsHeaders = getCorsHeaders(request);

  return NextResponse.json({ agents }, { headers: corsHeaders });
}
