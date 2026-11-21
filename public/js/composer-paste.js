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

import { t, tn } from "./i18n.js";
import { addComposerFiles } from "./attachments.js";
// Wave 30: paste or drop an image into a post/reply composer. Pasted/dropped
// files are only STAGED as pending (form.pendingComposerFiles) with a visible
// Attach / Dismiss strip; Attach folds them into form.composerFiles through
// the same addComposerFiles gate the picker uses (type, 10 MiB, 3 files).
// Nothing here touches the network or storage — bytes leave the browser only
// when the member presses Post, exactly as with the picker.

const typesOf = (transfer) => [...(transfer?.types ?? [])];
const carriesFiles = (transfer) => typesOf(transfer).includes("Files"); // i18n-ignore
const carriesText = (transfer) => typesOf(transfer).includes("text/plain");
const DROP_TARGET_CLASS = "composer-drop-target";

const stripOf = (form) => form?.pendingComposerStrip ?? null;

function paintPendingStrip(form) {
  const strip = stripOf(form);
  if (!strip) return;
  const pending = form.pendingComposerFiles ?? [];
  const note = strip.querySelector(".composer-pending-note");
  strip.hidden = pending.length === 0;
  note.textContent = pending.length
    ? tn("composer.pendingImages", pending.length, {
      names: pending.map((file) => file.name).join(", "),
    })
    : "";
}

// Stages a paste/drop: the preview runs the real gate against what is already
// attached, so refusals (wrong type, too big, over the cap) show at once and
// only files that would really fit wait for the member's confirm.
function stageFiles(form, picked, onNotice) {
  const attached = form.composerFiles ?? [];
  const { files, notices } = addComposerFiles(attached, picked);
  form.pendingComposerFiles = files.slice(attached.length);
  paintPendingStrip(form);
  if (notices.length) onNotice(notices);
}

const withoutDropClass = (className) =>
  String(className ?? "").split(" ").filter((name) => name && name !== DROP_TARGET_CLASS).join(" ");

function setDropTarget(form, active) {
  const base = withoutDropClass(form.className);
  form.className = active ? [base, DROP_TARGET_CLASS].filter(Boolean).join(" ") : base;
}

function createPendingStrip(document) {
  const strip = document.createElement("div");
  strip.className = "composer-pending";
  strip.hidden = true;
  const note = document.createElement("span");
  note.className = "composer-pending-note";
  note.setAttribute("aria-live", "polite");
  const attach = document.createElement("button");
  attach.type = "button";
  attach.className = "button button-quiet";
  attach.dataset.action = "attach-pending-files";
  attach.textContent = t("composer.pendingAttach");
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "button button-quiet";
  dismiss.dataset.action = "dismiss-pending-files";
  dismiss.textContent = t("composer.pendingDismiss");
  strip.append(note, attach, dismiss);
  return strip;
}

// Wires paste on the textarea and drag/drop on the whole form; returns the
// pending strip for the caller to place. onNotice receives refusal strings.
export function attachPasteAndDrop(form, textarea, document, onNotice = () => {}) {
  const strip = createPendingStrip(document);
  form.pendingComposerStrip = strip;
  textarea.addEventListener("paste", (event) => {
    const transfer = event.clipboardData;
    // Text wins: a rich copy (text + image) pastes as text like it always did.
    if (!transfer || carriesText(transfer)) return;
    const files = [...(transfer.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    stageFiles(form, files, onNotice);
  });
  form.addEventListener("dragover", (event) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDropTarget(form, true);
  });
  form.addEventListener("dragleave", () => setDropTarget(form, false));
  form.addEventListener("drop", (event) => {
    setDropTarget(form, false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    stageFiles(form, files, onNotice);
  });
  return strip;
}

// Attach: re-run the gate (the attached list may have changed since staging)
// and return any refusals for the caller's status line.
export function confirmPendingFiles(form) {
  if (!form) return [];
  const { files, notices } = addComposerFiles(form.composerFiles ?? [], form.pendingComposerFiles ?? []);
  form.composerFiles = files;
  dismissPendingFiles(form);
  return notices;
}

export function dismissPendingFiles(form) {
  if (!form) return;
  form.pendingComposerFiles = [];
  paintPendingStrip(form);
}
