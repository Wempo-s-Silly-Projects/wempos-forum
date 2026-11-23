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

// Embeds on demand (v5.84 load order): what render.js calls for each body
// paragraph. Only the small, DOM-free classifier is loaded with the page;
// the players (YouTube facade, media, waveform, 3D model) are imported the
// first time a rendered body actually holds an embeddable link. The host
// div.post-body[data-embed] is returned at once, holding the plain link,
// and the embed figure takes its place as soon as embeds.js has loaded. If
// that import fails, the plain link simply stays.
import { classifyEmbed, paragraphRuns, standaloneLink } from "./classify.js";
import { siteModuleOn } from "../site-modules.js";

let loading = null;

export function loadEmbeds(importEmbeds = () => import("./embeds.js")) {
  if (!loading) {
    loading = importEmbeds();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

function embedKind(run, origin) {
  const link = standaloneLink(run);
  return link ? classifyEmbed(link.url, origin)?.kind ?? null : null;
}

function embedHost(document, run, kind, renderText, options, load) {
  let host;
  try {
    host = document.createElement("div");
    host.className = "post-body";
    host.dataset.embed = kind;
    const link = renderText(run);
    link.className = "embed-pending";
    host.append(link);
  } catch {
    return renderText(run);
  }
  load().then((embeds) => {
    const embed = embeds.createEmbed(document, run, options);
    if (embed) host.replaceChildren(...Array.from(embed.childNodes));
  }).catch(() => {
    // The plain link stays: the designed fallback.
  });
  return host;
}

// Same contract as embeds.js embedParagraph: null when no run embeds, else
// one node per run (a host for each embeddable run, renderText otherwise).
// The owner's "embeds" module off (docs/modules.md): links stay plain links.
export function embedParagraph(document, text, renderText, options = {}, load = () => loadEmbeds()) {
  if (!siteModuleOn("embeds")) return null;
  const runs = paragraphRuns(text);
  const origin = options.origin ?? globalThis.location?.origin ?? null;
  const kinds = runs.map((run) => embedKind(run, origin));
  if (!kinds.some(Boolean)) return null;
  return runs.map((run, index) => (kinds[index]
    ? embedHost(document, run, kinds[index], renderText, { ...options, origin }, load)
    : renderText(run)));
}
