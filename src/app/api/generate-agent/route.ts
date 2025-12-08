import { NextRequest, NextResponse } from 'next/server';
import { AgentBuilderForm } from '@/types/agent';
import { callLLM, llmManager } from '@/lib/llmManager';

export async function POST(request: NextRequest) {
  try {
    const { prompt, partialData } = await request.json();

    if (!prompt && !partialData) {
      return NextResponse.json({ error: 'Either prompt or partialData is required' }, { status: 400 });
    }

    if (!llmManager.isConfigured()) {
      console.error('❌ LLM API not configured. Please check your environment variables');
      return NextResponse.json({ error: 'LLM API not configured' }, { status: 500 });
    }

    const modelName = llmManager.getModelName();
    const modelProvider = llmManager.getModelProvider();

    console.log(`🔧 Using model: ${modelProvider}/${modelName}`);

    const isPartialGeneration = !!partialData;

    let systemPrompt: string;
    let userPrompt: string;

    if (isPartialGeneration) {
      console.log('🔧 Generating missing fields for partial data');

      const existingFields: string[] = [];
      const missingFields: string[] = [];

      if (partialData.name && partialData.name.trim()) existingFields.push('name');
      else missingFields.push('name');

      if (partialData.description && partialData.description.trim()) existingFields.push('description');
      else missingFields.push('description');

      if (partialData.prompt && partialData.prompt.trim()) existingFields.push('prompt');
      else missingFields.push('prompt');

      if (partialData.skills && partialData.skills.length > 0) existingFields.push('skills');
      else missingFields.push('skills');

      if (partialData.intents && partialData.intents.length > 0) existingFields.push('intents');
      // NOTE(jiyoung): intents are not auto-generated, only manually created
      // else missingFields.push('intents');

      console.log('📊 Existing fields:', existingFields);
      console.log('📊 Missing fields:', missingFields);

      systemPrompt = `You are an AI agent designer. The user has partially filled out an agent configuration.
Your job is to complete ONLY the missing fields based on the existing information.

Existing data:
${JSON.stringify(partialData, null, 2)}

Return ONLY valid JSON with ALL fields (both existing and generated), in this exact format:
{
  "name": "${partialData.name || 'Agent Name in English'}",
  "description": "${partialData.description || 'Brief description of what the agent does'}",
  "prompt": "${partialData.prompt || 'Detailed system prompt for the agent'}",
  "skills": ${partialData.skills && partialData.skills.length > 0 ? JSON.stringify(partialData.skills) : '[{"id": "skill-id", "name": "Skill Name", "description": "What this skill does", "tags": ["tag1", "tag2"]}]'},
  "intents": ${partialData.intents && partialData.intents.length > 0 ? JSON.stringify(partialData.intents) : '[]'},
  "modelProvider": "${modelProvider}",
  "modelName": "${modelName}"
}

IMPORTANT RULES:
- Keep all existing fields EXACTLY as they are (already filled values should NOT be changed)
- Only generate content for empty/missing fields: ${missingFields.join(', ')}
- DO NOT generate intents - always return empty array [] for intents
- Ensure consistency between all fields (new generated content should match the existing data)
- Generated skills should be relevant to the existing name/description/prompt
- Generate content in the SAME LANGUAGE as the user's input. If the user wrote in Korean, generate in Korean. If in English, generate in English.
- Detect the language from existing fields (description, prompt, skill names/descriptions) and use that language for new content`;

      userPrompt = `Complete the missing fields (${missingFields.join(', ')}) for this agent configuration. Keep existing fields unchanged. Generate new content in the same language as the existing user input.`;

    } else {
      console.log('🚀 Generating agent with prompt:', prompt.substring(0, 50) + '...');

      systemPrompt = `You are an AI agent designer. Based on the user's description, generate a complete agent configuration.

Return ONLY valid JSON in this exact format:
{
  "name": "Agent Name in English",
  "description": "Brief description of what the agent does",
  "prompt": "Detailed system prompt for the agent that defines its behavior, personality, and capabilities",
  "skills": [
    {
      "id": "skill-id",
      "name": "Skill Name",
      "description": "What this skill does",
      "tags": ["tag1", "tag2"]
    }
  ],
  "tags": ["relevant", "tags", "for", "the", "agent"],
  "modelProvider": "${modelProvider}",
  "modelName": "${modelName}"
}

IMPORTANT RULES:
- The "name" field MUST be in English only (no Korean, Chinese, Japanese, etc.)
- The name should be concise, unique, and URL-friendly (e.g., "Socrates", "Ryu Seong-ryong")
- The description can be in the same language as user's request
- The prompt is detailed and defines the agent's personality, behavior, and expertise
- Skills are relevant to the agent's purpose
- Tags help categorize the agent (in English)
- Use "${modelProvider}" as modelProvider and "${modelName}" as modelName`;

      userPrompt = `User request: ${prompt}`;
    }

    const text = await callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
    console.log('📝 LLM response received:', text.substring(0, 100) + '...');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('❌ Failed to extract JSON from response:', text);
      throw new Error('Failed to generate valid JSON');
    }

    const agentConfig: AgentBuilderForm = JSON.parse(jsonMatch[0]);
    console.log('✅ Agent config generated:', agentConfig.name);

    return NextResponse.json(agentConfig);
  } catch (error) {
    console.error('❌ Error generating agent:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to generate agent configuration: ${errorMessage}` },
      { status: 500 }
    );
  }
}
