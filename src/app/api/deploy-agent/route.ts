import { NextRequest, NextResponse } from 'next/server';
import { AgentConfig } from '@/types/agent';
import { setAgent } from '@/lib/agentStore';
import { getIntents, setIntents, intentImageUrls } from '@/lib/intentStore';
import { deleteImagesByUrls } from '@/lib/gcsUpload';
import { setSkillInstructions, extractSkillInstructions, toPublicSkills } from '@/lib/skillStore';
import { ALLOWED_IMAGE_MIME_TYPES } from '@/lib/imageUploadValidation';
import type { AgentCard } from "@a2a-js/sdk";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const agentConfig: AgentConfig = body.agentConfig || body;
    const creatorAddress: string | undefined = body.creatorAddress;
    const agentId = agentConfig.id;

    console.log('🚀 Deploying agent:', agentId, 'Creator:', creatorAddress);

    // Private instructions map: { skillId: instructions } — never on the card.
    const skillInstructions = extractSkillInstructions(agentConfig.skills);

    const hasIntentImages = (agentConfig.intents || []).some(i => (i.images?.length ?? 0) > 0);
    const outputModes = hasIntentImages
      ? Array.from(new Set([...(agentConfig.defaultOutputModes || ['text']), ...ALLOWED_IMAGE_MIME_TYPES]))
      : (agentConfig.defaultOutputModes || ['text']);

    const agentCard: AgentCard = {
      name: agentConfig.name,
      description: agentConfig.description,
      protocolVersion: agentConfig.protocolVersion,
      version: agentConfig.version,
      url: agentConfig.url,
      capabilities: agentConfig.capabilities,
      defaultInputModes: agentConfig.defaultInputModes,
      defaultOutputModes: outputModes,
      // Strip instructions — the public card keeps only id/name/description/tags.
      skills: toPublicSkills(agentConfig.skills),
    };

    // Store intents in separate redis key if provided. On re-deploy, clean up
    // any images that existed before but are no longer referenced.
    if (agentConfig.intents && agentConfig.intents.length > 0) {
      console.log(`📌 Storing ${agentConfig.intents.length} intents for agent ${agentId}...`);
      const previousUrls = intentImageUrls(await getIntents(agentId));
      await setIntents(agentId, agentConfig.intents);
      console.log('✅ Intents stored successfully');

      const keptUrls = new Set(intentImageUrls(agentConfig.intents));
      const removedUrls = previousUrls.filter((url) => !keptUrls.has(url));
      if (removedUrls.length > 0) {
        console.log(`🗑️ Removing ${removedUrls.length} orphaned intent image(s)...`);
        await deleteImagesByUrls(removedUrls);
      }
    }

    // Store private skill instructions in their own redis key
    await setSkillInstructions(agentId, skillInstructions);

    // Store agent configuration in Redis
    // The executor will be created on-demand when the agent receives a message
    await setAgent(agentId, {
      card: agentCard,
      prompt: agentConfig.prompt,
      modelProvider: agentConfig.modelProvider,
      modelName: agentConfig.modelName,
      creator: creatorAddress,
      useSkills: agentConfig.useSkills ?? Object.keys(skillInstructions).length > 0,
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