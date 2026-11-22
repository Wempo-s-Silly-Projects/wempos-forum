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

// Embeds (v5.76): the YouTube facade. Until the reader presses play the post
// holds only local markup: a button with the link's own title text and a
// plain "Open on YouTube" link (navigation only, nothing fetched). No
// thumbnail from YouTube's image host, no preconnect, no script. The press
// swaps in one youtube-nocookie.com iframe; with prefers-reduced-motion the
// video loads
// paused instead of autoplaying. lite-youtube-embed is deliberately not
// vendored: it paints a YouTube poster on connect and preconnects to Google
// hosts on hover, both before any click.
import { t } from "../i18n.js";
import { YOUTUBE_EMBED_ORIGIN } from "./classify.js";

const FRAME_ALLOW = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"; // i18n-ignore
const FRAME_REFERRER_POLICY = "strict-origin-when-cross-origin";

export function youtubeEmbedSrc({ id, start }, { reducedMotion = false } = {}) {
  const params = new URLSearchParams();
  if (!reducedMotion) params.set("autoplay", "1");
  if (start > 0) params.set("start", String(start));
  const query = params.toString();
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${encodeURIComponent(id)}${query ? "?" + query : ""}`;
}

export function youtubeWatchUrl({ id, start }) {
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", id);
  if (start > 0) url.searchParams.set("t", String(start));
  return url.href;
}

const element = (document, tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function createFrame(document, embed, title, reducedMotion) {
  const frame = element(document, "iframe", "embed-youtube-frame");
  frame.setAttribute("src", youtubeEmbedSrc(embed, { reducedMotion }));
  frame.setAttribute("title", title);
  frame.setAttribute("allow", FRAME_ALLOW);
  frame.setAttribute("allowfullscreen", "");
  frame.setAttribute("referrerpolicy", FRAME_REFERRER_POLICY);
  return frame;
}

export function createYouTubeFacade(document, embed, { label = "", reducedMotion = false } = {}) {
  const title = label || t("embed.youtubeTitle");
  const figure = element(document, "figure", "embed embed-youtube");
  const stage = element(document, "div", "embed-youtube-stage");
  const button = element(document, "button", "embed-youtube-play");
  button.type = "button";
  button.setAttribute("aria-label", t("embed.youtubePlay", { title }));
  const icon = element(document, "span", "embed-youtube-icon");
  icon.setAttribute("aria-hidden", "true");
  button.append(
    icon,
    element(document, "span", "embed-youtube-title", title),
    element(document, "span", "embed-youtube-notice", t("embed.youtubeNotice")),
  );
  stage.append(button);
  const caption = element(document, "figcaption", "embed-caption");
  const original = element(document, "a", "embed-original", t("embed.youtubeOpen"));
  original.setAttribute("href", youtubeWatchUrl(embed));
  original.setAttribute("target", "_blank");
  original.setAttribute("rel", "noopener noreferrer"); // i18n-ignore
  caption.append(original);
  figure.append(stage, caption);
  let played = false;
  button.addEventListener("click", () => {
    if (played) return;
    played = true;
    const frame = createFrame(document, embed, title, reducedMotion);
    stage.replaceChildren(frame);
    if (typeof frame.focus === "function") frame.focus();
  });
  return figure;
}
