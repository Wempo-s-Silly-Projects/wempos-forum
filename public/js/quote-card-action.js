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

// Batch O: the "Quote card" action on post/reply cards and lobby messages.
// Small and eager (render.js and the chat lobby seat it); the drawing code in
// quote-card.js loads only when a reader actually presses the button. The
// action appears only on content the reader can already see AND that the
// public can see: never on hidden posts, posts by a removed account, or a
// staff view of someone else's post (staff can see banned or blocked
// authors' content that others cannot, so the card could leak it).
import { t } from "./i18n.js";

const STAFF_ROLES = Object.freeze(["owner", "admin"]);
const GIF_ONLY = /^\[gif:[0-9a-f-]{36}\]$/;

export function canQuoteCard(item, viewer) {
  const author = item?.author;
  if (!author || typeof author.username !== "string" || author.username === "") return false;
  if (item.visibility !== undefined && item.visibility !== "public") return false;
  const body = String(item.body ?? "").trim();
  if (body === "" || GIF_ONLY.test(body)) return false;
  const staffViewer = Boolean(viewer && STAFF_ROLES.includes(viewer.role));
  return !staffViewer || Number(viewer.id) === Number(author.id);
}

// The card's own copy of what it needs, taken when the button is built so a
// later edit or re-render cannot change what was offered.
const snapshotOf = (item) => Object.freeze({
  body: String(item.body ?? ""),
  username: item.author.username,
  displayName: item.author.displayName || item.author.username,
  avatarUrl: item.author.avatarUrl ?? null,
});

const loadQuoteCard = () => import("./quote-card.js");

export function createQuoteCardButton(document, item, viewer, { load = loadQuoteCard } = {}) {
  if (!canQuoteCard(item, viewer)) return null;
  const snapshot = snapshotOf(item);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-quiet quote-card-action";
  button.textContent = t("quotecard.action");
  button.setAttribute("aria-label", t("quotecard.actionLabel", { name: snapshot.username }));
  button.addEventListener("click", () => {
    button.disabled = true;
    load()
      .then((module) => module.openQuoteCardDialog(document, { ...snapshot }, { opener: button }))
      .catch(() => { /* the module failed to load; the button stays usable for a retry */ })
      .finally(() => { button.disabled = false; });
  });
  return button;
}
