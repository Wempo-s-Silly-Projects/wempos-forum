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

// Lazy route modules (v5.84 load order). The router used to import every
// route module up front, so a plain post page also downloaded the staff
// desk, two-factor, appeals and reports code. Now each module is imported the
// first time a route renders it or a click/submit needs one of its handlers.
// The owner tables below name, for every handler a lazy module registers,
// which module owns it; tests/lazy-load-graph.test.mjs pins them equal to
// each module's ACTIONS / FORM_HANDLERS keys, so a new handler can't be
// forgotten here.

export const ROUTE_MODULE_LOADERS = Object.freeze({
  auth: () => import("./routes/auth.js"),
  feed: () => import("./routes/feed.js"),
  composer: () => import("./routes/composer.js"),
  post: () => import("./routes/post.js"),
  profile: () => import("./routes/profile.js"),
  pages: () => import("./routes/pages.js"),
  appeals: () => import("./routes/appeals.js"),
  notifications: () => import("./routes/notifications.js"),
  admin: () => import("./routes/admin.js"),
  reports: () => import("./routes/reports.js"),
  blocks: () => import("./routes/blocks.js"),
  twofa: () => import("./routes/twofa.js"),
});

// route.name → the module whose render function paints it ("not-found" and
// "join" stay in app.js).
export const ROUTE_OWNERS = Object.freeze({
  setup: "auth",
  home: "feed",
  search: "feed",
  settings: "feed",
  mine: "feed",
  category: "feed",
  bookmarks: "feed",
  leaderboard: "pages",
  rules: "pages",
  week: "pages",
  tag: "pages",
  archive: "pages",
  post: "post",
  profile: "profile",
  admin: "admin",
  notifications: "notifications",
});

const owners = (table) => Object.freeze(Object.fromEntries(
  Object.entries(table).flatMap(([key, names]) => names.map((name) => [name, key])),
));

// data-action name → owning module.
export const ACTION_OWNERS = owners({
  feed: ["load-more", "reaction", "toggle-bookmark", "toggle-subscribe", "toggle-thread-mute", "suggestion-status",
    "presence-invisible", "download-my-data", "load-more-bookmarks", "remove-saved-board"],
  composer: ["composer-attach", "open-gif-picker", "confirm-gif-picker", "cancel-gif-picker", "choose-gif-upload",
    "remove-composer-file", "attach-pending-files", "dismiss-pending-files", "remove-gif", "open-poll-dialog",
    "confirm-poll-dialog", "cancel-poll-dialog"],
  post: ["load-older-replies", "reply-to", "expand-sub-replies", "quote", "expand-attachment", "poll-vote",
    "poll-unvote", "poll-close", "poll-deadline", "edit-post", "cancel-edit", "edit-history"],
  profile: ["delete-post", "delete-account", "block-user", "chat-user", "profile-pin", "profile-unpin",
    "profile-status-clear", "save-profile-css", "clear-profile-css", "set-profile-accent"],
  pages: ["save-forum-rules", "load-more-archive", "load-more-tag"],
  notifications: ["open-notification", "open-notification-thread", "mark-notifications-read"],
  admin: ["member-peek", "report-claim", "report-release", "tag-delete", "member-note-delete", "post-restore",
    "thread-pin", "thread-unpin", "thread-lock", "thread-unlock", "staff-pick", "staff-unpick", "gif-approve",
    "gif-reject", "resolve-profile-report", "resolve-dm-report", "css-approve", "css-reject", "chat-delete",
    "dm-delete"],
  reports: ["report", "close-report", "report-profile"],
  blocks: ["unblock-user"],
  twofa: ["backup-generate-ask"],
});

// data-form name → owning module.
export const FORM_OWNERS = owners({
  auth: ["setup"],
  composer: ["post-create", "reply"],
  post: ["post-edit", "thread-slowmode", "thread-tags"],
  profile: ["profile-editor", "avatar", "password", "profile-status"],
  pages: ["site-search"],
  appeals: ["admin-appeal", "ban-appeal"],
  admin: ["admin-resolve", "admin-ban", "admin-unban", "admin-promote", "admin-demote", "admin-avatar-approve",
    "admin-avatar-reject", "admin-attachment-approve", "admin-attachment-reject", "admin-member-search",
    "admin-hide-recent", "member-note-add", "tag-create", "filter-save", "filter-bulk-add", "branding-save"],
  reports: ["report"],
  twofa: ["totp-setup", "totp-confirm", "totp-disable", "totp-backups-generate"],
});

const pending = new Map();
const ready = new Map();

// One import per module per page. A failed import (offline, a deploy in
// between) is forgotten, so the next navigation or click tries again.
export function loadRouteModule(key, loaders = ROUTE_MODULE_LOADERS) {
  const loader = loaders[key];
  if (!loader) return Promise.reject(new Error(String(key)));
  if (!pending.has(key)) {
    const promise = loader().then((module) => {
      ready.set(key, module);
      return module;
    });
    promise.catch(() => pending.delete(key));
    pending.set(key, promise);
  }
  return pending.get(key);
}

// The module if it has already loaded, else null (no import is started).
export function loadedRouteModule(key) {
  return ready.get(key) ?? null;
}

// The handler a lazy module registers for this action/form name, loading the
// module first when needed; null when no lazy module owns the name.
export async function lazyHandler(kind, name, loaders = ROUTE_MODULE_LOADERS) {
  const table = kind === "form" ? FORM_OWNERS : ACTION_OWNERS;
  const key = Object.hasOwn(table, name) ? table[name] : null;
  if (!key) return null;
  const module = await loadRouteModule(key, loaders);
  const handlers = kind === "form" ? module.FORM_HANDLERS : module.ACTIONS;
  return handlers?.[name] ?? null;
}
