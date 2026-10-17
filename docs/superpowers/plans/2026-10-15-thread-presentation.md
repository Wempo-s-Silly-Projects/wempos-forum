# Thread Presentation + Socials Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task. Steps use checkbox syntax.

**Goal:** Quote-hybrid thread presentation (reply counts, latest replies on home, cascade styling, quote chip + button) plus collapsible profile socials — v2.3.

**Architecture:** Feed/detail payloads gain batched-computed `replyCount` and `latestReplies`; all thread-shape semantics (parent_id, cursors, bumping) unchanged. Quote/blockquote is display-only text convention (`> ` lines), filtered at the normal post path.

**Tech Stack:** Cloudflare Workers, D1, vanilla ES modules, node:test.

**Spec:** Approved in chat 2026-10-15 (owner); mirrors the v2.2 patterns (batched per-page queries like attachmentRowsForView).

## Global Constraints

- No schema migration: replyCount/latestReplies derive at read time by batched queries (one per feed page, mirroring Task 5's withAttachments pattern).
- `replyCount` = level-1 replies + sub-replies (ALL comments in the thread, deleted/hidden excluded per existing visibility rules).
- `latestReplies` = up to 3 most recent level-1 replies for a root thread (author username, avatar URL, snippet ≤ 80 chars body-text, id, createdAt, subReplyCount), most recent first; may be empty; never null.
- Quote composer prefill format: `> @<username>: <one-line snippet> \n` (single line, snippet ≤ 120 chars, appended at the TOP of an empty composer; user edits it anyway). Blockquote rendering: consecutive lines starting `> ` inside a post/reply body render as a blockquote element.
- v2.3.0: package.json version + wrangler VERSION var + footer stamp all read from those (existing machinery — update values only).
- CSP untouched; module split holds; profile socials section becomes `<details class="socials-details">` (summary = platform count label; body = the existing list).

## Review Focus

1. **Cursor/pagination untouched** — new batched queries MUST NOT enter the feed SELECT or alter LIMIT 21/order; attach after rows return (same rule as the v2.2 spec's metadata discipline). Test pins the feed SQL is unchanged.
2. **Count/preview correctness on hidden posts** — hidden/deleted replies must not count or preview; author-visibility rules reuse canViewPost semantics for previews. Test covers a hidden reply being excluded.
3. **Quote injection safety** — quote text is user content; composer prefill must be inserted as a VALUE (textarea value/property), never HTML; blockquote rendering via text nodes only, no innerHTML. Test asserts no markup interpretation of `>` content.
4. **Empty/edge shapes** — thread with 0 replies (`replyCount: 0`, `latestReplies: []`), >3 replies caps at 3 most recent, snippet truncation at 80 chars.

---

### Task 1: Backend — replyCount + latestReplies on feed payloads

**Files:**
- Modify: `api/posts.mjs` (feed read path only: a batched counts query + a batched latest-replies query attached after rows return, mirroring withAttachments from the v2.2 metadata task), worker.mjs nothing, `api/shared.mjs` POST_SELECT untouched
- Test: `tests/threading.test.mjs` (append) — patterns exist for feed reads w/ mockDb

**Interfaces:**
- Produces: every serialized feed post gains `replyCount: number` and `latestReplies: Array<{id, authorUsername, avatarUrl?, snippet, createdAt, subReplyCount}>` (shape pinned in Global Constraints). Detail/replies read paths UNCHANGED.

- [ ] **Step 1: Failing tests** — feed read with mockDb: (a) post with 2 replies + 1 sub-reply → replyCount 3, latestReplies has its 3 most recent (order pinned); (b) hidden reply excluded from count AND preview; (c) zero-replies post → replyCount 0 + []; (d) 4+ replies → latestReplies exactly 3, replyCount full; (e) snippet truncates at 80 chars with ellipsis; (f) ONE counts query + ONE replies query per page (calls.length assertions like the attachments tests); (g) feed SQL (cursor clauses) unchanged.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full battery (252/252 + new) + dry-run.
- [ ] **Step 5: Commit** locally (no push) — `feat: replyCount and latestReplies on feed payloads`

### Task 2: Backend — quote endpoint support (none needed) + version 2.3.0

**Files:**
- Modify: `package.json` (2.3.0), `wrangler.toml` (VERSION "2.3.0")
- Test: `tests/frontend-glue.test.mjs` (stamp rendering updated if it pins "v2.2")

**Interfaces:**
- Produces: stamp renders `v2.3 · <sha>`. NO backend changes beyond the var value (quote prefill is frontend-only).

- [ ] **Step 1: Update** version values + any test pinning "2.2"/"v2.2"/"2.2.0".
- [ ] **Step 2: Run** battery + dry-run; **Step 3: Commit** locally — `chore: bump forum version to 2.3.0`

### Task 3: Frontend — counts, latest replies, cascade, quote, blockquotes, collapsible socials

**Files:**
- Modify: `public/js/render.js` (replyCount tag, latestReplies snippets row, cascade wrapper for sub-replies, blockquote splitter for bodies, quote-button on cards), `public/js/app.js` (quote-button handler → composers' textarea prefill via value property; details/summary handling none needed), `public/styles.css` (`.reply-count` tag, `.preview-replies` row, cascade indent tokens, `blockquote` styling within `.post-body`, `.socials-details`
- Modify: `public/index.html` nothing; `public/js/profile-editor.js`/profile render (find where socials render) — wrap in details/summary (default OPEN when >0 and user is the owner, closed for visitors? NO — keep simple: collapsed only for viewers, open for self — implementer decision, document it)
- Test: `tests/frontend-render.test.mjs`, `tests/frontend-glue.test.mjs`

**Interfaces:**
- Consumes: Task 1's `replyCount`/`latestReplies`; existing composer textarea builders in app.js (createComposer); existing post/reply card body renderer.

- [ ] **Step 1: Failing render tests** — (a) replyCount renders `💬 3` next to reactions when present (no tag when 0); (b) latestReplies renders up to 3 snippet rows (username + snippet + time) with app-link to the thread; (c) sub-reply cards on the detail page render inside the cascade wrapper when parent grouping is already enabled (reuse existing grouping structure — the wrapper class only); (d) body containing `> line\n> line2` renders those lines as blockquote children (text-only, no HTML interpretation — a body containing `<b>` renders escaped as today); (e) profile socials section renders as details/summary with the existing links inside.
- [ ] **Step 2: Failing glue tests** — quote button click sets composer textarea.value to `> @user: snippet\n` prefix + focuses it (never HTML injection — Review Focus 3); snippet truncation 120-char variant at composer prefill.
- [ ] **Step 3: Run** — FAIL; **Step 4: Implement**; **Step 5: full battery + dry-run**; **Step 6: Commit** locally — `feat: thread presentation UI (counts, previews, cascade, quotes) and collapsible socials`

### Task 4: Integration

- [ ] **Step 1:** Full battery `npm run db:migrate:local && npm test && npx wrangler deploy --dry-run` all green.
- [ ] **Step 2:** CLAUDE.md behavior-notes bullet: quote-hybrid rendering (`> ` lines → blockquotes, quote button prefill), replyCount/latestReplies on feed, cascade sub-reply styling, collapsible socials; version 2.3.
- [ ] **Step 3:** Commit locally — `docs: document thread presentation changes for v2.3`
- [ ] **Step 4:** Report to the owner + whole-branch review of this workspace's range (ef1a51d..HEAD) before the owner pushes.