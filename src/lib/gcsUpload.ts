import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';

/**
 * Uploads an image buffer to the configured GCS bucket and returns its public
 * URL. Object-level ACLs are intentionally NOT set: the bucket is expected to
 * grant public read via bucket-level IAM (allUsers -> Storage Object Viewer),
 * which is compatible with uniform bucket-level access. Requires
 * GCS_BUCKET_NAME and application default credentials
 * (GOOGLE_APPLICATION_CREDENTIALS) in the environment.
 */
let storage: Storage | null = null;
function getStorage(): Storage {
  if (!storage) {
    // Inline credentials (raw JSON or base64-encoded JSON) take precedence for
    // environments where a key file path is impractical (e.g. serverless).
    // Falls back to ADC / GOOGLE_APPLICATION_CREDENTIALS file path otherwise.
    const inline = process.env.GCS_CREDENTIALS_JSON?.trim();
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

  const ext = EXT_BY_MIME[mimeType] || 'bin';
  const objectName = `intent-images/${agentId}/${uuidv4()}.${ext}`;
  const bucket = getStorage().bucket(bucketName);
  const file = bucket.file(objectName);

  await file.save(buffer, { contentType: mimeType, resumable: false });

  const url = `https://storage.googleapis.com/${bucketName}/${objectName}`;
  return { url, mimeType };
}
