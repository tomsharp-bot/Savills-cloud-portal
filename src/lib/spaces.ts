import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "../config.js";

/**
 * DigitalOcean Spaces (cloud-portal-vault / LON1).
 * Object I/O runs only when SPACES_ENDPOINT, SPACES_KEY, and SPACES_SECRET
 * are set. Do not invent credentials.
 *
 * PutObject is used for modest files (reference documents). Multipart uploads
 * for 11–15 GB photo packs are still TODO.
 */
export type SpacesConfig = {
  configured: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  /** True only when key+secret are both present — never log secrets. */
  hasCredentials: boolean;
};

export function spacesStatus(cfg = config.spaces): SpacesConfig {
  const hasCredentials = Boolean(cfg.key && cfg.secret);
  return {
    configured: Boolean(cfg.endpoint && cfg.bucket && hasCredentials),
    endpoint: cfg.endpoint || "",
    region: cfg.region || "lon1",
    bucket: cfg.bucket || "cloud-portal-vault",
    hasCredentials,
  };
}

let client: S3Client | null = null;

function spacesClient(): S3Client | null {
  const status = spacesStatus();
  if (!status.configured) return null;
  if (!client) {
    const endpoint = /^https?:\/\//i.test(status.endpoint) ? status.endpoint : `https://${status.endpoint}`;
    client = new S3Client({
      endpoint,
      region: status.region,
      credentials: {
        accessKeyId: config.spaces.key,
        secretAccessKey: config.spaces.secret,
      },
      forcePathStyle: false,
    });
  }
  return client;
}

function spacesError(action: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Spaces ${action} failed: ${message}`);
}

/** GET object bytes from Spaces. Null when Spaces is unset or the object is missing. */
export async function fetchSpacesObject(key: string): Promise<Buffer | null> {
  const s3 = spacesClient();
  if (!s3) return null;
  try {
    const out = await s3.send(
      new GetObjectCommand({
        Bucket: spacesStatus().bucket,
        Key: key,
      })
    );
    const body = out.Body;
    if (!body || typeof body.transformToByteArray !== "function") return null;
    return Buffer.from(await body.transformToByteArray());
  } catch (err) {
    spacesError("get", err);
    return null;
  }
}

/** PUT object bytes to Spaces. False when Spaces is unset or the upload fails. */
export async function putSpacesObject(key: string, body: Buffer, contentType?: string): Promise<boolean> {
  const s3 = spacesClient();
  if (!s3) return false;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: spacesStatus().bucket,
        Key: key,
        Body: body,
        ContentType: contentType || "application/octet-stream",
      })
    );
    return true;
  } catch (err) {
    spacesError("put", err);
    return false;
  }
}

/** DELETE an object. False when Spaces is unset or the delete fails. */
export async function deleteSpacesObject(key: string): Promise<boolean> {
  const s3 = spacesClient();
  if (!s3) return false;
  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: spacesStatus().bucket,
        Key: key,
      })
    );
    return true;
  } catch (err) {
    spacesError("delete", err);
    return false;
  }
}

export function spacesObjectKey(projectId: string, code: string): string {
  const safe = String(code || "")
    .replace(/[/\\]+/g, "-")
    .slice(0, 180);
  return `photos/${projectId}/pool/${safe}.jpg`;
}
