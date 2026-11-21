# Moving image storage from D1 to R2

**Status: not started.** R2 isn't wired up yet. The `[[r2_buckets]]` block in `wrangler.toml` is commented out, and no code reads a `MEDIA` binding. This page is the plan for when it's turned on.

## Where image bytes live today

Everything is in D1:

| Content | Where | Size cap |
|---|---|---|
| Post and reply attachments | chunked across `attachment_chunks` (`api/attachments.mjs`) | 10 MiB each, up to 3 per post |
| GIF gallery | chunked across `gif_chunks` (`api/gifs.mjs`) | 10 MiB |
| Avatars | `users.avatar_data` and `users.pending_avatar_data` (`api/avatars.mjs`) | 1 MiB |

D1 limits a single row to about 2 MB, which is why attachments and GIFs are split into chunks. R2 is a better home for large files.

## Why it can be done in steps

Attachments are content-addressed: each one is looked up by its SHA-256 (`lookupCanonicalByHash` in `api/attachments.mjs`), and a missing file is a normal 404, never a crash. So R2 can become the place the bytes come from while D1 keeps all the metadata (status, hashes, moderation state). Only the byte source changes.

## Step 0: turn it on

1. Create the bucket: `pnpm exec wrangler r2 bucket create wempo-forum-media`
2. Uncomment the `[[r2_buckets]]` block in `wrangler.toml` (binding `MEDIA`).
3. Deploy with `pnpm run deploy`. The binding exists, but nothing uses it yet.

## Step 1: copy existing bytes into R2

| Content | R2 key | Source |
|---|---|---|
| Attachment | `attachments/<attachment-id>` | `attachment_chunks`, in `seq` order |
| GIF | `gifs/<gif-id>` | `gif_chunks`, in `seq` order |
| Approved avatar | `avatars/<user-id>/<avatar-version>` | `users.avatar_data` |
| Pending avatar | `avatars/<user-id>/pending-<version>` | `users.pending_avatar_data` |

Write a backfill script in `scripts/` that pages through each source and `put`s the bytes. It should be safe to re-run (a repeat `put` just overwrites) and able to resume where it stopped. Spot-check a few objects with `pnpm exec wrangler r2 object get` afterwards.

## Step 2: new uploads go to R2

- Attachments (`insertAttachments` in `api/attachments.mjs`): after the image is sanitized, `put` it to R2 instead of inserting chunks. Keep the `attachments` metadata row exactly as it is, so moderation doesn't change.
- GIF uploads (`api/gifs.mjs`) and avatar uploads (`api/avatars.mjs`): same idea, with metadata staying in D1.
- Everywhere bytes get deleted (post deletion, rejected attachments or avatars, account deletion), also delete the R2 object. A missed delete just leaves an orphaned object, not visible content.
- Keep the current size caps for this step so it's a storage-only change.

## Step 3: serve from R2, with D1 as a fallback

- `assembledChunkBytes` (`api/attachments.mjs`) and `assembledGifBytes` (`api/gifs.mjs`): try R2 first, fall back to the D1 chunks, then 404.
- `handleAvatarReadRoute` (`api/avatars.mjs`): try R2, then the D1 columns.
- Leave `imageResponse` (`api/core/images.mjs`) alone so the response headers stay the same.

## Step 4: clean up

Once nothing has needed the D1 fallback for a good while, stop writing chunks, add a migration that drops the chunk tables and avatar blob columns, and sweep orphaned R2 objects. Only delete D1 bytes at this point.

## Rolling back

D1 keeps the metadata the whole time, so every step can be undone: comment the binding back out and the D1 path serves again. Don't run step 4 until R2 has been running without problems for a while.
