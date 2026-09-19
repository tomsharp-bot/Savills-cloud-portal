import { PrismaClient } from "@prisma/client";
import { healDatabaseUrl } from "../dbUrl.js";

// Heal a placeholder / schemeless value before PrismaClient is constructed.
// Missing DATABASE_URL is left to the server entrypoint / migrate wrapper
// (unit tests import this module without a database).
healDatabaseUrl();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
