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

// Save thread as text (wave 5.26 F1, client-only). The file is built only
// from the post cards the thread page already shows: anything inside
// [hidden] (filtered replies) is skipped, a folded reply keeps only its
// header line, and an unrevealed spoiler stays as the spoiler mask. Nothing
// is fetched or stored; the text is handed to the browser as a Blob download
// and the object URL is revoked afterwards.
import { t } from "./i18n.js";
import { postPermalink } from "./copy-link.js";
import { SPOILER_MASK } from "./markdown.js";

export const THREAD_TEXT_TYPE = "text/plain;charset=utf-8"; // i18n-ignore
export const THREAD_TEXT_SEPARATOR = "-".repeat(40);
export const SLUG_MAX = 60;
export const SLUG_FALLBACK = "thread"; // i18n-ignore
export const TITLE_MAX = 80;
// Some browsers read the Blob URL after the click returns (as data-export.js).
const REVOKE_DELAY_MS = 1000;
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const THREAD_ID_PATTERN = /^[0-9]{1,15}$/;
const BODY_CLASSES = new Set(["post-body", "post-quote", "post-codeblock", "post-heading", "md-list"]);

const classTokens = (node) => String(node?.className ?? "").split(/\s+/);
const isHiddenNode = (node) => node?.hidden === true || Boolean(node?.hasAttribute?.("hidden"));

function isShown(node) {
  for (let cur = node; cur && cur.nodeType === ELEMENT_NODE; cur = cur.parentNode) {
    if (isHiddenNode(cur)) return false;
  }
  return true;
}

// The text a reader sees: hidden nodes dropped, unrevealed spoilers masked.
function visibleText(node) {
  if (node.nodeType === TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== ELEMENT_NODE || isHiddenNode(node)) return "";
  const tokens = classTokens(node);
  if (tokens.includes("spoiler") && !tokens.includes("spoiler-revealed")) return SPOILER_MASK;
  if (node.tagName === "BR") return "\n";
  if (!node.childNodes.length) return node.textContent ?? "";
  return Array.from(node.childNodes, visibleText).join("");
}

function blockText(block) {
  const tokens = classTokens(block);
  if (tokens.includes("md-list")) {
    return Array.from(block.children).filter((item) => !isHiddenNode(item))
      .map((item) => "- " + visibleText(item).trim()).join("\n");
  }
  const text = visibleText(block);
  if (tokens.includes("post-quote")) return text.split("\n").map((line) => "> " + line).join("\n");
  return text;
}

const pad = (value) => String(value).padStart(2, "0");

// Absolute local time as "YYYY-MM-DD HH:MM", or "" for anything unparsable.
export function formatLocalDate(value) {
  const date = new Date(value ?? "");
  if (value == null || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function cardEntry(card) {
  const time = card.querySelector("time.post-time");
  const name = card.querySelector(".author-name");
  const body = card.hasAttribute("data-folded") ? "" : Array.from(card.children)
    .filter((child) => classTokens(child).some((name) => BODY_CLASSES.has(name)) && !isHiddenNode(child))
    .map(blockText).join("\n").trim();
  return {
    author: name ? visibleText(name).trim() : "",
    date: formatLocalDate(time?.dataset?.createdAt) || (time?.textContent ?? "").trim(),
    body,
  };
}

function threadTitle(entry) {
  const line = String(entry?.body ?? "").split("\n").map((part) => part.trim()).find(Boolean);
  return line ? line.slice(0, TITLE_MAX) : t("app.pagePost");
}

function composeThread(root, { threadId, origin, siteName }) {
  const cards = Array.from(root?.querySelectorAll?.("article.post-card") ?? []).filter(isShown);
  const entries = cards.map(cardEntry);
  const title = threadTitle(entries[0]);
  const link = postPermalink(origin, threadId);
  const lines = [link ? `${siteName} — ${link}` : siteName, "", title, THREAD_TEXT_SEPARATOR];
  for (const entry of entries) {
    lines.push(`${entry.author} — ${entry.date}`);
    if (entry.body) lines.push(entry.body);
    lines.push(THREAD_TEXT_SEPARATOR);
  }
  return { title, text: lines.join("\n") + "\n" };
}

export function buildThreadText(root, {
  threadId,
  origin = globalThis.location?.origin ?? "",
  siteName = t("app.siteName"),
} = {}) {
  return composeThread(root, { threadId, origin, siteName }).text;
}

// "<slug>-<id>.txt": the slug keeps lowercase ASCII letters, digits and
// single hyphens only (accents folded, everything else dropped), max
// SLUG_MAX characters, "thread" when nothing is left. A non-numeric id is
// left out, so no path character can reach the name.
export function threadFileName(title, threadId) {
  const slug = String(title ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, SLUG_MAX).replace(/-+$/, "") || SLUG_FALLBACK;
  const id = String(threadId ?? "");
  return slug + (THREAD_ID_PATTERN.test(id) ? "-" + id : "") + ".txt";
}

export function saveThreadAsText({
  doc = document,
  root,
  threadId,
  origin = globalThis.location?.origin ?? "",
  siteName = t("app.siteName"),
  urls = URL,
  BlobImpl = Blob,
  schedule = (fn) => setTimeout(fn, REVOKE_DELAY_MS),
}) {
  const { title, text } = composeThread(root, { threadId, origin, siteName });
  const href = urls.createObjectURL(new BlobImpl([text], { type: THREAD_TEXT_TYPE }));
  const link = doc.createElement("a");
  link.href = href;
  link.download = threadFileName(title, threadId);
  link.hidden = true;
  doc.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    schedule(() => urls.revokeObjectURL(href));
  }
}

export function createSaveThreadButton(doc, { getRoot, threadId, ...options }) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "button button-quiet save-thread-text";
  button.textContent = t("post.saveAsText");
  button.setAttribute("aria-label", t("post.saveAsTextLabel"));
  button.setAttribute("title", t("post.saveAsTextLabel"));
  button.addEventListener("click", (event) => {
    event?.preventDefault?.();
    saveThreadAsText({ doc, root: getRoot(), threadId, ...options });
  });
  return button;
}
