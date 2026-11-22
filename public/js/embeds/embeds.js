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

// Embeds (v5.76, Batch D): the one entry point render.js calls for each body
// paragraph. A paragraph that is exactly one embeddable link comes back as a
// div.post-body host (so the edit form hides it like any body paragraph)
// holding the embed figure; anything else returns null and renders as text.
// Every embed is click-to-load (YouTube, 3D) or same-origin only (video,
// audio): nothing contacts a third party until the reader explicitly asks.
import { classifyEmbed, standaloneLink } from "./classify.js";
import { createVendorLoader } from "./loader.js";
import { createYouTubeFacade } from "./youtube.js";
import { createMediaPlayer } from "./media.js";
import { createModelEmbed } from "./model.js";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"; // i18n-ignore

function prefersReducedMotion() {
  try {
    return Boolean(globalThis.matchMedia?.(REDUCED_MOTION_QUERY)?.matches);
  } catch {
    return false;
  }
}

function buildFigure(document, embed, ctx) {
  if (embed.kind === "youtube") return createYouTubeFacade(document, embed, ctx);
  if (embed.kind === "model") return createModelEmbed(document, embed, ctx);
  return createMediaPlayer(document, embed, ctx);
}

export function createEmbed(document, text, options = {}) {
  const link = standaloneLink(text);
  if (!link) return null;
  const origin = options.origin ?? globalThis.location?.origin ?? null;
  const embed = classifyEmbed(link.url, origin);
  if (!embed) return null;
  try {
    const ctx = {
      origin,
      label: link.label,
      reducedMotion: options.reducedMotion ?? prefersReducedMotion(),
      loader: options.loader ?? createVendorLoader(document),
    };
    const host = document.createElement("div");
    host.className = "post-body";
    host.dataset.embed = embed.kind;
    host.append(buildFigure(document, embed, ctx));
    return host;
  } catch {
    // A DOM without what an embed needs: the paragraph renders as text.
    return null;
  }
}

// A body paragraph keeps its blank lines (parseBlocks), so it is cut into
// blank-line-separated runs; a run that is one embeddable link becomes an
// embed and every other run goes back through renderText (the caller's
// ordinary paragraph). No embeddable run: null, and the caller renders the
// paragraph exactly as before.
export function embedParagraph(document, text, renderText, options = {}) {
  const runs = [];
  let current = [];
  for (const line of String(text ?? "").split("\n")) {
    if (line.trim() === "") {
      if (current.length) runs.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) runs.push(current.join("\n"));
  const embeds = runs.map((run) => createEmbed(document, run, options));
  if (!embeds.some(Boolean)) return null;
  return runs.map((run, index) => embeds[index] ?? renderText(run));
}
