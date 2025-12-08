import { NextRequest, NextResponse } from 'next/server';
import { AgentConfig } from '@/types/agent';
import { setAgent } from '@/lib/agentStore';
import { setIntents } from '@/lib/intentStore';
import type { AgentCard } from "@a2a-js/sdk";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const agentConfig: AgentConfig = body.agentConfig || body;
    const creatorAddress: string | undefined = body.creatorAddress;
    const agentId = agentConfig.id;

    console.log('🚀 Deploying agent:', agentId, 'Creator:', creatorAddress);

    const agentCard: AgentCard = {
      name: agentConfig.name,
      description: agentConfig.description,
      protocolVersion: agentConfig.protocolVersion,
      version: agentConfig.version,
      url: agentConfig.url,
      capabilities: agentConfig.capabilities,
      defaultInputModes: agentConfig.defaultInputModes,
      defaultOutputModes: agentConfig.defaultOutputModes,
      skills: agentConfig.skills,
    };

    // Store intents in separate redis key if provided
    if (agentConfig.intents && agentConfig.intents.length > 0) {
      console.log(`📌 Storing ${agentConfig.intents.length} intents for agent ${agentId}...`);
      await setIntents(agentId, agentConfig.intents);
      console.log('✅ Intents stored successfully');
    }

    // Store agent configuration in Redis
    // The executor will be created on-demand when the agent receives a message
    await setAgent(agentId, {
      card: agentCard,
      prompt: agentConfig.prompt,
      modelProvider: agentConfig.modelProvider,
      modelName: agentConfig.modelName,
      creator: creatorAddress,
    });

    console.log('✅ Agent deployed successfully:', agentId);

    return NextResponse.json({
      success: true,
      agentId: agentConfig.id,
      url: agentConfig.url
    });
  } catch (error) {
    console.error('❌ Error deploying agent:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to deploy agent: ${errorMessage}` },
      { status: 500 }
    );
  }
}