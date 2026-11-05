# v4.0 Plan 3 — profiles.mjs + moderation.mjs splits

Spec: docs/superpowers/specs/2026-11-05-v4-rewrite-design.md, "Splits". Same
protocol as plans 1–2: verbatim moves (a discovered bug gets its own commit),
suite + dry-run green at every commit, dispatch order and export surfaces
preserved. Task 1 of plan 2 (core/cursors.mjs) and plan 1's completed core
split already cover the shared primitives this plan consumes; `api/core/` is
NOT touched by this plan.

## Global constraints

- Imports only point down: topic modules may import core/, constants.mjs, and
  sibling topic modules — but no new cycles. The seam pairings below are
  pinned one-directional on purpose.
- worker.mjs and index-level behavior unchanged: `handleProfileRoutes` and
  `handleModerationRoutes` keep their signatures and worker.mjs import lines;
  `export { createUserBan } from "./api/moderation.mjs"` keeps resolving.
- shared.mjs's pinned 60-name surface (tests/core-layers.test.mjs) loses two
  names in Task 1 and one in Task 2 — the plan's rule: delete the name from
  the pinned list in the same commit, with a reason, and re-point every
  importer. The names move to topic modules, not the void.
- Routes keep their EXACT registration order inside handleProfileRoutes and
  handleModerationRoutes (first-claiming-handler-wins).

## Rulings recorded at plan-writing time

- **handleThreadPinRoute + handleHiddenPostsRoute → reports.mjs**: the spec's
  three-way moderation seam is "who bans vs who reviews vs who manages
  roles"; both leftover handlers are review-desk post actions (restore
  auto-hidden posts, pin threads), so they ride the "who reviews" module.
- **SUGGESTION_SCORE_SQL stays in boards.mjs** (plan 2 ledger — no change).

## Task 1: profile-css.mjs (CSS sandbox leaves shared.mjs)

**Files:** create `api/profile-css.mjs`; modify `api/shared.mjs`,
`api/profiles.mjs`, `tests/core-layers.test.mjs`.

**Move verbatim** out of shared.mjs: the whole profile-CSS sandbox family —
`PROFILE_CSS_PROPERTY_ALLOW`, `CUSTOM_CSS_MAX_BYTES`, `blockEnd`,
`atRuleName`, `scopeProfileCss`, `scopeKeyframeBody`,
`sanitizeDeclarationBody` — plus their comments.

**Consumes:** profile-css.mjs imports nothing but core/ (check at impl — the
family may be import-free, in which case it is a leaf).

**Pinned-list update (same commit):** drop `CUSTOM_CSS_MAX_BYTES` and
`scopeProfileCss` from core-layers.test.mjs's 60-name list — reason: they
moved to the profile-css topic module with their family; importers re-point
to ./profile-css.mjs. profiles.mjs is the only consumer (grep-verified).

**Step:** RED module pin test (tests/profile-css-module.test.mjs: the family
exports + a sandbox purity assertion — scoped output carries the profile-scope
selector prefix, properties outside the allow-list vanish, `@import` dropped)
→ create module → strip shared.mjs → re-point profiles.mjs → suite + dry-run
→ commit.

## Task 2: avatars.mjs (upload + serve + moderation queue)

**Files:** create `api/avatars.mjs`; modify `api/shared.mjs`,
`api/profiles.mjs`, `api/moderation.mjs`, `tests/core-layers.test.mjs`.

**Move verbatim:**
- from shared.mjs: `handleAvatarReadRoute` (+ its comment block).
- from profiles.mjs: `handleAvatarUploadRoute`, `MAX_AVATAR_BYTES`,
  `MAX_AVATAR_REQUEST_BYTES` (avatar-scoped limits).
- from moderation.mjs: `handleAvatarQueueRoute`, `resolveAvatarPending`,
  `handleAvatarModerationRoute` (the avatar moderation queue — spec puts
  queue routes in avatars.mjs, overriding the moderation seam for these
  three; cross-module move is fine — that is the spec's sentence).

**Pinned-list update (same commit):** drop `handleAvatarReadRoute` from the
60-name list — same reason pattern.

**Consumes:** core/images.mjs, core/shapers.mjs (publicRole at exits),
core/auth.mjs (requiremod for the queue), shared.mjs peers (rateLimit,
json, HttpError), profiles.mjs peers ONLY via narrow seam if needed (resolve
at impl; ledger).

**Step:** RED pin test → create → strip three sources → re-point
(handleProfileRoutes keeps registering handleAvatarReadRoute — from
avatars.mjs now; handleModerationRoutes keeps its registration order — the
avatar handlers import back) → suite + dry-run → commit.

## Task 3: bans.mjs (who bans)

**Files:** create `api/bans.mjs`; modify `api/moderation.mjs`.

**Move verbatim from moderation.mjs:** `handleBanListRoute`, `createUserBan`,
`revokeUserBan`, `handleBanMutationRoute` (+ comments).

**Surface:** moderation.mjs re-exports `createUserBan` (worker.mjs imports it
from there — worker.mjs untouched). The pinned role-change guard test
(tests/roles.test.mjs cites moderation.mjs's ROLE_*_DB imports — verify its
imports still resolve; re-point its comment only if stale).

**Step:** RED pin test → create → strip → suite + dry-run → commit.

## Task 4: reports.mjs (who reviews — all queues)

**Files:** create `api/reports.mjs`; modify `api/moderation.mjs`,
`api/profiles.mjs`.

**Move verbatim:**
- from moderation.mjs: `handleReportCreateRoute`, `handleReportQueueRoute`,
  `hidePostForOpenReport`, `dismissOpenReport`, `handleReportResolveRoute`,
  plus the two ruled-in review-desk handlers: `handleThreadPinRoute`
  (`THREAD_PIN_ROUTE`) and `handleHiddenPostsRoute`.
- from profiles.mjs: `handleProfileReportRoute`,
  `handleProfileReportAdminRoute` (post + profile report queues together,
  per spec).

**Step:** RED pin test → create → strip → suite + dry-run → commit.

## Task 5: members-admin.mjs (who manages roles)

**Files:** create `api/members-admin.mjs`; modify `api/moderation.mjs`.

**Move verbatim:** `ROLE_CHANGE_ADMIN_403`, `ROLE_UNCHANGED_409`,
`handleRoleChangeRoute`, `handleMemberSearchRoute`.

**Step:** RED pin test → create → strip → suite + dry-run → commit.

## Task 6: composers + close-out

- `profiles.mjs` becomes the profile-group composer: dispatcher keeps the
  EXACT original registration order — profile read, profile update, password
  change, account delete, then CSS routes (from profile-css.mjs), avatar
  routes (from avatars.mjs). Report routes register from reports.mjs in the
  original slots.
- `moderation.mjs` becomes the moderation-group composer: dispatcher keeps
  the original order with report/ban/role/search/pin/hidden handlers
  imported from the three new modules + avatars.mjs; re-exports `createUserBan`.
- Both composers' export surfaces: `export { handleProfileRoutes }` /
  `export { handleModerationRoutes, createUserBan }` unchanged.

**Step:** suite + dry-run green → verify worker.mjs untouched → run the
plan-reviewer with the user's four-category brief → minor fixes in own
commits → delete plan workspace.

## Final sweep carry-list (accumulating)

- Delete shared.mjs shim; re-point requiremod/ismod identifier renames
  (user-acknowledged deferral); stale header comment on shared.mjs.
- posts.mjs ⇄ bookmarks.mjs circular import via banFilterSql (reviewer note,
  plan 2): re-point bookmarks.mjs to posts-feed.mjs in the sweep.
- claude.md v4.0 notes + version stamp.
