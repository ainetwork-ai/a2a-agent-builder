export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

export function validateImageUpload(
  mimeType: string,
  sizeBytes: number
): { ok: true } | { ok: false; error: string } {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
    return { ok: false, error: `Unsupported type: ${mimeType}` };
  }
  if (sizeBytes > MAX_IMAGE_BYTES) {
    return { ok: false, error: `File too large (max ${MAX_IMAGE_BYTES} bytes)` };
  }
  if (sizeBytes <= 0) {
    return { ok: false, error: 'Empty file' };
  }
  return { ok: true };
}
