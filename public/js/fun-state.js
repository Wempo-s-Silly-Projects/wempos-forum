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

// Shared by the settings panel and the lazy-load gate so blocked storage has
// one page-local source of truth without adding properties to globalThis.
export const FUN_KEYS = Object.freeze(["confetti", "motion", "heroType", "sounds", "easterEggs", "sketch"]);
export const FUN_DEFAULTS = Object.freeze(Object.fromEntries(FUN_KEYS.map((key) => [key, true])));

export const FUN_FALLBACK_STATE = {
  settings: { ...FUN_DEFAULTS },
  byStorage: new WeakMap(),
  blocked: new WeakSet(),
};

export const isStorageObject = (storage) => storage !== null
  && (typeof storage === "object" || typeof storage === "function");

export const fallbackFor = (storage) => isStorageObject(storage)
  ? FUN_FALLBACK_STATE.byStorage.get(storage) ?? FUN_DEFAULTS
  : FUN_FALLBACK_STATE.settings;

export const rememberFallback = (storage, settings) => {
  if (isStorageObject(storage)) FUN_FALLBACK_STATE.byStorage.set(storage, { ...settings });
  else FUN_FALLBACK_STATE.settings = { ...settings };
};
