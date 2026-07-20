import { Intent, IntentImage } from '@/types/agent';

/**
 * A form-local intent image. Persisted images are `{ url, mimeType }`; a pending
 * image (selected in the form but not yet uploaded) additionally carries the
 * original `File` and its `url` is a `blob:` object URL for preview. The
 * presence of `file` marks it pending.
 */
export type FormIntentImage = IntentImage & { file?: File };

/**
 * Uploads any pending intent images (those carrying a `File`) to the
 * agent-scoped upload endpoint and returns cleaned `Intent[]` whose images are
 * all persisted `{ url, mimeType }` — no `file`, no blob URLs. Images without a
 * `file` pass through unchanged (already on the bucket). Throws on any upload
 * failure so the caller can abort deploy/edit and surface the error.
 */
export async function resolveIntentImages(
  agentId: string,
  intents: Intent[] | undefined
): Promise<Intent[]> {
  if (!intents || intents.length === 0) return intents ?? [];

  return Promise.all(
    intents.map(async (intent) => {
      const images = intent.images as FormIntentImage[] | undefined;
      if (!images || images.length === 0) return intent;

      const resolved: IntentImage[] = await Promise.all(
        images.map(async (img) => {
          if (!img.file) {
            // Already persisted — strip any stray fields, keep url/mimeType.
            return { url: img.url, mimeType: img.mimeType };
          }
          const body = new FormData();
          body.append('file', img.file);
          const res = await fetch(`/api/agents/${agentId}/upload-image`, {
            method: 'POST',
            body,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Image upload failed (${res.status})`);
          }
          const uploaded = await res.json(); // { url, mimeType }
          return { url: uploaded.url, mimeType: uploaded.mimeType };
        })
      );

      return { ...intent, images: resolved };
    })
  );
}
