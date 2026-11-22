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

// Embeds (v5.76): a same-origin .glb/.gltf as an interactive 3D viewer,
// click-to-load. Before the press the post holds one button; the ~1 MB
// vendored <model-viewer> bundle and the model itself load only after it.
// Upstream fetches Draco/KTX2 decoders and the Lottie loader from Google
// and public CDN hosts; the global config read at module start points them
// at a same-origin folder that ships nothing, so a model needing them fails
// to decode instead of calling out. No auto-rotate, no interaction-prompt
// animation, no AR (which would hand off to a vendor app).
import { t } from "../i18n.js";

export const MODEL_VIEWER_SRC = "/js/vendor/model-viewer.min.js";
const MODEL_VIEWER_DECODERS = "/js/vendor/model-viewer-decoders/";
const MODEL_VIEWER_TAG = "model-viewer";

export function modelViewerConfig() {
  return {
    dracoDecoderLocation: MODEL_VIEWER_DECODERS,
    ktx2TranscoderLocation: MODEL_VIEWER_DECODERS,
    meshoptDecoderLocation: MODEL_VIEWER_DECODERS + "meshopt_decoder.js",
    lottieLoaderLocation: MODEL_VIEWER_DECODERS + "lottie-loader.js",
  };
}

const element = (document, tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// The config must be in place before the bundle evaluates (it reads
// self.ModelViewerElement once, at load).
function configureViewer() {
  if (globalThis.customElements?.get?.(MODEL_VIEWER_TAG)) return;
  globalThis.ModelViewerElement = { ...(globalThis.ModelViewerElement ?? {}), ...modelViewerConfig() };
}

function createViewer(document, embed, name) {
  const viewer = document.createElement(MODEL_VIEWER_TAG);
  viewer.className = "embed-model-viewer";
  viewer.setAttribute("src", embed.url);
  viewer.setAttribute("alt", t("embed.modelAlt", { name }));
  viewer.setAttribute("camera-controls", "");
  viewer.setAttribute("touch-action", "pan-y");
  viewer.setAttribute("interaction-prompt", "none");
  viewer.setAttribute("shadow-intensity", "1");
  return viewer;
}

export function createModelEmbed(document, embed, ctx) {
  const name = ctx.label || embed.name;
  const figure = element(document, "figure", "embed embed-model");
  const stage = element(document, "div", "embed-model-stage");
  const button = element(document, "button", "embed-model-load");
  button.type = "button";
  button.append(
    element(document, "span", "embed-model-action", t("embed.modelLoad")),
    element(document, "span", "embed-model-name", name),
  );
  stage.append(button);
  const caption = element(document, "figcaption", "embed-caption");
  const link = element(document, "a", "embed-original", name);
  link.setAttribute("href", embed.url);
  link.setAttribute("rel", "internal");
  caption.append(link);
  figure.append(stage, caption);
  let started = false;
  button.addEventListener("click", () => {
    if (started) return undefined;
    started = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    configureViewer();
    return ctx.loader.import(MODEL_VIEWER_SRC).then(() => {
      stage.replaceChildren(createViewer(document, embed, name));
    }, () => {
      const note = element(document, "p", "embed-error", t("embed.loadFailed"));
      note.setAttribute("role", "status");
      stage.replaceChildren(note);
    });
  });
  return figure;
}
