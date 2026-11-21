# Feature slate — wave 2026-11-21-32 (v4.37.0) — feed page-size guard + long-post fold

Not shipped before (checked against feature-slate-2026-11-21*.md and
public/js): feed cards always rendered the full body; "Thread at a glance"
covers read time on the thread page only, and nothing clipped long posts.

## F1 — Feed page size under the D1 bind ceiling (LOW, from wave 31)

- `api/posts-feed.mjs` `listRootPosts` accepted `options.limit` that no
  caller passed; the reply-count rollup binds 2n+11 values for a blocking
  member, so any page of 45+ ids would pass D1's 100-parameter limit and
  500 the feed.
- The option is removed. Every branch (activity, suggestions, id-cursor /
  search) pages by `FEED_PAGE_SIZE = 20` from `constants.mjs`, next to
  `D1_MAX_BOUND_PARAMS = 100`; the 20/21 literals are gone.
- `tests/wave32-feed-page-size.test.mjs` (RED first) spies on every
  `bind()` of a real signed-in `GET /api/posts` by a blocking member at a
  full page (25 roots, replies, sub-replies, bookmarks): worst case = 51
  (the rollup), < 100. A caller-supplied `limit: 60` is ignored on all
  three branches. Chunk the IN-lists before ever raising the page size.
- `tests/wave29-feed-rollup.test.mjs` unchanged and green.

## F2 — Long posts fold in the feed (unique)

- Feed cards (data-driven: the feed decorates cards with `latestReplies`)
  whose body passes 900 characters or 14 lines show a clipped body (18rem,
  fade-out mask) and a **Show more** / **Show less** button
  (`aria-expanded`, `aria-controls`). The thread page always shows the
  whole post.
- Tabbing onto a link inside the clipped part unfolds it (`focusin`).
- The fold is one wrapper, so the edit swap hides it and Cancel restores
  it (`isEditBodyBlock` knows `post-body-fold`).
- `public/js/long-post.js`; modulepreload hint added. Page-view only: no
  storage, no request (source-pinned).
- `tests/wave32-long-post-fold.test.mjs` (RED first; caught an inverted
  toggle before commit).

## Strings

2 new keys (`longPost.showMore`, `longPost.showLess`) in en and all 20
locales.

## Migrations

None.
