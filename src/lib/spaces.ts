import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "../config.js";

/**
 * DigitalOcean Spaces (cloud-portal-vault / LON1).
 * Object I/O runs only when SPACES_ENDPOINT, SPACES_KEY, and SPACES_SECRET
 * are set. Do not invent credentials. Never log key or secret values.
 *
 * Production (NODE_ENV=production) and REQUIRE_SPACES=true must use the
 * private vault only. Reference documents then fail closed instead of
 * writing to local disk.
 *
 * PutObject is used for modest files (reference documents). Multipart uploads
 * for 11–15 GB photo packs are still TODO.
 */
export const EXPECTED_SPACES_BUCKET = "cloud-portal-vault";
export const EXPECTED_SPACES_REGION = "lon1";
export const EXPECTED_SPACES_ENDPOINT = "https://lon1.digitaloceanspaces.com";

export type SpacesConfig = {
  configured: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  /** True only when key+secret are both present — never log secrets. */
  hasCredentials: boolean;
};

export type ReferenceStorageMode = "spaces" | "disk" | "blocked";

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

/** Regional endpoint, lower-cased, no trailing slash. Empty when unset. */
export function normalizeSpacesEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}`;
  } catch {
    return withScheme.toLowerCase();
  }
}

/** True when bucket, region, and endpoint are the private lon1 vault. */
export function spacesTargetOk(cfg: SpacesConfig = spacesStatus()): boolean {
  return (
    cfg.bucket === EXPECTED_SPACES_BUCKET &&
    cfg.region === EXPECTED_SPACES_REGION &&
    normalizeSpacesEndpoint(cfg.endpoint) === EXPECTED_SPACES_ENDPOINT
  );
}

/** True for REQUIRE_SPACES values true, 1, and yes. */
export function spacesRequireFlag(value: string | undefined): boolean {
  const flag = String(value || "")
    .trim()
    .toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

/**
 * Spaces is mandatory in production, and whenever REQUIRE_SPACES is
 * true, 1, or yes. Local disk is not an acceptable substitute.
 */
export function spacesRequired(nodeEnv = config.nodeEnv): boolean {
  if (nodeEnv === "production") return true;
  return spacesRequireFlag(process.env.REQUIRE_SPACES);
}

/**
 * Where a reference-document byte upload is allowed to go.
 * - spaces: fully configured (and, when required, aimed at the vault)
 * - disk: local dev only, Spaces unset and not required
 * - blocked: required but missing or pointed somewhere other than the vault
 */
export function classifyReferenceStorage(input: {
  required: boolean;
  configured: boolean;
  targetOk: boolean;
}): ReferenceStorageMode {
  if (input.configured && (!input.required || input.targetOk)) return "spaces";
  if (input.required) return "blocked";
  return "disk";
}

export function referenceStorageMode(): ReferenceStorageMode {
  const status = spacesStatus();
  return classifyReferenceStorage({
    required: spacesRequired(),
    configured: status.configured,
    targetOk: spacesTargetOk(status),
  });
}

/**
 * An explicit override may select a stricter mode (used by tests).
 * It cannot turn a required or Spaces-backed store back into local disk.
 */
export function resolveReferenceStorageMode(
  live: ReferenceStorageMode,
  override?: ReferenceStorageMode
): ReferenceStorageMode {
  if (override === undefined) return live;
  if (live !== "disk" && override === "disk") return live;
  return override;
}

export function missingSpacesEnvNames(cfg = config.spaces): string[] {
  const missing: string[] = [];
  if (!cfg.endpoint) missing.push("SPACES_ENDPOINT");
  if (!cfg.key) missing.push("SPACES_KEY");
  if (!cfg.secret) missing.push("SPACES_SECRET");
  return missing;
}

/** Safe /health payload. Names and booleans only — never key or secret values. */
export function spacesHealth() {
  const status = spacesStatus();
  return {
    configured: status.configured,
    required: spacesRequired(),
    durable: status.configured && spacesTargetOk(status),
    bucket: status.bucket,
    region: status.region,
    endpoint: status.endpoint ? normalizeSpacesEndpoint(status.endpoint) : "",
    credentials: status.hasCredentials ? "present" : "missing",
  };
}

export function spacesStartupReport(): { level: "info" | "error"; message: string } {
  const status = spacesStatus();
  const required = spacesRequired();
  const targetOk = spacesTargetOk(status);
  const where =
    `bucket=${status.bucket} region=${status.region} ` +
    `endpoint=${status.endpoint ? normalizeSpacesEndpoint(status.endpoint) : "(unset)"} ` +
    `credentials=${status.hasCredentials ? "present" : "missing"}`;
  if (status.configured && targetOk) {
    return {
      level: "info",
      message: `Spaces ready (${where}). Reference documents use the private DigitalOcean Spaces bucket only.`,
    };
  }
  if (required) {
    return {
      level: "error",
      message:
        `Spaces NOT ready (${where}). Reference document uploads are disabled and will not use local disk. ` +
        `Set SPACES_ENDPOINT=${EXPECTED_SPACES_ENDPOINT}, SPACES_BUCKET=${EXPECTED_SPACES_BUCKET}, ` +
        `SPACES_REGION=${EXPECTED_SPACES_REGION}, SPACES_KEY, and SPACES_SECRET.`,
    };
  }
  if (status.configured) {
    return {
      level: "info",
      message: `Spaces configured (${where}). Reference documents use Spaces and will not fall back to local disk.`,
    };
  }
  return {
    level: "info",
    message:
      `Spaces not configured (${where}). Local reference-document disk is allowed only because ` +
      `NODE_ENV is not production and REQUIRE_SPACES is not set.`,
  };
}

export function logSpacesStartup(): void {
  const report = spacesStartupReport();
  if (report.level === "error") console.error(report.message);
  else console.log(report.message);
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
export async function putSpacesObject(
  key: string,
  body: Buffer,
  contentType?: string,
  metadata?: Record<string, string>
): Promise<boolean> {
  const s3 = spacesClient();
  if (!s3) return false;
  const meta = metadata
    ? Object.fromEntries(Object.entries(metadata).filter(([, value]) => String(value || "").length > 0))
    : undefined;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: spacesStatus().bucket,
        Key: key,
        Body: body,
        ContentType: contentType || "application/octet-stream",
        ACL: "private",
        ...(meta && Object.keys(meta).length ? { Metadata: meta } : {}),
      })
    );
    return true;
  } catch (err) {
    spacesError("put", err);
    return false;
  }
}

export type SpacesCopyResult = "copied" | "missing" | "failed";

function spacesObjectMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const name = String(rec.name || "");
  const code = String(rec.Code || "");
  if (name === "NoSuchKey" || name === "NotFound" || code === "NoSuchKey" || code === "NotFound") return true;
  return rec.$metadata?.httpStatusCode === 404;
}

/**
 * Server-side copy inside the bucket. "missing" means the source key is not there
 * (nothing was written to the destination). "failed" means the copy did not happen.
 */
export async function copySpacesObject(fromKey: string, toKey: string): Promise<SpacesCopyResult> {
  const s3 = spacesClient();
  if (!s3) return "failed";
  const bucket = spacesStatus().bucket;
  const copySource = `${bucket}/${fromKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: toKey,
        CopySource: copySource,
        ACL: "private",
      })
    );
    return "copied";
  } catch (err) {
    if (spacesObjectMissing(err)) return "missing";
    spacesError("copy", err);
    return "failed";
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
