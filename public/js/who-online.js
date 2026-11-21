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

// Who's Online roster: its OWN surface, not inside the chat widget — a
// compact card anchored bottom-left, listing who GET /api/presence currently
// reports (the server already excludes invisible and stale members; invisible
// mode is never exposed here). It renders for signed-OUT visitors too — the
// roster is a light public surface — and hides completely on a failed read.
// The presence BEACON belongs to this module alone (the chat widget must not
// double-send it): when a signed-in session exists, one POST /api/presence on
// boot and every 60s after, sleeping while document.hidden.
import { api, setCsrfToken } from "./api.js";
import { i18nReady, t } from "./i18n.js";
import { paintRosterGroups } from "./who-online-groups.js";

const ROSTER_REFRESH_MS = 60_000;
const BEACON_INTERVAL_MS = 60_000;
const ROSTER_NAME_MAX = 12;

let card = null;
let listEl = null;
let countEl = null;
let beaconOn = false;

const el = (tagName, className, text) => {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const profileHref = (username) => `/users/${encodeURIComponent(username)}`;

// Session knowledge rides one light probe: the response's user decides beacon
// eligibility, and the probe's CSRF token feeds the shared api() state (the
// same module instance app.js boot fills — whoever lands first wins, the
// token is identical either way).
const probeSession = async () => {
  try {
    const session = await api("/api/session");
    if (typeof session?.csrfToken === "string" && session.csrfToken) {
      setCsrfToken(session.csrfToken);
    }
    return Boolean(session?.user);
  } catch {
    return false;
  }
};

const paintRoster = (online) => {
  if (!card || !listEl || !countEl) return;
  // Wave 36: grouped by role (Staff, Members) with a count on each heading.
  paintRosterGroups(document, listEl, online, ROSTER_NAME_MAX, profileHref);
  countEl.textContent = String(online.length);
  card.hidden = false;
};

const refreshRoster = async () => {
  if (document.hidden) return;
  try {
    const data = await api("/api/presence");
    if (!card) mount();
    paintRoster(Array.isArray(data?.online) ? data.online : []);
  } catch {
    hideRoster();
  }
};

const mount = () => {
  if (card) return;
  card = el("aside", "who-online");
  card.hidden = true;
  const heading = el("h2", "who-online-heading", t("online.heading"));
  countEl = el("span", "who-online-count", "");
  heading.append(countEl);
  listEl = el("div", "who-online-list");
  card.append(heading, el("p", "who-online-note", t("online.note")), listEl);
  document.body.append(card);
};

const hideRoster = () => {
  if (card) card.hidden = true;
};

const boot = async () => {
  if (document.querySelector(".who-online")) return;
  await i18nReady();
  const signedIn = await probeSession();
  await refreshRoster();
  setInterval(() => refreshRoster().catch(() => { /* the card keeps its last paint */ }), ROSTER_REFRESH_MS);
  if (!signedIn) return;
  beaconOn = true;
  const beacon = () => {
    if (document.hidden) return;
    api("/api/presence", { method: "POST", body: {} }).catch(() => { /* the next tick re-acks */ });
  };
  await beacon();
  setInterval(beacon, BEACON_INTERVAL_MS);
};

await boot();

export { boot as initWhoOnline };
