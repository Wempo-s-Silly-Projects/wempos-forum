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

// Batch I item 4: a square crop (drag to frame, wheel or pinch to zoom)
// before the avatar upload. Cropper.js 1.6.2 (MIT, vendored verbatim) is the
// 1.x line on purpose: it styles through a same-origin stylesheet and CSSOM
// writes, which the CSP allows, where 2.x injects shadow-root <style>. The
// cropped Blob goes to the EXISTING upload call; the server still validates
// every byte. GIFs skip the cropper (cropping would drop their animation),
// and if the cropper cannot load the picked file uploads as it is.
import { t } from "./i18n.js";

// Mirrors constants.mjs AVATAR_CROP_SIZE (pinned equal by the tests).
export const AVATAR_CROP_SIZE = 512;
const CROPPER_SCRIPT = "./vendor/cropper.esm.js";
const CROPPER_STYLESHEET = "/js/vendor/cropper.min.css";
const LOSSY_QUALITY = 0.9;
const KEPT_TYPES = new Set(["image/png", "image/webp", "image/jpeg"]);

export const cropOutputType = (type) => (KEPT_TYPES.has(type) ? type : "image/jpeg");

export function shouldCropAvatar(file) {
  return Boolean(file && Number(file.size) > 0 && typeof file.type === "string" &&
    file.type.startsWith("image/") && file.type !== "image/gif");
}

// The cropper's selection, drawn onto an AVATAR_CROP_SIZE square, as a Blob.
export function cropToBlob(cropper, type) {
  const canvas = cropper.getCroppedCanvas({
    width: AVATAR_CROP_SIZE,
    height: AVATAR_CROP_SIZE,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
    fillColor: type === "image/jpeg" ? "#fff" : "transparent",
  });
  if (!canvas || typeof canvas.toBlob !== "function") return Promise.reject(new Error("crop-canvas"));
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("crop-blob"))), type, LOSSY_QUALITY);
  });
}

let cropperLoading = null;

function loadCropper(document) {
  cropperLoading ??= (async () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CROPPER_STYLESHEET;
    document.head.append(link);
    const module = await import(CROPPER_SCRIPT);
    return module.default;
  })();
  return cropperLoading;
}

function buildDialog(document, source) {
  const dialog = document.createElement("dialog");
  dialog.className = "profile2-crop-dialog";
  const title = document.createElement("h2");
  title.id = "profile2-crop-title";
  title.textContent = t("profile2.cropTitle");
  dialog.setAttribute("aria-labelledby", title.id);
  const stage = document.createElement("div");
  stage.className = "profile2-crop-stage";
  const image = document.createElement("img");
  image.alt = "";
  image.src = source;
  stage.append(image);
  const actions = document.createElement("div");
  actions.className = "profile2-crop-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("common.cancel");
  const use = document.createElement("button");
  use.type = "button";
  use.className = "primary";
  use.textContent = t("profile2.cropUse");
  actions.append(cancel, use);
  dialog.append(title, stage, actions);
  return { dialog, image, cancel, use };
}

// Resolves the cropped Blob, the original file when cropping is unavailable,
// or null when the member cancels (the upload is then skipped).
export async function cropAvatarFile(document, file, { load = loadCropper } = {}) {
  const urls = document.defaultView?.URL ?? globalThis.URL;
  let Cropper;
  try {
    Cropper = await load(document);
  } catch {
    return file;
  }
  const source = urls.createObjectURL(file);
  const { dialog, image, cancel, use } = buildDialog(document, source);
  if (typeof dialog.showModal !== "function") {
    urls.revokeObjectURL(source);
    return file;
  }
  document.body.append(dialog);
  dialog.showModal();
  const cropper = new Cropper(image, {
    aspectRatio: 1, viewMode: 1, dragMode: "move", autoCropArea: 1, background: false,
  });
  return new Promise((resolve) => {
    const finish = (result) => {
      cropper.destroy();
      urls.revokeObjectURL(source);
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    use.addEventListener("click", () => {
      use.disabled = true;
      cropToBlob(cropper, cropOutputType(file.type)).then(finish, () => finish(file));
    });
  });
}
