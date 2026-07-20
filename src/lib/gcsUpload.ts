import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';

/**
 * Uploads an image buffer to the configured GCS bucket and returns its public
 * URL. No object-level ACL is set — the shared bucket has uniform bucket-level
 * access (UBLA) enabled, so public read must be granted at the bucket IAM level
 * (allUsers -> Storage Object Viewer, ideally scoped to the {env}/intent-images/
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

// Shared-bucket env segment (matches the ainspace convention): production
// images live under production/, everything else under develop/.
function resolveEnv(): string {
  return (process.env.NEXT_PUBLIC_NODE_ENV || process.env.NODE_ENV) === 'production'
    ? 'production'
    : 'develop';
}

// Extracts the GCS object name from a public storage URL, or null if the URL
// does not point at the configured bucket.
function objectNameFromUrl(url: string, bucketName: string): string | null {
  const prefix = `https://storage.googleapis.com/${bucketName}/`;
  if (!url.startsWith(prefix)) return null;
  return decodeURIComponent(url.slice(prefix.length));
}

export async function uploadImageToGcs(
  buffer: Buffer,
  mimeType: string,
  agentId: string
): Promise<{ url: string; mimeType: string }> {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('GCS_BUCKET_NAME is not configured');
  }

  const ext = EXT_BY_MIME[mimeType] || 'bin';
  const objectName = `${resolveEnv()}/intent-images/${agentId}/${uuidv4()}.${ext}`;
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

/**
 * Best-effort deletion of specific images by their public URL. Used when an
 * intent edit drops one or more images. Never throws — cleanup failures are
 * logged so they cannot break the calling edit/deploy request.
 */
export async function deleteImagesByUrls(urls: string[]): Promise<void> {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName || urls.length === 0) return;
  const bucket = getStorage().bucket(bucketName);
  await Promise.all(
    urls.map(async (url) => {
      const objectName = objectNameFromUrl(url, bucketName);
      if (!objectName) {
        console.warn(`[gcs] skip delete; URL not in bucket: ${url}`);
        return;
      }
      try {
        await bucket.file(objectName).delete({ ignoreNotFound: true });
      } catch (err) {
        console.error(`[gcs] failed to delete ${objectName}:`, err);
      }
    })
  );
}

/**
 * Best-effort deletion of every image under an agent's prefix (current env).
 * Used when an agent and all its intents are removed. Never throws.
 */
export async function deleteAgentImages(agentId: string): Promise<void> {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) return;
  const prefix = `${resolveEnv()}/intent-images/${agentId}/`;
  try {
    await getStorage().bucket(bucketName).deleteFiles({ prefix, force: true });
  } catch (err) {
    console.error(`[gcs] failed to delete prefix ${prefix}:`, err);
  }
}
