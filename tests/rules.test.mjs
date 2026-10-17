// Rules page (v2.5): public read; moderator/admin save (word filter NOT
// applied — the owner's own site copy); JSON-decoded like the CSS intake;
// capped 20 KiB.
import test from "node:test";
import assert from "node:assert/strict";
import forumWorker from "../worker.mjs";

const db = {
  prepare(sql) {
    return {
      bind(...values) {
        return {
          async first() {
            if (/FROM bans/.test(sql)) return null; // not banned
            if (/FROM sessions/.test(sql)) {
              return { token_hash: "a".repeat(64), user_id: 1, csrf_token: "expected-csrf-token", expires_at: Math.floor(Date.now() / 1000) + 60, username: "wempo", role: "admin", bio: "" };
            }
            return { value: "Be chill, be kind, and have fun :3", updated_at: 1700000000 };
          },
          async all() { return { results: [] }; },
          async run() { return { meta: { changes: 1 } }; },
        };
      },
    };
  },
  async batch(statements) { return statements.map(() => ({ meta: { changes: 1 } })); },
};
const successLimiter = () => ({ async limit() { return { success: true }; } });
const env = { FORUM_DB: db, READ_RATE_LIMITER: successLimiter(), WRITE_RATE_LIMITER: successLimiter() };
const sessionRow = { token_hash: "a".repeat(64), user_id: 7, csrf_token: "expected-csrf-token", expires_at: Math.floor(Date.now() / 1000) + 60, username: "wempo", role: "admin", bio: "" };
const adminEnv = { ...env };

test("the rules read publicly", async () => {
  const res = await forumWorker.fetch(new Request("https://forum.example/api/rules", { method: "GET" }), env);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.match(payload.rules, /chill/);
  assert.ok(payload.updatedAt.includes("2023"));
});

test("a guest cannot save the rules; an admin can", async () => {
  const guestEnv = { FORUM_DB: db, READ_RATE_LIMITER: successLimiter(), WRITE_RATE_LIMITER: successLimiter() };
  const res = await forumWorker.fetch(new Request("https://forum.example/api/rules", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://forum.example" },
    body: JSON.stringify("the rules!"),
  }), guestEnv);
  assert.equal(res.status, 401);

  const res2 = await forumWorker.fetch(new Request("https://forum.example/api/rules", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://forum.example",
      "X-CSRF-Token": "expected-csrf-token",
      Cookie: "wempo_session=" + "s".repeat(43),
    },
    body: JSON.stringify("# The rules\n- be chill\n- be kind"),
  }), { ...adminEnv, FORUM_DB: db, GUEST_SESSION_RATE_LIMITER: successLimiter() });
  assert.equal(res2.status, 200);
  const payload = await res2.json();
  assert.match(payload.rules, /be chill/);
});
