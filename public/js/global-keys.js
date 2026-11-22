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

// Global keyboard shortcuts (Batch J): G then H goes home, G then C opens or
// closes the chat, / jumps to the search box and ? opens a list of every
// shortcut. Bound with the vendored tinykeys (MIT). They never fire while
// the member is typing, composing with an IME or holding a key down, and
// because they are single character keys (WCAG 2.1.4) the help dialog has a
// switch that turns them off; the choice lives in this browser only.
// J/K post navigation stays in post-keys.js (active only inside a thread).
import { t } from "./i18n.js";
import { isTypingTarget } from "./post-keys.js";
import { SHORTCUT_ROWS } from "./shortcut-sheet.js";

export const GLOBAL_KEYS_STORAGE_KEY = "forum-global-keys";
const OFF_VALUE = "off";
const ON_VALUE = "on";

// tinykeys binding → action name.
export const GLOBAL_KEY_BINDINGS = Object.freeze({
  "g h": "home",
  "g c": "chat",
  "/": "search",
  "[Shift]+?": "help",
});

export const GLOBAL_SHORTCUT_ROWS = Object.freeze(["ux.keysHome", "ux.keysChat", "ux.keysSearch", "ux.keysHelp"]);

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function readGlobalKeysOn(storage = browserStorage()) {
  try {
    return storage?.getItem(GLOBAL_KEYS_STORAGE_KEY) !== OFF_VALUE;
  } catch {
    return true;
  }
}

export function writeGlobalKeysOn(storage = browserStorage(), on = true) {
  try {
    storage?.setItem(GLOBAL_KEYS_STORAGE_KEY, on ? ON_VALUE : OFF_VALUE);
  } catch {
    // Blocked storage: the switch lasts for this page view only.
  }
}

export function ignoreGlobalKey(event) {
  if (!event || event.defaultPrevented || event.isComposing || event.repeat) return true;
  return isTypingTarget(event.target);
}

// Wires each binding to its action through tinykeys; returns unsubscribe.
export function bindGlobalKeys(target, actions, { storage = browserStorage(), tinykeys } = {}) {
  const bindings = {};
  for (const [binding, name] of Object.entries(GLOBAL_KEY_BINDINGS)) {
    bindings[binding] = (event) => {
      if (ignoreGlobalKey(event) || !readGlobalKeysOn(storage)) return;
      const action = actions[name];
      if (typeof action !== "function") return;
      event.preventDefault();
      action(event);
    };
  }
  return tinykeys(target, bindings, { ignore: ignoreGlobalKey });
}

function createRow(document, key) {
  const row = document.createElement("li");
  row.textContent = t(key);
  return row;
}

// The ? list: a native <dialog> (focus stays inside, Esc closes it) with
// every shortcut the forum has and the on/off switch for the global ones.
export function createShortcutHelp(document, { storage = browserStorage() } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "shortcut-help";
  dialog.setAttribute("aria-labelledby", "shortcut-help-title");
  const heading = document.createElement("h2");
  heading.id = "shortcut-help-title";
  heading.textContent = t("shortcuts.title");
  const list = document.createElement("ul");
  list.className = "shortcut-help-list";
  for (const key of [...GLOBAL_SHORTCUT_ROWS, ...SHORTCUT_ROWS]) list.append(createRow(document, key));
  const label = document.createElement("label");
  label.className = "shortcut-help-switch";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.className = "shortcut-help-toggle";
  toggle.checked = readGlobalKeysOn(storage);
  toggle.addEventListener("change", () => writeGlobalKeysOn(storage, toggle.checked));
  label.append(toggle, document.createTextNode(" " + t("ux.keysToggle")));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "button button-secondary shortcut-help-close";
  close.textContent = t("common.close");
  close.addEventListener("click", () => dialog.close?.());
  dialog.append(heading, list, label, close);
  return dialog;
}

// Opens the help dialog (built once per page) and hands focus back to
// whatever had it when the dialog closes.
function openShortcutHelp(document, state) {
  state.dialog ??= createShortcutHelp(document);
  if (!state.dialog.isConnected) {
    document.body.append(state.dialog);
    state.dialog.addEventListener("close", () => state.returnFocus?.focus?.());
  }
  if (state.dialog.open) return;
  state.returnFocus = document.activeElement;
  state.dialog.showModal();
}

export async function initGlobalKeys(document, { navigate, loadTinykeys = () => import("./vendor/tinykeys.js") } = {}) {
  const state = { dialog: null, returnFocus: null };
  const actions = {
    home: () => navigate("/"),
    chat: () => document.querySelector(".chat-widget-launcher")?.click(),
    search: () => {
      const input = document.querySelector("#search-query");
      input?.focus();
      input?.select?.();
    },
    help: () => openShortcutHelp(document, state),
  };
  try {
    const { tinykeys } = await loadTinykeys();
    return bindGlobalKeys(document.defaultView ?? globalThis, actions, { tinykeys });
  } catch (error) {
    console.warn("Keyboard shortcuts unavailable:", error);
    return () => {};
  }
}
