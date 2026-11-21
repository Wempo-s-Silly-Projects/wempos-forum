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

// Community traditions (wave 2026-11-21-14). Pure DOM builders — the caller
// passes the document and does the fetch:
//   isQotdBody        — does a thread open with "QOTD" (the Question of the
//                       Day tradition)? Mirrors the server's prefix test.
//   createQotdBanner  — the home feed's "Today's question" link, with a
//                       "You answered" chip when the viewer already replied.
//   createShowcaseGallery — the showcase board's image-first grid of tiles.
// Excerpts reuse threadExcerpt, which masks spoilers before cutting.
import { attachmentUrl } from "./attachments.js";
import { t } from "./i18n.js";
import { threadExcerpt } from "./profile-extras.js";

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

function createGalleryTile(document, item) {
  const tile = make(document, "a", "gallery-tile");
  tile.href = "/posts/" + Number(item.id);
  tile.setAttribute("data-app-link", "");
  const title = threadExcerpt(item.body);
  const image = make(document, "img", "gallery-image");
  image.src = attachmentUrl(item.image);
  image.alt = t("traditions.galleryAlt", { title });
  image.loading = "lazy";
  tile.append(image, make(document, "span", "gallery-caption", title));
  if (item.authorName) tile.append(make(document, "span", "gallery-author muted", item.authorName));
  return tile;
}

export function createShowcaseGallery(document, items) {
  const grid = make(document, "div", "showcase-gallery");
  if (!items.length) {
    grid.append(make(document, "p", "empty-state", t("traditions.galleryEmpty")));
    return grid;
  }
  for (const item of items) grid.append(createGalleryTile(document, item));
  return grid;
}
