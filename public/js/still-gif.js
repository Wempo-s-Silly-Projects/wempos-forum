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

// Still GIF frames under prefers-reduced-motion (wave 5.73.1 chat code,
// shared since the posts/gallery wave). A GIF shows its first frame on a
// <canvas>; callers decide WHEN (they check prefersReducedMotion()). Only
// same-origin images are drawn, so a canvas is never tainted; a cross-origin
// image, a canvas without a 2d context, or an undecodable frame leaves the
// plain animated <img> in place. No DOM access at import time.

export const GIF_MIME = "image/gif";
const GIF_BADGE_TEXT = "GIF"; // i18n-ignore (format name, as chat's GIF button)
const DEFAULT_LOADING_CLASS = "still-gif-loading";

// Same-origin check on an image URL: a root-relative path, or an absolute URL
// whose origin is the page's own. Protocol-relative, data: and foreign URLs
// are not drawn.
export function isSameOriginImage(src, origin = globalThis.location?.origin) {
  const text = String(src ?? "");
  if (text.startsWith("/") && !text.startsWith("//")) return true;
  if (!origin) return false;
  try {
    return new URL(text, origin).origin === origin;
  } catch {
    return false;
  }
}

// The image's current frame on a same-size canvas, or null. A named image
// (non-empty alt) names its canvas too.
export function stillFrameOf(doc, img, className = "") {
  const canvas = doc.createElement("canvas");
  if (className) canvas.className = className;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  if (img.alt) {
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", img.alt);
  }
  const context = canvas.getContext?.("2d");
  if (!context) return null;
  try {
    context.drawImage(img, 0, 0);
  } catch {
    return null;
  }
  return canvas;
}

// Hides the image (visibility, so lazy loading still fires) until it loads,
// then hands its still frame to onStill. False (and nothing done) for a
// cross-origin image.
export function freezeWhenLoaded(doc, img, { stillClass = "", loadingClass = DEFAULT_LOADING_CLASS } = {}, onStill) {
  if (!isSameOriginImage(img.src)) return false;
  img.classList.add(loadingClass);
  img.addEventListener("load", () => {
    const still = stillFrameOf(doc, img, stillClass);
    img.classList.remove(loadingClass);
    if (still) onStill(still);
  }, { once: true });
  return true;
}

// Still-only (no toggle): the frame sits just before the image, which is
// hidden but kept (callers that read img.src keep working).
export function freezeInPlace(doc, img, options = {}) {
  return freezeWhenLoaded(doc, img, options, (still) => {
    img.parentNode?.insertBefore(still, img);
    img.hidden = true;
  });
}

// The play/pause toggle (aria-pressed, labelled by the caller's existing
// key). Without `host` the button itself holds the media and swaps canvas and
// image (chat). With `host`, the media stays in the host — image kept, hidden
// or shown — and the button is a small "GIF" badge (post attachments, whose
// host is the lightbox button). Clicks before the frame is captured do
// nothing. Null for a cross-origin image (the caller keeps the plain <img>).
export function stillGifToggle(doc, img, { label, buttonClass, stillClass = "", loadingClass, host = null }) {
  if (!isSameOriginImage(img.src)) return null;
  const button = doc.createElement("button");
  button.type = "button";
  button.className = buttonClass;
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-label", label);
  let still = null;
  const show = (playing) => {
    if (!host) {
      button.replaceChildren(playing ? img : still);
      return;
    }
    img.hidden = !playing;
    still.hidden = playing;
  };
  freezeWhenLoaded(doc, img, { stillClass, loadingClass }, (canvas) => {
    still = canvas;
    if (host) host.insertBefore(still, img);
    show(false);
  });
  button.addEventListener("click", () => {
    if (!still) return;
    const playing = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(playing));
    show(playing);
  });
  if (host) button.textContent = GIF_BADGE_TEXT;
  else button.append(img);
  return button;
}
