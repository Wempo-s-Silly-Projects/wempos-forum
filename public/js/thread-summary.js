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

// The author's TL;DR box (v5.50.0, api/thread-summaries.mjs): a short summary
// above a thread's replies. Readers see it only when one exists; the thread's
// author and staff (canEdit — the server checks again) also get the editor.
// The shown text lands through textContent with spoilers masked; the editor
// prefills the raw text through .value. Nothing is stored on the device.
// Saving collapses whitespace to one line (the server refuses line breaks);
// saving an empty box removes the summary. A failed read removes the box.
import { api } from "./api.js";
import { t } from "./i18n.js";
import { maskSpoilers } from "./markdown.js";

export const THREAD_SUMMARY_MAX_CHARS = 280;

export function threadSummaryPath(postId) {
  const raw = String(postId);
  if (!/^[1-9][0-9]{0,14}$/.test(raw)) throw new RangeError("bad id");
  return "/api/posts/" + raw + "/summary";
}

function child(document, tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createEditor(document, box) {
  const input = child(document, "textarea", "thread-tldr-input");
  input.maxLength = THREAD_SUMMARY_MAX_CHARS;
  input.setAttribute("maxlength", String(THREAD_SUMMARY_MAX_CHARS));
  input.setAttribute("aria-label", t("tldr.label"));
  input.rows = 2;
  input.disabled = true;
  const save = child(document, "button", "button button-secondary thread-tldr-save", t("common.save"));
  save.type = "button";
  const remove = child(document, "button", "button button-quiet thread-tldr-remove", t("tldr.remove"));
  remove.type = "button";
  const status = child(document, "p", "muted thread-tldr-status");
  status.setAttribute("role", "status");
  const actions = child(document, "div", "thread-tldr-actions");
  actions.append(save, remove);
  box.append(child(document, "p", "muted thread-tldr-hint", t("tldr.hint")), input, actions, status);
  return { input, save, remove, status };
}

export function createThreadSummary(document, { postId, canEdit = false, request = api }) {
  const path = threadSummaryPath(postId);
  const box = child(document, "section", "panel thread-tldr");
  box.hidden = true;
  const body = child(document, "p", "thread-tldr-body");
  box.append(child(document, "h2", "thread-tldr-title", t("tldr.title")), body);
  const editor = canEdit ? createEditor(document, box) : null;

  const show = (summary) => {
    const text = typeof summary?.body === "string" ? summary.body : "";
    body.textContent = maskSpoilers(text);
    body.hidden = text === "";
    if (editor) editor.input.value = text;
  };
  const run = async (method, payload, doneKey) => {
    editor.save.disabled = true;
    editor.remove.disabled = true;
    try {
      const data = await request(path, payload === undefined ? { method } : { method, body: payload });
      show(data?.summary);
      editor.status.textContent = t(doneKey);
    } catch {
      editor.status.textContent = t("tldr.saveError");
    } finally {
      editor.save.disabled = false;
      editor.remove.disabled = false;
    }
  };
  box.removeThreadSummary = () => (editor ? run("DELETE", undefined, "tldr.removed") : Promise.resolve());
  box.saveThreadSummary = () => {
    if (!editor) return Promise.resolve();
    const text = String(editor.input.value ?? "").replace(/\s+/g, " ").trim();
    return text ? run("PUT", { body: text }, "tldr.saved") : box.removeThreadSummary();
  };
  box.loadThreadSummary = async () => {
    try {
      const data = await request(path);
      if (!data?.summary && !editor) {
        box.remove();
        return;
      }
      show(data?.summary);
      if (editor) editor.input.disabled = false;
      box.hidden = false;
    } catch {
      // Never offer an editor that could overwrite a summary it never loaded.
      box.remove();
    }
  };
  if (editor) {
    editor.save.addEventListener("click", () => box.saveThreadSummary());
    editor.remove.addEventListener("click", () => box.removeThreadSummary());
  }
  return box;
}

export const loadThreadSummary = (box) => box.loadThreadSummary();
