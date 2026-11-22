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

// Chat widget GIFs and message bodies (wave 2026-11-21-5 split): the
// `[gif:<id>]` token helpers, the approved-library picker both composers seat,
// and the body node every DM and lobby row paints through.
import { api } from "./api.js";
import { t } from "./i18n.js";
import { isEmojiOnly } from "./dm-effects.js";
import { fillImageBody, imageIdOf } from "./dm-extras.js";
import { el, ui } from "./chat-widget-state.js";
import { prefersReducedMotion } from "./focus-utils.js";

// GIFs in chat: a message whose WHOLE body is `[gif:<library-id>]` renders as
// the library image — the same by-reference convention posts use (gifIds
// point at the approved library; no byte copies), served from the existing
// /api/gifs/:id route. Bodies stay plain text on the wire and in D1.
const GIF_ID_SHAPE = /^[0-9a-f-]{36}$/;
const GIF_TOKEN = /^\[gif:([0-9a-f-]{36})\]$/;
export const GIF_PREVIEW_LABEL = "GIF";

export const gifIdOf = (body) => {
  const match = typeof body === "string" ? body.trim().match(GIF_TOKEN) : null;
  return match ? match[1] : null;
};

export const gifToken = (gifId) => `[gif:${gifId}]`;

// Wave 5.73.1: under prefers-reduced-motion a GIF shows its first frame on a
// <canvas>. The image is same-origin (/api/gifs/:id), so the canvas is never
// tainted. The <img> stays hidden (visibility, so lazy loading still fires)
// until the frame is captured; if the canvas cannot draw, the image shows.
const stillFrameOf = (img, className) => {
  const canvas = el("canvas", className);
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const context = canvas.getContext?.("2d");
  if (!context) return null;
  try {
    context.drawImage(img, 0, 0);
  } catch {
    return null; // undecodable frame: the caller keeps the animated image
  }
  return canvas;
};

const freezeWhenLoaded = (img, className, onStill) => {
  img.classList.add("chat-gif-loading");
  img.addEventListener("load", () => {
    const still = stillFrameOf(img, className);
    img.classList.remove("chat-gif-loading");
    if (still) onStill(still);
  }, { once: true });
};

// The reduced-motion message GIF: a toggle button (no new strings: the label
// is the image's own alt key) that swaps the still canvas and the animated
// image. Clicks before the frame is captured are ignored.
const reducedMotionGifButton = (img) => {
  const button = el("button", "chat-gif-toggle");
  button.type = "button";
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-label", t("chat.gifAlt"));
  let still = null;
  freezeWhenLoaded(img, "chat-gif", (canvas) => {
    still = canvas;
    button.replaceChildren(canvas);
  });
  button.addEventListener("click", () => {
    if (!still) return;
    const playing = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(playing));
    button.replaceChildren(playing ? img : still);
  });
  button.append(img);
  return button;
};

// A message body node: a GIF token becomes a lazy <img> from the library's
// serving route; anything else (and a token whose image 404s — unknown or
// unapproved ids) stays plain text. createElement/textContent only.
export const messageBodyNode = (className, body, { dm = false, authorName = "" } = {}) => {
  const node = el("p", className);
  const imageId = dm ? imageIdOf(body) : null;
  if (imageId) return fillImageBody(node, imageId, authorName);
  const gifId = gifIdOf(body);
  if (!gifId) {
    if (body !== undefined) node.textContent = body;
    if (dm && ui.effectsOn && isEmojiOnly(body)) node.classList.add("chat-emoji-jumbo");
    return node;
  }
  node.classList.add("chat-gif-body");
  const img = el("img", "chat-gif");
  img.src = "/api/gifs/" + encodeURIComponent(gifId);
  img.alt = t("chat.gifAlt");
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("error", () => {
    node.classList.remove("chat-gif-body");
    node.replaceChildren();
    node.textContent = body;
  }, { once: true });
  node.append(prefersReducedMotion() ? reducedMotionGifButton(img) : img);
  return node;
};

// The approved library (GET /api/gifs, the post composer picker's own list),
// cached for the panel's lifetime; ids are shape-checked before use.
const loadGifLibrary = async () => {
  if (ui.gifLibrary) return ui.gifLibrary;
  const data = await api("/api/gifs");
  const rows = Array.isArray(data?.gifs) ? data.gifs : [];
  ui.gifLibrary = rows.filter((gif) => typeof gif?.id === "string" && GIF_ID_SHAPE.test(gif.id));
  return ui.gifLibrary;
};

// The GIF button + its grid. The caller seats the toggle beside its Send
// button and the grid inside its composer (CSS floats it above). Picking a
// GIF closes the grid and hands the id to onPick.
export const buildGifPicker = (onPick) => {
  const toggle = el("button", "chat-widget-gif-button", "GIF");
  toggle.type = "button";
  toggle.setAttribute("aria-label", t("chat.sendGif"));
  toggle.setAttribute("aria-expanded", "false");
  const grid = el("div", "chat-widget-gif-grid");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", t("chat.gifLibrary"));
  grid.hidden = true;
  const closeGrid = () => {
    grid.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };
  const paintGrid = (gifs) => {
    grid.replaceChildren();
    if (gifs.length === 0) {
      grid.append(el("p", "chat-widget-gif-note", t("chat.gifsEmpty")));
      return;
    }
    for (const gif of gifs) {
      const pick = el("button", "chat-widget-gif-pick");
      pick.type = "button";
      pick.setAttribute("aria-label", t("chat.sendThisGif"));
      const img = el("img");
      img.src = typeof gif.url === "string" && gif.url.startsWith("/api/gifs/")
        ? gif.url : "/api/gifs/" + encodeURIComponent(gif.id);
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      if (prefersReducedMotion()) freezeWhenLoaded(img, "", (canvas) => pick.replaceChildren(canvas));
      pick.append(img);
      pick.addEventListener("click", () => {
        closeGrid();
        onPick(gif.id);
      });
      grid.append(pick);
    }
  };
  toggle.addEventListener("click", async () => {
    if (!grid.hidden) {
      closeGrid();
      return;
    }
    grid.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    grid.replaceChildren(el("p", "chat-widget-gif-note", t("chat.gifsLoading")));
    try {
      paintGrid(await loadGifLibrary());
    } catch {
      grid.replaceChildren(el("p", "chat-widget-gif-note", t("chat.gifsFailed")));
    }
  });
  grid.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault(); // handled here: the panel's own Escape stays put
    closeGrid();
    toggle.focus();
  });
  return { toggle, grid };
};
