import { NextRequest, NextResponse } from 'next/server';
import { validateImageUpload } from '@/lib/imageUploadValidation';
import { uploadImageToGcs } from '@/lib/gcsUpload';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const mimeType = file.type;
    const sizeBytes = file.size;
    const check = validateImageUpload(mimeType, sizeBytes);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadImageToGcs(buffer, mimeType, agentId);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Image upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
