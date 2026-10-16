import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.mjs";

// Task 8: bio limit 10,000 + per-platform social handles on PATCH /api/me,
// and the socials/polytoriaUsername fields on GET /api/users/:username.

function envWithLimiters(db, extras = {}) {
  return {
    FORUM_DB: db,
    READ_RATE_LIMITER: { async limit() { return { success: true }; } },
    WRITE_RATE_LIMITER: { async limit() { return { success: true }; } },
    ...extras,
  };
}

function sessionRow(overrides = {}) {
  return {
    token_hash: "a".repeat(64),
    user_id: 7,
    csrf_token: "expected-csrf-token",
    expires_at: Math.floor(Date.now() / 1000) + 60,
    username: "social_user",
    role: "member",
    bio: "old bio",
    avatar_status: null,
    avatar_mime: null,
    avatar_updated_at: null,
    avatar_version: null,
    ...overrides,
  };
}

// D1 mock: routes are matched against the SQL text; the last route is the fallback.
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

async function call(requestUrl, method, routes, { role, body, extras } = {}) {
  const headers = { "Content-Type": "application/json", Origin: "https://forum.example" };
  if (role) {
    headers["X-CSRF-Token"] = "expected-csrf-token";
    headers.Cookie = "wempo_session=" + "s".repeat(43);
  }
  const request = new Request(requestUrl, {
    method,
    headers,
    body: method === "GET" ? undefined : body ?? "{}",
  });
  const response = await worker.fetch(request, envWithLimiters(routes.db, extras));
  return { response, calls: routes.calls, body: await response.json() };
}

function meRoutes(banRow = null, options = {}) {
  return mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow(options.session ?? {}) },
    { sql: /SELECT id FROM bans WHERE user_id = \?/, result: banRow },
    { sql: /UPDATE users SET/, changes: options.updateChanges ?? 1 },
    { sql: /./ },
  ]);
}

// PATCH /api/me — bio limit 10,000 ------------------------------------------------

test("a 10,000 character bio is trimmed then accepted", async () => {
  const routes = meRoutes();
  const paddedBio = "  " + "a".repeat(10000) + "  ";
  const { response, body, calls } = await call("https://forum.example/api/me", "PATCH", routes, {
    role: "member",
    body: JSON.stringify({ bio: paddedBio }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body, { bio: "a".repeat(10000) });
  const update = calls[2];
  assert.match(update.sql, /UPDATE users SET bio = \? WHERE id = \? AND NOT EXISTS/);
  assert.equal(update.values[0], "a".repeat(10000));
});

test("a 10,001 character bio is rejected with the updated message and no write", async () => {
  const routes = meRoutes();
  const { response, body, calls } = await call("https://forum.example/api/me", "PATCH", routes, {
    role: "member",
    body: JSON.stringify({ bio: "a".repeat(10001) }),
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, "Your bio must be 10000 characters or fewer.");
  assert.equal(calls.length, 2, "no bio write may run after a failed limit check");
});

test("the /api/me route accepts a JSON body larger than the 16 KB global cap", async () => {
  const routes = meRoutes();
  // ~20 KB of ignored padding plus a small bio: valid JSON under the 64 KB
  // per-route cap, but over the 16 KB default.
  const body = JSON.stringify({ bio: "within the cap", padding: "x".repeat(20000) });
  const { response } = await call("https://forum.example/api/me", "PATCH", routes, {
    role: "member",
    body,
  });

  assert.equal(response.status, 200, "the per-route cap must be raised above 16 KB");
});

test("other routes keep the 16 KB global cap", async () => {
  const routes = mockDb([
    { sql: /FROM sessions s LEFT JOIN users u/, result: sessionRow() },
    { sql: /SELECT id FROM bans WHERE user_id = \?/, result: null },
    { sql: /./ },
  ]);
  const body = JSON.stringify({
    currentPassword: "whatever",
    newPassword: "correct-horse-battery",
    padding: "x".repeat(20000),
  });
  const { response, body: responseBody } = await call(
    "https://forum.example/api/me/password",
    "PATCH",
    routes,
    { role: "member", body },
  );

  assert.equal(response.status, 413);
  assert.equal(responseBody.error, "That upload is too large.");
});

test("a body over the 64 KB per-route cap is rejected on /api/me too", async () => {
  const routes = meRoutes();
  const body = JSON.stringify({
    bio: "too big overall",
    padding: "x".repeat(66000),
  });
  const { response, body: responseBody } = await call("https://forum.example/api/me", "PATCH", routes, {
    role: "member",
    body,
  });

  assert.equal(response.status, 413);
  assert.equal(responseBody.error, "That upload is too large.");
});

// PATCH /api/me — word-filtered bios (Task 13) ---------------------------------

test("a bio containing a filtered word is masked before it is stored", async () => {
  const routes = meRoutes();
  const { response, body, calls } = await call("https://forum.example/api/me", "PATCH", routes, {
    role: "member",
    body: JSON.stringify({ bio: "my name is BadWord and I like cheese" }),
    extras: { FILTERED_WORDS: "badword" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body, { bio: "my name is ******* and I like cheese" });
  const update = calls[2];
  assert.match(update.sql, /UPDATE users SET bio = \? WHERE id = \? AND NOT EXISTS/);
  assert.equal(update.values[0], "my name is ******* and I like cheese");
});

test("filter masking is case-insensitive and masks every occurrence in a bio", async () => {
  const routes = meRoutes();
  const { response, body, calls } = await call("https://forum.example/api/me", "PATCH", routes, {
    role: "member",
    body: JSON.stringify({ bio: "BADWORD and badword and badwordish" }),
    extras: { FILTERED_WORDS: "badword" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body, { bio: "******* and ******* and *******ish" });
  assert.equal(calls[2].values[0], "******* and ******* and *******ish");
});

test("a length-boundary bio stays accepted after masking (masking preserves length)", async () => {
  const routes = meRoutes();
  // The mask has the same character count as the original, so a 10,000-char
  // bio that contains a filtered word must still pass the limit check made
  // before masking, exactly like the posts flow.
  const paddedBio = "badword " + "a".repeat(10000 - "badword ".length);
  const { response, body, calls } = await call("https://forum.example/api/me", "PATCH", routes, {
    role: "member",
    body: JSON.stringify({ bio: paddedBio }),
    extras: { FILTERED_WORDS: "badword" },
  });

  assert.equal(response.status, 200);
  assert.equal(body.bio, "******* " + "a".repeat(10000 - "badword ".length));
  assert.equal(body.bio.length, 10000);
  assert.equal(calls[2].values[0], body.bio);
});

test("an unset FILTERED_WORDS stores the bio unchanged", async () => {
  const routes = meRoutes();
  const { response, body, calls } = await call("https://forum.example/api/me", "PATCH", routes, {
    role: "member",
    body: JSON.stringify({ bio: "bio with badword inside" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body, { bio: "bio with badword inside" });
  assert.equal(calls[2].values[0], "bio with badword inside");
});

// PATCH /api/me — socials ---------------------------------------------------------

const MAX_LENGTH_HANDLES = {
  youtube: "a".repeat(60),
  x: "b".repeat(15),
  reddit: "c".repeat(20),
  github: "d".repeat(39),
  discord: "e".repeat(64),
  gitlab: "f".repeat(30),
  instagram: "g".repeat(30),
  tiktok: "h".repeat(24),
  twitch: "i".repeat(25),
  polytoria: "j".repeat(24),
};

const COLUMNS = {
  youtube: "social_youtube",
  x: "social_x",
  reddit: "social_reddit",
  github: "social_github",
  discord: "social_discord",
  gitlab: "social_gitlab",
  instagram: "social_instagram",
  tiktok: "social_tiktok",
  twitch: "social_twitch",
  polytoria: "polytoria_username",
};

test("handles that hit each platform's max length are accepted together", async () => {
  const routes = meRoutes();
  const socials = { ...MAX_LENGTH_HANDLES };
  const { response, body, calls } = await call("https://forum.example/api/me", "PATCH", routes, {
    role: "member",
    body: JSON.stringify({ socials }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body.bio, "old bio", "an absent bio key must leave the stored bio in place");
  assert.deepEqual(body.socials, socials, "the response reports the stored handles");
  const update = calls[2];
  assert.match(update.sql, /UPDATE users SET /);
  assert.match(update.sql, /WHERE id = \? AND NOT EXISTS/);
  assert.match(update.sql, /FROM bans WHERE user_id = \? AND revoked_at IS NULL/);
  const expectedValues = Object.values(socials);
  assert.deepEqual(
    update.values.slice(0, expectedValues.length),
    expectedValues,
    "each handle is bound to its own platform column",
  );
  assert.equal(update.values[update.values.length - 3], 7, "the update targets the session user");
});

test("every platform rejects whitespace, URL prefixes, and script prefixes", async () => {
  for (const platform of Object.keys(COLUMNS)) {
    for (const badHandle of ["has space", "http://evil.example", "javascript:alert(1)"]) {
      const routes = meRoutes();
      const { response, body, calls } = await call("https://forum.example/api/me", "PATCH", routes, {
        role: "member",
        body: JSON.stringify({ socials: { [platform]: badHandle } }),
      });

      assert.equal(response.status, 400, platform + " " + JSON.stringify(badHandle));
      assert.equal(body.error, "Enter a valid " + platform + " name.");
      assert.equal(calls.length, 2, "no write after an invalid handle");
    }
  }
});

test("the pinned per-platform shapes reject off-by-one and symbol violations", async () => {
  const rejects = {
    youtube: ["@needs_no_at", "a".repeat(61)],
    x: ["a".repeat(16), "has-hyphen"],
    reddit: ["ab", "a".repeat(21)],
    github: ["has_underscore", "a".repeat(40)],
    discord: ["a", "has space"],
    instagram: ["no-hyphens", "a".repeat(31)],
    polytoria: ["no-hyphens", "a".repeat(25)],
  };
  for (const [platform, values] of Object.entries(rejects)) {
    for (const value of values) {
      const routes = meRoutes();
      const { response, body } = await call("https://forum.example/api/me", "PATCH", routes, {
        role: "member",
        body: JSON.stringify({ socials: { [platform]: value } }),
      });

      assert.equal(response.status, 400, platform + " " + JSON.stringify(value));
      assert.equal(body.error, "Enter a valid " + platform + " name.");
    }
  }
});

test("non-string handles and unknown platforms are rejected with 400", async () => {
  const numericRoutes = meRoutes();
  const numeric = await call("https://forum.example/api/me", "PATCH", numericRoutes, {
    role: "member",
    body: JSON.stringify({ socials: { youtube: 42 } }),
  });
  assert.equal(numeric.response.status, 400);
  assert.equal(numeric.body.error, "Enter a valid youtube name.");
  assert.equal(numeric.calls.length, 2);

  const unknownRoutes = meRoutes();
  const unknown = await call("https://forum.example/api/me", "PATCH", unknownRoutes, {
    role: "member",
    body: JSON.stringify({ socials: { mastodon: "someone" } }),
  });
  assert.equal(unknown.response.status, 400);
  assert.equal(unknown.body.error, "That social platform is not supported.");
  assert.equal(unknown.calls.length, 2, "no write after an unknown platform key");

  const shapeRoutes = meRoutes();
  const shape = await call("https://forum.example/api/me", "PATCH", shapeRoutes, {
    role: "member",
    body: JSON.stringify({ socials: ["youtube"] }),
  });
  assert.equal(shape.response.status, 400);
  assert.equal(shape.body.error, "The socials value must be an object.");
  assert.equal(shape.calls.length, 2);
});

test("null and empty-string handles clear a platform", async () => {
  const routes = meRoutes();
  const { response, body, calls } = await call("https://forum.example/api/me", "PATCH", routes, {
    role: "member",
    body: JSON.stringify({
      socials: { reddit: "keepme", github: null, twitch: "" },
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.socials,
    { reddit: "keepme" },
    "cleared platforms disappear from the sparse response",
  );
  const update = calls[2];
  assert.match(update.sql, /social_reddit = \?/);
  assert.match(update.sql, /social_github = \?/);
  assert.match(update.sql, /social_twitch = \?/);
  const values = update.values.slice(0, 3);
  assert.deepEqual(values, ["keepme", null, null]);
});

test("bio and socials update atomically in one ban-guarded UPDATE", async () => {
  const routes = meRoutes();
  const { response, body, calls } = await call("https://forum.example/api/me", "PATCH", routes, {
    role: "member",
    body: JSON.stringify({ bio: "new bio text", socials: { github: "octcat" } }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body, { bio: "new bio text", socials: { github: "octcat" } });
  const updates = calls.filter(({ sql }) => sql.startsWith("UPDATE users SET"));
  assert.equal(updates.length, 1, "both fields must be written in a single statement");
  assert.match(updates[0].sql, /UPDATE users SET bio = \?, social_github = \?/);
  assert.match(updates[0].sql, /WHERE id = \? AND NOT EXISTS/);
  assert.equal(updates[0].values[0], "new bio text");
  assert.equal(updates[0].values[1], "octcat");
});

test("omitting the bio key does not rewrite bio, and omitting socials does not rewrite handles", async () => {
  const bioOnlyRoutes = meRoutes();
  const bioOnly = await call("https://forum.example/api/me", "PATCH", bioOnlyRoutes, {
    role: "member",
    body: JSON.stringify({ bio: "just the bio" }),
  });
  assert.equal(bioOnly.response.status, 200);
  assert.doesNotMatch(bioOnly.calls[2].sql, /SET social_/);
  assert.doesNotMatch(bioOnly.calls[2].sql, /polytoria/);

  const socialsOnlyRoutes = meRoutes();
  const socialsOnly = await call("https://forum.example/api/me", "PATCH", socialsOnlyRoutes, {
    role: "member",
    body: JSON.stringify({ socials: { twitch: "streamer" } }),
  });
  assert.equal(socialsOnly.response.status, 200);
  assert.doesNotMatch(socialsOnly.calls[2].sql, /SET bio = \?/);

  const emptyRoutes = meRoutes();
  const empty = await call("https://forum.example/api/me", "PATCH", emptyRoutes, {
    role: "member",
    body: JSON.stringify({}),
  });
  assert.equal(empty.response.status, 400);
  assert.equal(empty.calls.length, 2, "nothing to update must not write");
});

test("banned members cannot update bio or socials, and a ban landing mid-flight blocks the write", async () => {
  const bannedRoutes = meRoutes({ id: "1" });
  const banned = await call("https://forum.example/api/me", "PATCH", bannedRoutes, {
    role: "member",
    body: JSON.stringify({ bio: "sneaky", socials: { github: "octcat" } }),
  });
  assert.equal(banned.response.status, 403);
  assert.match(banned.body.error, /banned/i);
  assert.equal(banned.calls.length, 2, "no write for a banned member");

  const racedRoutes = meRoutes(null, { updateChanges: 0 });
  const raced = await call("https://forum.example/api/me", "PATCH", racedRoutes, {
    role: "member",
    body: JSON.stringify({ bio: "raced", socials: { github: "octcat" } }),
  });
  assert.equal(raced.response.status, 403);
  assert.match(raced.body.error, /banned/i);
});

// GET /api/users/:username — socials reads ----------------------------------------

function socialUserRow(overrides = {}) {
  const socialColumns = {
    social_youtube: null,
    social_x: null,
    social_reddit: null,
    social_github: null,
    social_discord: null,
    social_gitlab: null,
    social_instagram: null,
    social_tiktok: null,
    social_twitch: null,
    polytoria_username: null,
  };
  return {
    id: "9",
    username: "profiled_user",
    username_key: "profiled_user",
    role: "member",
    bio: "hello",
    avatar_status: null,
    avatar_mime: null,
    avatar_updated_at: null,
    avatar_version: null,
    ...socialColumns,
    ...overrides,
  };
}

async function profileGet(userRow) {
  const routes = mockDb([
    { sql: /FROM users WHERE username_key = \?/, result: userRow },
    { sql: /FROM posts p JOIN users u/, rows: [] },
    { sql: /./ },
  ]);
  const { response, body, calls } = await call(
    "https://forum.example/api/users/profiled_user",
    "GET",
    routes,
  );
  return { response, body, userSelect: calls[0] };
}

test("the profile read returns a sparse socials map plus polytoriaUsername", async () => {
  const row = socialUserRow({
    social_youtube: "myhandle",
    social_x: "x_name",
    polytoria_username: "PolyUser",
  });
  const { response, body, userSelect } = await profileGet(row);

  assert.equal(response.status, 200);
  assert.deepEqual(body.socials, { youtube: "myhandle", x: "x_name", polytoria: "PolyUser" });
  assert.equal(body.polytoriaUsername, "PolyUser");
  assert.match(userSelect.sql, /social_youtube/);
  assert.match(userSelect.sql, /polytoria_username/);
});

test("platforms with no handle are absent from the socials map", async () => {
  const noHandles = await profileGet(socialUserRow());
  assert.equal(noHandles.response.status, 200);
  assert.deepEqual(noHandles.body.socials, {});
  assert.equal(noHandles.body.polytoriaUsername, null);
});

test("rows predating the social columns normalize to the empty socials map", async () => {
  const legacy = {
    id: "9",
    username: "profiled_user",
    username_key: "profiled_user",
    role: "member",
    bio: "hello",
    avatar_status: null,
    avatar_mime: null,
    avatar_updated_at: null,
    avatar_version: null,
  };
  const { response, body } = await profileGet(legacy);

  assert.equal(response.status, 200);
  assert.deepEqual(body.socials, {});
  assert.equal(body.polytoriaUsername, null);
});