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

// @mention picker, on first use (v5.84 load order). Composers call this
// instead of mention-picker.js directly: the picker (and the vendored
// fuzzysort it ranks with) is imported the first time the field gets focus,
// which is always before anyone can type an "@" into it, and the real
// attachMentionPicker then wires the field exactly as before.

let loading = null;

export function loadMentionPicker(importPicker = () => import("./mention-picker.js")) {
  if (!loading) {
    loading = importPicker();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

export function attachMentionPicker(textarea, document, load = () => loadMentionPicker()) {
  if (!textarea || !document) return;
  let attached = false;
  const attach = () => {
    if (attached) return;
    attached = true;
    textarea.removeEventListener("focus", attach);
    load().then((picker) => picker.attachMentionPicker(textarea, document), () => {
      // Offline: the next focus tries again.
      attached = false;
      textarea.addEventListener("focus", attach);
    });
  };
  if (document.activeElement === textarea) attach();
  else textarea.addEventListener("focus", attach);
}
