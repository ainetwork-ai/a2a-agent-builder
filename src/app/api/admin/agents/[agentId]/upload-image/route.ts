import { NextRequest, NextResponse } from 'next/server';
import { validateImageUpload } from '@/lib/imageUploadValidation';
import { uploadImageToGcs } from '@/lib/gcsUpload';
import { getAgent } from '@/lib/agentStore';
import { getCorsHeaders, corsOptions } from '@/lib/utils/cors';
import { verifyAdminJwt } from '@/lib/adminAuth';

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * Admin-dashboard counterpart of `POST /api/agents/{agentId}/upload-image`:
 * same GCS upload, but cross-origin (CORS) and gated by the admin JWT.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const corsHeaders = getCorsHeaders(request);

  const authError = await verifyAdminJwt(request);
  if (authError) return authError;

  try {
    const { agentId } = await params;

    const agent = await getAgent(agentId);
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400, headers: corsHeaders }
      );
    }

    const check = validateImageUpload(file.type, file.size);
    if (!check.ok) {
      return NextResponse.json(
        { error: check.error },
        { status: 400, headers: corsHeaders }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadImageToGcs(buffer, file.type, agentId);

    console.log(`🖼️ [admin] Uploaded intent image for agent ${agentId}`);

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (error) {
    console.error('Admin image upload error:', error);
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500, headers: corsHeaders }
    );
  }
}
