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

// v5.43.0 client: the desk's staff notes (inside the member peek) and report
// claim control, and the thread page's slow-mode note + staff form. DOM-pure
// builders over fake-dom; staff and member text lands through textContent
// only, and nothing touches device storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeFakeDocument, findByClass, countByClass } from "./helpers/fake-dom.mjs";
import { bestOf } from "./helpers/timing.mjs";
import { createClaimControl, createMemberNotes, memberNotesPath } from "../public/js/desk/staff-tools.js";
import {
  SLOW_MODE_CHOICES,
  createSlowModeForm,
  createSlowModeNote,
  formatSlowModeDuration,
  slowModePath,
} from "../public/js/slow-mode.js";
import { SLOW_MODE_CHOICES as SERVER_CHOICES } from "../api/staff-tools.mjs";
import { currentLocale, t } from "../public/js/i18n.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const doc = makeFakeDocument();
const NOTES = [
  { id: 9, body: "<img src=x onerror=alert(1)> newest", createdAt: "2026-11-22T10:00:00.000Z", author: { id: 1, username: "boss" } },
  { id: 4, body: "older note", createdAt: "2026-11-20T10:00:00.000Z", author: { id: 2, username: "deputy" } },
];

test("slow mode choices mirror the server allowlist; paths are id-only", () => {
  assert.deepEqual([...SLOW_MODE_CHOICES], [...SERVER_CHOICES]);
  assert.equal(slowModePath(12), "/api/admin/threads/12/slowmode");
  assert.equal(memberNotesPath(7), "/api/admin/members/7/notes");
  assert.equal(memberNotesPath(7, 3), "/api/admin/members/7/notes/3");
  for (const junk of ["1/../x", "abc", -1, 0, 1.5]) {
    assert.throws(() => slowModePath(junk), RangeError, String(junk));
    assert.throws(() => memberNotesPath(junk), RangeError, String(junk));
  }
});

test("slow mode note: one line on the thread page, localized duration, nothing when off", () => {
  assert.equal(createSlowModeNote(doc, null), null);
  assert.equal(createSlowModeNote(doc, 0), null);
  const note = createSlowModeNote(doc, 300);
  assert.equal(note.className, "slow-mode-note");
  assert.equal(note.textContent, t("slowMode.note", { duration: formatSlowModeDuration(300) }));
  assert.match(formatSlowModeDuration(30, "en"), /30 seconds/);
  assert.match(formatSlowModeDuration(60, "en"), /1 minute/);
  assert.match(formatSlowModeDuration(900, "en"), /15 minutes/);
  assert.match(formatSlowModeDuration(300, "de"), /5 Minuten/);
});

test("slow mode staff form: Off plus the four choices, the current one selected", () => {
  const form = createSlowModeForm(doc, 12, 60);
  assert.equal(form.dataset.form, "thread-slowmode");
  assert.equal(form.dataset.postId, "12");
  const select = form.querySelector("select");
  assert.equal(select.name, "seconds");
  const options = [...select.querySelectorAll("option")];
  assert.deepEqual(options.map((o) => o.value), ["0", "30", "60", "300", "900"]);
  assert.equal(options[0].textContent, t("slowMode.off"));
  assert.equal(options.find((o) => o.selected)?.value, "60");
  assert.equal(select.value, "60");
  const label = form.querySelector("label");
  assert.equal(label.getAttribute("for"), select.id);
  assert.equal(form.querySelector("button").type, "submit");
  assert.equal(createSlowModeForm(doc, 12, null).querySelector("select").value, "0");
});

test("claim control: unclaimed offers Claim; claimed names the holder and offers Release", () => {
  const open = createClaimControl(doc, { id: 5, claim: null });
  const claimButton = open.querySelector("button");
  assert.equal(claimButton.dataset.action, "report-claim");
  assert.equal(claimButton.dataset.reportId, "5");
  assert.equal(claimButton.textContent, t("desk.claim.claim"));
  assert.equal(findByClass(open, "report-claimed-by"), null);
  const held = createClaimControl(doc, { id: 5, claim: { staffId: 2, username: "<b>deputy</b>", claimedAt: "2026-11-22T10:00:00.000Z" } });
  assert.equal(findByClass(held, "report-claimed-by").textContent, t("desk.claim.claimedBy", { username: "<b>deputy</b>" }));
  const release = held.querySelector("button");
  assert.equal(release.dataset.action, "report-release");
  assert.equal(release.textContent, t("desk.claim.release"));
});

test("member notes: newest first as served, bodies as text, delete per note, add form capped at 500", () => {
  const section = createMemberNotes(doc, 7, "alice", NOTES);
  assert.equal(section.className, "member-notes");
  assert.equal(section.dataset.memberId, "7");
  assert.equal(countByClass(section, "member-note"), 2);
  const bodies = section.querySelectorAll(".member-note-body");
  assert.equal(bodies[0].textContent, NOTES[0].body, "markup stays text");
  assert.equal(bodies[0].childElementCount, 0);
  assert.equal(bodies[1].textContent, "older note");
  const meta = findByClass(section, "member-note-meta");
  assert.equal(meta.textContent, t("desk.notes.by", { username: "boss", date: new Date(NOTES[0].createdAt).toLocaleString(currentLocale()) }));
  const deletes = [...section.querySelectorAll("button")].filter((button) => button.dataset.action === "member-note-delete");
  assert.equal(deletes.length, 2);
  assert.equal(deletes[0].dataset.noteId, "9");
  assert.equal(deletes[0].dataset.memberId, "7");
  assert.equal(deletes[0].getAttribute("aria-label"), t("desk.notes.delete"));
  const form = section.querySelector("form");
  assert.equal(form.dataset.form, "member-note-add");
  assert.equal(form.dataset.memberId, "7");
  const area = form.querySelector("textarea");
  assert.equal(area.name, "body");
  assert.equal(String(area.maxLength), "500");
  assert.equal(form.querySelector("label").getAttribute("for"), area.id);
  assert.ok(findByClass(section, "member-notes-hint").textContent.length > 0, "says who can see the notes");
  const empty = createMemberNotes(doc, 7, "alice", []);
  assert.equal(findByClass(empty, "empty-state").textContent, t("desk.notes.empty"));
  assert.equal(countByClass(empty, "member-note"), 0);
});

test("member notes render stays linear at the 50-note cap", () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ ...NOTES[1], id: i + 1 }));
  const small = bestOf(() => createMemberNotes(doc, 7, "alice", many(12)));
  const large = bestOf(() => createMemberNotes(doc, 7, "alice", many(50)));
  assert.ok(large < Math.max(small, 0.05) * 16, `12 notes ${small}ms, 50 notes ${large}ms`);
});

test("wiring: desk handlers, the peek loads notes, the thread page shows the note and staff form", () => {
  const admin = read("public/js/routes/admin.js");
  for (const key of ["\"report-claim\"", "\"report-release\"", "\"member-note-delete\"", "\"member-note-add\""]) {
    assert.ok(admin.includes(key), key);
  }
  assert.match(admin, /memberNotesPath\(/);
  const reports = read("public/js/desk/reports.js");
  assert.match(reports, /createClaimControl\(document, report\)/);
  const post = read("public/js/routes/post.js");
  assert.match(post, /createSlowModeNote\(document, post\.slowModeSeconds\)/);
  assert.match(post, /createSlowModeForm\(document, post\.id, post\.slowModeSeconds\)/);
  assert.ok(post.includes("\"thread-slowmode\""));
  assert.match(read("public/index.html"), /<link rel="modulepreload" href="\/js\/slow-mode\.js">/);
});

test("new client modules: no HTML sinks, no device storage", () => {
  for (const file of ["public/js/desk/staff-tools.js", "public/js/slow-mode.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser/, file);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/, file);
  }
});
