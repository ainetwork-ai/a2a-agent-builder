import { NextResponse } from 'next/server';
import { getAllAgents } from '@/lib/agentStore';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get('address');

  const allAgents = await getAllAgents();

  // Filter agents by wallet address if provided
  const filteredAgents = walletAddress
    ? allAgents.filter(agent =>
        agent.creator &&
        agent.creator.toLowerCase() === walletAddress.toLowerCase()
      )
    : allAgents;

  // Convert StoredAgent to the format expected by the frontend
  const agents = filteredAgents.map(agent => ({
    id: agent.card.url.split('/').pop() || '', // Extract ID from URL
    name: agent.card.name,
    description: agent.card.description,
    url: agent.card.url,
    modelProvider: agent.modelProvider,
    modelName: agent.modelName,
    prompt: agent.prompt,
    skills: agent.card.skills,
    deployed: true, // All agents in the store are deployed
    creator: agent.creator // Include creator address for ownership verification
  }));

  console.log('📋 Listing agents:', agents.length, walletAddress ? `(by ${walletAddress})` : '(all)');

  return NextResponse.json({
    agents
  });
}
