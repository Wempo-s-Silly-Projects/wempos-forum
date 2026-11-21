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

// v4.21 search highlighting: the searched words light up in reply results and
// member names. The server matches with instr(lower(body), lower(q)), so the
// client mirrors it with toLowerCase. Pure splitter + a DOM builder that only
// makes text nodes and <mark> elements (never HTML strings).

// Splits text into [{ text, hit }] runs around case-insensitive matches. When
// lowercasing changes the length (e.g. "İ"), offsets would drift, so the text
// comes back whole and unhighlighted rather than marked in the wrong place.
export function highlightParts(text, query) {
  const value = String(text ?? "");
  if (!value) return [];
  const needle = String(query ?? "").trim().toLowerCase();
  const haystack = value.toLowerCase();
  if (!needle || haystack.length !== value.length) return [{ text: value, hit: false }];
  const parts = [];
  let cursor = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    if (at > cursor) parts.push({ text: value.slice(cursor, at), hit: false });
    parts.push({ text: value.slice(at, at + needle.length), hit: true });
    cursor = at + needle.length;
    at = haystack.indexOf(needle, cursor);
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor), hit: false });
  return parts;
}

export function appendHighlighted(document, parent, text, query) {
  for (const part of highlightParts(text, query)) {
    if (!part.hit) {
      parent.append(document.createTextNode(part.text));
      continue;
    }
    const mark = document.createElement("mark");
    mark.className = "search-hit";
    mark.textContent = part.text;
    parent.append(mark);
  }
  return parent;
}
