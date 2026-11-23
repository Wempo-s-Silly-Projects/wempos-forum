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

// Batch H: the emoji picker for the post composer and both chat inputs. The
// vendored picmo (native emoji, no sprite sheets) loads only on the first
// press of an emoji button; its data is the vendored emojibase-data set for
// the reader's language (search speaks that language), fetched same-origin
// through api(), never from a CDN. picmo's own <style> injection is switched
// off (CSP style-src 'self'); its stylesheet is linked from /js/vendor/ once.
// Data stays in memory (no IndexedDB copy); picmo keeps its recently-used
// list in this browser's localStorage only, and the sign-out wipe clears it
// (clearAllEmojiRecents, v5.82.1 review L1). The pick goes in through
// field-edit.js, so Ctrl/Cmd+Z undoes it.
import { api } from "./api.js";
import { currentLocale, t } from "./i18n.js";
import { insertAtCaret } from "./field-edit.js";

export const EMOJIBASE_PATH = "/js/vendor/emojibase/";
export const PICMO_CSS_HREF = "/js/vendor/picmo.css";
// The emojibase-data 18.0.0 locales vendored: those the forum also speaks.
export const EMOJIBASE_LOCALES = Object.freeze([
  "bn", "da", "de", "en", "es", "fi", "fr", "hi", "hu", "it", "ja", "ko", "ms", "nb",
  "nl", "pl", "pt", "ru", "sv", "th", "uk", "vi", "zh", "zh-hant",
]);
const LOCALE_ALIASES = Object.freeze({ "zh-hans": "zh", "zh-hant": "zh-hant" });
const EMOJI_GLYPH = "🙂";
const EMOJIS_PER_ROW = 8;
const VISIBLE_ROWS = 5;

// The key picmo's default recents provider writes (vendor/picmo.js).
export const PICMO_RECENTS_KEY = "PicMo:recents"; // i18n-ignore

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

// Sign-out wipe: the recents list is per member, so it leaves with them.
export function clearAllEmojiRecents(storage = browserStorage()) {
  try {
    storage?.removeItem(PICMO_RECENTS_KEY);
  } catch {
    // Blocked storage: nothing was kept.
  }
}

const defaultLoadPicmo = () => import("./vendor/picmo.js");
const picmoLoads = new Map();
const dataLoads = new Map();
const linkedDocuments = new WeakSet();

export function emojibaseLocaleFor(code) {
  const lower = String(code ?? "").toLowerCase();
  if (LOCALE_ALIASES[lower]) return LOCALE_ALIASES[lower];
  if (EMOJIBASE_LOCALES.includes(lower)) return lower;
  const primary = lower.split("-")[0];
  return EMOJIBASE_LOCALES.includes(primary) ? primary : "en";
}

// picmo's interface strings: category names straight from the emojibase
// messages for that language, everything else from our own translations.
export function picmoI18n(messages) {
  const groups = Array.isArray(messages?.groups) ? messages.groups : [];
  const categories = Object.fromEntries(groups
    .filter((group) => typeof group?.key === "string" && typeof group?.message === "string")
    .map((group) => ["categories." + group.key, group.message]));
  return {
    ...categories,
    "categories.recents": t("composer.emojiRecents"),
    "categories.custom": t("composer.emoji"),
    "error.load": t("composer.emojiError"),
    "search.error": t("composer.emojiError"),
    "recents.clear": t("composer.emojiClear"),
    "recents.none": t("composer.emojiRecentsNone"),
    retry: t("common.retry"),
    "search.clear": t("composer.emojiClear"),
    "search.notFound": t("composer.emojiNotFound"),
    search: t("common.search"),
  };
}

const loadOnce = (cache, key, load) => {
  if (!cache.has(key)) {
    const pending = Promise.resolve().then(load);
    cache.set(key, pending);
    pending.catch(() => cache.delete(key)); // a failed load may be retried
  }
  return cache.get(key);
};

function linkStylesheet(document) {
  if (linkedDocuments.has(document) || !document.head) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = PICMO_CSS_HREF;
  document.head.append(link);
  linkedDocuments.add(document);
}

export function closeEmojiPicker(host) {
  const open = host?.emojiPicker;
  if (!open) return;
  host.emojiPicker = null;
  open.picker?.destroy?.();
  open.root.remove();
  open.button?.setAttribute("aria-expanded", "false");
}

export async function openEmojiPicker(field, host, document, {
  loadPicmo = defaultLoadPicmo,
  fetchJson = (path) => api(path),
  locale = currentLocale(),
  button = null,
} = {}) {
  closeEmojiPicker(host);
  const picmo = await loadOnce(picmoLoads, loadPicmo, loadPicmo);
  picmo.globalConfig.injectStyles = false;
  linkStylesheet(document);
  const code = emojibaseLocaleFor(locale);
  const [emojiData, messages] = await loadOnce(dataLoads, code, () => Promise.all([
    fetchJson(EMOJIBASE_PATH + code + "/data.json"),
    fetchJson(EMOJIBASE_PATH + code + "/messages.json"),
  ]));
  const root = document.createElement("div");
  root.className = "emoji-popover";
  host.append(root);
  const picker = picmo.createPicker({
    rootElement: root,
    emojiData,
    messages,
    locale: code,
    i18n: picmoI18n(messages),
    dataStore: picmo.InMemoryStoreFactory,
    theme: picmo.autoTheme,
    showPreview: false,
    emojisPerRow: EMOJIS_PER_ROW,
    visibleRows: VISIBLE_ROWS,
  });
  host.emojiPicker = { root, picker, button };
  picker.addEventListener("emoji:select", (selection) => {
    closeEmojiPicker(host);
    insertAtCaret(field, selection?.emoji ?? "");
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeEmojiPicker(host);
    field?.focus?.();
  });
  return { picmo, picker, root };
}

// Loading failed (offline, blocked): say so in the popover's place; the
// next press closes the note, the one after retries.
function showLoadError(host, document, button) {
  const root = document.createElement("div");
  root.className = "emoji-popover emoji-popover-error";
  const note = document.createElement("p");
  note.className = "form-note";
  note.setAttribute("role", "alert");
  note.textContent = t("composer.emojiError");
  root.append(note);
  host.append(root);
  host.emojiPicker = { root, picker: null, button };
}

// The toggle button. host: where the popover opens (defaults to the
// button's parent, which should be position: relative in CSS).
export function createEmojiButton(field, document, { host = null } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "composer-tool composer-emoji";
  button.textContent = EMOJI_GLYPH;
  button.setAttribute("aria-label", t("composer.emoji"));
  button.setAttribute("aria-expanded", "false");
  button.title = t("composer.emoji");
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", async () => {
    const target = host ?? button.parentNode;
    if (!target) return;
    if (target.emojiPicker) {
      closeEmojiPicker(target);
      return;
    }
    button.setAttribute("aria-expanded", "true");
    try {
      await openEmojiPicker(field, target, document, { button });
    } catch {
      showLoadError(target, document, button);
    }
  });
  return button;
}
