import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  constructDatabaseUrlFromDiscreteVars,
  ensureDatabaseUrl,
  hasPostgresScheme,
} from "./dbUrl.js";

function isolated(partial: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...partial };
}

describe("DATABASE_URL healer", () => {
  it("passes through a valid postgresql:// URL", () => {
    const valid = "postgresql://portal:portal@localhost:5432/savills_cloud_portal?schema=public";
    const env = isolated({ DATABASE_URL: valid });
    assert.equal(ensureDatabaseUrl(env), valid);
    assert.equal(env.DATABASE_URL, valid);
  });

  it("passes through a valid postgres:// URL", () => {
    const valid = "postgres://portal:portal@localhost:5432/savills_cloud_portal";
    const env = isolated({ DATABASE_URL: valid });
    assert.equal(ensureDatabaseUrl(env), valid);
  });

  it("constructs from DB_* vars when DATABASE_URL is a bind placeholder", () => {
    const env = isolated({
      DATABASE_URL: "${db.DATABASE_URL}",
      DB_HOST: "db.example.com",
      DB_PORT: "25060",
      DB_USER: "doadmin",
      DB_PASSWORD: "p@ss/w:rd",
      DB_NAME: "defaultdb",
    });
    const url = ensureDatabaseUrl(env);
    assert.equal(
      url,
      "postgresql://doadmin:p%40ss%2Fw%3Ard@db.example.com:25060/defaultdb?sslmode=require"
    );
    assert.equal(env.DATABASE_URL, url);
    assert.ok(hasPostgresScheme(url));
  });

  it("constructs from PG* vars when the scheme is missing", () => {
    const env = isolated({
      DATABASE_URL: "db.ondigitalocean.com:25060",
      PGHOST: "db.ondigitalocean.com",
      PGPORT: "25060",
      PGUSER: "doadmin",
      PGPASSWORD: "secret",
      PGDATABASE: "savills_cloud_portal",
    });
    const url = ensureDatabaseUrl(env);
    assert.equal(
      url,
      "postgresql://doadmin:secret@db.ondigitalocean.com:25060/savills_cloud_portal?sslmode=require"
    );
  });

  it("rejects a placeholder when discrete vars are absent and only logs a 16-char preview", () => {
    const env = isolated({ DATABASE_URL: "${db.DATABASE_URL}" });
    assert.throws(() => ensureDatabaseUrl(env), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /First 16 characters: "\$\{db\.DATABASE_UR"/);
      assert.match(err.message, /Managed Database Connection Details panel/);
      assert.equal(err.message.includes("DATABASE_URL}"), false);
      return true;
    });
  });

  it("rejects a missing DATABASE_URL when discrete vars are absent", () => {
    const env = isolated({});
    assert.throws(() => ensureDatabaseUrl(env), /DATABASE_URL is missing or empty/);
  });

  it("constructs from discrete vars when DATABASE_URL is missing", () => {
    const env = isolated({
      DB_HOST: "localhost",
      DB_USER: "portal",
      DB_PASSWORD: "portal",
      DB_NAME: "savills_cloud_portal",
    });
    const url = constructDatabaseUrlFromDiscreteVars(env);
    assert.equal(
      url,
      "postgresql://portal:portal@localhost:5432/savills_cloud_portal?sslmode=require"
    );
    assert.equal(ensureDatabaseUrl(env), url);
  });
});
