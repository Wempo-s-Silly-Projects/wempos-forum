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

import { prefersReducedMotion } from "./focus-utils.js";
import { t } from "./i18n.js";
import { attachFullscreenToggle } from "./lightbox-fullscreen.js";
import { GIF_MIME, stillGifToggle } from "./still-gif.js";

// Image viewer (wave 2026-11-21-21 F1): the native #attachment-lightbox
// dialog grows a close button, previous/next buttons, an "Image 2 of 3"
// counter and arrow/Home/End keys that step between the images of the SAME
// post strip. Nothing new becomes reachable: the viewer only walks the
// .attachment-expand buttons already rendered in that strip, using their own
// versioned URLs. showModal() keeps the page behind it inert; on close focus
// goes back to the thumbnail of the image last shown (not merely the one
// first clicked). A click on the backdrop or the image closes, as before.
// The controls are built once per dialog, lazily, with createElement.
// Wave 5.14 F3: an "Actual size" toggle flips the dialog's data-size between
// "fit" (viewport-capped, the default) and "actual" (natural pixels, the
// dialog scrolls); stepping to another image or closing resets it to fit.
// Page-view only: nothing is stored and nothing is fetched.
// Media lane: a full-screen toggle (lightbox-fullscreen.js, screenfull loaded
// on first press) puts the whole viewer dialog in full screen.

const STRIP_SELECTOR = ".post-attachments";
const THUMB_SELECTOR = ".attachment-expand";
const controllers = new WeakMap();

// New index for a navigation key, or null when the key is not ours. Ends
// clamp rather than wrap so the counter never jumps from last to first.
// Right-to-left pages mirror the arrows (ArrowLeft moves forward).
export function stepIndex(index, total, key, rtl = false) {
  if (total < 2) return null;
  const forward = rtl ? "ArrowLeft" : "ArrowRight";
  const backward = rtl ? "ArrowRight" : "ArrowLeft";
  if (key === forward) return Math.min(total - 1, index + 1);
  if (key === backward) return Math.max(0, index - 1);
  if (key === "Home") return 0;
  if (key === "End") return total - 1;
  return null;
}

// The thumbnails that share the clicked button's strip, in page order.
export function stripThumbs(button) {
  const strip = button?.closest?.(STRIP_SELECTOR);
  if (!strip) return button ? [button] : [];
  return [...strip.querySelectorAll(THUMB_SELECTOR)];
}

const hasImage = (thumb) => Boolean(thumb?.querySelector?.("img"));

const iconlessButton = (document, className, label, text) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.textContent = text;
  return button;
};

function buildControls(dialog, document) {
  const close = iconlessButton(document, "lightbox-close", t("common.close"), "×");
  const previous = iconlessButton(document, "lightbox-step lightbox-previous", t("lightbox.previous"), "‹");
  const next = iconlessButton(document, "lightbox-step lightbox-next", t("lightbox.next"), "›");
  const size = iconlessButton(document, "lightbox-size", t("lightbox.actualSize"), t("lightbox.actualSize"));
  size.setAttribute("aria-pressed", "false");
  const fullscreen = iconlessButton(document, "lightbox-fullscreen", t("embed.player.enterFullscreen"),
    t("embed.player.enterFullscreen"));
  attachFullscreenToggle(dialog, fullscreen);
  const counter = document.createElement("p");
  counter.className = "lightbox-counter";
  counter.setAttribute("aria-live", "polite");
  dialog.append(close, size, fullscreen, previous, next, counter);
  return { close, size, previous, next, counter };
}

// Reduced motion (shared still-gif.js): a GIF shows its still first frame on
// a fresh <img> mounted beside the shared viewer image, plus chat's
// play/pause badge. A fresh image per GIF (its src dropped on teardown) means
// a late load never paints a frame over the next image shown.
function createGifView(dialog, document, image) {
  const view = { gif: null, toggle: null };
  const clear = () => {
    if (!view.gif) return;
    view.gif.removeAttribute("src");
    dialog.querySelectorAll(".lightbox-still").forEach((still) => still.remove());
    view.gif.remove();
    view.toggle.remove();
    view.gif = null;
    view.toggle = null;
    image.hidden = false;
  };
  const show = (source) => {
    if (source.dataset?.mime !== GIF_MIME || !prefersReducedMotion()) return;
    const gif = document.createElement("img");
    gif.className = "lightbox-gif";
    gif.alt = "";
    gif.src = source.src;
    dialog.append(gif);
    const toggle = stillGifToggle(document, gif, {
      label: t("chat.gifAlt"), buttonClass: "still-gif-toggle lightbox-gif-toggle", stillClass: "lightbox-still", host: dialog,
    });
    if (!toggle) {
      gif.remove();
      return;
    }
    dialog.append(toggle);
    view.gif = gif;
    view.toggle = toggle;
    image.hidden = true;
  };
  const isMedia = (node) => Boolean(node) && (node === view.gif || node.classList?.contains("lightbox-still") === true);
  return { clear, show, isMedia };
}

function createController(dialog, document) {
  const image = dialog.querySelector("img");
  const controls = buildControls(dialog, document);
  const gifView = createGifView(dialog, document, image);
  const view = { thumbs: [], index: 0 };
  const isRtl = () => document.documentElement?.dir === "rtl";
  const setActualSize = (actual) => {
    dialog.dataset.size = actual ? "actual" : "fit";
    controls.size.setAttribute("aria-pressed", actual ? "true" : "false");
  };

  const show = (index) => {
    const thumb = view.thumbs[index];
    const source = thumb?.querySelector("img");
    if (!source || !image) return;
    view.index = index;
    gifView.clear();
    image.src = source.src;
    gifView.show(source);
    setActualSize(false);
    const total = view.thumbs.length;
    controls.counter.hidden = total < 2;
    controls.counter.textContent = total < 2 ? "" : t("lightbox.counter", { index: index + 1, total });
    controls.previous.hidden = total < 2;
    controls.next.hidden = total < 2;
    controls.previous.disabled = index === 0;
    controls.next.disabled = index === total - 1;
  };

  // Wave 22 a11y: reaching an end disables the step button that has focus;
  // a disabled control drops focus out of the dialog, so hand it to the
  // opposite step button instead.
  const keepStepFocus = (from) => {
    if (from !== controls.previous && from !== controls.next) return;
    if (!from.disabled) return;
    const other = from === controls.next ? controls.previous : controls.next;
    (other.disabled || other.hidden ? controls.close : other).focus();
  };
  controls.close.addEventListener("click", () => dialog.close());
  controls.size.addEventListener("click", () => setActualSize(dialog.dataset.size !== "actual"));
  controls.previous.addEventListener("click", () => {
    show(Math.max(0, view.index - 1));
    keepStepFocus(controls.previous);
  });
  controls.next.addEventListener("click", () => {
    show(Math.min(view.thumbs.length - 1, view.index + 1));
    keepStepFocus(controls.next);
  });
  dialog.addEventListener("click", (event) => {
    const onImage = event.target === image || gifView.isMedia(event.target);
    // At actual size a click on the image zooms back out to fit first.
    if (onImage && dialog.dataset.size === "actual") {
      setActualSize(false);
      return;
    }
    if (event.target === dialog || onImage) dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    const target = stepIndex(view.index, view.thumbs.length, event.key, isRtl());
    if (target === null) return;
    event.preventDefault();
    show(target);
    keepStepFocus(event.target);
  });
  // The close event fires after the dialog's own focus restore, so this
  // focus call wins: the reader lands on the image they were last viewing.
  dialog.addEventListener("close", () => {
    const thumb = view.thumbs[view.index];
    if (thumb?.isConnected !== false) thumb?.focus?.();
    view.thumbs = [];
    gifView.clear();
    setActualSize(false);
  });

  return {
    open(button) {
      // Wave 24: a thumbnail with no <img> is skipped, and clicking one never
      // reopens the viewer on the previously shown image.
      const thumbs = stripThumbs(button).filter(hasImage);
      if (!thumbs.includes(button)) {
        gifView.clear();
        image?.removeAttribute("src");
        return;
      }
      view.thumbs = thumbs;
      show(thumbs.indexOf(button));
      if (!dialog.open) dialog.showModal();
      controls.close.focus();
    },
  };
}

export function openLightbox(dialog, button, document = globalThis.document) {
  if (!dialog || !button) return;
  let controller = controllers.get(dialog);
  if (!controller) {
    controller = createController(dialog, document);
    controllers.set(dialog, controller);
  }
  controller.open(button);
}
