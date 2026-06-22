import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents } from '@/lib/agentStore';
import { getIntents } from '@/lib/intentStore';
import { getSkillInstructions } from '@/lib/skillStore';
import { getCorsHeaders, corsOptions } from '@/lib/utils/cors';

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get('address');

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
      const skillInstructions = await getSkillInstructions(agentId);

      return {
        id: agentId,
        name: agent.card.name,
        description: agent.card.description,
        url: agent.card.url,
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
        prompt: agent.prompt,
        skills: agent.card.skills.map((s) => ({
          ...s,
          ...(skillInstructions[s.id] ? { instructions: skillInstructions[s.id] } : {}),
        })),
        intents: intents.length > 0 ? intents : undefined,
        useSkills: agent.useSkills ?? false,
        deployed: true,
        creator: agent.creator,
      };
    })
  );

  console.log(
    '📋 Listing agents:',
    agents.length,
    walletAddress ? `(by ${walletAddress})` : '(all)'
  );

  const corsHeaders = getCorsHeaders(request);

  return NextResponse.json({ agents }, { headers: corsHeaders });
}
