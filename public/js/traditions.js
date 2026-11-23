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

// Community traditions (wave 2026-11-21-14). Pure DOM builders — the caller
// passes the document and does the fetch:
//   isQotdBody        — does a thread open with "QOTD" (the Question of the
//                       Day tradition)? Mirrors the server's prefix test.
//   createQotdBanner  — the home feed's "Today's question" link, with a
//                       "You answered" chip when the viewer already replied.
//   createShowcaseGallery — the showcase board's image-first grid of tiles,
//                       with the staff pick (v5.35) pinned on top.
//   createStaffPickTile — the "Staff pick ⭐" tile (gallery and /week).
// Excerpts reuse threadExcerpt, which masks spoilers before cutting.
import { attachmentUrl } from "./attachments.js";
import { prefersReducedMotion } from "./focus-utils.js";
import { t } from "./i18n.js";
import { threadExcerpt } from "./profile-extras.js";
import { freezeInPlace, GIF_MIME } from "./still-gif.js";

const QOTD_PREFIX = /^[ \t\r\n]*qotd/i;

export const isQotdBody = (body) => typeof body === "string" && QOTD_PREFIX.test(body);

const make = (document, tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createQotdBanner(document, qotd) {
  const banner = make(document, "section", "qotd-banner");
  banner.setAttribute("aria-label", t("traditions.qotdTitle"));
  banner.append(make(document, "span", "qotd-label", t("traditions.qotdToday")));
  const link = make(document, "a", "qotd-link", threadExcerpt(qotd.body));
  link.href = "/posts/" + Number(qotd.id);
  link.setAttribute("data-app-link", "");
  banner.append(link);
  if (qotd.answered) banner.append(make(document, "span", "role-badge qotd-answered", t("traditions.qotdAnswered")));
  return banner;
}

// A tile's cover image. Under reduced motion a GIF cover shows its still
// first frame; the tile is a link, so no play/pause button nests inside it —
// the post itself carries the toggle.
function createGalleryImage(document, image, title) {
  const node = make(document, "img", "gallery-image");
  node.src = attachmentUrl(image);
  node.alt = t("traditions.galleryAlt", { title });
  node.loading = "lazy";
  return node;
}

function freezeGalleryGif(document, node, image) {
  if (image?.mime === GIF_MIME && prefersReducedMotion()) freezeInPlace(document, node, { stillClass: "gallery-image" });
}

function createGalleryTile(document, item) {
  const tile = make(document, "a", "gallery-tile");
  tile.href = "/posts/" + Number(item.id);
  tile.setAttribute("data-app-link", "");
  const title = threadExcerpt(item.body);
  const image = createGalleryImage(document, item.image, title);
  tile.append(image, make(document, "span", "gallery-caption", title));
  freezeGalleryGif(document, image, item.image);
  if (item.authorName) tile.append(make(document, "span", "gallery-author muted", item.authorName));
  return tile;
}

// Staff pick (v5.35): the server already re-checked visibility and masked the
// excerpt; a pick without an approved image is a text-only tile.
export function createStaffPickTile(document, pick) {
  const tile = make(document, "a", "gallery-tile staff-pick-tile");
  tile.href = "/posts/" + Number(pick.id);
  tile.setAttribute("data-app-link", "");
  tile.append(make(document, "span", "role-badge staff-pick-label", t("staffPick.label")));
  const title = threadExcerpt(String(pick.excerpt ?? ""));
  if (pick.image) {
    const image = createGalleryImage(document, pick.image, title);
    tile.append(image);
    freezeGalleryGif(document, image, pick.image);
  }
  tile.append(make(document, "span", "gallery-caption", title));
  if (pick.authorName) tile.append(make(document, "span", "gallery-author muted", pick.authorName));
  return tile;
}

export function createShowcaseGallery(document, items, staffPick = null) {
  const grid = make(document, "div", "showcase-gallery");
  if (staffPick) grid.append(createStaffPickTile(document, staffPick));
  const rest = staffPick ? items.filter((item) => Number(item.id) !== Number(staffPick.id)) : items;
  if (!rest.length && !staffPick) {
    grid.append(make(document, "p", "empty-state", t("traditions.galleryEmpty")));
    return grid;
  }
  for (const item of rest) grid.append(createGalleryTile(document, item));
  return grid;
}
