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

import { t } from "./i18n.js";
import { jumpToNode } from "./focus-utils.js";
import { createTourButton } from "./newcomer-tour.js";
// Newcomer cards (wave 2026-11-21-20): a one-time welcome card for accounts
// made in the last 7 days (three starter links and a nudge to say hi), then a
// short "new tricks" tips card for everyone signed in. One card shows at a
// time; "Got it" hides it for good and the next one (if any) takes its place.
// Dismissals live in this browser only, scoped per account like drafts.js,
// and are wiped on sign-out. Nothing is sent to the server; nothing tracks.

export const NEWCOMER_STORAGE_KEY = "forum-newcomer-dismissed";
export const NEWCOMER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const WELCOME_CARD = "welcome";
// A new tip set gets a new id, so the card comes back once for everyone.
export const TIPS_CARD = "tips-2026-11-21";

export const newcomerKey = (accountId) => NEWCOMER_STORAGE_KEY + ":u" + accountId;

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function readDismissed(storage, accountId) {
  try {
    const raw = storage ? storage.getItem(newcomerKey(accountId)) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Returns a NEW map with the card stamped dismissed, and stores it.
export function dismissCard(storage, accountId, cardId, now = Date.now()) {
  const next = { ...readDismissed(storage, accountId), [cardId]: now };
  try {
    storage?.setItem(newcomerKey(accountId), JSON.stringify(next));
  } catch {
    // Quota or blocked storage: the card just comes back next visit.
  }
  return next;
}

// Sign-out wipe: every account's dismissals go, other keys stay.
export function clearAllNewcomer(storage = browserStorage()) {
  try {
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(NEWCOMER_STORAGE_KEY + ":")) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Blocked storage: nothing was stored to wipe.
  }
}

// True when the account was made less than 7 days ago. A missing or broken
// date counts as not new (no welcome rather than a wrong one).
export function isNewAccount(joinedAt, now = Date.now()) {
  const joined = Date.parse(joinedAt ?? "");
  return Number.isFinite(joined) && now - joined < NEWCOMER_WINDOW_MS;
}

// The cards still to show this member, in order.
export function pendingCards(user, dismissed, now = Date.now()) {
  if (!user || !Number.isFinite(Number(user.id))) return [];
  const seen = isPlainObject(dismissed) ? dismissed : {};
  const cards = [];
  if (isNewAccount(user.joinedAt, now) && !(WELCOME_CARD in seen)) cards.push(WELCOME_CARD);
  if (!(TIPS_CARD in seen)) cards.push(TIPS_CARD);
  return cards;
}

const STARTER_LINKS = [
  ["/c/general", "newcomer.linkGeneral"],
  ["/c/showcase", "newcomer.linkShowcase"],
  ["/rules", "newcomer.linkRules"],
];
const TIP_KEYS = ["newcomer.tipSpoilers", "newcomer.tipShortcut", "newcomer.tipPostKeys", "newcomer.tipPinnedChats"];

const textNode = (document, tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};

function welcomeBody(document, user) {
  const list = document.createElement("ul");
  list.className = "newcomer-links";
  for (const [href, key] of STARTER_LINKS) {
    const item = document.createElement("li");
    const link = textNode(document, "a", "newcomer-link", t(key));
    link.href = href;
    link.setAttribute("data-app-link", "");
    item.append(link);
    list.append(item);
  }
  // Invite links (v5.34): the server names the inviter only while they are
  // unbanned and not block-paired (GET /api/session user.invitedBy).
  const invitedBy = typeof user.invitedBy === "string" && user.invitedBy ? user.invitedBy : "";
  return {
    title: t("newcomer.welcomeTitle", { name: user.username }),
    nodes: [
      ...(invitedBy ? [textNode(document, "p", "newcomer-invited", t("invite.invitedBy", { name: invitedBy }))] : []),
      textNode(document, "p", "newcomer-copy", t("newcomer.welcomeBody")),
      list,
      // L2 wave: the one guided tour lives here (newcomer-tour.js, Driver.js).
      createTourButton(document),
      textNode(document, "p", "newcomer-nudge", t("newcomer.sayHi")),
    ],
    dismissLabel: t("newcomer.hideWelcome"),
  };
}

function tipsBody(document) {
  const list = document.createElement("ul");
  list.className = "newcomer-tips";
  for (const key of TIP_KEYS) list.append(textNode(document, "li", "", t(key)));
  return {
    title: t("newcomer.tipsTitle"),
    nodes: [textNode(document, "p", "newcomer-copy", t("newcomer.tipsBody")), list],
    dismissLabel: t("newcomer.hideTips"),
  };
}

// One card: a labelled region with its heading, body and a "Got it" button.
export function createNewcomerCard(document, cardId, user, onDismiss) {
  const spec = cardId === WELCOME_CARD ? welcomeBody(document, user) : tipsBody(document);
  const card = document.createElement("section");
  card.className = "newcomer-card";
  card.dataset.card = cardId;
  const heading = textNode(document, "h2", "newcomer-title", spec.title);
  heading.id = "newcomer-title-" + cardId;
  heading.setAttribute("tabindex", "-1");
  card.setAttribute("aria-labelledby", heading.id);
  const dismiss = textNode(document, "button", "button button-secondary newcomer-dismiss", t("newcomer.gotIt"));
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", spec.dismissLabel);
  dismiss.addEventListener("click", () => onDismiss(cardId));
  card.append(heading, ...spec.nodes, dismiss);
  return card;
}

// Mounts the first pending card into `slot`. Dismissing it records the choice
// and swaps in the next card with focus on its heading; after the last one a
// short status line keeps focus off <body> and tells screen readers it's done.
export function renderNewcomerCards(document, slot, user, { storage = browserStorage(), now = Date.now() } = {}) {
  if (!slot || !user) return;
  const mount = (cardId, moveFocus) => {
    const card = createNewcomerCard(document, cardId, user, (dismissedId) => {
      const next = pendingCards(user, dismissCard(storage, user.id, dismissedId, now), now);
      if (next.length) {
        mount(next[0], true);
        return;
      }
      const done = textNode(document, "p", "newcomer-done", t("newcomer.allSet"));
      done.setAttribute("role", "status");
      slot.replaceChildren(done);
      jumpToNode(done, { block: "nearest" });
    });
    slot.replaceChildren(card);
    if (moveFocus) jumpToNode(card.querySelector(".newcomer-title"), { block: "nearest" });
  };
  const first = pendingCards(user, readDismissed(storage, user.id), now)[0];
  if (first) mount(first, false);
}
