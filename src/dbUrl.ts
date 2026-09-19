/**
 * Validate / heal DATABASE_URL before Prisma reads it.
 * DigitalOcean App Platform often receives a literal `${db.DATABASE_URL}`
 * bind placeholder, or a value with no postgres:// scheme.
 */

const HINT =
  "Set DATABASE_URL to a real postgresql:// URI from the Managed Database Connection Details panel.";

function firstNonEmpty(env: NodeJS.ProcessEnv, keys: string[]): string {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function hasPostgresScheme(value: string): boolean {
  return value.startsWith("postgres://") || value.startsWith("postgresql://");
}

/** Build postgresql://user:pass@host:port/db?sslmode=require from DO-style discrete vars. */
export function constructDatabaseUrlFromDiscreteVars(env: NodeJS.ProcessEnv): string | undefined {
  const host = firstNonEmpty(env, ["DB_HOST", "PGHOST"]);
  const port = firstNonEmpty(env, ["DB_PORT", "PGPORT"]) || "5432";
  const user = firstNonEmpty(env, ["DB_USER", "PGUSER"]);
  const password = firstNonEmpty(env, ["DB_PASSWORD", "PGPASSWORD"]);
  const database = firstNonEmpty(env, ["DB_NAME", "PGDATABASE"]);

  if (!host || !user || !password || !database) {
    return undefined;
  }

  const userInfo = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return `postgresql://${userInfo}@${host}:${port}/${encodeURIComponent(database)}?sslmode=require`;
}

function preview(value: string): string {
  return value.slice(0, 16);
}

/**
 * Heal DATABASE_URL in place when possible.
 * Returns the valid URL, or undefined when it is missing (so tests can import Prisma).
 * Throws when a non-empty value is still not a postgres URI and cannot be constructed.
 */
export function healDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.DATABASE_URL;
  const trimmed = typeof raw === "string" ? raw.trim() : "";

  if (!trimmed) {
    const constructed = constructDatabaseUrlFromDiscreteVars(env);
    if (constructed) {
      env.DATABASE_URL = constructed;
      console.warn(
        "DATABASE_URL was missing or empty; constructed one from DB_HOST/PGHOST and related variables (sslmode=require)."
      );
      return constructed;
    }
    return undefined;
  }

  if (hasPostgresScheme(trimmed)) {
    env.DATABASE_URL = trimmed;
    return trimmed;
  }

  const constructed = constructDatabaseUrlFromDiscreteVars(env);
  if (constructed) {
    env.DATABASE_URL = constructed;
    console.warn(
      "DATABASE_URL was not a valid postgres URI; constructed one from DB_HOST/PGHOST and related variables (sslmode=require)."
    );
    return constructed;
  }

  throw new Error(
    `DATABASE_URL is invalid (must start with postgresql:// or postgres://). First 16 characters: "${preview(trimmed)}"\n${HINT}`
  );
}

export function ensureDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = healDatabaseUrl(env);
  if (!url) {
    throw new Error(`DATABASE_URL is missing or empty. ${HINT}`);
  }
  return url;
}

/** Heal process.env.DATABASE_URL or exit 1 with a safe, password-free message. */
export function applyDatabaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  try {
    return ensureDatabaseUrl(env);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
    return "";
  }
}
