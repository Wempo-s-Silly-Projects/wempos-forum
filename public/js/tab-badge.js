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

// Unread count on the favicon (an in-house stand-in for favico.js, whose
// upstream stopped in 2016): while the tab is hidden, the signed-in member's
// unread notifications plus DMs are drawn as a small coral badge over the
// icon. Zero, or coming back to the tab, puts the plain icon back. The counts
// are the ones the bell and chat launcher already hold: no request here.
// Like the tab-title count it is opt-in (the same device pref, off by
// default) and held back during quiet hours.
import { notificationAlertsAllowed } from "./quiet-hours.js";
import { pageStorage, readTabUnread } from "./tab-unread.js";

const BADGE_CAP = 9;
const ICON_SIZE = 32;
const BADGE_RADIUS = 10;
const BADGE_FILL = "#c65343";
const BADGE_TEXT = "#ffffff";
const BASE_ICON = "/icons/icon.svg";

// "" for zero or junk, "1".."9", then "9+".
export function badgeLabel(count) {
  const value = typeof count === "number" ? count : Number.NaN;
  if (!Number.isSafeInteger(value) || value <= 0) return "";
  return value > BADGE_CAP ? BADGE_CAP + "+" : String(value);
}

// A PNG data URL of the base icon with the label, or null without canvas.
function drawBadge(doc, label, baseImage) {
  const canvas = doc.createElement("canvas");
  const context = canvas?.getContext?.("2d");
  if (!context || typeof canvas.toDataURL !== "function") return null;
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  if (baseImage?.complete && baseImage.naturalWidth) context.drawImage(baseImage, 0, 0, ICON_SIZE, ICON_SIZE);
  const centre = ICON_SIZE - BADGE_RADIUS;
  context.beginPath();
  context.arc(centre, centre, BADGE_RADIUS, 0, 2 * Math.PI);
  context.fillStyle = BADGE_FILL;
  context.fill();
  context.fillStyle = BADGE_TEXT;
  context.font = "bold " + (label.length > 1 ? 11 : 14) + "px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, centre, centre + 1);
  return canvas.toDataURL("image/png");
}

export function createTabBadge(doc, { allowed = () => true } = {}) {
  const counts = new Map();
  let baseImage = null;
  const icons = () => [...(doc.querySelectorAll?.('link[rel="icon"]') ?? [])];
  const plainHref = (link) => {
    if (link.plainHref === undefined) link.plainHref = link.getAttribute("href");
    return link.plainHref;
  };
  const render = () => {
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const label = doc.visibilityState === "hidden" && allowed() ? badgeLabel(total) : "";
    if (label && !baseImage) loadBase();
    const badged = label ? drawBadge(doc, label, baseImage) : null;
    for (const link of icons()) {
      const plain = plainHref(link);
      link.setAttribute("href", badged ?? plain);
    }
  };
  // The plain icon, drawn under the badge once loaded (a cached static file).
  const loadBase = () => {
    baseImage = doc.createElement("img");
    if (!baseImage || !("src" in baseImage)) return;
    baseImage.onload = render;
    baseImage.src = BASE_ICON;
  };
  doc.addEventListener?.("visibilitychange", render);
  return {
    setCount(source, count) {
      const value = Number(count);
      counts.set(source, Number.isSafeInteger(value) && value > 0 ? value : 0);
      render();
    },
  };
}

let pageBadge = null;

// The page-wide badge; `source` is "notifications" or "dms".
export function setTabBadgeCount(source, count) {
  if (typeof document === "undefined") return;
  pageBadge ??= createTabBadge(document, {
    allowed: () => readTabUnread(pageStorage()) && notificationAlertsAllowed(pageStorage(), new Date()),
  });
  pageBadge.setCount(source, count);
}
