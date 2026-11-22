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

// Desk staff tools (v5.43, api/staff-tools.mjs): the report card's claim
// control and the staff notes shown inside the member peek. Builders only
// (createElement/textContent) — note bodies are never parsed as HTML. The
// clicks and the add submit live in routes/admin.js.
import { currentLocale, t } from "../i18n.js";

export const MEMBER_NOTE_MAX = 500;

const positiveId = (value) => {
  const id = Number(value);
  if (typeof value === "string" ? !/^[1-9][0-9]{0,14}$/.test(value) : !Number.isSafeInteger(id) || id < 1) {
    throw new RangeError("bad id");
  }
  return id;
};

export const memberNotesPath = (memberId, noteId) => {
  const base = `/api/admin/members/${positiveId(memberId)}/notes`;
  return noteId === undefined ? base : `${base}/${positiveId(noteId)}`;
};

const text = (document, tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
};

const actionButton = (document, action, label, data) => {
  const button = text(document, "button", "button button-quiet", label);
  button.type = "button";
  button.dataset.action = action;
  Object.assign(button.dataset, data);
  return button;
};

// Claim / Release: any staff member may release anyone's claim.
export function createClaimControl(document, report) {
  const wrap = document.createElement("div");
  wrap.className = "report-claim";
  const reportId = String(report.id);
  if (report.claim) {
    wrap.append(text(document, "p", "report-claimed-by", t("desk.claim.claimedBy", { username: report.claim.username ?? "" })));
    wrap.append(actionButton(document, "report-release", t("desk.claim.release"), { reportId }));
  } else {
    wrap.append(actionButton(document, "report-claim", t("desk.claim.claim"), { reportId }));
  }
  return wrap;
}

function noteItem(document, memberId, note) {
  const item = document.createElement("li");
  item.className = "member-note";
  item.append(text(document, "p", "member-note-body", note.body));
  const when = new Date(note.createdAt).toLocaleString(currentLocale());
  const meta = text(document, "p", "member-note-meta muted", t("desk.notes.by", { username: note.author?.username ?? "", date: when }));
  const remove = actionButton(document, "member-note-delete", t("desk.notes.delete"), {
    memberId: String(memberId),
    noteId: String(note.id),
  });
  remove.setAttribute("aria-label", t("desk.notes.delete"));
  item.append(meta, remove);
  return item;
}

function addNoteForm(document, memberId, username) {
  const form = document.createElement("form");
  form.className = "member-note-form";
  form.dataset.form = "member-note-add";
  form.dataset.memberId = String(memberId);
  const area = document.createElement("textarea");
  area.id = `member-note-${memberId}`;
  area.name = "body";
  area.maxLength = MEMBER_NOTE_MAX;
  area.required = true;
  area.rows = 2;
  const label = text(document, "label", "", t("desk.notes.label", { username }));
  label.setAttribute("for", area.id);
  const button = text(document, "button", "button button-secondary", t("desk.notes.add"));
  button.type = "submit";
  form.append(label, area, button);
  return form;
}

// Notes arrive newest first from the server (LIMIT 50); order is kept.
export function createMemberNotes(document, memberId, username, notes) {
  const section = document.createElement("section");
  section.className = "member-notes";
  section.dataset.memberId = String(memberId);
  section.append(text(document, "h4", "member-notes-title", t("desk.notes.title")));
  section.append(text(document, "p", "member-notes-hint muted", t("desk.notes.hint")));
  if (notes.length) {
    const list = document.createElement("ol");
    list.className = "member-notes-list";
    for (const note of notes) list.append(noteItem(document, memberId, note));
    section.append(list);
  } else {
    section.append(text(document, "p", "empty-state", t("desk.notes.empty")));
  }
  section.append(addNoteForm(document, memberId, username));
  return section;
}
