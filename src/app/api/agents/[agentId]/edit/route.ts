import { NextRequest, NextResponse } from 'next/server';
import { getAgent, setAgent } from '@/lib/agentStore';
import { setIntents } from '@/lib/intentStore';
import { Skill, Intent } from '@/types/agent';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const body = await request.json();

    const { name, description, url, skills, modelProvider, modelName, prompt, address, intents } = body;

    // Get existing agent
    const agent = await getAgent(agentId);
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Verify creator ownership (skip check for agents without creator - legacy agents)
    if (agent.creator && agent.creator !== address) {
      console.log('❌ Unauthorized edit attempt:', { creator: agent.creator, requester: address });
      return NextResponse.json(
        { error: 'Unauthorized: Only the creator can edit this agent' },
        { status: 403 }
      );
    }

    // Validate required fields
    if (!name || !description || !url || !skills || !modelProvider || !modelName || !prompt) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Update intents in separate Redis key if provided
    if (intents && Array.isArray(intents)) {
      console.log(`📌 Updating ${intents.length} intents for agent ${agentId}...`);
      await setIntents(agentId, intents as Intent[]);
      console.log('✅ Intents updated successfully');
    }

    // Update agent card
    const updatedCard = {
      ...agent.card,
      name,
      description,
      url,
      skills: skills as Skill[],
    };

    // Update agent
    const updatedAgent = {
      ...agent,
      card: updatedCard,
      modelProvider: modelProvider as 'gemini' | 'openai' | 'anthropic',
      modelName,
      prompt,
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
