import { NextRequest, NextResponse } from 'next/server';
import { getAgent, setAgent } from '@/lib/agentStore';
import { getIntents, setIntents, intentImageUrls } from '@/lib/intentStore';
import { deleteImagesByUrls } from '@/lib/gcsUpload';
import { getCorsHeaders, corsOptions } from '@/lib/utils/cors';
import { verifyAdminJwt } from '@/lib/adminAuth';
import { Intent, IntentImage } from '@/types/agent';

const MAX_INTENT_IMAGES = 3;

/**
 * Normalize an untrusted `intents` payload into `Intent[]`.
 * Returns an error string instead of throwing so the caller can 400.
 */
function parseIntents(value: unknown): { ok: true; intents: Intent[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'intents must be an array' };
  }

  const intents: Intent[] = [];

  for (const [i, raw] of value.entries()) {
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, error: `intents[${i}] must be an object` };
    }
    const { name, description, prompt, images } = raw as Record<string, unknown>;

    if (typeof name !== 'string' || name.trim() === '') {
      return { ok: false, error: `intents[${i}].name is required` };
    }
    if (typeof description !== 'string') {
      return { ok: false, error: `intents[${i}].description must be a string` };
    }
    if (typeof prompt !== 'string') {
      return { ok: false, error: `intents[${i}].prompt must be a string` };
    }

    const intent: Intent = { name: name.trim(), description, prompt };

    if (images !== undefined) {
      if (!Array.isArray(images)) {
        return { ok: false, error: `intents[${i}].images must be an array` };
      }
      if (images.length > MAX_INTENT_IMAGES) {
        return { ok: false, error: `intents[${i}].images exceeds ${MAX_INTENT_IMAGES}` };
      }
      const parsed: IntentImage[] = [];
      for (const [j, img] of images.entries()) {
        if (typeof img !== 'object' || img === null) {
          return { ok: false, error: `intents[${i}].images[${j}] must be an object` };
        }
        const { url, mimeType } = img as Record<string, unknown>;
        if (typeof url !== 'string' || url.trim() === '') {
          return { ok: false, error: `intents[${i}].images[${j}].url is required` };
        }
        if (url.startsWith('blob:') || url.startsWith('data:')) {
          return { ok: false, error: `intents[${i}].images[${j}].url must be an uploaded URL` };
        }
        if (typeof mimeType !== 'string' || mimeType.trim() === '') {
          return { ok: false, error: `intents[${i}].images[${j}].mimeType is required` };
        }
        parsed.push({ url, mimeType });
      }
      if (parsed.length > 0) intent.images = parsed;
    }

    intents.push(intent);
  }

  const names = intents.map((it) => it.name);
  if (new Set(names).size !== names.length) {
    return { ok: false, error: 'intent names must be unique' };
  }

  return { ok: true, intents };
}

export async function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const corsHeaders = getCorsHeaders(request);

  const authError = await verifyAdminJwt(request);
  if (authError) return authError;

  try {
    const { agentId } = await params;
    const body = await request.json();
    const { prompt, intents } = body ?? {};

    const hasPrompt = prompt !== undefined;
    const hasIntents = intents !== undefined;

    if (!hasPrompt && !hasIntents) {
      return NextResponse.json(
        { error: 'Nothing to update: provide prompt and/or intents' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (hasPrompt && (typeof prompt !== 'string' || prompt.trim() === '')) {
      return NextResponse.json(
        { error: 'Missing required field: prompt' },
        { status: 400, headers: corsHeaders }
      );
    }

    let nextIntents: Intent[] | undefined;
    if (hasIntents) {
      const parsed = parseIntents(intents);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: parsed.error },
          { status: 400, headers: corsHeaders }
        );
      }
      nextIntents = parsed.intents;
    }

    const agent = await getAgent(agentId);
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    if (hasPrompt) {
      await setAgent(agentId, { ...agent, prompt });
      console.log(`📝 [admin] Updated prompt for agent ${agentId}`);
    }

    if (nextIntents) {
      const previousUrls = intentImageUrls(await getIntents(agentId));
      await setIntents(agentId, nextIntents);
      console.log(`📌 [admin] Updated ${nextIntents.length} intents for agent ${agentId}`);

      // Best-effort cleanup: remove images that were dropped in this edit.
      const keptUrls = new Set(intentImageUrls(nextIntents));
      const removedUrls = previousUrls.filter((url) => !keptUrls.has(url));
      if (removedUrls.length > 0) {
        console.log(`🗑️ [admin] Removing ${removedUrls.length} orphaned intent image(s)...`);
        await deleteImagesByUrls(removedUrls);
      }
    }

    return NextResponse.json(
      {
        success: true,
        agentId,
        ...(hasPrompt ? { prompt } : {}),
        ...(nextIntents ? { intents: nextIntents } : {}),
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error updating agent:', error);
    return NextResponse.json(
      { error: 'Failed to update agent' },
      { status: 500, headers: corsHeaders }
    );
  }
}
