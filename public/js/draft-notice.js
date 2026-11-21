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

import { t, currentLocale } from "./i18n.js";
import { formatRelative } from "./reltime.js";
import { clearDraft } from "./drafts.js";

// Wave 31: a composer that restored an unsent draft says so — "Restored your
// unsent draft (saved 5m ago)." — with a Discard draft button. Discard asks
// first, then empties the box and removes that one stored draft; autosave
// stays armed so new typing saves as before. Local-only: it reads the
// existing draft key on the form and makes no request.

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const askDiscard = () =>
  (typeof globalThis.confirm === "function" ? globalThis.confirm(t("drafts.discardConfirm")) : true);

function savedWhen(savedAt) {
  const relative = formatRelative(savedAt, { locale: currentLocale() });
  return relative || new Date(savedAt).toLocaleString(currentLocale());
}

export function createDraftNotice(document, {
  form, textarea, savedAt, storage = browserStorage(), confirmDiscard = askDiscard,
}) {
  const notice = document.createElement("div");
  notice.className = "draft-notice";
  const text = document.createElement("span");
  text.className = "draft-notice-text";
  text.textContent = t("drafts.restored", { when: savedWhen(savedAt) });
  const discard = document.createElement("button");
  discard.type = "button";
  discard.className = "button button-quiet draft-notice-discard";
  discard.textContent = t("drafts.discard");
  discard.addEventListener("click", () => {
    if (!confirmDiscard()) return;
    const key = form?.dataset?.draftKey;
    if (key) clearDraft(storage, key);
    textarea.value = "";
    textarea.dispatchEvent?.(new Event("input", { bubbles: true }));
    notice.hidden = true;
    textarea.focus();
  });
  notice.append(text, discard);
  return notice;
}
