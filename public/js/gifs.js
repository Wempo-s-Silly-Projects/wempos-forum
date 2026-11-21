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

// Gallery picker (v3.0.1, was the GIF picker): the composer's Gallery button opens a dialog of the
// APPROVED library; members multi-select up to the composer's spare
// attachment slots; confirmed picks ride the SAME submission as files
// (form.composerGifs — gifIds fields), so server-side validation/limits
// apply identically. Lazy <img> in the grid (modern-web: offscreen media
// defers its network request).
import { MAX_COMPOSER_FILES } from "./attachments.js";
import { t } from "./i18n.js";

export const GIF_PICKER_DIALOG_ID = "gif-picker";

export function spareComposerSlots(form) {
  const files = Array.isArray(form.composerFiles) ? form.composerFiles.length : 0;
  const gifs = Array.isArray(form.composerGifs) ? form.composerGifs.length : 0;
  return Math.max(0, MAX_COMPOSER_FILES - files - gifs);
}

export function addGifsToComposer(form, gifIds) {
  const current = Array.isArray(form.composerGifs) ? form.composerGifs : [];
  const spare = spareComposerSlots(form);
  const picked = gifIds.slice(0, spare);
  const overflow = gifIds.length - picked.length;
  form.composerGifs = current.concat(picked);
  return { added: picked, overflow };
}

export function removeGifFromComposer(form, gifId) {
  const current = Array.isArray(form.composerGifs) ? form.composerGifs : [];
  form.composerGifs = current.filter((id) => id !== gifId);
}

export function renderGifThumbs(document, form) {
  const wrap = document.createElement("div");
  wrap.className = "gif-thumbs";
  for (const gifId of Array.isArray(form.composerGifs) ? form.composerGifs : []) {
    const chip = document.createElement("div");
    chip.className = "gif-chip";
    const img = document.createElement("img");
    img.src = "/api/gifs/" + encodeURIComponent(gifId);
    img.loading = "lazy";
    img.alt = t("gifs.selectedImage");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "gif-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", t("gifs.removeImage"));
    remove.dataset.action = "remove-gif";
    remove.dataset.gifId = gifId;
    chip.append(img, remove);
    wrap.append(chip);
  }
  return wrap;
}
