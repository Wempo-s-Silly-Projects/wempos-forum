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

// Wave 2026-11-21-13: two profile delights. "Member since" formats the
// account's join date in the reader's own language (Intl, no strings to
// translate beyond the label). Recent threads lists a member's newest public
// threads as plain links; excerpts mask spoilers BEFORE they are cut, so a
// spoiler can never leak through a truncated, unclosed "||". DOM-pure: the
// caller passes the document and does the fetch.
import { DEFAULT_LOCALE, t } from "./i18n.js";
import { maskSpoilers } from "./markdown.js";
import { createInput, createSelect } from "./forms.js";

export const THREAD_EXCERPT_MAX = 120;
const ELLIPSIS = "…";

const safeLocale = (locale) => {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
};

export function formatJoinedDate(iso, locale = DEFAULT_LOCALE) {
  if (iso === null || iso === undefined || iso === "") return "";
  const when = new Date(iso);
  if (!Number.isFinite(when.getTime())) return "";
  return new Intl.DateTimeFormat(safeLocale(locale), { year: "numeric", month: "long", day: "numeric" })
    .format(when);
}

export function threadExcerpt(body) {
  const flat = maskSpoilers(body).replace(/\s+/g, " ").trim();
  return flat.length > THREAD_EXCERPT_MAX ? flat.slice(0, THREAD_EXCERPT_MAX) + ELLIPSIS : flat;
}

// v5.38.0: in-app thread links are built with the URL API (the id is forced
// numeric first), never by gluing untrusted text into an href.
const LINK_BASE = "https://wempos-forum.invalid";
export const threadPath = (id) => new URL("/posts/" + Number(id), LINK_BASE).pathname;

// v5.38.0 F1: on your own profile each recent thread (except the one already
// pinned) offers "Pin to profile"; options = { own, pinnedId }.
export function createRecentThreads(document, threads, locale = DEFAULT_LOCALE, options = {}) {
  const list = document.createElement("ul");
  list.className = "recent-threads";
  if (!threads.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = t("profile.threadsEmpty");
    list.append(empty);
    return list;
  }
  for (const thread of threads) {
    const item = document.createElement("li");
    item.className = "recent-thread";
    const link = document.createElement("a");
    link.className = "recent-thread-link";
    link.href = threadPath(thread.id);
    link.setAttribute("data-app-link", "");
    link.textContent = threadExcerpt(thread.body) || t("profile.threadUntitled");
    const when = document.createElement("time");
    when.className = "recent-thread-time";
    when.dateTime = thread.createdAt;
    when.textContent = formatJoinedDate(thread.createdAt, locale);
    item.append(link, when);
    if (options.own && Number(thread.id) !== Number(options.pinnedId)) {
      const pin = actionButton(document, "profile-pin", "button button-quiet recent-thread-pin", t("profile.pinThread"));
      pin.dataset.postId = String(Number(thread.id));
      item.append(pin);
    }
    list.append(item);
  }
  return list;
}

// v5.23.0 F2: optional pronouns next to the profile name. textContent only
// (the server already limits the characters); null when none are set, so the
// header paints nothing for the default opt-out.
export function createPronouns(document, pronouns) {
  if (typeof pronouns !== "string" || pronouns === "") return null;
  const span = document.createElement("span");
  span.className = "profile-pronouns";
  span.textContent = pronouns;
  return span;
}

function actionButton(document, action, className, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.action = action;
  button.textContent = label;
  return button;
}

// v5.38.0 F2: the custom status under the profile name — emoji and text via
// textContent only; null when the payload carries none (unset, expired,
// banned or filtered out server-side).
export function createStatusLine(document, status) {
  if (!status || (!status.text && !status.emoji)) return null;
  const line = document.createElement("p");
  line.className = "profile-status";
  if (status.emoji) {
    const emoji = document.createElement("span");
    emoji.className = "profile-status-emoji";
    emoji.setAttribute("aria-hidden", "true");
    emoji.textContent = status.emoji;
    line.append(emoji);
  }
  if (status.text) {
    const text = document.createElement("span");
    text.className = "profile-status-text";
    text.textContent = status.text;
    line.append(text);
  }
  return line;
}

// v5.38.0 F1: the pinned thread on top of the profile. options.own adds Unpin.
export function createPinnedThread(document, thread, locale = DEFAULT_LOCALE, options = {}) {
  if (!thread || !Number.isSafeInteger(Number(thread.id))) return null;
  const box = document.createElement("div");
  box.className = "pinned-thread";
  const label = document.createElement("p");
  label.className = "pinned-thread-label";
  label.textContent = t("profile.pinnedTitle");
  const link = document.createElement("a");
  link.className = "pinned-thread-link";
  link.href = threadPath(thread.id);
  link.setAttribute("data-app-link", "");
  link.textContent = threadExcerpt(thread.body) || t("profile.threadUntitled");
  const when = document.createElement("time");
  when.className = "recent-thread-time";
  when.dateTime = thread.createdAt;
  when.textContent = formatJoinedDate(thread.createdAt, locale);
  box.append(label, link, when);
  if (options.own) box.append(actionButton(document, "profile-unpin", "button button-quiet pinned-thread-unpin", t("profile.unpinThread")));
  return box;
}

export const STATUS_EXPIRY_CHOICES = ["never", "1h", "4h", "today", "week"];
const EXPIRY_LABEL_KEYS = {
  never: "status.expiryNever", "1h": "status.expiryHour", "4h": "status.expiryFourHours",
  today: "status.expiryToday", week: "status.expiryWeek",
};

// v5.38.0 F2: the own-profile status form (data-form="profile-status").
export function createStatusForm(document, status) {
  const form = document.createElement("form");
  form.className = "profile-status-form";
  form.dataset.form = "profile-status";
  form.append(
    createInput(document, { id: "status-emoji", name: "statusEmoji", label: t("status.emojiLabel"), maxLength: 16,
      value: typeof status?.emoji === "string" ? status.emoji : "" }),
    createInput(document, { id: "status-text", name: "statusText", label: t("status.textLabel"), maxLength: 60,
      value: typeof status?.text === "string" ? status.text : "" }),
    createSelect(document, { id: "status-expiry", name: "statusExpiry", label: t("status.expiryLabel"),
      options: STATUS_EXPIRY_CHOICES.map((value) => ({ value, label: t(EXPIRY_LABEL_KEYS[value]) })) }),
  );
  const actions = document.createElement("div");
  actions.className = "form-actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "button button-primary";
  save.textContent = t("status.save");
  actions.append(save);
  if (status) actions.append(actionButton(document, "profile-status-clear", "button button-quiet status-clear", t("status.clear")));
  form.append(actions);
  return form;
}
