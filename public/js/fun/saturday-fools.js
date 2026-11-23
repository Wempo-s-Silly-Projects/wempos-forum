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

// Saturday Fools (owner order, Nov 22): one silly, purely cosmetic gag on the
// VISITOR'S local Saturday. fun-gate.js imports this module only when the
// shell carries <meta name="saturday-fools" content="on"> (env SATURDAY_FOOLS
// = "on" and the owner has not forced it off) and it is Saturday locally.
// The active gag is the one in saturday-fools/index.js whose date equals the
// visitor's local Saturday date; with none dated for today nothing happens.
// It switches off at local midnight (a timer, plus a re-check whenever the
// tab becomes visible or gains focus). Members have no opt-out (owner order,
// 23:13); accessibility is not an opt-out and always holds: reduced motion
// runs the gag's still variant (or skips a moving gag that has none), gags
// never touch forms, submit handlers, moderation or sign-in.
import { t } from "../i18n.js";
import { prefersReducedMotion } from "../focus-utils.js";
import { GAGS } from "./saturday-fools/index.js";

export const FOOLS_META_NAME = "saturday-fools";
export const FOOLS_META_ON = "on";
export const SATURDAY = 6;
// Device-level marker: the local date the banner was closed on.
export const FOOLS_BANNER_CLOSED_KEY = "forum-saturday-fools-banner-closed";
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const pad = (value) => String(value).padStart(2, "0");

// "YYYY-MM-DD" in the visitor's local time zone.
export function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isLocalSaturday(date) {
  return date.getDay() === SATURDAY;
}

export function foolsMetaOn(doc) {
  return doc?.querySelector?.(`meta[name="${FOOLS_META_NAME}"]`)?.getAttribute?.("content") === FOOLS_META_ON;
}

// A gag module's shape (docs/saturday-fools.md); a malformed one is ignored.
export function isValidGag(gag) {
  return Boolean(gag && typeof gag.id === "string" && typeof gag.name === "string"
    && typeof gag.date === "string" && DATE_KEY.test(gag.date) && typeof gag.apply === "function");
}

// The gag dated for `date`'s local day, only on a local Saturday; else null.
export function gagForDate(gags, date) {
  if (!isLocalSaturday(date)) return null;
  const key = localDateKey(date);
  return (gags ?? []).find((gag) => isValidGag(gag) && gag.date === key) ?? null;
}

// Milliseconds from `date` to the next local midnight (at least 1).
export function msUntilLocalMidnight(date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return Math.max(1, next.getTime() - date.getTime());
}

function bannerClosedToday(storage, key) {
  try {
    return storage?.getItem(FOOLS_BANNER_CLOSED_KEY) === key;
  } catch {
    return false;
  }
}

function rememberBannerClosed(storage, key) {
  try {
    storage?.setItem(FOOLS_BANNER_CLOSED_KEY, key);
  } catch {
    // Blocked storage: the banner stays closed for this page only.
  }
}

// The informational note: "🃏 Saturday Fools: <gag name>" and a close button.
// Closing hides the BANNER ONLY, for the rest of the local day; the gag
// itself keeps running (owner order, 23:13: no member opt-out).
function createBanner(doc, gag, onClose) {
  const banner = doc.createElement("aside");
  banner.className = "fools-banner";
  banner.setAttribute("role", "note");
  const text = doc.createElement("span");
  text.className = "fools-banner-text";
  text.textContent = t("fools.banner", { name: t(gag.name) });
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "button button-secondary fools-banner-close";
  close.textContent = t("common.close");
  close.addEventListener("click", onClose);
  banner.append(text, close);
  return banner;
}

// Picks the function to run: the full gag, its still variant under reduced
// motion, or nothing (a moving gag without a still variant is skipped).
export function gagRunner(gag, reducedMotion) {
  if (!reducedMotion || !gag.motion) return gag.apply;
  return typeof gag.reducedMotionApply === "function" ? gag.reducedMotionApply : null;
}

export function defaultFoolsEnv() {
  return {
    doc: globalThis.document,
    win: globalThis,
    storage: browserStorage(),
    now: () => new Date(),
    reducedMotion: () => prefersReducedMotion(globalThis),
    gags: GAGS,
  };
}

// The controller: refresh() re-decides the active gag (start / stop),
// enhance(root) lets the active gag touch a freshly rendered view, stop()
// undoes everything. Each gag call is isolated: a throwing gag is dropped.
export function createSaturdayFools(env = defaultFoolsEnv()) {
  const { doc, win, storage } = env;
  let current = null;
  let undo = null;
  let banner = null;
  let midnightTimer = null;

  const clearTimer = () => {
    if (midnightTimer !== null) win?.clearTimeout?.(midnightTimer);
    midnightTimer = null;
  };

  function stop() {
    clearTimer();
    try {
      undo?.();
    } catch {
      // A gag's undo failing must not keep the banner or the timer around.
    }
    undo = null;
    banner?.remove?.();
    banner = null;
    current = null;
  }

  function showBanner(gag, key) {
    if (bannerClosedToday(storage, key) || !doc?.body) return;
    banner = createBanner(doc, gag, () => {
      rememberBannerClosed(storage, key);
      banner?.remove?.();
      banner = null;
    });
    doc.body.prepend(banner);
  }

  function start(gag, now) {
    current = gag;
    const run = gagRunner(gag, env.reducedMotion?.() === true);
    if (run) {
      try {
        const result = run(doc, { win });
        undo = typeof result === "function" ? result : null;
      } catch {
        undo = null;
      }
    }
    showBanner(gag, localDateKey(now));
    midnightTimer = win?.setTimeout?.(refresh, msUntilLocalMidnight(now)) ?? null;
  }

  function refresh() {
    const now = env.now();
    const gag = foolsMetaOn(doc) ? gagForDate(env.gags, now) : null;
    if (gag === current) return current;
    stop();
    if (gag) start(gag, now);
    return current;
  }

  function enhance(root) {
    if (!current || typeof current.enhance !== "function") return;
    if (!gagRunner(current, env.reducedMotion?.() === true)) return;
    try {
      current.enhance(root, { win });
    } catch {
      // Isolated: a failing enhance never breaks the page render.
    }
  }

  return { refresh, enhance, stop, active: () => current };
}

let controller = null;

// Called once by fun-gate.js: start, and re-check on visibility / focus so a
// tab left open past local midnight drops the gag.
export function startSaturdayFools(env = defaultFoolsEnv()) {
  if (controller) return controller;
  controller = createSaturdayFools(env);
  controller.refresh();
  env.doc?.addEventListener?.("visibilitychange", () => controller.refresh());
  env.win?.addEventListener?.("focus", () => controller.refresh());
  return controller;
}

export function enhanceSaturdayFools(root) {
  controller?.enhance(root);
}
