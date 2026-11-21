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

// v4.0 plan 3 composer: the moderation desk's dispatcher. Split along the
// spec's seam — bans.mjs ("who bans"), reports.mjs ("who reviews": all
// queues + pin/unpin + hidden posts), members-admin.mjs (roles + member
// search), avatars.mjs (the avatar moderation queue's own lifecycle). The
// dispatcher order is untouched; worker.mjs keeps importing createUserBan
// from here.
// v4.0 plan 3, Task 2: the avatar moderation queue moved to api/avatars.mjs
// (the spec puts the queue routes with the avatar lifecycle); its dispatcher
// registrations import back here in the original order.
import { handleAvatarModerationRoute, handleAvatarQueueRoute } from "./avatars.mjs";
// v4.0 plan 3, Task 4: the review desk (all report queues, pin/unpin, the
// hidden-posts page) moved to api/reports.mjs.
import {
  handleHiddenPostsRoute,
  handleReportCreateRoute,
  handleReportQueueRoute,
  handleReportResolveRoute,
  handleThreadPinRoute,
} from "./reports.mjs";
// v4.0 plan 3, Task 3: the ban family moved to api/bans.mjs ("who bans" —
// the spec's first moderation seam); the composer re-exports createUserBan
// because worker.mjs imports it from here.
import { createUserBan, handleBanListRoute, handleBanMutationRoute } from "./bans.mjs";
// v4.0 plan 3, Task 5: promote/demote + member search moved to
// api/members-admin.mjs ("who manages roles" — the spec's third seam).
import { handleMemberSearchRoute, handleRoleChangeRoute } from "./members-admin.mjs";
import { handleModToolRoutes } from "./mod-tools.mjs";

async function handleModerationRoutes(request, env, url, path, method, ctx) {
  const handlers = [
    handleReportCreateRoute,
    handleReportQueueRoute,
    handleReportResolveRoute,
    handleBanListRoute,
    handleBanMutationRoute,
    handleMemberSearchRoute,
    handleRoleChangeRoute,
    handleAvatarQueueRoute,
    handleAvatarModerationRoute,
    handleHiddenPostsRoute,
    handleThreadPinRoute,
    handleModToolRoutes,
  ];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method, ctx);
    if (response) return response;
  }
  return null;
}

export { handleModerationRoutes, createUserBan };
