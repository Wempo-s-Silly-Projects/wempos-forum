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

// Chat list quick filter (wave 2026-11-21-6): narrows the chat widget's
// conversation rows by the name each row shows. Local-only — it filters the
// rows already loaded and sends nothing. Pure and DOM-free for node tests.

// The longest query the filter box accepts (usernames are far shorter).
export const FILTER_QUERY_MAX = 40;

// A NEW array of the rows whose label contains the query, case-insensitive;
// a blank query keeps every row, an over-long one matches nothing.
export const filterConversations = (rows, query, labelOf) => {
  const list = Array.isArray(rows) ? rows : [];
  const needle = typeof query === "string" ? query.trim().toLocaleLowerCase() : "";
  if (!needle) return [...list];
  if (needle.length > FILTER_QUERY_MAX) return [];
  return list.filter((row) => String(labelOf(row) ?? "").toLocaleLowerCase().includes(needle));
};

// "Unread only" (wave 2026-11-21-27, v4.32): a NEW array of the rows that
// carry unread messages when `on`, else a copy of every row. Muted chats
// stay in (a mute quiets only the launcher badge).
export const onlyUnread = (rows, on) => {
  const list = Array.isArray(rows) ? rows : [];
  if (!on) return [...list];
  return list.filter((row) => Number(row?.unread) > 0);
};
