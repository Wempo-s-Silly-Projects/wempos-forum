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

// The §4b door-swap, client half: Wempo Accounts (the configured
// ACCOUNTS_ORIGIN) is the ONE sign-in surface for every Wempo site. The forum keeps its guest
// browsing, but every auth surface — the header's Sign in link, the home
// route's door panel, and the boot-level ?wt redemption — points at Accounts.
// A member site arrival carrying ?wt=<ticket> redeems the ticket HERE (on the
// forum's origin, where the shared session cookie lives) BEFORE the router
// mounts anything; a refused ticket settles into a card (the audit's fix —
// no catch-all redirect) whose Accounts link is manual. No password forms
// render anywhere client-side.
//
// Everything here is pure and DOM-free (win/api ride in as arguments), so
// node --test pins the behavior; app.js supplies the real api()/window at
// boot.

// The query-string parameter the Accounts worker redirects back with.
export const SSO_TICKET_PARAM = "wt";

// The exact Accounts origin every auth link targets. Self-hosting (v5.17.0):
// it is the instance's ACCOUNTS_ORIGIN, which the worker stamps into the HTML
// shell as <meta name="accounts-origin">; read per call (no DOM = none set).
export function wempoAccountsOrigin() {
  const meta = globalThis.document?.querySelector?.('meta[name="accounts-origin"]');
  return typeof meta?.content === "string" ? meta.content : "";
}

// wempoAccountsSignInUrl(origin) -> the Accounts sign-in handoff. The return
// parameter carries the EXACT ORIGIN and nothing more (no query string, no
// path): the Accounts side exact-match checks it, so this page can never
// widen what it sends.
export function wempoAccountsSignInUrl(origin) {
  return wempoAccountsOrigin() + "/?return=" + encodeURIComponent(origin || "");
}

// The sign-out handoff: the forum's logout clears its own session, then hands
// the browser here so the Accounts session clears too. NO return parameter,
// on purpose — with one, the Accounts arrival auto-issues a fresh ticket and
// bounces the member straight back signed in.
export function wempoAccountsSignOutUrl() {
  return wempoAccountsOrigin() + "/?signout=1";
}

// ssoTicketFromSearch(search) -> the ticket, or "". A 32-byte-hex one-time
// ticket ONLY — anything else (missing, wrong length, non-hex) is not a
// ticket and the door treats ?wt as absent. Uppercase hex normalizes
// (the redeem endpoint tolerates it either way); a malformed search never
// throws.
export function ssoTicketFromSearch(search) {
  let value;
  try {
    value = new URLSearchParams(search || "").get(SSO_TICKET_PARAM);
  } catch {
    return "";
  }
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : "";
}

// clearTicketParam(win) -> drop the ticket parameter from the address bar
// without touching the path or a hash fragment and without a history entry,
// so the one-time code can never be re-posted by a later render, a reload,
// or the back button. Returns whether anything was removed.
export function clearTicketParam(win) {
  const params = new URLSearchParams(win.location.search || "");
  if (!params.has(SSO_TICKET_PARAM)) return false;
  params.delete(SSO_TICKET_PARAM);
  const query = params.toString();
  win.history.replaceState(
    null,
    "",
    win.location.pathname + (query ? "?" + query : "") + win.location.hash,
  );
  return true;
}

export const SSO_REDEEM_TIMEOUT_MS = 15_000;

// redeemReturnTicket(win, api, { onBanned }) -> true when the boot must STOP
// (the browser was redirected to Accounts, or a banned redeem settled into
// the ban screen), false when boot should carry on (no ticket, already
// signed in, or the redemption succeeded). app.js calls this BEFORE
// startRouter so the ?wt handoff redeemes without any route render between.
//
// The order is load-bearing:
//   1. the parameter is cleared FIRST — a one-time code is spent exactly
//      once, and a re-render, reload, or back-button pop must never re-post
//      it,
//   2. a signed-in open never redeems: the redeem route requires a guest
//      session, and blindly POSTing a member's ?wt would only fail and
//      bounce a signed-in member to Accounts in a loop,
//   3. the redeem is the one-time POST,
//   4. a refusal is a burned/expired ticket — a fresh one comes from
//      Accounts, so the open bounces there. A ban, though, is the forum's
//      own §13 gate answering on the redeem: that member gets the ban
//      screen (reason + expiry + appeal form), not another Accounts
//      redirect, or a banned member would ping-pong forever.
export async function redeemReturnTicket(win, api, { onBanned, onRefused, setCsrfToken } = {}) {
  const ticket = ssoTicketFromSearch(win.location.search);
  clearTicketParam(win);
  if (!ticket) return false;
  // The redeem route rides a guest session + CSRF (requireCsrf), so a fresh
  // browser asks for the guest session FIRST — GET /api/session mints (or
  // reuses) it and answers the csrf token, which is stored so the redeem POST
  // carries X-CSRF-Token. Without this every redeem 401s. A failed probe
  // reads as "no known member" — the redeem itself then answers the truth,
  // and its own refusal path decides.
  let session = null;
  try {
    session = await api("/api/session");
  } catch { /* fall through to the redeem */ }
  if (setCsrfToken && session && typeof session.csrfToken === "string") {
    setCsrfToken(session.csrfToken);
  }
  if (session && session.user) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SSO_REDEEM_TIMEOUT_MS);
  try {
    await api("/api/auth/sso/redeem", {
      method: "POST",
      body: { wt: ticket },
      signal: controller.signal,
    });
    // Session minted on the forum (cookie set); boot mounts and the router's
    // first render reads the new session. Nothing else to do here.
    return false;
  } catch (error) {
    // NO catch-all redirect (the audit's fix): a refusal here can be burned,
    // timed out, or a dead network — bouncing the open to
    // Accounts on every one of those would loop members cross-origin until a
    // rate limiter parks them. Until the Accounts landing carries its own
    // auto-ticket gate, the refusal settles into a card rendered by the host
    // site (banned:true gets the ban screen via onBanned; everything else the
    // static can't-sign-in card via onRefused, whose Accounts link is manual
    // — a person, not a redirect loop, chooses the retry). Returning true
    // ALWAYS here stops the boot: the router must not mount over a refusal.
    if (error && error.banned === true) {
      if (onBanned) onBanned(error);
    } else if (onRefused) {
      onRefused(error);
    }
    return true;
  } finally {
    clearTimeout(timeout);
  }
}
