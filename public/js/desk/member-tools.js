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

// Moderator tools on a report card (wave 2026-11-21-9): the "recent activity"
// peek (a member's newest posts, hidden ones flagged) and the hide-a-spam-run
// form. createElement/textContent only — post bodies are never parsed as HTML.
import { currentLocale, t, tn } from "../i18n.js";

export const HIDE_RECENT_MAX = 50;
export const HIDE_RECENT_DEFAULT = 5;

const text = (document, tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
};

// The toggle that loads the peek into its sibling region on first open.
export function createMemberPeekToggle(document, userId, reportId) {
  const wrap = document.createElement("div");
  wrap.className = "member-peek-wrap";
  const region = document.createElement("div");
  region.className = "member-peek-region";
  region.id = `member-peek-${reportId}`;
  region.hidden = true;
  const button = text(document, "button", "button button-quiet", t("desk.peek.show"));
  button.type = "button";
  button.dataset.action = "member-peek";
  button.dataset.userId = String(userId);
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", region.id);
  wrap.append(button, region);
  return wrap;
}

function peekItem(document, post) {
  const item = document.createElement("li");
  item.className = "member-peek-item";
  const meta = document.createElement("p");
  meta.className = "member-peek-meta";
  const link = text(document, "a", "", new Date(post.createdAt).toLocaleString(currentLocale()));
  link.href = `/posts/${post.threadId}`;
  meta.append(link);
  if (post.hidden) meta.append(text(document, "span", "member-peek-hidden", t("desk.peek.hiddenTag")));
  item.append(meta, text(document, "p", "member-peek-body", post.body));
  return item;
}

export function createMemberPeek(document, data) {
  const section = document.createElement("section");
  section.className = "member-peek";
  section.append(text(document, "h3", "member-peek-title", t("desk.peek.title", { username: data.member.username })));
  const facts = [tn("desk.peek.publicCount", data.publicCount)];
  if (data.activeBan) facts.push(t("desk.peek.banned"));
  section.append(text(document, "p", "muted", facts.join(" · ")));
  if (!data.posts.length) {
    section.append(text(document, "p", "empty-state", t("desk.peek.empty")));
    return section;
  }
  const list = document.createElement("ol");
  list.className = "member-peek-list";
  for (const post of data.posts) list.append(peekItem(document, post));
  section.append(list);
  return section;
}

// Hide-a-spam-run: a bounded count; the submit handler confirms before sending.
export function createHideRecentForm(document, userId, username, reportId) {
  const form = document.createElement("form");
  form.className = "hide-recent-form";
  form.dataset.form = "admin-hide-recent";
  form.dataset.userId = String(userId);
  form.dataset.username = username;
  const id = `hide-recent-${reportId}`;
  const label = text(document, "label", "", t("desk.hideRecent.label", { username }));
  label.setAttribute("for", id);
  const input = document.createElement("input");
  input.id = id;
  input.name = "count";
  input.type = "number";
  input.min = "1";
  input.max = String(HIDE_RECENT_MAX);
  input.value = String(HIDE_RECENT_DEFAULT);
  input.required = true;
  const button = text(document, "button", "button button-danger", t("desk.hideRecent.button"));
  button.type = "submit";
  form.append(label, input, button);
  return form;
}
