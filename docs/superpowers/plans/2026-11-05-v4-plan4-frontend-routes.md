# v4.0 Plan 4 — frontend: router table + app.js dissolution

Spec: docs/superpowers/specs/2026-11-05-v4-rewrite-design.md ("Frontend
design"). Goal: `app.js` (2,513 lines) dissolves into `public/js/routes/`
modules; `app.js` shrinks to boot (~200–300 lines); `render.js` keeps only
shared element helpers; `admin.js` splits along desk sections. Same vanilla
ESM, same textContent-only rendering, same `data-action`/`data-form`
delegation. Desktop output identical.

## Structural map of app.js (from this session's survey)

- Lines 76–105: DOM singletons (main, dialogs), openConfirmDialog.
- 106–141: profileBadgeFor, applyProfileTheme.
- 142–348: composer family + SUGGESTIONS consts + element/panel/authForm
  helpers. (element/createPanel/addHeading/authForm are ALSO in render.js?
  — resolve duplicates at move time; render.js is the shared home.)
- 349–792: renderAccountNavigation, home/intro/join/setup/account panels,
  renderHome, renderSearchResults, profile render family.
- 793–839: renderAdmin (the desk's section dispatch).
- 840–1332: per-route render fns (setup, home, feed tabs, rules,
  leaderboard, mine, archive+fragment, chat, category, bookmarks, post,
  profile, admin queues, appeals, notifications, not-found, renderRoute).
- 1383–2127: submit-* family + composer idempotency + dialog openers
  (delete/report/gifs/polls) + reactions + pagination loaders + quote +
  lightbox.
- 2128–2187: load-more family.
- 2188–2440: handleButtonAction — the delegated-action switch (cross-route).
- 2440–2513: handleClick, fillVersionTag, boot.

## Design constraints

- The delegation engine (handleButtonAction/handleClick) is CROSS-ROUTE by
  nature — it follows data-action attributes from whatever is rendered. It
  stays in app.js (boot layer), BUT per-action bodies that are route-owned
  move into their route module and app.js's switch dispatches by importing
  handlers. Resolution: keep the switch as a registry —
  `import { actions as feedActions } from "./routes/feed.js"` etc., merged
  into one map; the switch body shrinks to a lookup. First-match order
  matters only within a route's own actions (no two routes share an action
  name — verify at move time with a duplicate-key test).
- Form submission: `submitForm` (forms.js) stays shared; the route-owned
  submit-* functions move to their modules and register via the same
  data-form dispatch forms.js already uses.
- No `innerHTML` anywhere; textContent only; CSSOM style writes only.
- Route module shape: `render(host, context) async` + `actions` +
  `forms` registrations, mirroring chat.js's existing shape (it moves into
  routes/ untouched).
- The DOM singletons (dialogs, main) move to a shared `dom.js` imported by
  whoever needs them — dialogs are global chrome, route modules that open
  them (report/gifs/polls/confirm) import from there.
- Suite gate changes for this plan: backend `npm test` stays green (it does
  not cover public/js); per-task browser smoke via `wrangler dev` + Chrome
  DevTools MCP for the routes each task touches; full smoke ladder at close
  (register/login, post/reply/react/report, admin queue, ban, avatar, chat,
  DM, notifications, logout, reload persistence, mobile 390px pass).

## Task ladder

1. **routes/shell** — dom.js (singletons), move shared visual helpers into
   render.js where duplicated, profileBadgeFor/applyProfileTheme → render.js
   or keep in app.js if cross-route (decide at move). app.js still boots.
2. **routes/auth.js** — renderSetupRoute, authForm/setupForm,
   renderJoinPanel, renderSetupLocked, renderHomeAccess, submitAuthForm,
   banned screen wiring (banned.js already exists — wire only).
3. **routes/feed.js** — home/mine/category/feed-tabs/bookmarks renders,
   composer family (createComposer → submitNewPost/submitReplyForm, file/gif
   strips, signature/idempotency), renderSearchResults, loadMorePosts,
   renderIntroduction, renderAccountNavigation (header chrome — stays in
   app.js? it owns header/nav composition per spec boot description; decide
   at task time and ledger).
4. **routes/post.js** — renderPostRoute + reply nesting/sub-reply toggles,
   quoteIntoComposer, submitPostEditForm, editTargetArticle, reactions,
   openAttachmentLightbox, loadOlderReplies.
5. **routes/profile.js** — renderProfile family + profile-editor forms
   (submitProfileEditorForm, submitAvatarForm, submitPasswordForm),
   openDeletePostDialog/openDeleteAccountDialog, loadMoreProfilePosts,
   appendProfileSocials/RoleControls; admin bits route to admin module.
6. **routes/archive.js + leaderboard.js + rules.js + search.js** — the four
   small route pages + their load-more fragments + submitSiteSearch.
7. **routes/notifications.js + appeals.js + chat wrap** — notifications
   (openNotification, markAllRead), appeals (member + ban appeal forms),
   chat.js → routes/chat.js untouched.
8. **routes/admin.js split** — renderAdminRoute + the queues (report,
   profile-report, bans, avatars, attachments, css, gifs, rules editor,
   hidden, user search, appeals decisions, role changes, avatar/attachment
   moderation) split along desk sections per spec (admin-queues.js,
   admin-automod.js, admin-logs.js or fewer — resolve at task time with a
   ledger ruling; admin.js currently 592 lines).
9. **boot close-out** — app.js = session resolution, header/nav composition,
   route table delegation (renderRoute becomes a lookup over the route
   modules), delegated-action registry merge, message area, version tag.
   Target ≤ ~300 lines.

## Acceptance

- All routes from router.js render and function under wrangler dev (desktop
  1280px) — smoke list in the design constraints.
- `npm test` green entire plan; no backend file touched.
- app.js ≤ ~300 lines; every moved function lives in exactly one module.
- CSP unchanged; no inline handlers introduced.
