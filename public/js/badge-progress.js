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

// Next badge (wave 5.7 F1): the milestone badges (v2.5) graduate as a member
// posts; on their OWN profile a line says which badge is next and how far
// along they are, with a progress bar. Display-only: the counts already ride
// the profile payload, nothing is fetched or stored. DOM-pure: the caller
// passes the document.
import { t } from "./i18n.js";

// Lowest first; min = threads started + replies written.
export const BADGE_TIERS = Object.freeze([
  Object.freeze({ min: 0, key: "profile.badgeNew" }),
  Object.freeze({ min: 20, key: "profile.badgeStandard" }),
  Object.freeze({ min: 100, key: "profile.badgeBig" }),
  Object.freeze({ min: 1000, key: "profile.badgeMega" }),
  Object.freeze({ min: 10000, key: "profile.badgeFamous" }),
]);

const normaliseTotal = (value) => {
  const total = Number(value);
  return Number.isSafeInteger(total) && total > 0 ? total : 0;
};

export function badgeKeyFor(totalContributions) {
  const total = normaliseTotal(totalContributions);
  return BADGE_TIERS.reduce((key, tier) => (total >= tier.min ? tier.key : key), BADGE_TIERS[0].key);
}

// { key, done, goal } for the next tier, or null at the top badge.
export function nextBadgeProgress(totalContributions) {
  const total = normaliseTotal(totalContributions);
  const next = BADGE_TIERS.find((tier) => tier.min > total);
  return next ? { key: next.key, done: total, goal: next.min } : null;
}

export function createNextBadge(doc, totalContributions) {
  const line = doc.createElement("p");
  line.className = "profile-next-badge";
  const progress = nextBadgeProgress(totalContributions);
  if (!progress) {
    line.textContent = t("profile.topBadge");
    return line;
  }
  const text = t("profile.nextBadge", { badge: t(progress.key), done: progress.done, goal: progress.goal });
  const label = doc.createElement("span");
  label.textContent = text;
  const bar = doc.createElement("progress");
  bar.className = "profile-next-badge-bar";
  bar.max = progress.goal;
  bar.value = progress.done;
  bar.setAttribute("aria-label", text);
  line.append(label, bar);
  return line;
}
