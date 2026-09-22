import { config } from "../config.js";

/**
 * DigitalOcean Spaces (cloud-portal-vault / LON1) extension point.
 * When SPACES_KEY + SPACES_SECRET (+ endpoint) are set, real object I/O
 * can replace coloured placeholder thumbs and stub zip downloads.
 * Do not invent credentials — leave unset until App Platform env is ready.
 *
 * Multipart uploads for 11–15 GB packs: TODO when Spaces is live.
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

/** Future: GET object bytes from Spaces by key. Stub returns null. */
export async function fetchSpacesObject(_key: string): Promise<Buffer | null> {
  if (!spacesStatus().configured) return null;
  // TODO: @aws-sdk/client-s3 GetObject against config.spaces
  return null;
}

/** Future: PUT object to Spaces. Stub no-ops. */
export async function putSpacesObject(_key: string, _body: Buffer, _contentType?: string): Promise<boolean> {
  if (!spacesStatus().configured) return false;
  // TODO: multipart upload for large packs (11–15 GB)
  return false;
}

export function spacesObjectKey(projectId: string, code: string): string {
  const safe = String(code || "")
    .replace(/[/\\]+/g, "-")
    .slice(0, 180);
  return `photos/${projectId}/pool/${safe}.jpg`;
}
