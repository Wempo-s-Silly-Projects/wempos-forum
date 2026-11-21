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

// Not-found rescue (v5.2): the 404 view offers a way out — back to the home
// feed, and a search for the words in the address that missed (so
// /c/gamedev-tips offers a search for "gamedev tips"). Page-view only: no
// storage, no network. Everything is painted with textContent.

// Route prefixes and file noise carry no meaning as search words.
const NOISE_WORDS = new Set(["c", "posts", "users", "admin", "index", "html", "htm", "php"]);
const MIN_WORD_LENGTH = 2;
const MAX_WORDS = 5;
const MAX_QUERY_LENGTH = 60;

const decodePath = (pathname) => {
  try {
    return decodeURIComponent(pathname);
  } catch (error) {
    if (error instanceof URIError) return pathname;
    throw error;
  }
};

export function notFoundQuery(pathname) {
  const words = decodePath(String(pathname ?? ""))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= MIN_WORD_LENGTH && !NOISE_WORDS.has(word.toLowerCase()));
  return words.slice(0, MAX_WORDS).join(" ").slice(0, MAX_QUERY_LENGTH).trim();
}

const makeLink = (doc, href, text) => {
  const link = doc.createElement("a");
  link.setAttribute("href", href);
  link.textContent = text;
  return link;
};

export function buildNotFoundLinks(doc, translate, pathname) {
  const wrap = doc.createElement("p");
  wrap.className = "not-found-links";
  wrap.append(makeLink(doc, "/", translate("app.notFoundHome")));
  const query = notFoundQuery(pathname);
  if (query) {
    wrap.append(makeLink(doc, `/?q=${encodeURIComponent(query)}`, translate("app.notFoundSearch", { query })));
  }
  return wrap;
}
