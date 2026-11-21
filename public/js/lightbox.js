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

import { t } from "./i18n.js";

// Image viewer (wave 2026-11-21-21 F1): the native #attachment-lightbox
// dialog grows a close button, previous/next buttons, an "Image 2 of 3"
// counter and arrow/Home/End keys that step between the images of the SAME
// post strip. Nothing new becomes reachable: the viewer only walks the
// .attachment-expand buttons already rendered in that strip, using their own
// versioned URLs. showModal() keeps the page behind it inert; on close focus
// goes back to the thumbnail of the image last shown (not merely the one
// first clicked). A click on the backdrop or the image closes, as before.
// The controls are built once per dialog, lazily, with createElement.

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
  const counter = document.createElement("p");
  counter.className = "lightbox-counter";
  counter.setAttribute("aria-live", "polite");
  dialog.append(close, previous, next, counter);
  return { close, previous, next, counter };
}

function createController(dialog, document) {
  const image = dialog.querySelector("img");
  const controls = buildControls(dialog, document);
  const view = { thumbs: [], index: 0 };
  const isRtl = () => document.documentElement?.dir === "rtl";

  const show = (index) => {
    const thumb = view.thumbs[index];
    const source = thumb?.querySelector("img");
    if (!source || !image) return;
    view.index = index;
    image.src = source.src;
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
  controls.previous.addEventListener("click", () => {
    show(Math.max(0, view.index - 1));
    keepStepFocus(controls.previous);
  });
  controls.next.addEventListener("click", () => {
    show(Math.min(view.thumbs.length - 1, view.index + 1));
    keepStepFocus(controls.next);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target === image) dialog.close();
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
  });

  return {
    open(button) {
      const thumbs = stripThumbs(button);
      const index = Math.max(0, thumbs.indexOf(button));
      view.thumbs = thumbs;
      show(index);
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
