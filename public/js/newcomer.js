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
import { offSiteModules } from "./site-modules.js";
// Newcomer cards (wave 2026-11-21-20): a one-time welcome card for accounts
// made in the last 7 days (three starter links and a nudge to say hi), then a
// short "new tricks" tips card for everyone signed in. One card shows at a
// time; "Got it" hides it for good and the next one (if any) takes its place.
// Dismissals live in this browser only, scoped per account like drafts.js,
// and are wiped on sign-out. Nothing is sent to the server; nothing tracks.
//
// v5.96.0 Part D: the first-week onboarding cards. Each account day (0, 1,
// 3, 5, 8) has one card, shown only while the data the server already sends
// (GET /api/session user.onboarding: own post count, default profile, the
// pinned Start-here thread) says it still fits. At most one card a day, the
// tips card included: once one is dismissed, the next waits for tomorrow.
// Settings -> Notifications turns them off (stored in the same dismiss map).

export const NEWCOMER_STORAGE_KEY = "forum-newcomer-dismissed";
export const NEWCOMER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const WELCOME_CARD = "welcome";
// A new tip set gets a new id, so the card comes back once for everyone.
export const TIPS_CARD = "tips-2026-11-21";

export const newcomerKey = (accountId) => NEWCOMER_STORAGE_KEY + ":u" + accountId;

// The dismiss-map entry that turns the onboarding cards off (Settings).
export const ONBOARDING_OFF = "onboarding-off";
// Account days 0..8 inclusive.
export const ONBOARDING_DAYS = 9;
const DAY_MS = 24 * 60 * 60 * 1000;
// Each card owns the account days [from, until); `when` reads the session's
// onboarding facts and never guesses (a missing fact skips the card).
export const ONBOARDING_CARDS = Object.freeze([
  Object.freeze({ id: WELCOME_CARD, from: 0, until: 1, when: () => true }),
  Object.freeze({ id: "onboard-say-hi", from: 1, until: 3, when: (facts) => facts.postCount === 0 }),
  Object.freeze({ id: "onboard-profile", from: 3, until: 5, when: (facts) => facts.profileDefault === true }),
  Object.freeze({ id: "onboard-stuck", from: 5, until: 8, when: (facts) => facts.postCount === 0 }),
  Object.freeze({ id: "onboard-things", from: 8, until: ONBOARDING_DAYS, when: () => true }),
]);

// The account day `at` falls on (0 = the day they joined; negative before
// it), or null.
export function accountDay(joinedAt, at) {
  const joined = Date.parse(joinedAt ?? "");
  if (!Number.isFinite(joined) || !Number.isFinite(at)) return null;
  return Math.floor((at - joined) / DAY_MS);
}

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

// The card to show this member now (at most one), as a list.
export function pendingCards(user, dismissed, now = Date.now()) {
  if (!user || !Number.isFinite(Number(user.id))) return [];
  const seen = isPlainObject(dismissed) ? dismissed : {};
  const tips = TIPS_CARD in seen ? [] : [TIPS_CARD];
  const rawDay = accountDay(user.joinedAt, now);
  if (rawDay === null || rawDay >= ONBOARDING_DAYS) return tips;
  // A clock a little behind the server's join stamp still counts as day 0.
  const day = Math.max(0, rawDay);
  const dismissedToday = Object.entries(seen)
    .some(([id, at]) => id !== ONBOARDING_OFF && accountDay(user.joinedAt, Number(at)) === day);
  if (dismissedToday) return [];
  const facts = isPlainObject(user.onboarding) ? user.onboarding : {};
  const today = ONBOARDING_OFF in seen ? null
    : ONBOARDING_CARDS.find((card) => day >= card.from && day < card.until);
  if (today && !(today.id in seen) && today.when(facts)) return [today.id];
  return tips;
}

// Settings -> Notifications: on unless the member turned the cards off.
export function onboardingEnabled(storage, accountId) {
  return !(ONBOARDING_OFF in readDismissed(storage, accountId));
}

// Returns a NEW map with the switch applied, and stores it.
export function setOnboardingEnabled(storage, accountId, enabled, now = Date.now()) {
  const rest = Object.fromEntries(Object.entries(readDismissed(storage, accountId))
    .filter(([id]) => id !== ONBOARDING_OFF));
  const next = enabled ? rest : { ...rest, [ONBOARDING_OFF]: now };
  try {
    storage?.setItem(newcomerKey(accountId), JSON.stringify(next));
  } catch {
    // Blocked storage: the switch lasts for this page only.
  }
  return next;
}

export function createOnboardingPanel(document, user, { storage = browserStorage() } = {}) {
  const panel = document.createElement("section");
  panel.className = "panel onboarding-panel";
  const heading = textNode(document, "h2", "", t("newcomer.onboardSettingTitle"));
  const label = document.createElement("label");
  label.className = "notification-pref";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = onboardingEnabled(storage, user.id);
  box.addEventListener("change", () => setOnboardingEnabled(storage, user.id, box.checked));
  label.append(box, document.createTextNode(" " + t("newcomer.onboardSettingLabel")));
  panel.append(heading, label);
  return panel;
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

const linkItem = (document, href, text) => {
  const item = document.createElement("li");
  const link = textNode(document, "a", "newcomer-link", text);
  link.href = href;
  link.setAttribute("data-app-link", "");
  item.append(link);
  return item;
};

// Day 0's first link: the pinned Start-here thread when the server found one
// the member may see, else General.
function starterLinks(user) {
  const startHere = Number(user.onboarding?.startHereId);
  return Number.isSafeInteger(startHere) && startHere > 0
    ? [["/posts/" + startHere, "newcomer.onboardStartHere"], ...STARTER_LINKS.slice(1)]
    : STARTER_LINKS;
}

function welcomeBody(document, user) {
  const list = document.createElement("ul");
  list.className = "newcomer-links";
  for (const [href, key] of starterLinks(user)) {
    list.append(linkItem(document, href, t(key)));
  }
  // Invite links (v5.34): the server names the inviter only while they are
  // unbanned and not block-paired (GET /api/session user.invitedBy).
  const invitedBy = typeof user.invitedBy === "string" && user.invitedBy ? user.invitedBy : "";
  return {
    title: t("newcomer.onboardWelcomeTitle"),
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

// Days 1, 3 and 5: a line of copy and one link.
const ONE_LINK_CARDS = Object.freeze({
  "onboard-say-hi": () => ["newcomer.onboardSayHiTitle", "newcomer.onboardSayHiBody",
    "/c/general", t("newcomer.linkGeneral")],
  "onboard-profile": (user) => ["newcomer.onboardProfileTitle", "newcomer.onboardProfileBody",
    "/users/" + encodeURIComponent(user.username ?? ""), t("newcomer.onboardProfileLink")],
  "onboard-stuck": () => ["newcomer.onboardStuckTitle", "newcomer.onboardStuckBody", "/c/help", t("boards.helpLabel")],
});

function oneLinkBody(document, cardId, user) {
  const [titleKey, bodyKey, href, linkText] = ONE_LINK_CARDS[cardId](user);
  const list = document.createElement("ul");
  list.className = "newcomer-links";
  list.append(linkItem(document, href, linkText));
  return {
    title: t(titleKey),
    nodes: [textNode(document, "p", "newcomer-copy", t(bodyKey)), list],
    dismissLabel: t("newcomer.hideOnboard"),
  };
}

// Day 8: the Question of the Day, polls and the chat lobby (each module only
// while it is on for this forum).
function thingsBody(document, modulesOff) {
  const list = document.createElement("ul");
  list.className = "newcomer-tips";
  list.append(textNode(document, "li", "", t("newcomer.onboardThingsQotd")));
  if (!modulesOff.has("polls")) list.append(linkItem(document, "/c/polls", t("newcomer.onboardThingsPolls")));
  if (!modulesOff.has("chat")) {
    const item = document.createElement("li");
    const chat = textNode(document, "button", "button button-quiet newcomer-chat", t("newcomer.onboardThingsChat"));
    chat.type = "button";
    chat.addEventListener("click", () => document.querySelector(".chat-widget-launcher")?.click());
    item.append(chat);
    list.append(item);
  }
  return { title: t("newcomer.onboardThingsTitle"), nodes: [list], dismissLabel: t("newcomer.hideOnboard") };
}

function cardSpec(document, cardId, user, modulesOff) {
  if (cardId === WELCOME_CARD) return welcomeBody(document, user);
  if (cardId in ONE_LINK_CARDS) return oneLinkBody(document, cardId, user);
  if (cardId === "onboard-things") return thingsBody(document, modulesOff);
  return tipsBody(document);
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
// The first onboarding card a member sees (whichever day that is) says how
// to turn the cards off; it names the real Settings and Notifications labels.
const offHint = (document) => textNode(document, "p", "newcomer-off-hint muted", t("newcomer.onboardOffHint", {
  settings: t("common.settings"), notifications: t("settingsGroups.notifications"),
}));
const isOnboardingCard = (cardId) => ONBOARDING_CARDS.some((card) => card.id === cardId);
const sawOnboarding = (dismissed) => ONBOARDING_CARDS.some((card) => card.id in dismissed);

export function createNewcomerCard(document, cardId, user, onDismiss, { modulesOff = new Set(), dismissed = {} } = {}) {
  const spec = cardSpec(document, cardId, user, modulesOff);
  const hint = isOnboardingCard(cardId) && !sawOnboarding(dismissed) ? [offHint(document)] : [];
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
  card.append(heading, ...spec.nodes, ...hint, dismiss);
  return card;
}

// Mounts the first pending card into `slot`. Dismissing it records the choice
// and swaps in the next card with focus on its heading; after the last one a
// short status line keeps focus off <body> and tells screen readers it's done.
export function renderNewcomerCards(document, slot, user, {
  storage = browserStorage(), now = Date.now(), modulesOff = offSiteModules(document),
} = {}) {
  if (!slot || !user) return;
  const mount = (cardId, moveFocus, dismissed) => {
    const card = createNewcomerCard(document, cardId, user, (dismissedId) => {
      const nowDismissed = dismissCard(storage, user.id, dismissedId, now);
      const next = pendingCards(user, nowDismissed, now);
      if (next.length) {
        mount(next[0], true, nowDismissed);
        return;
      }
      const done = textNode(document, "p", "newcomer-done", t("newcomer.allSet"));
      done.setAttribute("role", "status");
      slot.replaceChildren(done);
      jumpToNode(done, { block: "nearest" });
    }, { modulesOff, dismissed });
    slot.replaceChildren(card);
    if (moveFocus) jumpToNode(card.querySelector(".newcomer-title"), { block: "nearest" });
  };
  const dismissed = readDismissed(storage, user.id);
  const first = pendingCards(user, dismissed, now)[0];
  if (first) mount(first, false, dismissed);
}
