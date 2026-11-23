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

// Link preview cards (batch L item 3, client): a paragraph that is nothing
// but one external https link gets a small "Show link preview" button. Only
// a click asks the forum (GET /api/link-preview, members only); the forum
// fetches the page, so the linked site never sees the reader. The card is
// text only — title, description, site — and never shows a third-party
// image. A refused or failed preview says so quietly.
import { api } from "./api.js";
import { t } from "./i18n.js";
import { siteModuleOn } from "./site-modules.js";

const PREVIEW_PATH = "/api/link-preview?url=";
const LINK_REL = "noopener noreferrer nofollow ugc"; // i18n-ignore

// The anchor when `paragraph` is exactly one external https link (its text
// is the whole paragraph), else null.
export function standaloneLink(paragraph, currentHost = globalThis.location?.host ?? "") {
  const elements = Array.from(paragraph?.children ?? []);
  if (elements.length !== 1 || elements[0].tagName !== "A") return null;
  const anchor = elements[0];
  if (String(paragraph.textContent ?? "").trim() !== String(anchor.textContent ?? "").trim()) return null;
  const href = anchor.getAttribute?.("href") ?? "";
  if (!/^https:\/\//i.test(href)) return null;
  try {
    return new URL(href).host === currentHost ? null : anchor;
  } catch {
    return null;
  }
}

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createPreviewCard(document, preview) {
  const card = element(document, "aside", "link-preview-card");
  card.setAttribute("aria-label", t("safety.previewLabel"));
  const link = element(document, "a", "link-preview-title", preview.title);
  link.setAttribute("href", preview.url);
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", LINK_REL);
  card.append(link);
  if (preview.description) card.append(element(document, "p", "link-preview-description", preview.description));
  card.append(element(document, "p", "link-preview-site muted", preview.siteName || preview.host));
  return card;
}

function previewButton(document, href, request) {
  const button = element(document, "button", "link-preview-show", t("safety.previewShow"));
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    const result = await request(PREVIEW_PATH + encodeURIComponent(href)).catch(() => null);
    const replacement = result?.ok && result.preview?.title
      ? createPreviewCard(document, result.preview)
      : element(document, "p", "link-preview-unavailable muted", t("safety.previewUnavailable"));
    button.replaceWith?.(replacement);
    if (!replacement.parentNode && button.parentNode) {
      button.parentNode.insertBefore(replacement, button);
      button.parentNode.removeChild(button);
    }
  });
  return button;
}

// Adds a button after each standalone-link paragraph directly inside
// `article`; returns how many it added. Nothing is fetched here. None while
// the owner has the "link-previews" module off (docs/modules.md).
export function addPreviewButtons(document, article, { request = api, currentHost } = {}) {
  if (!siteModuleOn("link-previews")) return 0;
  let count = 0;
  for (const paragraph of Array.from(article?.children ?? [])) {
    if (paragraph.tagName !== "P") continue;
    const anchor = standaloneLink(paragraph, currentHost);
    if (!anchor) continue;
    const button = previewButton(document, anchor.getAttribute("href"), request);
    if (paragraph.nextSibling !== undefined && paragraph.parentNode?.insertBefore) {
      paragraph.parentNode.insertBefore(button, paragraph.nextSibling ?? null);
    } else {
      article.append(button);
    }
    count += 1;
  }
  return count;
}
