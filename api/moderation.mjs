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
  ];
  for (const handler of handlers) {
    const response = await handler(request, env, url, path, method, ctx);
    if (response) return response;
  }
  return null;
}

export { handleModerationRoutes, createUserBan };
