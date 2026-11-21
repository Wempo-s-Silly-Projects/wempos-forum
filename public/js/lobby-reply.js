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

// Lobby reply (wave 2026-11-21-6): a Reply button on another member's Lobby
// row prefills "@name " into the send box, keeping whatever was already
// typed. Pure and DOM-free so node tests can import it; the existing
// @mention ping on send does the rest (no new request, no new endpoint).

// The Lobby send cap (the server's 500-char body limit).
export const REPLY_BODY_MAX = 500;

// The draft with the mention leading it: unchanged when the mention is
// already there or the name is missing, clipped to the send cap.
export const withReplyMention = (draft, username) => {
  const current = typeof draft === "string" ? draft : "";
  const name = typeof username === "string" ? username.trim() : "";
  if (!name) return current;
  const mention = "@" + name + " ";
  if (current.startsWith(mention)) return current;
  return (mention + current.trimStart()).slice(0, REPLY_BODY_MAX);
};
