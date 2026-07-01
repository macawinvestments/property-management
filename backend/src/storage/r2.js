import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

// R2 is S3-compatible. One client, pointed at the R2 endpoint.
const client = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

export function r2Configured() {
  return Boolean(config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey);
}

// Upload a file buffer. Returns the storage key.
export async function uploadObject(key, buffer, mimeType) {
  await client.send(
    new PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType || 'application/octet-stream',
    })
  );
  return key;
}

// A short-lived signed URL to download/preview the object directly from R2.
export function signedDownloadUrl(key, filename, expiresIn = 300) {
  const cmd = new GetObjectCommand({
    Bucket: config.r2.bucket,
    Key: key,
    // Hint the browser to use the original filename on download.
    ResponseContentDisposition: filename ? `inline; filename="${filename.replace(/"/g, '')}"` : undefined,
  });
  return getSignedUrl(client, cmd, { expiresIn });
}

export async function deleteObject(key) {
  await client.send(new DeleteObjectCommand({ Bucket: config.r2.bucket, Key: key }));
}
