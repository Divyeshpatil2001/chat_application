// Where uploaded photos/videos actually live. Two drivers:
//  - "local" (default): written to server/uploads, served by Express static middleware.
//  - "minio": written to an S3-compatible bucket (MinIO locally, or real S3 in production).
// Switch with STORAGE_DRIVER=minio and the MINIO_* env vars below (see docker-compose.yml).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'minio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const driver = process.env.STORAGE_DRIVER === 'minio' ? 'minio' : 'local';

const uploadsDir = path.join(process.env.DATA_DIR || __dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const BUCKET = process.env.MINIO_BUCKET || 'chat-media';
let minioClient = null;
let publicBase = '';

if (driver === 'minio') {
  minioClient = new Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'chatminio',
    secretKey: process.env.MINIO_SECRET_KEY || 'chatminiosecret',
  });
  publicBase = process.env.MINIO_PUBLIC_URL || `http://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || 9000}`;
}

// Call once at startup. Creates the bucket and makes it public-read so the browser can load
// media directly by URL. Fine for a demo; a production setup would keep the bucket private
// and hand out short-lived presigned URLs instead.
export async function initStorage() {
  if (driver !== 'minio') return;
  const exists = await minioClient.bucketExists(BUCKET).catch(() => false);
  if (!exists) await minioClient.makeBucket(BUCKET);
  await minioClient.setBucketPolicy(
    BUCKET,
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${BUCKET}/*`] }],
    })
  );
  console.log(`Storage: MinIO bucket "${BUCKET}" ready at ${publicBase}`);
}

// Saves a buffer under `filename` and returns the URL the client should use.
// Local driver returns a relative path (resolved against the API origin by the client);
// MinIO returns a full absolute URL, since it's served from a different origin/port.
export async function saveFile(buffer, filename, mimetype) {
  if (driver === 'minio') {
    await minioClient.putObject(BUCKET, filename, buffer, buffer.length, { 'Content-Type': mimetype });
    return `${publicBase}/${BUCKET}/${filename}`;
  }
  fs.writeFileSync(path.join(uploadsDir, filename), buffer);
  return `/uploads/${filename}`;
}

export { uploadsDir };
