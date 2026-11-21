# Feature slate — wave 2026-11-21-31 (v4.36.0) — hardening + restored drafts

Not shipped before (checked against feature-slate-2026-11-21*.md and
public/js): drafts have autosaved since wave 2026-11-21 F1 but restored
silently, with no way to drop one except clearing the box by hand.

## F1 — Hardening pass over v4.32–v4.35 (`1f4943e..17ee6f7`)

Defects (RED test first, then fix; `tests/wave31-hardening.test.mjs`):

- **MEDIUM — upload count gate ran late** (`api/attachments.mjs`). The
  multipart reader refused a 4th image/GIF only after the loop, so every
  `images` part was read, sanitized, hashed and looked up in D1 (2 queries
  each) first; inside the ~30.5 MiB request ceiling one request could drive
  hundreds of lookups. `assertAttachmentRoom` now refuses the over-cap part
  before any work. 40-image body: 40 lookups → ≤ 3.
- **LOW — false "Discard your changes?"** (`public/js/render.js`
  `editHasUnsavedChanges`). Textareas report CR/CRLF as LF; a body stored with
  CRLF (API/MCP clients; the server only trims) compared unequal with no
  typing. Both sides are now line-break-normalized.
- **LOW — storage sweep blind spot** (`tests/wave27-storage-wipe-sweep`).
  The write pattern missed `localStorage.key = v`; it now matches dot
  assignment (not `==`) and self-checks every write shape.

Confirmed, no change:

- Server upload enforcement is independent of the client: byte ceiling 413
  before buffering, 10 MiB per file, magic-byte sniff (client type/name
  ignored — pinned with a `cat.png` that is not an image), metadata strip via
  `sanitizeImage`, revoked-hash check, 3-item cap.
- The paste strip creates no object URLs (names only), so nothing to revoke;
  a successful post re-renders the form, dropping staged files.
- Body cap parity: client `COMPOSER_MAX_CHARS` 4750 == server
  `MAX_COMPOSER_BODY_CHARS` (pinned in wave30); server `requiredText` rejects
  over-cap bodies.
- Feed rollup: new differential cases (deleted roots, roots / level-1s hidden
  after replies, ban on → expired → revoked) match the frozen pre-v4.34 SQL
  for anon, both sides of a block pair and an admin. Bound params at the max
  page (20 ids, blocking member) = 51 ≤ D1's 100 (old form 26). LOW
  suspicion: `listRootPosts` `options.limit` is an unused knob; at 45+ ids
  the rollup would pass 100 binds. Pinned by test at 20.
- 0059: the dm pair lookup still plans on `sqlite_autoindex_dm_threads_1`.
- Shortcut sheet and unread-only filter: page-view only, no defects.

## F2 — Restored-draft notice + Discard draft

- When a composer restores an unsent draft it shows "Restored your unsent
  draft (saved 5m ago)." (`Intl.RelativeTimeFormat`, locale-aware) with a
  **Discard draft** button (`public/js/draft-notice.js`).
- Discard asks first, then empties the box and removes that one stored
  draft; autosave stays armed so new typing saves as before.
- `drafts.js`: `loadDraftEntry` (body + savedAt); `attachDraftAutosave`
  returns `{ savedAt }` on restore, else null. `loadDraft` unchanged.
- Privacy: reads the existing account-scoped `forum-draft:` key; no new
  storage key, no request (source-pinned).

## Strings

3 new keys (`drafts.restored`, `drafts.discard`, `drafts.discardConfirm`)
in en and all 20 locales.

## Gates

No migration. One server change (`api/attachments.mjs`, earlier refusal,
same error text). Deploy follows the normal push then `pnpm run deploy`.
