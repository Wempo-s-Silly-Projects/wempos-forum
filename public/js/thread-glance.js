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

import { t, tn } from "./i18n.js";
import { jumpToNode } from "./focus-utils.js";
// Thread at a glance (wave 2026-11-21 F4): a compact strip above a thread's
// replies — how many people are talking, an estimated read time, and a jump to
// the most-liked reply. Computed only from the posts already on the page (the
// server shaped them for this viewer), so it costs no extra request and can't
// surface anything hidden. Built with createElement/textContent only.

export const WORDS_PER_MINUTE = 220;
export const TOP_REPLY_MIN_LIKES = 2;

const wordCount = (body) => {
  const text = typeof body === "string" ? body.trim() : "";
  return text ? text.split(/\s+/).length : 0;
};

export function summarizeThread(root, replies) {
  const list = Array.isArray(replies) ? replies : [];
  const posts = [root, ...list].filter(Boolean);
  const names = new Set(posts
    .map((post) => post?.author?.username)
    .filter((name) => typeof name === "string" && name)
    .map((name) => name.toLowerCase()));
  const words = posts.reduce((total, post) => total + wordCount(post?.body), 0);
  // Strictly greater keeps the earliest reply on a tie (replies arrive oldest first).
  const topReply = list.reduce((best, reply) => {
    const likes = Number(reply?.likeCount) || 0;
    if (likes < TOP_REPLY_MIN_LIKES) return best;
    return !best || likes > (Number(best.likeCount) || 0) ? reply : best;
  }, null);
  return {
    participants: names.size,
    replyCount: list.length,
    readMinutes: Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)),
    topReply,
  };
}

// The strip itself. The top-reply button looks the card up at click time, so
// it keeps working after "Load older replies" repaints the list.
export function createThreadGlance(document, summary, scope) {
  const strip = document.createElement("div");
  strip.className = "thread-glance";
  strip.setAttribute("role", "group");
  strip.setAttribute("aria-label", t("glance.label"));
  const facts = [
    tn("glance.people", summary.participants),
    tn("glance.readTime", summary.readMinutes),
  ];
  for (const fact of facts) {
    const span = document.createElement("span");
    span.className = "thread-glance-fact";
    span.textContent = fact;
    strip.append(span);
  }
  if (summary.topReply) {
    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "button button-quiet thread-glance-top";
    jump.textContent = tn("glance.topReply", Number(summary.topReply.likeCount) || 0, {
      name: summary.topReply.author?.username ?? t("glance.aMember"),
    });
    jump.addEventListener("click", () => {
      const card = scope?.querySelector('[data-post-id="' + Number(summary.topReply.id) + '"]');
      if (!card) return;
      jumpToNode(card, { block: "center" });
      card.classList.add("post-spotlight");
      setTimeout(() => card.classList.remove("post-spotlight"), 1600);
    });
    strip.append(jump);
  }
  return strip;
}
