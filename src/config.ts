import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: required("DATABASE_URL"),
  sessionSecret: required("SESSION_SECRET", "dev-only-change-me"),
  spaces: {
    endpoint: process.env.SPACES_ENDPOINT || "",
    region: process.env.SPACES_REGION || "lon1",
    bucket: process.env.SPACES_BUCKET || "cloud-portal-vault",
    key: process.env.SPACES_KEY || "",
    secret: process.env.SPACES_SECRET || "",
  },
};

export const isProduction = config.nodeEnv === "production";
