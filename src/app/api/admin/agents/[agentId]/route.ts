import { NextRequest, NextResponse } from 'next/server';
import { getAgent, setAgent } from '@/lib/agentStore';
import { getCorsHeaders, corsOptions } from '@/lib/utils/cors';
import { verifyAdminSecret } from '@/lib/adminAuth';

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const corsHeaders = getCorsHeaders(request);

  const authError = verifyAdminSecret(request);
  if (authError) return authError;

  try {
    const { agentId } = await params;
    const body = await request.json();
    const { prompt } = body ?? {};

    if (typeof prompt !== 'string' || prompt.trim() === '') {
      return NextResponse.json(
        { error: 'Missing required field: prompt' },
        { status: 400, headers: corsHeaders }
      );
    }

    const agent = await getAgent(agentId);
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    await setAgent(agentId, { ...agent, prompt });

    console.log(`📝 [admin] Updated prompt for agent ${agentId}`);

    return NextResponse.json(
      { success: true, agentId, prompt },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error updating agent prompt:', error);
    return NextResponse.json(
      { error: 'Failed to update agent prompt' },
      { status: 500, headers: corsHeaders }
    );
  }
}
