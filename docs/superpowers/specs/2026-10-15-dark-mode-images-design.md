# Wempo's Forum: Dark Mode + Image Attachments — Design

Date: 2026-10-15
Status: Approved design (pending implementation plan)

## Goals

1. **Dark mode** — a user-switchable dark theme that follows the OS preference by default, without changing the forum's current visual identity.
2. **Image attachments** — users attach up to 3 images (JPEG, PNG, WebP, or animated GIF) to posts and replies. Uploads only: no external image URLs, ever, so the CSP stays same-origin and third parties never see viewers' IPs.

Non-goals: drag-and-drop upload, image resizing/compression on the server, video attachments, external URL embeds, per-image captions.

**Revision (2026-10-15, post-implementation):** the per-image limit is **10 MiB** (user decision). D1 hard-caps a single BLOB/row at 2,000,000 bytes (2 MB), so attachment bytes are chunked across a dedicated table rather than stored in one column. See "Storage model (chunked)" below.

## Part 1: Dark mode

### Token strategy

`public/styles.css`'s `:root` block remains the single source of truth for color variables. Dark mode overrides those same variables rather than introducing a second palette: the existing colors are re-weighted (paper → deep ink surfaces, ink → warm off-white text, adjusted muted/line/green/coral/yellow/blue/focus values for contrast on dark backgrounds).

All 48 existing `var(--…)` call sites continue to work unchanged; only the definitions swap.

### Scheme declaration

- `<meta name="color-scheme" content="light dark">` in `index.html`'s `<head>`.
- `:root { color-scheme: light dark; }` in `styles.css` so scrollbars, form controls, and the browser canvas adapt.
- `accent-color` on `:root` set to the theme's green so native checkboxes/radios match.

### Mode resolution

Precedence, highest first:

1. **Manual choice** — `localStorage.forum-theme` = `"light"` or `"dark"`, applied as `data-theme` attribute on `<html>`.
2. **OS preference** — when no manual choice exists, a `@media (prefers-color-scheme: dark)` block in `styles.css` applies the dark variable set (as `:root:not([data-theme])` so a stored manual value always wins).
3. **Light** — the current look, for anything else (including `data-theme="light"` explicitly).

### No-flash behavior

A tiny inline `<script>` in `index.html`'s `<head>` runs before paint: if `localStorage.forum-theme` is set, it sets `document.documentElement.dataset.theme` to that value. This prevents a flash of the wrong theme on reload.

### Toggle

A moon/sun button in the header flips the theme, updates `data-theme`, and writes the choice to `localStorage.forum-theme`. Logic lives in a new `public/js/theme.js` (small, self-contained, wired from `app.js` init like other modules). The button's accessible label announces the action ("Switch to dark theme"/"Switch to light theme").

## Part 2: Image attachments

### Storage model (chunked — revision 2)

D1's 2 MB BLOB/row cap rules out single-column storage at 10 MiB, so bytes live in chunk rows:

- **`attachments` table** — metadata + moderation state only (no blob columns after migration `0004`): `id` TEXT PK, `post_id` FK, `created_by` FK, `created_at`, `mime`, `status` (`pending|approved|rejected`), `version`.
  - Rationale for a NEW migration instead of editing 0003: local dev D1 tracks applied migrations by filename, so an in-place edit would not re-run; the remote DB has not received any of these migrations yet, so a clean DROP+reCREATE chain (0003 → 0004) runs correctly in both places.
- **`attachment_chunks` table**: `attachment_id` TEXT FK → attachments ON DELETE CASCADE, `kind` TEXT CHECK(`'pending','approved'`), `seq` INTEGER (0-based, ordered), `data` BLOB NOT NULL with a CHECK ≤ 2,000,000 bytes. PK `(attachment_id, kind, seq)`. An attachment's byte set is its chunks of a given kind concatenated in `seq` order.
- Pending bytes (author-only visibility) are `kind='pending'` chunks; approval converts `kind` pending→approved in place (single UPDATE) and bumps `version`; rejection deletes the attachments row (chunks cascade).
- **Limits (revised):** 10 MiB per image (`MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024`), still 3 images per post/reply, request ceiling `3 * MAX_ATTACHMENT_BYTES + 512 KiB` ≈ 30.5 MiB, chunk fill at 1,900,000 bytes per chunk (margin below the 2 MB cap).
- Serving assembles chunks by concatenating `seq`-ordered chunks in memory (Workers has ample memory for ≤10 MiB); a status whose chunk set is empty serves 404 (fail-safe). The moderation queue's `sizeBytes` is `SUM(length(data))` over the pending chunks.
- Magic-byte sniffing, hybrid visibility, all moderation semantics, CSP, and rate limits are unchanged from the original design.

### Serving

- `GET /api/attachments/:id` in a new `api/attachments.mjs`:
  - Approved images serve to everyone (public, no auth), `?v=` cache-busting param stored as `version`.
  - `pending` images serve **only to their author** and to moderators. Everyone else gets 404 (not 403 — don't confirm existence).
  - `rejected` images 404 for everyone.
  - Response sets `Cache-Control: private, max-age` for pending (author-only) and longer caching for approved public bytes, with immutable versioning.

### Upload path

- Composers gain a paperclip attach button accepting up to **3 images per post or reply**. Files upload together with the post/reply body in one `multipart/form-data` request (same pattern as the avatar form) — new endpoint bodies:
  - `POST /api/posts` gains `images` file field (repeatable, 0–3).
  - `POST /api/posts/:id/replies` gains the same.
- Validation per file:
  - Magic-byte check for JPEG (`FF D8 FF`), PNG (`89 50 4E 47`), WebP (`RIFF….WEBP`), GIF (`GIF87a`/`GIF89a`). Validation logic reused from / refactored out of the avatar checker in `api/profiles.mjs` into `api/shared.mjs` so both call one implementation.
  - **10 MiB per image** (revision 2; chunked per the Storage model section); the request body limit scales to cover 3 images + text (≈ 30.5 MiB hard ceiling on the buffered body).
  - Mime claimed by the browser is never trusted; stored mime comes from the magic bytes.
- Rate limit: `image-upload` per-account binding (5/min) in addition to the existing per-IP write limit (same shape as the avatar-upload limiter).
- All parts of a post's image set are stored `pending` on creation.

### Visibility rules (hybrid)

- The post's **author always sees their own attachments** immediately (pending bytes served from the pending pair).
- **Everyone else sees a placeholder** ("🖼️ image awaiting review") until each attachment is approved.
- Deletion: deleting a post (existing delete path) cascades to its attachments. Rejecting an attachment removes its bytes and sets status `rejected`.

### Moderation

- `GET /api/admin/attachments` — moderator-only queue of pending attachments (id, post id, uploader, mime, size, created_at), same shape as the avatar queue.
- `POST /api/admin/attachments/:id/approve` — promotes pending bytes to the approved pair, `status='approved'`, bumps version.
- `POST /api/admin/attachments/:id/reject` — clears bytes, `status='rejected'`.
- Surfaced in the existing moderator tools panel next to the avatar queue. Moderator UI lets them jump to the containing post for context.
- The existing word-filter and reports flow are untouched; reports on posts already surface the containing post.

### CSP

**Unchanged** (`img-src 'self' data:`). That is the security payoff of uploads-only.

### Frontend rendering

- Post and reply cards render an image strip under the text when attachments exist. Author-side pending images render with a small "awaiting review" chip; other users get the placeholder.
- `<img loading="lazy">` for all attachments; images cap at a reasonable rendered size with the existing paper card styling.
- The composer shows thumbnails of chosen files with a per-file remove button before posting.

## Security notes

- Magic bytes validated server-side; served responses re-state the validated mime with `X-Content-Type-Options: nosniff` (header already global).
- Pending attachments are author/moderator-only reads; existence is not confirmed to outsiders (404).
- Attachment serving never sets user-controlled headers; ids are random, hashes not needed (unlike sessions) because ids are already opaque.
- Body-size and rate limits apply before any D1 write.
- Same CSRF/Origin/session rules as every other state-changing endpoint.

## Testing

- Unit tests (existing `tests/` patterns, node:test):
  - Magic-byte validation: each accepted type passes; mismatched/claimed-but-wrong mime fails; truncation fails.
  - Limits: >1 MiB rejected; 4 files rejected; oversized request body rejected.
  - Hybrid visibility: author sees pending bytes; a second account 404s; moderator sees pending bytes; approve → public; reject → 404 for all.
  - Queue endpoints require moderator role; approve/reject state transitions.
  - GIF specifically: `GIF89a` bytes pass and serve with `image/gif`.
- Browser smoke additions: attach a GIF to a post, see it as the author, log in as second account → placeholder; approve in mod panel → visible. Dark-mode toggle round-trips through reload.

## Checks before done

`npm run db:migrate:local && npm test && wrangler deploy --dry-run`, plus the browser smoke list above.

## Open items for implementation planning

- Exact dark-palette hex values (to be tuned during implementation against contrast).
- Whether `session.mjs`'s `/api/me` responses need an `attachments pending count` signal for mod-panel badge (decide in plan; not required).