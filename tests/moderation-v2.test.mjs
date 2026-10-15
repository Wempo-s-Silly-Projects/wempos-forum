import test from "node:test";
import assert from "node:assert/strict";
import forumWorker from "../worker.mjs";

// Task 7: moderator role, promote/demote, and avatar moderation.

function envWithLimiters(db, extras = {}) {
  return {
    FORUM_DB: db,
    READ_RATE_LIMITER: { async limit() { return { success: true }; } },
    WRITE_RATE_LIMITER: { async limit() { return { success: true }; } },
    AVATAR_UPLOAD_RATE_LIMITER: { async limit() { return { success: true }; } },
    ...extras,
  };
}

function sessionRow(overrides = {}) {
  return {
    token_hash: "a".repeat(64),
    user_id: 7,
    csrf_token: "expected-csrf-token",
    expires_at: Math.floor(Date.now() / 1000) + 60,
    username: "test_user",
    role: "member",
    bio: "",
    avatar_status: null,
    avatar_mime: null,
    avatar_updated_at: null,
    avatar_version: null,
    ...overrides,
  };
}

// D1 mock: each route is { sql: RegExp, ...responder }. prepare() picks the
// first route whose regex matches the SQL; the last route acts as a fallback.
// Responders: result (first()), rows (all()), changes (run()).
function mockDb(routes) {
  const calls = [];
  const db = {
    prepare(sql) {
      const route = routes.find((candidate) => candidate.sql.test(sql)) ||
        routes[routes.length - 1];
      if (!route) throw new Error("Unexpected SQL: " + sql);
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async first() {
              return route.result === undefined ? null : route.result;
            },
            async all() {
              return { results: route.rows === undefined ? [] : route.rows };
            },
            async run() {
              return { meta: { changes: route.changes === undefined ? 0 : route.changes } };
            },
          };
        },
      };
    },
    async batch(statements) {
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return { db, calls };
}

// Requests run through worker.fetch so HttpError handling (status + message)
// matches production. `role` attaches a signed-in session; omit it for guests.
async function call(requestUrl, method, routes, { role, body } = {}) {
  // Origin is always same-origin here so guest failures surface as session
  // errors (401) rather than origin-block errors (403).
  const headers = body instanceof FormData
    ? { Origin: "https://forum.example" }
    : { "Content-Type": "application/json", Origin: "https://forum.example" };
  if (role) {
    headers["X-CSRF-Token"] = "expected-csrf-token";
    headers.Cookie = "wempo_session=" + "s".repeat(43);
  }
  const request = new Request(requestUrl, {
    method,
    headers,
    body: method === "GET" ? undefined : body ?? "{}",
  });
  const response = await forumWorker.fetch(request, envWithLimiters(routes.db));
  return { response, calls: routes.calls };
}

async function errorOf(response) {
  return (await response.json()).error;
}

test("promote moves a member to moderator with a role-guarded update", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "admin" }) },
    { sql: /SELECT id, role FROM users WHERE id = \? LIMIT 1/, result: { id: "5", role: "member" } },
    { sql: /UPDATE users SET role = \? WHERE id = \? AND role = \?/, changes: 1 },
    { sql: /./ },
  ]);
  const { response, calls } = await call("https://forum.example/api/admin/users/5/promote", "POST", routes, {
    role: "admin",
  });

  assert.equal(response.status, 200);
  assert.match(calls[1].sql, /SELECT id, role FROM users WHERE id = \? LIMIT 1/);
  assert.equal(calls[2].values[0], "moderator");
  assert.equal(calls[2].values[1], 5);
  assert.equal(calls[2].values[2], "member");
  assert.deepEqual(await response.json(), { ok: true, role: "moderator" });
});

test("demote moves a moderator back to member with a role-guarded update", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "admin" }) },
    { sql: /SELECT id, role FROM users WHERE id = \? LIMIT 1/, result: { id: "5", role: "moderator" } },
    { sql: /UPDATE users SET role = \? WHERE id = \? AND role = \?/, changes: 1 },
    { sql: /./ },
  ]);
  const { response, calls } = await call("https://forum.example/api/admin/users/5/demote", "POST", routes, {
    role: "admin",
  });

  assert.equal(response.status, 200);
  assert.equal(calls[2].values[0], "member");
  assert.equal(calls[2].values[1], 5);
  assert.equal(calls[2].values[2], "moderator");
  assert.deepEqual(await response.json(), { ok: true, role: "member" });
});

test("promote and demote refuse administrator targets, including self", async () => {
  for (const action of ["promote", "demote"]) {
    const routes = mockDb([
      { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "admin", user_id: 7 }) },
      { sql: /SELECT id, role FROM users WHERE id = \? LIMIT 1/, result: { id: "7", role: "admin" } },
      { sql: /./ },
    ]);
    const { response, calls } = await call("https://forum.example/api/admin/users/7/" + action, "POST", routes, {
      role: "admin",
    });

    assert.equal(response.status, 403);
    assert.equal(await errorOf(response), "Administrator accounts cannot be modified here.");
    assert.equal(calls.length, 2, "no role update must run");
  }
});

test("promote and demote 404 on unknown members", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "admin" }) },
    { sql: /SELECT id, role FROM users WHERE id = \? LIMIT 1/, result: null },
    { sql: /./ },
  ]);
  const { response } = await call("https://forum.example/api/admin/users/5/promote", "POST", routes, {
    role: "admin",
  });

  assert.equal(response.status, 404);
  assert.equal(await errorOf(response), "Member not found.");
});

test("promote and demote 409 when the target already holds the resulting role", async () => {
  for (const [action, targetRole] of [["promote", "moderator"], ["demote", "member"]]) {
    const routes = mockDb([
      { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "admin" }) },
      { sql: /SELECT id, role FROM users WHERE id = \? LIMIT 1/, result: { id: "5", role: targetRole } },
      { sql: /./ },
    ]);
    const { response, calls } = await call("https://forum.example/api/admin/users/5/" + action, "POST", routes, {
      role: "admin",
    });

    assert.equal(response.status, 409);
    assert.match(await errorOf(response), /already has this role/);
    assert.equal(calls.length, 2, "no role update must run");
  }
});

test("moderators and members cannot promote", async () => {
  for (const role of ["moderator", "member"]) {
    const routes = mockDb([
      { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role }) },
      { sql: /./ },
    ]);
    const { response, calls } = await call("https://forum.example/api/admin/users/5/promote", "POST", routes, {
      role,
    });

    assert.equal(response.status, 403);
    assert.equal(await errorOf(response), "Only moderators can do that.");
    assert.equal(calls.length, 1, "no database access beyond the session read");
  }
});

test("guests cannot promote", async () => {
  const routes = mockDb([{ sql: /./, result: null }]);
  const { response } = await call("https://forum.example/api/admin/users/5/promote", "POST", routes);

  assert.equal(response.status, 401);
  assert.equal(routes.calls.length, 0, "invalid session cookies fail before any query");
});

test("promote and demote validate the optional, unstored reason", async () => {
  const okRoutes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "admin" }) },
    { sql: /SELECT id, role FROM users WHERE id = \? LIMIT 1/, result: { id: "5", role: "moderator" } },
    { sql: /UPDATE users SET role = \? WHERE id = \? AND role = \?/, changes: 1 },
    { sql: /./ },
  ]);
  const ok = await call("https://forum.example/api/admin/users/5/demote", "POST", okRoutes, {
    role: "admin",
    body: JSON.stringify({ reason: "Ready for the desk" }),
  });
  assert.equal(ok.response.status, 200);

  const badRoutes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "admin" }) },
    { sql: /./ },
  ]);
  const bad = await call("https://forum.example/api/admin/users/5/promote", "POST", badRoutes, {
    role: "admin",
    body: JSON.stringify({ reason: 123 }),
  });
  assert.equal(bad.response.status, 400);
  assert.equal(badRoutes.calls.length, 1, "no target read or update after a bad body");
});

test("moderators can resolve reports through requireModerator", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "moderator" }) },
    { sql: /FROM reports WHERE id = \? AND status = 'open' LIMIT 1/, result: { id: "1", post_id: "2" } },
    { sql: /UPDATE reports SET status = 'dismissed'/, changes: 1 },
    { sql: /./ },
  ]);
  const { response, calls } = await call("https://forum.example/api/admin/reports/1/resolve", "POST", routes, {
    role: "moderator",
    body: JSON.stringify({ action: "dismiss" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.match(calls[2].sql, /UPDATE reports SET status = 'dismissed'/);
});

test("moderators can reach the ban list read", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "moderator" }) },
    { sql: /FROM bans b JOIN users u ON u.id = b.user_id/, rows: [] },
    { sql: /./ },
  ]);
  const { response, calls } = await call("https://forum.example/api/admin/bans", "GET", routes, {
    role: "moderator",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { bans: [] });
  assert.match(calls[1].sql, /FROM bans b JOIN users u ON u.id = b.user_id/);
});

test("the avatar queue lists pending uploads oldest first", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "moderator" }) },
    {
      sql: /FROM users WHERE avatar_status = 'pending' ORDER BY pending_avatar_updated_at ASC LIMIT 100/,
      rows: [
        { id: "5", username: "first_pic", pending_avatar_updated_at: 1700000000, pending_avatar_version: "ver-1" },
        { id: "9", username: "later_pic", pending_avatar_updated_at: 1700000500, pending_avatar_version: "ver-2" },
      ],
    },
    { sql: /./ },
  ]);
  const { response, calls } = await call("https://forum.example/api/admin/avatars", "GET", routes, {
    role: "moderator",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    avatars: [
      {
        userId: 5,
        username: "first_pic",
        avatarUrl: "/api/avatars/5?v=ver-1",
        uploadedAt: new Date(1700000000 * 1000).toISOString(),
      },
      {
        userId: 9,
        username: "later_pic",
        avatarUrl: "/api/avatars/9?v=ver-2",
        uploadedAt: new Date(1700000500 * 1000).toISOString(),
      },
    ],
  });
  assert.match(calls[1].sql, /FROM users WHERE avatar_status = 'pending' ORDER BY pending_avatar_updated_at ASC LIMIT 100/);
});

test("members cannot reach the avatar queue", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "member" }) },
    { sql: /./ },
  ]);
  const { response, calls } = await call("https://forum.example/api/admin/avatars", "GET", routes, {
    role: "member",
  });

  assert.equal(response.status, 403);
  assert.equal(await errorOf(response), "Only moderators can do that.");
  assert.equal(calls.length, 1);
});

test("approve copies the pending set into the approved set and clears pending", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "moderator" }) },
    { sql: /SELECT id FROM users WHERE id = \? LIMIT 1/, result: { id: "5" } },
    { sql: /UPDATE users SET\s+avatar_mime = pending_avatar_mime/, changes: 1 },
    { sql: /./ },
  ]);
  const { response, calls } = await call("https://forum.example/api/admin/avatars/5/approve", "POST", routes, {
    role: "moderator",
  });

  assert.equal(response.status, 200);
  // calls: [session read, acting-moderator ban check, target existence, UPDATE]
  const update = calls[3];
  assert.match(update.sql, /avatar_mime = pending_avatar_mime/);
  assert.match(update.sql, /avatar_data = pending_avatar_data/);
  assert.match(update.sql, /avatar_updated_at = pending_avatar_updated_at/);
  assert.match(update.sql, /avatar_version = pending_avatar_version/);
  assert.match(update.sql, /pending_avatar_mime = NULL/);
  assert.match(update.sql, /pending_avatar_data = NULL/);
  assert.match(update.sql, /pending_avatar_updated_at = NULL/);
  assert.match(update.sql, /pending_avatar_version = NULL/);
  assert.match(update.sql, /avatar_status = 'approved'/);
  assert.match(update.sql, /WHERE id = \? AND avatar_status = 'pending'/);
  assert.deepEqual(update.values, [5]);
  assert.deepEqual(await response.json(), { ok: true });
});

test("approve 409s when the avatar is not awaiting review", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "moderator" }) },
    { sql: /SELECT id FROM users WHERE id = \? LIMIT 1/, result: { id: "5" } },
    { sql: /UPDATE users SET\s+avatar_mime = pending_avatar_mime/, changes: 0 },
    { sql: /./ },
  ]);
  const { response } = await call("https://forum.example/api/admin/avatars/5/approve", "POST", routes, {
    role: "moderator",
  });

  assert.equal(response.status, 409);
  assert.equal(await errorOf(response), "That avatar is not awaiting review.");
});

test("reject clears the pending set and falls back to the previous avatar state", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "moderator" }) },
    { sql: /SELECT id FROM users WHERE id = \? LIMIT 1/, result: { id: "5" } },
    { sql: /UPDATE users SET\s+pending_avatar_mime = NULL/, changes: 1 },
    { sql: /./ },
  ]);
  const { response, calls } = await call("https://forum.example/api/admin/avatars/5/reject", "POST", routes, {
    role: "moderator",
  });

  assert.equal(response.status, 200);
  const update = calls[3];
  assert.match(update.sql, /pending_avatar_mime = NULL/);
  assert.match(update.sql, /pending_avatar_data = NULL/);
  assert.match(update.sql, /pending_avatar_updated_at = NULL/);
  assert.match(update.sql, /pending_avatar_version = NULL/);
  assert.match(
    update.sql,
    /avatar_status = CASE WHEN avatar_mime IS NOT NULL THEN 'approved' ELSE NULL END/,
  );
  assert.match(update.sql, /WHERE id = \? AND avatar_status = 'pending'/);
  assert.deepEqual(update.values, [5]);
});

test("reject 409s when the avatar is not awaiting review", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "moderator" }) },
    { sql: /SELECT id FROM users WHERE id = \? LIMIT 1/, result: { id: "5" } },
    { sql: /UPDATE users SET\s+pending_avatar_mime = NULL/, changes: 0 },
    { sql: /./ },
  ]);
  const { response } = await call("https://forum.example/api/admin/avatars/5/reject", "POST", routes, {
    role: "moderator",
  });

  assert.equal(response.status, 409);
  assert.equal(await errorOf(response), "That avatar is not awaiting review.");
});

test("avatar moderation 404s for unknown members before touching the avatar", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "moderator" }) },
    { sql: /SELECT id FROM users WHERE id = \? LIMIT 1/, result: null },
    { sql: /./ },
  ]);
  const { response, calls } = await call("https://forum.example/api/admin/avatars/5/approve", "POST", routes, {
    role: "moderator",
  });

  assert.equal(response.status, 404);
  assert.equal(await errorOf(response), "Member not found.");
  assert.equal(calls.length, 3, "no avatar update must run");
});

test("only moderators can approve or reject avatars", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ role: "member" }) },
    { sql: /./ },
  ]);
  const { response, calls } = await call("https://forum.example/api/admin/avatars/5/approve", "POST", routes, {
    role: "member",
  });

  assert.equal(response.status, 403);
  assert.equal(await errorOf(response), "Only moderators can do that.");
  assert.equal(calls.length, 1, "no database access beyond the session read");
});

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function pendingAvatarRow() {
  return {
    id: "5",
    avatar_status: "pending",
    avatar_mime: null,
    avatar_data: null,
    pending_avatar_mime: "image/png",
    pending_avatar_data: PNG_BYTES,
  };
}

function approvedAvatarRow() {
  return {
    id: "5",
    avatar_status: "approved",
    avatar_mime: "image/png",
    avatar_data: PNG_BYTES,
    pending_avatar_mime: null,
    pending_avatar_data: null,
  };
}

// GET /api/avatars/5: `viewer` attaches a session, otherwise the request is a
// guest read.
async function avatarGet(row, viewer) {
  const routes = [
    { sql: /FROM users WHERE id = \? LIMIT 1/, result: row },
    { sql: /./ },
  ];
  if (viewer) {
    routes.unshift({
      sql: /FROM sessions s LEFT JOIN users u/,
      result: sessionRow({ user_id: viewer.userId, role: viewer.role, avatar_status: "pending" }),
    });
  }
  const mock = mockDb(routes);
  const headers = viewer ? { Cookie: "wempo_session=" + "s".repeat(43) } : {};
  const response = await forumWorker.fetch(
    new Request("https://forum.example/api/avatars/5", { headers }),
    envWithLimiters(mock.db),
  );
  return { response, calls: mock.calls };
}

test("pending avatar visibility: guest 404, owner 200, moderator 200, member 404, after approve guest 200", async () => {
  const guest = await avatarGet(pendingAvatarRow(), null);
  assert.equal(guest.response.status, 404);
  assert.equal(await errorOf(guest.response), "Picture not found.");
  assert.equal(guest.calls.length, 1, "guest 404 must not consult session state");

  const owner = await avatarGet(pendingAvatarRow(), { userId: 5, role: "member" });
  assert.equal(owner.response.status, 200);
  assert.equal(owner.response.headers.get("Content-Type"), "image/png");
  assert.equal(owner.response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(Array.from(new Uint8Array(await owner.response.arrayBuffer())), Array.from(PNG_BYTES));

  const moderator = await avatarGet(pendingAvatarRow(), { userId: 9, role: "moderator" });
  assert.equal(moderator.response.status, 200);
  assert.equal(moderator.response.headers.get("Cache-Control"), "no-store");

  const admin = await avatarGet(pendingAvatarRow(), { userId: 9, role: "admin" });
  assert.equal(admin.response.status, 200);
  assert.equal(admin.response.headers.get("Cache-Control"), "no-store");

  const otherMember = await avatarGet(pendingAvatarRow(), { userId: 8, role: "member" });
  assert.equal(otherMember.response.status, 404);
  assert.equal(await errorOf(otherMember.response), "Picture not found.");

  const approvedGuest = await avatarGet(approvedAvatarRow(), null);
  assert.equal(approvedGuest.response.status, 200);
  assert.equal(approvedGuest.response.headers.get("Content-Type"), "image/png");
  assert.equal(approvedGuest.response.headers.get("Cache-Control"), "public, max-age=3600");
});

test("missing users 404 through the avatar endpoint", async () => {
  const missing = await avatarGet(null, null);
  assert.equal(missing.response.status, 404);
  assert.equal(await errorOf(missing.response), "Picture not found.");
});

// Re-upload over an approved avatar: moderators/owner review the PENDING
// bytes even while the approved avatar still serves the public.
test("re-upload over approved: moderator and owner see pending bytes, public sees the approved avatar", async () => {
  const reuploadRow = {
    id: "5",
    avatar_status: "pending",
    avatar_mime: "image/png",
    avatar_data: PNG_BYTES,
    pending_avatar_mime: "image/jpeg",
    pending_avatar_data: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]),
  };

  const moderator = await avatarGet(reuploadRow, { userId: 9, role: "moderator" });
  assert.equal(moderator.response.status, 200);
  assert.equal(moderator.response.headers.get("Content-Type"), "image/jpeg");
  assert.equal(moderator.response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(
    Array.from(new Uint8Array(await moderator.response.arrayBuffer())),
    Array.from(reuploadRow.pending_avatar_data),
    "moderator must see the pending re-upload, not the approved avatar",
  );

  const owner = await avatarGet(reuploadRow, { userId: 5, role: "member" });
  assert.equal(owner.response.status, 200);
  assert.equal(owner.response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(
    Array.from(new Uint8Array(await owner.response.arrayBuffer())),
    Array.from(reuploadRow.pending_avatar_data),
  );

  const guest = await avatarGet(reuploadRow, null);
  assert.equal(guest.response.status, 200);
  assert.equal(guest.response.headers.get("Content-Type"), "image/png");
  assert.equal(guest.response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(
    Array.from(new Uint8Array(await guest.response.arrayBuffer())),
    Array.from(PNG_BYTES),
    "guest keeps seeing the approved avatar",
  );

  const otherMember = await avatarGet(reuploadRow, { userId: 8, role: "member" });
  assert.equal(otherMember.response.status, 200);
  assert.equal(otherMember.response.headers.get("Content-Type"), "image/png");
  assert.equal(otherMember.response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(
    Array.from(new Uint8Array(await otherMember.response.arrayBuffer())),
    Array.from(PNG_BYTES),
  );
});

function avatarUploadRequest() {
  const form = new FormData();
  form.append("avatar", new File([PNG_BYTES], "avatar.png", { type: "image/png" }));
  return new Request("https://forum.example/api/me/avatar", {
    method: "POST",
    headers: {
      Origin: "https://forum.example",
      "X-CSRF-Token": "expected-csrf-token",
      Cookie: "wempo_session=" + "s".repeat(43),
    },
    body: form,
  });
}

test("avatar uploads write only the pending set and report the pending status", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ user_id: 7 }) },
    // Anchored on "SELECT id" so it cannot also match the upload UPDATE (whose
    // NOT EXISTS clause mentions the same bans fragment).
    { sql: /SELECT id FROM bans WHERE user_id = \?/, result: null },
    {
      sql: /UPDATE users SET pending_avatar_mime = \?, pending_avatar_data = \?, pending_avatar_updated_at = \?, pending_avatar_version = \?, avatar_status = 'pending'/,
      changes: 1,
    },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(avatarUploadRequest(), envWithLimiters(routes.db));

  assert.equal(response.status, 200);
  const update = routes.calls[2];
  assert.match(update.sql, /UPDATE users SET pending_avatar_mime = \?, pending_avatar_data = \?, pending_avatar_updated_at = \?, pending_avatar_version = \?, avatar_status = 'pending'/);
  assert.equal(update.values[0], "image/png");
  assert.deepEqual(Array.from(update.values[1]), Array.from(PNG_BYTES));
  assert.match(update.sql, /WHERE id = \? AND NOT EXISTS/);
  assert.match(update.sql, /FROM bans WHERE user_id = \? AND revoked_at IS NULL/);
  assert.equal(update.values[4], 7);
  assert.equal(update.values[5], 7);
  const body = await response.json();
  assert.equal(body.avatarStatus, "pending");
  assert.match(body.avatarUrl, /^\/api\/avatars\/7\?v=/);
  assert.doesNotMatch(update.sql, /(?<![A-Za-z_])avatar_mime = \?/, "the approved set must not be written by an upload");
});

test("re-uploading while pending replaces the pending bytes", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ user_id: 7, avatar_status: "pending" }) },
    { sql: /SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /UPDATE users SET pending_avatar_mime = \?/, changes: 1 },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(avatarUploadRequest(), envWithLimiters(routes.db));

  assert.equal(response.status, 200);
  assert.match(routes.calls[2].sql, /UPDATE users SET pending_avatar_mime = \?/);
  assert.equal((await response.json()).avatarStatus, "pending");
});

test("banned members cannot write a pending avatar upload", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ user_id: 7 }) },
    { sql: /SELECT id FROM bans WHERE user_id = \?/, result: { id: "1" } },
    { sql: /./ },
  ]);
  const response = await forumWorker.fetch(avatarUploadRequest(), envWithLimiters(routes.db));

  assert.equal(response.status, 403);
  assert.match(await errorOf(response), /banned/i);
  assert.equal(routes.calls.length, 2, "no upload write may run");
});

test("session payloads carry avatarStatus from the users row", async () => {
  for (const status of ["pending", "approved", null]) {
    const routes = mockDb([
      { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow({ avatar_status: status }) },
      { sql: /./ },
    ]);
    const response = await forumWorker.fetch(
      new Request("https://forum.example/api/session", {
        headers: { Cookie: "wempo_session=" + "s".repeat(43) },
      }),
      envWithLimiters(routes.db),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.avatarStatus, status);
  }
});