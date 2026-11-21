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

// Thread-author chip (wave 2026-11-21-7 F2): on a thread page, replies written
// by the member who started the thread carry a small "Author" chip next to the
// name, so a reader can follow the original poster's answers at a glance.
// Client-only: built from the author ids the post payload already carries.
import { t } from "./i18n.js";

const CHIP_CLASS = "role-badge-op";

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// The root post's author id, or null for a removed account.
export function threadStarterId(post) {
  return post?.author ? positiveId(post.author.id) : null;
}

export function isThreadStarterReply(reply, starterId) {
  const starter = positiveId(starterId);
  if (!starter || !reply?.parent || !reply.author) return false;
  return positiveId(reply.author.id) === starter;
}

function createChip(document) {
  const chip = document.createElement("span");
  chip.className = "role-badge " + CHIP_CLASS;
  chip.textContent = t("render.threadAuthor");
  chip.setAttribute("title", t("render.threadAuthorTitle"));
  return chip;
}

function hasChip(row) {
  if (typeof row.querySelector === "function") return Boolean(row.querySelector("." + CHIP_CLASS));
  return Array.from(row.children ?? []).some((child) => child.className?.split?.(" ").includes(CHIP_CLASS));
}

// Appends the chip to each starter reply's author row inside `container`.
// Idempotent: a row that already carries the chip is left alone.
export function markThreadStarterReplies(document, container, replies, starterId) {
  if (!container || typeof container.querySelector !== "function") return;
  for (const reply of replies ?? []) {
    if (!isThreadStarterReply(reply, starterId)) continue;
    const id = positiveId(reply.id);
    if (!id) continue;
    const row = container.querySelector(`article[data-post-id="${id}"] .post-author`);
    if (row && !hasChip(row)) row.append(createChip(document));
  }
}
