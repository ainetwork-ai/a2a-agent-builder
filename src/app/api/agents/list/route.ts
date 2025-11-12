import { NextResponse } from 'next/server';
import { getAllAgents } from '@/lib/agentStore';

export async function GET() {
  const allAgents = await getAllAgents();

  // Convert StoredAgent to the format expected by the frontend
  const agents = allAgents.map(agent => ({
    id: agent.card.url.split('/').pop() || '', // Extract ID from URL
    name: agent.card.name,
    description: agent.card.description,
    url: agent.card.url,
    modelProvider: agent.modelProvider,
    modelName: agent.modelName,
    prompt: agent.prompt,
    skills: agent.card.skills,
    deployed: true // All agents in the store are deployed
  }));

  console.log('📋 Listing agents:', agents.length);

  return NextResponse.json({
    agents
  });
}
