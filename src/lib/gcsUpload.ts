import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';

/**
 * Uploads an image buffer to the configured GCS bucket and returns its public
 * URL. No object-level ACL is set — the shared bucket has uniform bucket-level
 * access (UBLA) enabled, so public read must be granted at the bucket IAM level
 * (allUsers -> Storage Object Viewer, ideally scoped to the intent-images/
 * prefix). Requires GCS_BUCKET_NAME plus credentials via GCS_CREDENTIALS_JSON
 * (inline) or ADC / GOOGLE_APPLICATION_CREDENTIALS.
 */
/**
 * Removes a single pair of matching wrapping quotes from an env value. Docker's
 * `--env-file` passes values literally (quotes are NOT stripped), so a
 * shell-friendly `GCS_CREDENTIALS_JSON='{...}'` arrives with the quotes intact.
 */
function stripWrappingQuotes(value?: string): string | undefined {
  if (!value) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if (value.length >= 2 && (first === "'" || first === '"') && last === first) {
    return value.slice(1, -1).trim();
  }
  return value;
}

let storage: Storage | null = null;
function getStorage(): Storage {
  if (!storage) {
    // Inline credentials (raw JSON or base64-encoded JSON) take precedence for
    // environments where a key file path is impractical (e.g. serverless).
    // Falls back to ADC / GOOGLE_APPLICATION_CREDENTIALS file path otherwise.
    const inline = stripWrappingQuotes(process.env.GCS_CREDENTIALS_JSON?.trim());
    if (inline) {
      let credentials: { project_id?: string };
      try {
        const raw = inline.startsWith('{')
          ? inline
          : Buffer.from(inline, 'base64').toString('utf8');
        credentials = JSON.parse(raw);
      } catch {
        throw new Error('GCS_CREDENTIALS_JSON is not valid JSON (raw or base64)');
      }
      storage = new Storage({ credentials, projectId: credentials.project_id });
    } else {
      storage = new Storage();
    }
  }
  return storage;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function uploadImageToGcs(
  buffer: Buffer,
  mimeType: string,
  agentId: string
): Promise<{ url: string; mimeType: string }> {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('GCS_BUCKET_NAME is not configured');
  }

  // Separate dev/prod images in the shared bucket, matching the ainspace
  // convention (NEXT_PUBLIC_NODE_ENV -> production|develop). Falls back to
  // NODE_ENV so a plain prod build still lands under production/.
  const env =
    (process.env.NEXT_PUBLIC_NODE_ENV || process.env.NODE_ENV) === 'production'
      ? 'production'
      : 'develop';

  const ext = EXT_BY_MIME[mimeType] || 'bin';
  const objectName = `intent-images/${env}/${agentId}/${uuidv4()}.${ext}`;
  const bucket = getStorage().bucket(bucketName);
  const file = bucket.file(objectName);

  await file.save(buffer, {
    contentType: mimeType,
    resumable: false,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });

  const url = `https://storage.googleapis.com/${bucketName}/${objectName}`;
  return { url, mimeType };
}
