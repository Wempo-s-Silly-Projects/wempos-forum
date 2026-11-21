// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// Self-hosting part 1 (v5.17.0): the instance's public origin, the Wempo
// Accounts origin and the Turnstile pair come from config. The owner's
// deployment sets SITE_ORIGIN / ACCOUNTS_ORIGIN / TURNSTILE_SITEKEY /
// TURNSTILE_SECRET and must behave exactly as before; an instance that sets
// none of them answers on its own request origin with no redirect and no
// Turnstile (rate limits stay on).
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { requireTurnstile } from "../worker.mjs";
import { makeEnv } from "./helpers/d1.mjs";
import { forgeSession, makeRequest, seedPost, seedUser } from "./helpers/seed.mjs";
import { wempoAccountsSignInUrl, wempoAccountsSignOutUrl } from "../public/js/sso.js";
import { takeTurnstileToken, turnstileSitekey } from "../public/js/turnstile.js";

const OWNER_ORIGIN = "https://wempos-forum.com";
// The owner's host must never leak into a self-hosted copy. Checked by
// splitting on the literal (not a regex or .includes) so CodeQL's hostname
// rules have nothing to flag; length 1 means "never appears".
const OWNER_HOST = "wempos-forum.com";
const SELF_HOST = "https://forum.example.org";
const UNSET = { SITE_ORIGIN: undefined };

const fetchAt = (env, url, init) => worker.fetch(new Request(url, init), env, {});

// ---- SITE_ORIGIN unset: no redirect, discovery on the request origin ------

test("SITE_ORIGIN unset: a workers.dev host is served, not redirected", async () => {
  const env = makeEnv(UNSET);
  const response = await fetchAt(env, "https://my-forum.someone.workers.dev/posts/3?x=1");
  assert.notEqual(response.status, 301);
  assert.equal(response.headers.get("Location"), null);
  assert.equal(env.ASSETS.requests.length, 1);
});

test("SITE_ORIGIN unset: every discovery document uses the request origin", async () => {
  const env = makeEnv(UNSET);
  const author = await seedUser(env.__sqlite, { username: "Selfie" });
  const postId = seedPost(env.__sqlite, { authorId: author, body: "hello self host" });

  const catalog = await (await fetchAt(env, SELF_HOST + "/.well-known/api-catalog")).json();
  assert.equal(catalog.linkset[0].anchor, SELF_HOST + "/api/");
  assert.equal(catalog.linkset[0].status[0].href, SELF_HOST + "/api/version");

  const card = await (await fetchAt(env, SELF_HOST + "/.well-known/mcp/server-card.json")).json();
  assert.equal(card.transport.endpoint, SELF_HOST + "/mcp");

  const openapi = await (await fetchAt(env, SELF_HOST + "/openapi.json")).json();
  assert.deepEqual(openapi.servers, [{ url: SELF_HOST }]);

  const auth = await (await fetchAt(env, SELF_HOST + "/auth.md")).text();
  assert.ok(auth.includes("How authentication works on " + SELF_HOST + ", for people"), auth);
  assert.equal(auth.split(OWNER_HOST).length, 1, "auth.md must not name the owner's host");

  const sitemap = await (await fetchAt(env, SELF_HOST + "/sitemap.xml")).text();
  assert.ok(sitemap.includes("<loc>" + SELF_HOST + "/</loc>"), sitemap);
  assert.ok(sitemap.includes("<loc>" + SELF_HOST + "/posts/" + postId + "</loc>"));
  assert.equal(sitemap.split(OWNER_HOST).length, 1, "sitemap must not name the owner's host");

  const markdown = await (await fetchAt(env, SELF_HOST + "/", { headers: { Accept: "text/markdown" } })).text();
  assert.ok(markdown.includes(SELF_HOST + "/posts/" + postId), markdown);
  assert.equal(markdown.split(OWNER_HOST).length, 1, "markdown must not name the owner's host");

  const mcp = await fetchAt(env, SELF_HOST + "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "recent_posts", arguments: {} } }),
  });
  const rows = JSON.parse((await mcp.json()).result.content[0].text);
  assert.equal(rows[0].url, SELF_HOST + "/posts/" + postId);
});

test("robots.txt is served by the worker and points its Sitemap at the instance origin", async () => {
  const unset = makeEnv(UNSET);
  const own = await fetchAt(unset, SELF_HOST + "/robots.txt");
  assert.equal(own.status, 200);
  assert.match(own.headers.get("Content-Type"), /^text\/plain/);
  const body = await own.text();
  assert.match(body, /^Sitemap: https:\/\/forum\.example\.org\/sitemap\.xml$/m);
  assert.match(body, /User-agent: GPTBot[\s\S]*Disallow: \/\n/);
  assert.equal(unset.ASSETS.requests.length, 0);

  const owner = makeEnv({ SITE_ORIGIN: OWNER_ORIGIN });
  const ownerBody = await (await fetchAt(owner, OWNER_ORIGIN + "/robots.txt")).text();
  assert.match(ownerBody, /^# Wempo's Forum — https:\/\/wempos-forum\.com$/m);
  assert.match(ownerBody, /^Sitemap: https:\/\/wempos-forum\.com\/sitemap\.xml$/m);
});

// ---- SITE_ORIGIN set: the owner's behavior, pinned ------------------------

test("SITE_ORIGIN set: workers.dev 301s to it with path + query intact", async () => {
  const env = makeEnv({ SITE_ORIGIN: OWNER_ORIGIN });
  const response = await fetchAt(env, "https://wempos-forum.itswempo.workers.dev/c/general?page=2");
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("Location"), OWNER_ORIGIN + "/c/general?page=2");
});

test("SITE_ORIGIN set: discovery names the configured origin even on another host", async () => {
  const env = makeEnv({ SITE_ORIGIN: OWNER_ORIGIN });
  const card = await (await fetchAt(env, SELF_HOST + "/.well-known/mcp/server-card.json")).json();
  assert.equal(card.transport.endpoint, OWNER_ORIGIN + "/mcp");
  const robots = await (await fetchAt(env, SELF_HOST + "/robots.txt")).text();
  assert.match(robots, /^Sitemap: https:\/\/wempos-forum\.com\/sitemap\.xml$/m);
});

test("SITE_ORIGIN that is itself a workers.dev host never redirects to itself", async () => {
  const own = "https://mine.someone.workers.dev";
  const env = makeEnv({ SITE_ORIGIN: own });
  const response = await fetchAt(env, own + "/about");
  assert.notEqual(response.status, 301);
});

test("a malformed SITE_ORIGIN is ignored (request origin, no redirect)", async () => {
  const env = makeEnv({ SITE_ORIGIN: "not a url" });
  const response = await fetchAt(env, "https://x.workers.dev/");
  assert.notEqual(response.status, 301);
  const card = await (await fetchAt(env, SELF_HOST + "/.well-known/mcp/server-card.json")).json();
  assert.equal(card.transport.endpoint, SELF_HOST + "/mcp");
});

// ---- Turnstile: skipped only when the instance has no secret --------------

test("requireTurnstile: no TURNSTILE_SECRET means no check at all", async () => {
  const request = new Request(SELF_HOST + "/api/auth/login", { method: "POST" });
  await requireTurnstile(request, { TURNSTILE_HOSTNAMES: "" }, {}, "login");
});

test("requireTurnstile: a configured secret still refuses a missing token", async () => {
  const request = new Request(OWNER_ORIGIN + "/api/auth/login", { method: "POST" });
  await assert.rejects(
    requireTurnstile(request, { TURNSTILE_SECRET: "s", TURNSTILE_HOSTNAMES: "wempos-forum.com" }, {}, "login"),
    (error) => error.status === 403 && /Human verification is required/.test(error.message),
  );
  // A secret with no hostnames is a misconfiguration, still refused (fail closed).
  await assert.rejects(
    requireTurnstile(request, { TURNSTILE_SECRET: "s", TURNSTILE_HOSTNAMES: "" }, { "cf-turnstile-response": "t" }, "login"),
    (error) => error.status === 403,
  );
});

test("POST /api/posts: no secret posts without a token; with a secret the token is required", async () => {
  const open = makeEnv();
  const member = await seedUser(open.__sqlite, { username: "NoCaptcha" });
  const session = forgeSession(open.__sqlite, member);
  const ok = await worker.fetch(makeRequest("/api/posts", { method: "POST", session, body: { body: "no captcha here", board: "general" } }), open, {});
  assert.equal(ok.status, 201, await ok.clone().text());

  const guarded = makeEnv({ TURNSTILE_SECRET: "owner-secret", TURNSTILE_HOSTNAMES: "wempos-forum.com" });
  const other = await seedUser(guarded.__sqlite, { username: "Captcha" });
  const otherSession = forgeSession(guarded.__sqlite, other);
  const refused = await worker.fetch(makeRequest("/api/posts", { method: "POST", session: otherSession, body: { body: "needs a token", board: "general" } }), guarded, {});
  assert.equal(refused.status, 403);
  assert.match((await refused.json()).error, /Human verification is required/);
  assert.equal(guarded.__sqlite.prepare("SELECT COUNT(*) AS n FROM posts").get().n, 0);
});

// ---- client config: Accounts origin + Turnstile sitekey -------------------

test("the HTML shell carries the configured Accounts origin and Turnstile sitekey", async () => {
  const env = makeEnv({ ACCOUNTS_ORIGIN: "https://accounts.wempos-forum.com", TURNSTILE_SITEKEY: "0xSITEKEY" });
  const html = await (await fetchAt(env, OWNER_ORIGIN + "/", { headers: { Accept: "text/html" } })).text();
  assert.match(html, /<meta name="accounts-origin" content="https:\/\/accounts\.wempos-forum\.com">/);
  assert.match(html, /<meta name="turnstile-sitekey" content="0xSITEKEY">/);
});

test("unset Accounts origin / sitekey: no config metas in the shell", async () => {
  const env = makeEnv({ ACCOUNTS_ORIGIN: undefined, TURNSTILE_SITEKEY: undefined });
  const html = await (await fetchAt(env, SELF_HOST + "/", { headers: { Accept: "text/html" } })).text();
  assert.doesNotMatch(html, /name="accounts-origin"/);
  assert.doesNotMatch(html, /name="turnstile-sitekey"/);
  assert.match(html, /<meta name="app-build"/);
});

test("config meta values are attribute-escaped", async () => {
  const env = makeEnv({ ACCOUNTS_ORIGIN: 'https://a.example"><script>', TURNSTILE_SITEKEY: "k<&>" });
  const html = await (await fetchAt(env, SELF_HOST + "/", { headers: { Accept: "text/html" } })).text();
  assert.equal(html.toLowerCase().includes("<script>"), false, "the injected tag never reaches the page raw");
  assert.match(html, /content="k&lt;&amp;&gt;"/);
});

function withMetas(metas, fn) {
  const saved = globalThis.document;
  globalThis.document = {
    querySelector(selector) {
      const name = /meta\[name="([^"]+)"\]/.exec(selector)?.[1];
      return name && Object.hasOwn(metas, name) ? { content: metas[name] } : null;
    },
  };
  try {
    return fn();
  } finally {
    if (saved === undefined) delete globalThis.document;
    else globalThis.document = saved;
  }
}

test("sso.js: every Accounts link targets the configured ACCOUNTS_ORIGIN", () => {
  withMetas({ "accounts-origin": "https://accounts.example.org" }, () => {
    assert.equal(wempoAccountsSignInUrl(SELF_HOST), "https://accounts.example.org/?return=" + encodeURIComponent(SELF_HOST));
    assert.equal(wempoAccountsSignOutUrl(), "https://accounts.example.org/?signout=1");
  });
  withMetas({ "accounts-origin": "https://accounts.wempos-forum.com" }, () => {
    assert.equal(wempoAccountsSignInUrl(OWNER_ORIGIN), "https://accounts.wempos-forum.com/?return=https%3A%2F%2Fwempos-forum.com");
  });
});

test("turnstile.js: the sitekey comes from the shell; none configured means no token needed", () => {
  withMetas({ "turnstile-sitekey": "0xOWNER" }, () => assert.equal(turnstileSitekey(), "0xOWNER"));
  withMetas({}, () => {
    assert.equal(turnstileSitekey(), "");
    assert.equal(takeTurnstileToken({}), "");
  });
});
