import { NextRequest, NextResponse } from 'next/server';
import { getAgent, setAgent } from '@/lib/agentStore';
import { Skill } from '@/types/agent';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const body = await request.json();

    const { name, description, skills, modelProvider, modelName } = body;

    // Get existing agent
    const agent = await getAgent(agentId);
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Validate required fields
    if (!name || !description || !skills || !modelProvider || !modelName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Update agent card
    const updatedCard = {
      ...agent.card,
      name,
      description,
      skills: skills as Skill[],
    };

    // Update agent
    const updatedAgent = {
      ...agent,
      card: updatedCard,
      modelProvider: modelProvider as 'gemini' | 'openai' | 'anthropic',
      modelName,
    };

    await setAgent(agentId, updatedAgent);

    return NextResponse.json({
      success: true,
      agent: updatedAgent
    });
  } catch (error) {
    console.error('Error updating agent:', error);
    return NextResponse.json(
      { error: 'Failed to update agent' },
      { status: 500 }
    );
  }
}
