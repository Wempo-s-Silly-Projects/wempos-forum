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

// "Attach a sketch" (Batch M #8), behind the "sketch" switch: a composer
// button opens a small drawing dialog (signature_pad, loaded only on that
// click). "Attach sketch" turns the drawing into one PNG File and stages it
// through the composer's own pending-attachment path (the same Attach /
// Dismiss strip a pasted image gets), so it is checked by the same gate and
// uploaded only when the member posts. Nothing is stored or sent here.
import { t } from "../i18n.js";
import { stagePendingFiles } from "../composer-paste.js";
import { ensureFunStyles, loadVendor } from "./loader.js";
import { isFunOn } from "./settings.js";

// Mirrors constants.mjs (pinned equal by tests/batch-m-fun.test.mjs).
export const FUN_SKETCH_SIZE_PX = 480;
export const SKETCH_FILE_NAME = "sketch.png";
const PNG = "image/png";
const PAPER = "rgb(255, 255, 255)";

// canvas -> Promise<File> (FileCtor injectable for tests).
export function sketchToFile(canvas, FileCtor = globalThis.File) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error(PNG));
      resolve(new FileCtor([blob], SKETCH_FILE_NAME, { type: PNG }));
    }, PNG);
  });
}

const makeButton = (doc, className, text) => {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
};

async function openSketch(doc, form, env) {
  const SignaturePad = await (env.load ?? loadVendor)("signaturePad");
  ensureFunStyles(doc);
  const dialog = doc.createElement("dialog");
  dialog.className = "fun-sketch";
  dialog.setAttribute("aria-label", t("fun.sketchButton"));
  const canvas = doc.createElement("canvas");
  canvas.className = "fun-sketch-canvas";
  canvas.width = FUN_SKETCH_SIZE_PX;
  canvas.height = FUN_SKETCH_SIZE_PX;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", t("fun.sketchCanvas"));
  const pad = new SignaturePad(canvas, { backgroundColor: PAPER });
  const clear = makeButton(doc, "button button-quiet", t("fun.sketchClear"));
  const attach = makeButton(doc, "button", t("fun.sketchAttach"));
  const cancel = makeButton(doc, "button button-quiet", t("common.cancel"));
  const row = doc.createElement("div");
  row.className = "fun-sketch-actions";
  row.append(clear, attach, cancel);
  dialog.append(canvas, row);
  const close = () => { pad.off?.(); dialog.close?.(); dialog.remove(); };
  clear.addEventListener("click", () => pad.clear());
  cancel.addEventListener("click", close);
  dialog.addEventListener("cancel", close);
  attach.addEventListener("click", async () => {
    if (pad.isEmpty()) return;
    try {
      const file = await sketchToFile(canvas);
      (env.stage ?? stagePendingFiles)(form, [file], () => {});
    } finally {
      close();
    }
  });
  doc.body.append(dialog);
  dialog.showModal?.();
}

// The composer button, or null while the switch is off.
export function createSketchButton(doc, env = {}) {
  if (!isFunOn("sketch", env.storage)) return null;
  const button = makeButton(doc, "button button-quiet fun-sketch-open", t("fun.sketchButton"));
  button.addEventListener("click", () => {
    const form = button.closest?.("form") ?? null;
    if (form) openSketch(doc, form, env).catch(() => {});
  });
  return button;
}
