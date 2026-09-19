#!/usr/bin/env node
/**
 * Heal / validate DATABASE_URL, then optionally run a follow-on command
 * in the same process environment so Prisma migrate sees the result.
 *
 *   node scripts/ensure-database-url.js
 *   node scripts/ensure-database-url.js npx prisma migrate deploy
 *   node scripts/ensure-database-url.js node dist/index.js
 *
 * Do not use `node scripts/ensure-database-url.js && <cmd>` if you need
 * the healed value — the `&&` child will not inherit a mutated env.
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function loadHealer() {
  const compiled = path.join(__dirname, "..", "dist", "dbUrl.js");
  if (fs.existsSync(compiled)) {
    return require(compiled);
  }
  throw new Error("dist/dbUrl.js not found. Run `npm run build` before migrate/start.");
}

const healer = loadHealer();
healer.applyDatabaseUrlFromEnv();

const args = process.argv.slice(2);
if (args.length === 0) {
  process.exit(0);
}

const result = spawnSync(args[0], args.slice(1), {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
