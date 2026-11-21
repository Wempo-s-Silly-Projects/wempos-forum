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

// Jump to the latest reply (wave 2026-11-21-9 F3): one button above a long
// thread's replies. The target is looked up at click time, so it stays right
// after "Load older replies" repaints the list. No request, no storage.
import { t } from "./i18n.js";
import { jumpToNode } from "./focus-utils.js";

export const LATEST_JUMP_MIN_REPLIES = 3;

const lastReplyCard = (list) => [...list.children].filter((node) => node.matches?.(".post-card")).at(-1) ?? null;

export function createLatestReplyJump(document, replyList, replyCount) {
  if (!replyList || replyCount < LATEST_JUMP_MIN_REPLIES) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-quiet latest-reply-jump";
  button.textContent = t("post.latestReply");
  button.addEventListener("click", (event) => {
    event.preventDefault?.();
    jumpToNode(lastReplyCard(replyList), { block: "center" });
  });
  return button;
}
