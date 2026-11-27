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

// Thread tags (v5.44, api/tags.mjs). Pure DOM builders — the callers
// (routes/post.js, routes/pages.js, routes/admin.js) do the fetches and the
// submits; nothing here touches storage or the network:
//   createTagChips   — the thread page's chips, each a link to /tag/<slug>;
//   createTagEditor  — the author's / staff's picker (≤ THREAD_TAG_MAX);
//   createTagPage    — the /tag/<slug> thread list + "load older";
//   createTagManager — the desk's create form and delete buttons.
// Labels and previews land through textContent; every href and API path is
// built with the URL API from a validated slug or id. Thread previews are
// masked twice over (server before its cut, threadExcerpt again here).
import { boardLabel } from "./boards.js";
import { t, tn } from "./i18n.js";
import { threadExcerpt } from "./profile-extras.js";

// Mirrors of api/tags.mjs (pinned equal by test).
export const THREAD_TAG_MAX = 3;
export const TAG_TOTAL_MAX = 50;
const TAG_LABEL_MAX = 24;
const SLUG_PATTERN = /^[a-z0-9-]{2,24}$/;
const LINK_BASE = "https://wempos-forum.invalid";

const validSlug = (slug) => {
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) throw new RangeError("bad slug");
  return slug;
};

const positiveId = (value) => {
  const id = Number(value);
  if (typeof value === "string" ? !/^[1-9][0-9]{0,14}$/.test(value) : !Number.isSafeInteger(id) || id < 1) {
    throw new RangeError("bad id");
  }
  return id;
};

const pathOf = (pathname, params = {}) => {
  const url = new URL(pathname, LINK_BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.pathname + url.search;
};

export const tagPagePath = (slug) => pathOf(`/tag/${validSlug(slug)}`);
export const tagListingPath = (slug, before) =>
  pathOf(`/api/tags/${validSlug(slug)}/posts`, before === undefined || before === null ? {} : { before: positiveId(before) });
export const postTagsPath = (postId) => pathOf(`/api/posts/${positiveId(postId)}/tags`);
export const adminTagPath = (tagId) => pathOf(tagId === undefined ? "/api/admin/tags" : `/api/admin/tags/${positiveId(tagId)}`);

const make = (document, tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const appLink = (document, className, href, text) => {
  const link = make(document, "a", className, text);
  link.href = href;
  link.setAttribute("data-app-link", "");
  return link;
};

const isShowable = (tag) => tag && typeof tag.slug === "string" && SLUG_PATTERN.test(tag.slug);

export function createTagChips(document, tags) {
  const shown = Array.isArray(tags) ? tags.filter(isShowable) : [];
  if (!shown.length) return null;
  const list = make(document, "ul", "tag-chips");
  list.setAttribute("aria-label", t("tags.chipsLabel"));
  for (const tag of shown) {
    const item = make(document, "li", "tag-chip-item");
    item.append(appLink(document, "tag-chip", tagPagePath(tag.slug), String(tag.label ?? "")));
    list.append(item);
  }
  return list;
}

// The caller shows this only to the thread's author or staff (the server
// gates it again). Nothing to pick from = no form.
export function createTagEditor(document, postId, allTags, selectedIds) {
  const tags = Array.isArray(allTags) ? allTags.filter(isShowable) : [];
  if (!tags.length) return null;
  const chosen = new Set((selectedIds || []).map(Number));
  const form = make(document, "form", "tag-editor");
  form.dataset.form = "thread-tags";
  form.dataset.postId = String(positiveId(postId));
  const fieldset = make(document, "fieldset", "tag-editor-fields");
  fieldset.append(make(document, "legend", "tag-editor-legend", t("tags.editLabel", { count: THREAD_TAG_MAX })));
  for (const tag of tags) {
    const box = make(document, "input", "tag-editor-box");
    box.type = "checkbox";
    box.name = "tagId";
    box.value = String(positiveId(tag.id));
    box.id = `tag-editor-${form.dataset.postId}-${box.value}`;
    box.checked = chosen.has(Number(tag.id));
    const label = make(document, "label", "tag-editor-label", String(tag.label ?? ""));
    label.setAttribute("for", box.id);
    const row = make(document, "span", "tag-editor-option");
    row.append(box, label);
    fieldset.append(row);
  }
  const button = make(document, "button", "button button-quiet", t("common.save"));
  button.type = "submit";
  form.append(fieldset, button);
  return form;
}

export function createTagThreadRows(document, threads) {
  const list = make(document, "ol", "tag-threads");
  for (const thread of threads) {
    const row = make(document, "li", "tag-thread");
    row.append(appLink(document, "tag-thread-link", pathOf(`/posts/${positiveId(thread.id)}`),
      threadExcerpt(String(thread.excerpt ?? ""))));
    const meta = [boardLabel(thread.board), tn("counts.replies", Number(thread.replyCount) || 0)];
    if (thread.authorName) meta.unshift(String(thread.authorName));
    row.append(make(document, "span", "tag-thread-meta muted", meta.join(t("counts.separator"))));
    list.append(row);
  }
  return list;
}

export function createLoadMoreTag(document, slug, before) {
  const button = make(document, "button", "button button-secondary", t("feed.loadOlderPosts"));
  button.type = "button";
  button.dataset.action = "load-more-tag";
  button.dataset.slug = validSlug(slug);
  button.dataset.before = String(positiveId(before));
  return button;
}

// The /tags index: every tag as a chip linking to its page, or the empty
// state. Tags are staff-made public labels (GET /api/tags), so the index
// shows nothing a guest could not already reach from a thread.
export function createTagIndex(document, tags) {
  const page = make(document, "div", "tag-index");
  const chips = createTagChips(document, tags);
  page.append(chips ?? make(document, "p", "empty-state", t("tags.none")));
  return page;
}

export function createTagPage(document, data) {
  const page = make(document, "div", "tag-page");
  const threads = Array.isArray(data?.threads) ? data.threads : [];
  if (!threads.length) {
    page.append(make(document, "p", "empty-state", t("tags.empty")));
    return page;
  }
  page.append(createTagThreadRows(document, threads));
  if (data.nextBefore) page.append(createLoadMoreTag(document, data.tag.slug, data.nextBefore));
  return page;
}

const field = (document, name, labelText, attributes) => {
  const input = make(document, "input", "tag-manager-input");
  input.name = name;
  input.id = `tag-manager-${name}`;
  input.required = true;
  Object.assign(input, attributes.props || {});
  for (const [key, value] of Object.entries(attributes.attrs || {})) input.setAttribute(key, value);
  const label = make(document, "label", "tag-manager-field-label", labelText);
  label.setAttribute("for", input.id);
  return [label, input];
};

// Staff only (the desk is staff-gated; the server gates every write again).
export function createTagManager(document, tags) {
  const wrap = make(document, "div", "tag-manager");
  const form = make(document, "form", "tag-manager-form");
  form.dataset.form = "tag-create";
  form.append(
    ...field(document, "slug", t("tags.slugLabel"), { attrs: { pattern: "[a-z0-9\\-]{2,24}" }, props: { maxLength: 24 } }),
    ...field(document, "label", t("tags.labelField"), { props: { maxLength: TAG_LABEL_MAX } }),
  );
  const create = make(document, "button", "button", t("tags.create"));
  create.type = "submit";
  form.append(create);
  wrap.append(form);
  const shown = Array.isArray(tags) ? tags.filter(isShowable) : [];
  if (!shown.length) {
    wrap.append(make(document, "p", "empty-state", t("tags.none")));
    return wrap;
  }
  const list = make(document, "ul", "tag-manager-list");
  for (const tag of shown) {
    const item = make(document, "li", "tag-manager-item");
    item.append(appLink(document, "tag-manager-label", tagPagePath(tag.slug), String(tag.label ?? "")));
    const remove = make(document, "button", "button button-quiet", t("common.delete"));
    remove.type = "button";
    remove.dataset.action = "tag-delete";
    remove.dataset.tagId = String(positiveId(tag.id));
    item.append(remove);
    list.append(item);
  }
  wrap.append(list);
  return wrap;
}
