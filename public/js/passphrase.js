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

// Batch F: "Suggest a passphrase". Six words from the EFF large wordlist
// (7776 words, vendored verbatim; ~77.5 bits), picked in the browser with
// crypto.getRandomValues and rejection sampling so every word is equally
// likely. Nothing is sent anywhere; the field shows the words so the member
// can write them down or save them in a password manager.
import { t } from "./i18n.js";

export const PASSPHRASE_WORDS = 6;
const UINT32_RANGE = 0x100000000;

export function pickPassphrase(words, count, getRandomValues) {
  const limit = Math.floor(UINT32_RANGE / words.length) * words.length;
  const picked = [];
  const sample = new Uint32Array(1);
  while (picked.length < count) {
    getRandomValues(sample);
    if (sample[0] < limit) picked.push(words[sample[0] % words.length]);
  }
  return picked;
}

let wordlist = null;
function loadWordlist() {
  wordlist ??= import("./vendor/eff-wordlist/wordlist.json", { with: { type: "json" } })
    .then((module) => module.default);
  return wordlist;
}

export function attachPassphraseButton(document, input) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-quiet passphrase-suggest";
  button.textContent = t("security.suggestPassphrase");
  button.addEventListener("click", async () => {
    const words = await loadWordlist();
    input.type = "text";
    input.value = pickPassphrase(words, PASSPHRASE_WORDS, (array) => crypto.getRandomValues(array)).join("-");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });
  (input.closest("label") ?? input).after(button);
  return button;
}
