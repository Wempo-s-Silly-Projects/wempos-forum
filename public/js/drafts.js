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

// Composer draft autosave (wave 2026-11-21 F1): whatever a member types in a
// post or reply composer is kept in localStorage per composer + thread, so a
// refresh, crash or wandering off never loses it. Local-only — nothing leaves
// the browser. Every storage touch is wrapped: a private window or blocked
// storage turns the feature into a silent no-op, never a broken composer.
// The helpers take the storage and clock as arguments so node tests drive them.

export const DRAFT_PREFIX = "forum-draft:";
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const DRAFT_SAVE_DELAY_MS = 400;

export const draftKey = (formName, postId, board = null) =>
  DRAFT_PREFIX + formName + ":" + (postId ?? "new") + (board ? ":" + board : "");

export function clearDraft(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
    // Blocked storage: nothing to clear.
  }
}

export function saveDraft(storage, key, body, now = Date.now()) {
  if (typeof body !== "string" || !body.trim()) {
    clearDraft(storage, key);
    return;
  }
  try {
    storage?.setItem(key, JSON.stringify({ body, savedAt: now }));
  } catch {
    // Quota exceeded or blocked storage: autosave is best-effort.
  }
}

export function loadDraft(storage, key, now = Date.now()) {
  let raw = null;
  try {
    raw = storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
  if (!raw) return null;
  let draft = null;
  try {
    draft = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!draft || typeof draft.body !== "string" || !Number.isFinite(draft.savedAt)) return null;
  if (now - draft.savedAt > DRAFT_MAX_AGE_MS) {
    clearDraft(storage, key);
    return null;
  }
  return draft.body;
}

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

// Wires one composer form: restores a saved draft into the empty textarea and
// saves (debounced) on every input. The key rides on the form's dataset so the
// submit handlers can clear it without recomputing it.
export function attachDraftAutosave(form, textarea, key, storage = browserStorage()) {
  if (!form || !textarea) return;
  form.dataset.draftKey = key;
  const saved = loadDraft(storage, key);
  if (saved && !textarea.value) {
    textarea.value = saved;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
  let timer = null;
  textarea.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (form.dataset.draftKey) saveDraft(storage, key, textarea.value);
    }, DRAFT_SAVE_DELAY_MS);
  });
}

export function clearFormDraft(form, storage = browserStorage()) {
  const key = form?.dataset?.draftKey;
  if (!key) return;
  clearDraft(storage, key);
}
