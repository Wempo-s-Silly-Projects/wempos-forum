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

// Staff thread lock (v5.51): the thread page's "This thread is locked" note,
// the staff-only reason line, the composer gate and the reply-control strip
// for members. Builders only (createElement/textContent); the Lock/Unlock
// buttons live in render.js's staff menu and their actions in
// routes/admin.js. The server enforces the lock — this is display.
import { t } from "./i18n.js";

const isStaff = (viewer) => viewer?.role === "owner" || viewer?.role === "admin";
const REPLY_CONTROL_ACTIONS = new Set(["reply-to", "quote"]);

const positiveId = (value) => {
  const id = Number(value);
  if (typeof value === "string" ? !/^[1-9][0-9]{0,14}$/.test(value) : !Number.isSafeInteger(id) || id < 1) {
    throw new RangeError("bad id");
  }
  return id;
};

export const threadLockPath = (postId) => `/api/admin/threads/${positiveId(postId)}/lock`;

export function createThreadLockNote(document, locked) {
  if (locked !== true) return null;
  const note = document.createElement("p");
  note.className = "thread-lock-note";
  note.setAttribute("role", "status");
  note.textContent = t("threadLock.note");
  return note;
}

// Staff only (the caller checks the role; the reason comes from the desk GET).
export function createThreadLockReason(document, reason) {
  if (typeof reason !== "string" || !reason) return null;
  const line = document.createElement("p");
  line.className = "thread-lock-reason";
  line.textContent = t("threadLock.reason", { reason });
  return line;
}

// The root reply composer: signed in, a public root, and open — or staff.
export function canReplyToThread(post, viewer) {
  if (!viewer || post.visibility === "hidden" || post.parent) return false;
  return post.locked !== true || isStaff(viewer);
}

// Removes the per-card Reply and Quote buttons (a locked thread, non-staff).
// Spreads the NodeList first so removal never skips a sibling.
export function stripReplyControls(container) {
  const doomed = [...container.querySelectorAll("button")]
    .filter((button) => REPLY_CONTROL_ACTIONS.has(button.dataset.action));
  for (const button of doomed) button.remove();
  return doomed.length;
}
