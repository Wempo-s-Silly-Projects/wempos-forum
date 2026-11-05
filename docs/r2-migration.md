# Migrating media storage from D1 to R2

The forum currently stores every image byte inside D1 (avatars in `users.avatar_data`
/ `pending_avatar_data`, post/reply attachments chunked across `attachment_chunks`,
gallery images across `gif_chunks`). D1 caps a single row at ~2 MB and is a poor fit
for large media at scale. R2 is the intended store — this is the path for when the
account has R2 enabled. **Nothing in the shipped code reads the binding yet**; the
commented `[[r2_buckets]]` block in `wrangler.toml` is the only preparation.

## Why this is safe to do in phases

Every media read already resolves through a canonical lookup keyed by the
content-addressed SHA-256 (`lookupCanonicalByHash` in `api/attachments.mjs`), and
serving is fail-safe: missing bytes are the route's normal 404, never a crash. That
means R2 can be introduced as the *source of bytes* while D1 keeps all metadata
(status, hashes, moderation state) — the read path just changes WHERE the byte
concatenation comes from.

## Phase 0 — enable (when you pay for R2)

1. `wrangler r2 bucket create wempo-forum-media`
2. Uncomment the `[[r2_buckets]]` block in `wrangler.toml` (`binding = "MEDIA"`).
3. `wrangler deploy` — the binding exists but nothing uses it yet.

## Phase 1 — backfill: copy existing D1 bytes into R2

Object keys mirror the current canonical shape, so dedup keeps working:

| Content            | R2 key                                   | Source                                     |
|--------------------|------------------------------------------|--------------------------------------------|
| Attachment bytes   | `attachments/<attachment-id>`             | `attachment_chunks` in `seq` order         |
| Gallery bytes      | `gifs/<gif-id>`                          | `gif_chunks` in `seq` order                 |
| Approved avatar    | `avatars/<user-id>/<avatar-version>`     | `users.avatar_data`                         |
| Pending avatar     | `avatars/<user-id>/pending-<version>`     | `users.pending_avatar_data`                |

Backfill script sketch (`scripts/`, run against a local checkout with both bindings;
idempotent — `put` overwrites harmlessly, and content hashes make re-runs no-ops):

```js
// scripts/backfill-media-to-r2.mjs — sketch, write for real when Phase 0 is live
// 1. Page through attachment_chunks ORDER BY attachment_id, seq — concatenate
//    each attachment's chunks, `await env.MEDIA.put("attachments/" + id, bytes)`.
// 2. Same for gif_chunks → "gifs/" + id.
// 3. SELECT id, avatar_version, avatar_data, pending_avatar_version,
//    pending_avatar_data FROM users — put each non-null blob under its key.
// 4. After each successful batch, mark progress in a `media_migration_state`
//    table (or just resume by page number) so an interrupted run re-enters.
```

Verify with `wrangler r2 object get` spot-checks against known attachments.

## Phase 2 — write path: new uploads go to R2, D1 stores metadata only

- `api/attachments.mjs` (`readComposedBody` + `insertAttachments`): after
  `sanitizeImage`, `await env.MEDIA.put("attachments/" + id, clean)` replaces the
  chunk INSERT loop. Keep the `attachments` metadata row exactly as-is (status,
  hash, mime, version) — moderation flow untouched. The 10 MiB cap can be RAISED
  later, but keep it for phase 2 so the change is storage-only.
- `api/gifs.mjs` (upload route): same — `MEDIA.put("gifs/" + id, bytes)`, keep the
  `gifs` row.
- `api/profiles.mjs` (avatar upload): store the pending blob in R2, keep
  `pending_avatar_mime` / `avatar_status` in D1. Consider dropping the 1 MiB
  avatar cap to R2-comfortable sizes at the same time.
- Delete paths (`DELETE /api/posts/:id` cascades, attachment reject, avatar
  reject, account deletion): add the matching `MEDIA.delete(key)` alongside each
  D1 delete — best-effort (a missed delete is an orphaned object, not a leak of
  served content; add a periodic sweep later if orphans bother you).

## Phase 3 — read path: serve from R2, D1 as fallback

- `assembledChunkBytes` (attachments) / `assembledGifBytes` (gifs): try
  `MEDIA.get(key)` first; if the object is missing, fall back to the D1 chunk
  concatenation (covers anything the backfill missed), else the existing 404.
- Avatar serving in `api/shared.mjs` (`handleAvatarReadRoute`): same try-R2,
  fall back to the D1 blob columns.
- Keep the `imageResponse` egress contract untouched — sniffed MIME,
  `nosniff`, `Content-Disposition` all stay.
- Longer term (optional): redirect to R2 public access or a custom domain
  instead of proxying bytes through the Worker; that changes URLs, so it needs
  its own migration note.

## Phase 4 — cleanup

After a soak period with zero D1 fallback hits: stop writing chunks (drop the
chunk INSERTs), add a migration to drop the chunk tables and the avatar blob
columns, and sweep orphaned R2 objects. Only THEN delete any bytes.

## Rollback

Every phase is independently reversible because D1 keeps metadata at all times:
comment the binding back out and the chunk-fallback path resumes serving. Do not
drop D1 bytes (phase 4) until the R2 path has been boring for a while.
