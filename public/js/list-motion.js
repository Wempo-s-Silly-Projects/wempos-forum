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

// List motion (Batch J): the vendored AutoAnimate (MIT) eases replies, poll
// rows and notifications in and out when they are added, removed or
// reordered. Each list is wired once; under prefers-reduced-motion nothing
// is wired at all, so lists change instantly exactly as before.
import { prefersReducedMotion } from "./focus-utils.js";

const LIST_SELECTOR = ".replies-list, .post-poll";
const ITEM_PARENT_SELECTOR = ".notification-item";
const WIRED_ATTRIBUTE = "data-auto-animate";
const MOTION_MS = 180;

// The containers under `root` that get motion: reply lists, poll blocks and
// the parent of the notification rows.
export function motionTargets(root) {
  const targets = new Set(root?.querySelectorAll?.(LIST_SELECTOR) ?? []);
  const item = root?.querySelector?.(ITEM_PARENT_SELECTOR);
  if (item?.parentElement) targets.add(item.parentElement);
  return [...targets];
}

export function animateLists(root, { autoAnimate, win = globalThis } = {}) {
  if (typeof autoAnimate !== "function" || prefersReducedMotion(win)) return;
  for (const target of motionTargets(root)) {
    if (target.hasAttribute(WIRED_ATTRIBUTE)) continue;
    target.setAttribute(WIRED_ATTRIBUTE, "");
    autoAnimate(target, { duration: MOTION_MS });
  }
}
