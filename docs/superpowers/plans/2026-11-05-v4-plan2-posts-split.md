# v4.0 Plan 2 — posts.mjs Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `api/posts.mjs` (1,369 lines) into six single-topic modules, changing nothing observable — same routes, same cursor semantics, same payload shapes.

**Architecture:** Verbatim moves inside the posts topic. `worker.mjs` keeps calling one `handlePostRoutes`; the split module composes its piece handlers in the same order they were checked. Everything imports from `api/core/` (plan 1's leaves) — never from shared.mjs for moved names, and never topic-to-topic except through a thin public seam each new module exports.

**Tech Stack:** Cloudflare Workers ESM, D1, node:test.

**Spec:** `docs/superpowers/specs/2026-11-05-v4-rewrite-design.md` — Backend design (posts split), invariants 1/2/5/6. Plan 1's core leaves exist and are stable.

## Global Constraints

- Suite (`npm test` → 74/74) + `npx wrangler deploy --dry-run` green at every commit.
- Moves are verbatim relative to the pre-split `api/posts.mjs` (diff-verify each function against `git show <BASE>:api/posts.mjs`); a discovered bug is reported as its own commit, never folded into a move.
- The route order must be preserved: `handlePostRoutes` currently checks routes in a fixed sequence (feed → replies → detail → create → reply-create → edit → history → delete → reactions → suggestion-status → search); dispatch order changes are observable (first handler wins on overlap) and are therefore forbidden.
- shared.mjs's export surface is pinned by tests/core-layers.test.mjs — imports move to `api/core/` where names exist there; POST_SELECT / VIEW_INCREMENT_SQL / canViewPost come from core/shapers.mjs and core/visibility.mjs.
- The layer rule extends here: none of the six new modules may import shared.mjs except `handleAvatarReadRoute`-tier leftovers that still live there (none expected — if one is needed, stop and rule).

## Review Focus

1. **Dispatch-order drift** — a route landing in the composed chain at a different position than the original if/else chain resolved it. Pinned by a route-order test added in Task 1 asserting the exact handler sequence `handlePostRoutes` consults (reflection over a module-level exported route list).
2. **Cursor semantics drift** — the composite `<seconds>_<id>` / `<rank>_<id>` cursor logic moves into cursors.mjs; any deviation breaks pagination for open tabs. Pinned by new direct unit tests for encode/decode/parse of both cursor shapes (including the legacy 2-part cursor).
3. **The attachments decoration helper fan-out** — `withAttachments` is used by feed, detail, and replies reads; if one import path misses it, cards render without images. Pinned by the existing suite (attachment-rendering tests) staying green per move.
4. **Idempotency family coherence** — the staged-post fingerprint/replay family must move as one unit; a partial move leaves two files sharing private helpers through back-channels. Pinned by the existing idempotency tests + a no-new-export check (private helpers stay non-exported).

---

### Task 1: Route-order guard + cursors.mjs

**Files:**
- Create: `api/core/cursors.mjs`, `tests/cursors.test.mjs`
- Modify: `api/posts.mjs` (cursor parse/encode call sites re-pointed to core)

**Interfaces:**
- Produces: `parseCursor(raw)` → `{ seconds, id, rank? }` | null; `encodeCursor(row)`; the two ORDER-BY key builders if the feed code parameterizes them. Exact signatures extracted from the current code when the task starts (the functions are inline today — the move first EXTRACTS them, with tests written against the extracted form).

- [ ] **Step 1: Write failing tests for the cursor shapes observed in `listRootPosts`/`listReplies` (activity cursor, suggestions score cursor, legacy 2-part fallback)**
- [ ] **Step 2: Run → RED (no core/cursors.mjs)**
- [ ] **Step 3: Extract the cursor logic verbatim from posts.mjs into api/core/cursors.mjs; re-point call sites**
- [ ] **Step 4: Run → GREEN, suite green, dry-run clean**
- [ ] **Step 5: Add the route-order pin: export a `POST_ROUTE_ORDER` list from posts.mjs (the handler chain, in order) and test it equals the documented sequence; commit**

### Task 2: boards.mjs

**Files:**
- Create: `api/boards.mjs`
- Move verbatim: `BOARD_VALUES`, `SUGGESTIONS_BOARD`, `UPDATES_BOARD`, `GENERAL_BOARD_DEFAULT`, `boardField`
- [ ] Steps: create module → strip from posts.mjs, import back → suite + dry-run → commit.

### Task 3: posts-feed.mjs (reads)

**Files:**
- Create: `api/posts-feed.mjs`
- Move verbatim: `replySnippet`, `replyCountsSql`, `latestRepliesSql`, `withReplyMetadata`, `withAttachments`, `banFilterSql`, `listRootPosts`, `handlePostFeedRoute`, `handlePostDetailRoute`, `attachSubReplyCounts`
- Consumes: core cursors, core shapers (POST_SELECT, publicPost), core visibility, core auth (readSession), boards.mjs.
- [ ] Steps: create module → strip → suite + dry-run → commit.

### Task 4: replies.mjs

**Files:**
- Create: `api/replies.mjs`
- Move verbatim: `listReplies`, `handleRepliesReadRoute`, `handleReplyCreateRoute`, `REPLY_SNIPPET_MAX`
- Consumes: posts-feed's decoration helpers via a narrow re-export seam (`export { withReplyMetadata, attachSubReplyCounts }` from posts-feed — the only seam between the two).
- [ ] Steps: create module → strip → suite + dry-run → commit.

### Task 5: posts-write.mjs (writes)

**Files:**
- Create: `api/posts-write.mjs`
- Move verbatim: the idempotency family (`getPostIdempotencyKey`, `STAGED_IDEMPOTENCY_TTL_SECONDS`, `existingIdempotentPost`, `throwIfArchivedIdempotencyKey`, `storedPostFingerprint`, `assertIdempotencyFingerprint`, `replayIdempotentPost`, `postCreationFingerprint`), `persistStagedPostAttachments`, `handlePostCreateRoute`, `handleReplyCreateRoute`'s vision-scheduling helper `scheduleAttachmentVisionChecks` (shared create-side plumbing), `handlePostEditRoute`, `handlePostEditHistoryRoute`, `handlePostDeleteRoute`, `POST_DELETE_SQL`, `REPLY_REPARENT_SQL`, `postDeletionStatements`, `handleReactionRoute`, `handleReactionDeleteRoute`, `MAX_COMPOSER_BODY_CHARS`
- Note: `scheduleAttachmentVisionChecks` is consumed by BOTH post-create and reply-create — if replies.mjs (Task 4) already claimed it, its home is decided there and posts-write imports it through that module's seam. Resolve at implementation; ledger the placement.
- [ ] Steps: create module → strip → suite + dry-run → commit.

### Task 6: search.mjs + suggestions.mjs

**Files:**
- Create: `api/search.mjs` — `handleSearchRoute`, `searchReplies`, `threadRootId`
- Create: `api/suggestions.mjs` — `handleSuggestionStatusRoute`, `SUGGESTION_SCORE_SQL` (moves here from boards if boards didn't claim it; boards keeps the constants it needs for field validation — resolve and ledger)
- [ ] Steps: create both → strip both → suite + dry-run → commit.

### Task 7: Compose + close-out

**Files:**
- Modify: `api/posts.mjs` — becomes the thin composer: imports the six modules' handlers, keeps `handlePostRoutes` with the EXACT original dispatch order (pinned by Task 1's guard), exports what worker.mjs and tests import (POST_DELETE_SQL, REPLY_REPARENT_SQL, postDeletionStatements re-exports stay available under `api/posts.mjs` until the final sweep plan re-points importers).
- [ ] Step 1: rewrite posts.mjs as composer → suite + dry-run green
- [ ] Step 2: `wc -l` report; ledger anything discovered-not-fixed; commit

## Self-Review notes

- Spec coverage: the six files match the spec's posts split + boards; cursors.mjs (spec's core list) lands first as Task 1.
- Step scan: each task = create+strip+verify+commit; exact member lists pinned above.
- Type consistency: seam names named where two new modules touch (replies↔posts-feed, posts-write↔attachments helper).
