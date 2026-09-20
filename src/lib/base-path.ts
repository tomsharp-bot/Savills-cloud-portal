/**
 * Configurable public URL prefix so the portal can live at
 * https://savillscloudportal.co.uk/projectprogress
 *
 * Empty / "/" means the app is mounted at the domain root (local default).
 * Reads BASE_PATH or APP_BASE_PATH.
 */

export function normalizeBasePath(raw?: string | null): string {
  const value = String(raw ?? "").trim();
  if (!value || value === "/") return "";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.replace(/\/+$/, "");
}

export function configuredBasePath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return normalizeBasePath(env.BASE_PATH || env.APP_BASE_PATH);
}

/**
 * Public apps mounted at the domain root even when the Mark Up portal
 * lives under BASE_PATH=/projectprogress.
 */
export const ROOT_APP_PREFIXES = ["/HHSRS-site-form", "/hhsrs-site-form"] as const;

export function isRootAppPath(href: string): boolean {
  const path = href.startsWith("/") ? href : `/${href}`;
  return ROOT_APP_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)
  );
}

/** Prefix an in-app path. `baseUrl('/login')` → `/projectprogress/login` when set. */
export function baseUrl(href: string, basePath = ""): string {
  if (!href) return basePath || "/";
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(href) || href.startsWith("//")) {
    return href;
  }
  const path = href.startsWith("/") ? href : `/${href}`;
  if (isRootAppPath(path)) return path;
  if (!basePath) return path;
  if (path === "/") return basePath;
  if (path === basePath || path.startsWith(`${basePath}/`) || path.startsWith(`${basePath}?`)) {
    return path;
  }
  return `${basePath}${path}`;
}

/** Adjust a res.redirect() target so it stays under the mount prefix. */
export function prefixRedirectUrl(url: string, basePath: string): string {
  if (!basePath) return url || "/";
  if (!url) return basePath;
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(url) || url.startsWith("//")) {
    return url;
  }
  if (!url.startsWith("/")) return url;
  return baseUrl(url, basePath);
}
