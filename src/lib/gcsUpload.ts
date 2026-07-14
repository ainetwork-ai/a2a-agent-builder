import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';

/**
 * Uploads an image buffer to the configured GCS bucket (public-read) and
 * returns its public URL. Requires GCS_BUCKET_NAME and application default
 * credentials (GOOGLE_APPLICATION_CREDENTIALS) in the environment.
 */
let storage: Storage | null = null;
function getStorage(): Storage {
  if (!storage) storage = new Storage();
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
  mimeType: string
): Promise<{ url: string; mimeType: string }> {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('GCS_BUCKET_NAME is not configured');
  }

  const ext = EXT_BY_MIME[mimeType] || 'bin';
  const objectName = `intent-images/${uuidv4()}.${ext}`;
  const bucket = getStorage().bucket(bucketName);
  const file = bucket.file(objectName);

  await file.save(buffer, { contentType: mimeType, resumable: false });

  const url = `https://storage.googleapis.com/${bucketName}/${objectName}`;
  return { url, mimeType };
}
