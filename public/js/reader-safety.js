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

// Reader safety (batch L): the one hook render.js calls after it has built a
// post body. Each step is independent and failure-proof — a step that
// throws (or a test DOM without some API) leaves the body exactly as
// rendered: the lookalike-link guard (installed once per document), the
// language hint, the opt-in strong-language blur, and the click-to-load
// preview buttons under standalone links.
import { applyPostLanguage } from "./lang-detect.js";
import { addPreviewButtons } from "./link-preview.js";
import { installLinkGuard } from "./link-safety.js";
import { applyStrongLanguageBlur } from "./strong-language.js";

// The blocks renderBodyBlocks appends: the post card's header, buttons and
// footer keep the reader's own interface language.
const BODY_BLOCK_CLASSES = ["post-body", "post-heading", "md-list", "post-quote"];
const bodyBlocks = (article) => Array.from(article.children ?? []).filter((child) =>
  String(child.className ?? "").split(/\s+/).some((name) => BODY_BLOCK_CLASSES.includes(name)));

const quietly = (step) => {
  try {
    const result = step();
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {
    // The body stays exactly as rendered.
  }
};

export function applyReaderSafety(document, article, body) {
  if (!document || !article) return;
  quietly(() => installLinkGuard(document));
  const blocks = bodyBlocks(article);
  quietly(() => applyPostLanguage(blocks, body));
  for (const block of blocks) quietly(() => applyStrongLanguageBlur(block, { document }));
  quietly(() => addPreviewButtons(document, article));
}
