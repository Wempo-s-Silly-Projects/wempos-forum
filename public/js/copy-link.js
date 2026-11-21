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


// Copy link (wave 2026-11-21-4 F2): a quiet icon button on every post and
// reply card that copies the card's absolute /posts/<id> link, so sharing a
// reply with a friend is one click. Client-only: nothing is sent anywhere,
// and the result is announced in a polite status mounted beside the button.
import { t } from "./i18n.js";
import { createIcon } from "./icons.js";

export const COPIED_STATUS_MS = 2000;
const POST_ID_PATTERN = /^[0-9]{1,15}$/;

// The absolute permalink, or null when the id is not a plain positive number.
export function postPermalink(origin, postId) {
  const id = String(postId ?? "");
  if (!POST_ID_PATTERN.test(id)) return null;
  return String(origin ?? "") + "/posts/" + id;
}

const defaultClipboard = () => globalThis.navigator?.clipboard ?? null;
const defaultOrigin = () => globalThis.location?.origin ?? "";

// The status lives BESIDE the labelled button (a button's children are
// presentational) and is mounted empty, so screen readers announce the change.
function showStatus(button, status, copied, schedule) {
  button.dataset.copied = String(copied);
  status.textContent = copied ? t("render.linkCopied") : t("render.copyLinkFailed");
  schedule(() => {
    status.textContent = "";
  }, COPIED_STATUS_MS);
}

// Returns a wrapper: the icon button plus its polite status.
export function createCopyLinkButton(document, postId, {
  origin = defaultOrigin(),
  clipboard = defaultClipboard(),
  schedule = setTimeout,
} = {}) {
  const wrap = document.createElement("span");
  wrap.className = "copy-link-wrap";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-quiet icon-button copy-link";
  const label = t("render.copyLink");
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.append(createIcon(document, "link"));
  const status = document.createElement("span");
  status.className = "copy-link-status";
  status.setAttribute("role", "status");
  wrap.append(button, status);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    const link = postPermalink(origin, postId);
    let copied = false;
    try {
      if (link && clipboard && typeof clipboard.writeText === "function") {
        await clipboard.writeText(link);
        copied = true;
      }
    } catch {
      // Permission refused or no secure context: the failure status says so.
      copied = false;
    }
    showStatus(button, status, copied, schedule);
  });
  return wrap;
}
