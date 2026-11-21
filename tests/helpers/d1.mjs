// Test harness: a tiny D1-compatible adapter over node:sqlite (a REAL SQL
// referee), a migrations loader, and makeEnv() — the env bindings the worker
// touches (FORUM_DB, the rate-limiter map from constants.mjs, secrets, ASSETS).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RATE_LIMIT_BINDINGS } from "../../constants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MIGRATIONS_DIR = join(ROOT, "migrations");
export const TEST_PEPPER = "test-pepper-0123456789abcdef0123456789abcdef";
export const TEST_RELAY_TOKEN = "relay-token-for-tests-0123456789";

// D1 binds: undefined is a D1_TYPE_ERROR; booleans bind as 1/0.
function normalizeBind(value) {
  if (value === undefined) throw new TypeError("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

class D1Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...values) {
    return new D1Statement(this.db, this.sql, values.map(normalizeBind));
  }

  // Executes synchronously; returns a D1-shaped result.
  execute() {
    const statement = this.db.prepare(this.sql);
    if (statement.columns().length > 0) {
      const results = statement.all(...this.params).map((row) => ({ ...row }));
      return { success: true, results, meta: { changes: 0, last_row_id: 0, rows_read: results.length } };
    }
    const info = statement.run(...this.params);
    return {
      success: true,
      results: [],
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid), rows_read: 0 },
    };
  }

  async first(column) {
    const { results } = this.execute();
    const row = results[0] ?? null;
    if (row === null) return null;
    return column === undefined ? row : (row[column] ?? null);
  }

  async all() {
    return this.execute();
  }

  async run() {
    return this.execute();
  }

  async raw() {
    return this.execute().results.map((row) => Object.values(row));
  }
}

export class D1Database {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new D1Statement(this.sqlite, sql);
  }

  // D1 batches are one implicit transaction: any failure rolls all back.
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(sql) {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }
}

// Splits a migration file into statements: respects quotes, comments, and
// CREATE TRIGGER ... BEGIN ... END bodies.
export function splitSql(text) {
  const statements = [];
  let buffer = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "-" && next === "-") {
      const end = text.indexOf("\n", index);
      index = end < 0 ? text.length : end + 1;
      buffer += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end < 0 ? text.length : end + 2;
      buffer += " ";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      let end = index + 1;
      while (end < text.length) {
        if (text[end] === char && text[end + 1] === char) { end += 2; continue; }
        if (text[end] === char) break;
        end += 1;
      }
      buffer += text.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (char === ";") {
      const inTrigger = /^\s*CREATE\s+(TEMP(ORARY)?\s+)?TRIGGER\b/i.test(buffer);
      if (inTrigger && !/\bEND\s*$/i.test(buffer)) {
        buffer += char;
        index += 1;
        continue;
      }
      if (buffer.trim()) statements.push(buffer.trim());
      buffer = "";
      index += 1;
      continue;
    }
    buffer += char;
    index += 1;
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

// Applies migrations/*.sql in order to a fresh in-memory DB. Each file runs
// in one transaction (so PRAGMA defer_foreign_keys behaves like D1); a
// statement node:sqlite refuses is skipped and recorded in `skipped`.
export function loadSchema() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const skipped = [];
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    sqlite.exec("BEGIN");
    for (const statement of splitSql(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))) {
      try {
        sqlite.exec(statement);
      } catch (error) {
        skipped.push({ file, statement: statement.slice(0, 120), error: error.message });
      }
    }
    sqlite.exec("COMMIT");
  }
  return { sqlite, db: new D1Database(sqlite), skipped, files };
}

// Limiter shape api/vendor/http.mjs rateLimit expects: env[binding].limit({key})
// resolving { success }. Calls are recorded for assertions.
export function makeLimiters(success = true) {
  const calls = [];
  const limiter = { calls, limit: async ({ key }) => { calls.push(key); return { success }; } };
  return { limiter, bindings: Object.fromEntries(Object.values(RATE_LIMIT_BINDINGS).map((name) => [name, limiter])) };
}

export function makeAssets(handler) {
  const requests = [];
  return {
    requests,
    fetch: async (request) => {
      requests.push(request);
      if (handler) return handler(request);
      return new Response("<!doctype html><html><head><title>t</title></head><body>shell</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  };
}

export function makeEnv(overrides = {}) {
  const schema = overrides.FORUM_DB ? null : loadSchema();
  const { bindings } = makeLimiters();
  return {
    FORUM_DB: schema ? schema.db : undefined,
    ...bindings,
    PASSWORD_PEPPER: TEST_PEPPER,
    RELAY_TOKEN: TEST_RELAY_TOKEN,
    AGENT_TOKENS: "",
    VERSION: "9.9.9-test",
    COMMIT_SHA: "abc1234",
    ASSETS: makeAssets(),
    ...overrides,
    ...(schema ? { __sqlite: schema.sqlite, __skipped: schema.skipped } : {}),
  };
}
