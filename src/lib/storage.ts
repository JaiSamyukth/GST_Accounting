// Neon Object Storage (S3-compatible). The bucket is private; bytes pass through the app.
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface Storage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Returns null when the object does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export class StorageUnavailableError extends Error {
  constructor(message = "File storage is not configured") {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

function s3Storage(): Storage {
  // Read credentials at call time so a rotated key is picked up without a redeploy.
  const client = () => {
    const endpoint = process.env.AWS_ENDPOINT_URL_S3;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!endpoint || !accessKeyId || !secretAccessKey) throw new StorageUnavailableError();
    return new S3Client({
      endpoint, region: process.env.AWS_REGION || "ap-southeast-1", forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  };
  const bucket = () => process.env.S3_BUCKET || "gst-documents";
  return {
    async put(key, body, contentType) {
      await client().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      try {
        const r = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
        if (!r.Body) return null;
        return await r.Body.transformToByteArray();
      } catch (e) {
        const name = (e as { name?: string }).name;
        if (name === "NoSuchKey" || name === "NotFound") return null;
        throw e;
      }
    },
    async delete(key) {
      await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    },
  };
}

const g = globalThis as unknown as { __gstStorage?: Storage };

export function getStorage(): Storage {
  g.__gstStorage ??= s3Storage();
  return g.__gstStorage;
}

/** Tests: replace the storage client. */
export function setStorage(s: Storage | null): void {
  g.__gstStorage = s ?? undefined;
}

/** In-memory storage, used by tests. */
export function memoryStorage(): Storage & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(k, b) { objects.set(k, b); },
    async get(k) { return objects.get(k) ?? null; },
    async delete(k) { objects.delete(k); },
  };
}
