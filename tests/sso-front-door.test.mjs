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

// The Wempo Accounts handshake, forum client half (the §4b door-swap): the
// forum keeps guest browsing but has NO password sign-in surface — every auth
// link targets Wempo Accounts, and a member-site arrival carrying ?wt=<ticket>
// redeems the ticket at boot BEFORE the router mounts. The pure helpers are
// pinned behaviorally; the redeem's guest-session + CSRF preflight, the
// refusal cards (no catch-all redirect — the audit fix), the logout handoff,
// and the stale-route aliases are pinned behaviorally or as source text
// (node --test has no DOM).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SSO_TICKET_PARAM,
  SSO_REDEEM_TIMEOUT_MS,
  WEMPO_ACCOUNTS_ORIGIN,
  clearTicketParam,
  redeemReturnTicket,
  ssoTicketFromSearch,
  wempoAccountsSignInUrl,
  wempoAccountsSignOutUrl,
} from "../public/js/sso.js";
import { routeForPath } from "../public/js/router.js";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const SSO_SOURCE = read("public/js/sso.js");
const APP_SOURCE = read("public/js/app.js");
const AUTH_SOURCE = read("public/js/routes/auth.js");
const FEED_SOURCE = read("public/js/routes/feed.js");
const NOTIFICATIONS_SOURCE = read("public/js/routes/notifications.js");
const NAV_SOURCE = read("public/js/routes/account-nav.js");

// --- pure helpers ----------------------------------------------------------------

test("ssoTicketFromSearch accepts exactly a 32-byte-hex ?wt value", () => {
  assert.equal(SSO_TICKET_PARAM, "wt");
  const ticket = "ab".repeat(32);
  assert.equal(ssoTicketFromSearch("?wt=" + ticket), ticket);
  // Uppercase hex is the same ticket, normalized for the redeem.
  assert.equal(ssoTicketFromSearch("?wt=" + "AB".repeat(32)), ticket);
  assert.equal(ssoTicketFromSearch("?other=1&wt=" + ticket), ticket);
  for (const bad of [
    "?wt=zz", "?wt=" + "ab".repeat(31), "?wt=" + "ab".repeat(33),
    "?wt=" + "zz".repeat(32), "?wt=abc", "?wt=", "", "?other=x", "?wt=" + ticket + "0",
  ]) {
    assert.equal(ssoTicketFromSearch(bad), "", "rejects " + JSON.stringify(bad));
  }
  // A malformed search string never throws.
  assert.equal(ssoTicketFromSearch(null), "");
  assert.equal(SSO_REDEEM_TIMEOUT_MS, 15_000, "a hung relay can never wedge the boot");
});

test("clearTicketParam removes only the ticket parameter, without touching the path or hash", () => {
  const calls = [];
  const win = {
    location: { pathname: "/c/suggestions", search: "?wt=" + "ab".repeat(32) + "&keep=1", hash: "#join" },
    history: { replaceState: (...args) => calls.push(args) },
  };
  assert.equal(clearTicketParam(win), true);
  assert.deepEqual(calls, [[null, "", "/c/suggestions?keep=1#join"]]);
});

test("clearTicketParam leaves a ticket-free URL untouched (replaceState never runs)", () => {
  const calls = [];
  const win = {
    location: { pathname: "/", search: "?utm=1", hash: "" },
    history: { replaceState: (...args) => calls.push(args) },
  };
  assert.equal(clearTicketParam(win), false);
  assert.deepEqual(calls, []);
});

test("wempoAccountsSignInUrl carries the EXACT origin — never a query string or path", () => {
  const origin = "https://wempos-forum.itswempo.workers.dev";
  assert.equal(
    wempoAccountsSignInUrl(origin),
    WEMPO_ACCOUNTS_ORIGIN + "/?return=" + encodeURIComponent(origin),
  );
  assert.equal(WEMPO_ACCOUNTS_ORIGIN, "https://accounts.itswempo.workers.dev");
  // The handoff URL is origin-only, built through the shared helper.
  assert.match(wempoAccountsSignInUrl("http://127.0.0.1:8794"), /\?return=http%3A%2F%2F127\.0\.0\.1%3A8794$/);
});

// The sign-out handoff: the forum logout clears ITS session, then the browser
// rides to Accounts to clear that session too. NO return parameter, on
// purpose — with one, the Accounts arrival would auto-issue a fresh ticket
// and bounce the member straight back signed in.
test("wempoAccountsSignOutUrl is the ?signout=1 handoff and never carries a return", () => {
  assert.equal(wempoAccountsSignOutUrl(), WEMPO_ACCOUNTS_ORIGIN + "/?signout=1");
  assert.doesNotMatch(wempoAccountsSignOutUrl(), /return=/);
});

// --- the boot redeem ---------------------------------------------------------------

function fakeWindow(search, { hash = "" } = {}) {
  const calls = { replaceState: [], replace: [], assign: [] };
  return {
    calls,
    location: { search, pathname: "/", origin: "https://forum.test", hash },
    history: { replaceState: (...args) => calls.replaceState.push(args) },
    location_replace: (url) => calls.replace.push(url),
    location_assign: (url) => calls.assign.push(url),
  };
}

// redeemReturnTicket navigates through win.location.replace — route the call
// through a setter so the fake records it while staying a plain object.
function navigatingWindow(search) {
  const win = fakeWindow(search);
  Object.defineProperty(win.location, "replace", { value: (url) => win.calls.replace.push(url) });
  Object.defineProperty(win.location, "assign", { value: (url) => win.calls.assign.push(url) });
  return win;
}

function fakeApi({ session = { user: null, csrfToken: "csrf-guest" }, redeem = null } = {}) {
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/session") {
      if (session instanceof Error) throw session;
      return session;
    }
    if (path === "/api/auth/sso/redeem") {
      if (redeem instanceof Error) throw redeem;
      if (redeem) return redeem;
      return { user: { id: 9 }, csrfToken: "csrf-member" };
    }
    return null;
  };
  api.calls = calls;
  return api;
}

const TICKET = "ab".repeat(32);

test("no ticket: the door never fires — no session probe, no POST, no param clearing", async () => {
  const api = fakeApi();
  const win = navigatingWindow("?utm=1");
  const csrfWrites = [];
  assert.equal(await redeemReturnTicket(win, api, { setCsrfToken: (t) => csrfWrites.push(t) }), false);
  assert.equal(api.calls.length, 0);
  assert.deepEqual(win.calls, { replaceState: [], replace: [], assign: [] });
  assert.deepEqual(csrfWrites, []);
});

test("the redeem preflights a guest session + CSRF, or every redeem would 401", async () => {
  const api = fakeApi();
  const win = navigatingWindow("?wt=" + TICKET);
  const csrfWrites = [];
  const stopped = await redeemReturnTicket(win, api, { setCsrfToken: (t) => csrfWrites.push(t) });
  assert.equal(stopped, false, "a successful redeem mounts the router");

  // Order is load-bearing: the guest session GET first, the redeem POST after.
  assert.deepEqual(api.calls.map((call) => call.path), ["/api/session", "/api/auth/sso/redeem"]);
  assert.equal(api.calls[1].options.method, "POST");
  assert.deepEqual(api.calls[1].options.body, { wt: TICKET });
  // The POST carries the guest session's csrf token, which the boot stored.
  assert.deepEqual(csrfWrites, ["csrf-guest"]);

  // The one-time parameter is cleared FIRST, unconditionally — even a
  // signed-in open (the next test) can never carry a spent code.
  assert.deepEqual(win.calls.replaceState, [[null, "", "/"]]);
});

test("a signed-in open never redeems: the probe answers, the POST never fires", async () => {
  const api = fakeApi({ session: { user: { id: 9 }, csrfToken: "csrf-member" } });
  const win = navigatingWindow("?wt=" + TICKET);
  assert.equal(await redeemReturnTicket(win, api, {}), false);
  assert.deepEqual(api.calls.map((call) => call.path), ["/api/session"]);
  // Still cleared — the address bar must never carry a spent ticket.
  assert.deepEqual(win.calls.replaceState, [[null, "", "/"]]);
});

test("a failed probe still attempts the redeem (the redeem answers the truth)", async () => {
  const api = fakeApi({ session: new Error("network down") });
  const win = navigatingWindow("?wt=" + TICKET);
  assert.equal(await redeemReturnTicket(win, api, {}), false);
  assert.deepEqual(api.calls.map((call) => call.path), ["/api/session", "/api/auth/sso/redeem"]);
});

test("a banned redeem stops into the ban screen — never an Accounts bounce", async () => {
  const banned = Object.assign(new Error("This account is currently banned."), {
    banned: true, reason: "Spam", expiresAt: 9_999_999_999,
  });
  const api = fakeApi({ redeem: banned });
  const win = navigatingWindow("?wt=" + TICKET);
  const seen = [];
  const stopped = await redeemReturnTicket(win, api, { onBanned: (error) => seen.push(error) });
  assert.equal(stopped, true, "the boot never mounts the router over a ban screen");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].reason, "Spam");
  assert.deepEqual(win.calls.replace, [], "no redirect on a ban");
  assert.deepEqual(win.calls.assign, []);
});

test("every other refusal stops into the static card — NO catch-all redirect (the audit fix)", async () => {
  for (const refusal of [new Error("That sign-in link has expired. Sign in again."), new Error("Request failed (0)")]) {
    const api = fakeApi({ redeem: refusal });
    const win = navigatingWindow("?wt=" + TICKET);
    const seen = [];
    const stopped = await redeemReturnTicket(win, api, { onRefused: (error) => seen.push(error) });
    assert.equal(stopped, true, JSON.stringify(refusal.message));
    assert.equal(seen.length, 1);
    // A burned ticket is fine, but the catch also swallows degraded legs
    // (relay down, dead network) where a redirect would ping-pong the open
    // against Accounts forever. No navigation out of a refusal.
    assert.deepEqual(win.calls.replace, [], "no location.replace out of the redeem catch");
    assert.deepEqual(win.calls.assign, [], "no location.assign out of the redeem catch");
  }
});

test("an unwired callbacks pair still returns true (the boot stops) without throwing", async () => {
  const api = fakeApi({ redeem: new Error("refused") });
  const win = navigatingWindow("?wt=" + TICKET);
  assert.equal(await redeemReturnTicket(win, api), true);
});

// --- source pins (node --test has no DOM) -------------------------------------------

test("boot redeems the ?wt ticket BEFORE the router mounts", () => {
  const redeemIndex = APP_SOURCE.indexOf("redeemReturnTicket(window, api");
  const routerIndex = APP_SOURCE.indexOf("state.router = startRouter");
  assert.ok(redeemIndex > 0, "the boot redemption exists");
  assert.ok(routerIndex > redeemIndex, "the router mounts only after the door settles");

  // The redeem stops the boot on a refusal (the cards); the guest session +
  // CSRF preflight rides the boot's api and the real csrf store.
  assert.match(APP_SOURCE, /onBanned: showBootBanScreen/);
  assert.match(APP_SOURCE, /onRefused: showBootSignInCard/);
  assert.match(APP_SOURCE, /setCsrfToken/);
});

test("the refusal cards: banned renders the existing ban screen, other refusals the static can't-sign-in card", () => {
  // The banned leg rides the §13 screen.
  assert.match(APP_SOURCE, /renderBannedScreen\(main, \{ reason: error\.reason, expiresAt: error\.expiresAt \}\)/);
  // The static card carries a MANUAL link to Accounts (a person chooses the
  // retry) — the card itself never navigates.
  assert.match(APP_SOURCE, /Can't sign in right now/);
  assert.match(APP_SOURCE, /Try again from Wempo Accounts/);
  assert.match(APP_SOURCE, /again\.href = wempoAccountsSignInUrl\(location\.origin\)/);

  // And sso.js — the door itself — has no auto navigation in its catch.
  const catchIndex = SSO_SOURCE.indexOf("} catch (error) {", SSO_SOURCE.indexOf("/api/auth/sso/redeem"));
  assert.ok(catchIndex > 0, "the redeem catch exists");
  const catchEnd = SSO_SOURCE.indexOf("} finally", catchIndex);
  const refusalCatch = SSO_SOURCE.slice(catchIndex, catchEnd);
  assert.doesNotMatch(refusalCatch, /location\.replace|location\.assign|location\.href\s*=/);
});

test("every auth surface targets Wempo Accounts: nav, door panel, guest gates — no password forms", () => {
  // The nav + mobile rung.
  assert.match(NAV_SOURCE, /signIn\.href = wempoAccountsSignInUrl\(location\.origin\)/);
  assert.match(NAV_SOURCE, /: wempoAccountsSignInUrl\(location\.origin\)/, "the mobile guest rung");
  // The home door panel.
  assert.match(AUTH_SOURCE, /Sign in with Wempo Accounts/);
  assert.match(AUTH_SOURCE, /button\.href = wempoAccountsSignInUrl\(location\.origin\)/);
  // The mine/bookmarks/notifications guest gates (the old /#join links).
  assert.equal(FEED_SOURCE.match(/signIn\.href = wempoAccountsSignInUrl\(location\.origin\)/g)?.length, 2);
  assert.match(NOTIFICATIONS_SOURCE, /signIn\.href = wempoAccountsSignInUrl\(location\.origin\)/);
  // No auth form posts login/register client-side anymore; setup stays.
  assert.doesNotMatch(AUTH_SOURCE, /\/api\/auth\/login|\/api\/auth\/register/);
  assert.doesNotMatch(AUTH_SOURCE, /renderTotpLoginStep|FORM_HANDLERS\.login/);
  // ...and twofa.js lost the login step with it.
  const twofaSource = read("public/js/routes/twofa.js");
  assert.doesNotMatch(twofaSource, /totp-login|api\/auth\/totp/);
});

test("log out clears the forum session, then rides the sign-out handoff (no return param)", () => {
  // The forum's own session clears first (logout POST + CSRF reset), THEN
  // the browser hands over.
  const logoutIndex = NAV_SOURCE.indexOf('await api("/api/auth/logout", { method: "POST" })');
  const handoffIndex = NAV_SOURCE.indexOf("window.location.assign(wempoAccountsSignOutUrl())");
  assert.ok(logoutIndex > 0 && handoffIndex > logoutIndex);
  // No navigate("/") before the handoff — the member is leaving the site.
  assert.doesNotMatch(NAV_SOURCE.slice(logoutIndex, handoffIndex), /router\.navigate/);
});

test("stale /login and /register paths degrade to the home door", () => {
  assert.deepEqual(routeForPath("/login"), { name: "home" });
  assert.deepEqual(routeForPath("/register"), { name: "home" });
  // A bare "#/login" hash rides pathname "/" — the home door — the fragment
  // itself never routes.
  assert.deepEqual(routeForPath("/", ""), { name: "home" });
});
