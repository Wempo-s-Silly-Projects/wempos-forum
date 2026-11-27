# Feature slate 2026-11-22-activitypub (ActivityPub federation, P1–P4)

Owner: "OOOOOOOOO thats nice". Goal: people on Mastodon, Lemmy and other
fediverse servers can find, follow and reply to forum threads, categories
and members, without the forum giving up its defaults law.

Checked against earlier slates: nothing ActivityPub-shaped has shipped. The
closest pieces are the discovery routes (`api/discovery.mjs`: api-catalog,
MCP server card, sitemap, markdown views), the outbound fetch guard
(`api/link-preview.mjs:27-110`: `isPublicAddress`, `resolveHost`,
`readCapped`), server spoiler masking (`api/core/spoilers.mjs`), and the
visibility SQL (`api/core/visibility.mjs`: `ACTIVE_BAN_SQL`,
`viewablePostSql`, `canViewPost`). Repo state: `249bc92`, v5.82.1,
migration ledger top 0087, 65 locale files.

The work is split into four phases. Each phase is its own wave, ships on its
own, and can be turned off with one switch (`AP_ENABLED` var, default
`"off"`). Nothing federates until staff turn on a category AND a member opts
in.

---

## 0. Decisions this slate asks for (OWNER-GATED)

| # | Question | Seat recommendation |
|---|---|---|
| Q1 | Which categories federate at launch? | **None by default.** Staff turn each one on. Suggested first pick: `showcase` and `general`. Never `help` (often holds personal debugging data); `updates`/`polls` only if staff want announcements federated. |
| Q2 | Library: Fedify, or our own code? | **Our own code**, using built-in WebCrypto (see §6). Fedify is MIT and works with Workers, but its Workers adapter needs KV and Queues, and it brings about 20 dependencies. |
| Q3 | Key storage secret | A new owner-held secret, `AP_KEY_SECRET`, entered only via stdin (`wrangler secret put AP_KEY_SECRET`). The owner sets it; agents never see it. |
| Q4 | Replies from other servers | Held for review at first: they land as **staged** (only staff and the author see them) until staff approve them, or until staff mark that server as trusted. |
| Q5 | Replies by members who haven't opted in, inside a federated thread | **Left out** of what federates. Other servers see a "N more replies on the forum" link, never the text or the author. |
| Q6 | When a member opts out | Send `Delete` for every one of their federated posts, then `Delete(Person)`; their actor URL answers 410. The settings page tells them plainly that other servers may keep copies. |
| Q7 | NodeInfo `usage` numbers (member/post totals) | Leave them out (`usage: { users: {} }`). They expose site activity and are not required. |
| Q8 | Federate image attachments? | Not in P1–P2: posts go out as text plus a link. Revisit later; attachment URLs work like passwords (capability URLs, `attachments.mjs:343`). |
| Q9 | Federate local members' likes outward (P4)? | **No** by default. A separate per-member opt-in, off by default. |
| Q10 | Paid Workers plan? | It decides the delivery batch size: 50 subrequests per run on the free plan, 1000 on paid. The constant defaults to the free plan. |

---

## 1. Scope by phase

### P1 — Read-only outbound (discoverable, no inbox)

What: other servers can look up and fetch forum actors and objects. They
cannot follow yet, and no inbox exists. Covers:

- **WebFinger** `GET /.well-known/webfinger?resource=acct:<name>@wempos-forum.com`
  (also `acct:<board>@…` for categories). Answers only for opted-in members
  and federated categories. Everything else gets the same 404, so the route
  can't be used to check who has an account.
- **NodeInfo** `GET /.well-known/nodeinfo` → `GET /nodeinfo/2.1`: software
  name and version, `protocols: ["activitypub"]`, `openRegistrations`. No
  usage totals (Q7).
- **Actors**, using stable numeric ids so a username rename never breaks
  followers:
  - Member: `GET /ap/users/:id` → `Person` (preferredUsername, name,
    summary = bio only if the member ticks it, approved avatar URL, `url` →
    `/u/<name>`, publicKey, inbox and outbox URLs).
  - Category: `GET /ap/boards/:slug` → `Group` (Lemmy-compatible:
    `postingRestrictedToMods` for staff-only boards, `attributedTo` →
    moderators collection).
  - Instance actor: `GET /ap/actor` → `Application`. It signs our own fetches
    to servers that require signed fetches.
- **Outbox** `GET /ap/users/:id/outbox`, `/ap/boards/:slug/outbox`:
  `OrderedCollection` with paged `Create` items, page size `FEED_PAGE_SIZE`.
- **Objects** `GET /ap/posts/:id`: a root topic is a `Page` (name = title,
  Lemmy-style), a reply is a `Note` with `inReplyTo`. They are served only
  if `canViewPost(post, null)` passes as a guest, the board is federated,
  and the author has opted in. Otherwise the route returns 404.
- **Content negotiation**: `/posts/:id`, `/u/:name` and `/c/:slug` answer
  `application/activity+json` / `application/ld+json; profile=…` with a 302
  to the `/ap/…` URL. HTML pages carry
  `<link rel="alternate" type="application/activity+json">`. Pasting a
  thread URL into Mastodon search then finds it.
- **HTTP Signatures on fetch**: every outbound GET (P1 only fetches remote
  keys to test signature verification) is signed by the instance actor
  (draft-cavage `rsa-sha256`).

The P1 admin route turns categories on and off. The member settings toggle
ships in P1 (opt-in, off by default), so an actor only exists after the
member turns it on.

### P2 — Follows, Accept, delivery

- **Inboxes**: `POST /ap/inbox` (shared), `/ap/users/:id/inbox`,
  `/ap/boards/:slug/inbox`. Handled in P2: `Follow`, `Undo(Follow)`,
  `Delete(Person)` (purge the cached remote actor), and `Update(Person)`
  (refresh the cache). Every other activity type gets `202` and is dropped
  until P3/P4.
- **Accept**: a valid `Follow` of an opted-in member or a federated board is
  answered with `Accept(Follow)` through the delivery queue. Members get a
  setting to approve follows by hand (`manuallyApprovesFollowers`), **on by
  default**, so nothing reaches a stranger without the member's say. The
  member sees the queue on `/settings → Fediverse`.
- **Delivery**: creating, editing or deleting a federated post queues one
  `ap_deliveries` row per **distinct shared inbox**, deduplicated, written
  in the same `batch()` as the post write. A **Cron Trigger** (`* * * * *`,
  new `scheduled()` handler in `worker.mjs`; no Queues, no KV) claims up to
  `AP_DELIVERY_BATCH` due rows per run. It sends each with a signature,
  using `ctx.waitUntil` within the subrequest budget, and retries failures
  with exponential backoff (`AP_DELIVERY_BACKOFF_SECONDS`, base 60 s, ×4).
  A row is dropped after `AP_DELIVERY_MAX_ATTEMPTS` (8, about 2 days), and
  the server is marked `unreachable` until its next successful inbound
  request.
- Category Group actors **Announce** each new federated topic to their
  followers (the Lemmy model). Member actors send `Create` to theirs.
- **Edits** send `Update(Note|Page)`. **Deletes** (including staff
  hide/remove, author delete, ban, a block by the board, and the member
  opting out) send `Delete` + `Tombstone`. `GET /ap/posts/:id` then answers
  410.

### P3 — Replies from other servers become forum replies (moderated)

- In the inbox, `Create(Note)` whose `inReplyTo` is a federated local post
  becomes a forum reply under that post. The author is a **shadow member**:
  a `users` row with no password, no session, no email and no login, linked
  to `ap_remote_actors.local_user_id`. Its username is reserved, shown as
  `@alice@mastodon.social`, and it can never sign in. Shadow members are
  excluded from leaderboard, presence, newest members, search-users and
  member counts.
- Moderation: the reply is inserted **staged** (`THREAD_REPLY_INSERT_STAGED_SQL`,
  `constants.mjs:60`) unless the server is on the staff `trusted` list. It
  goes through the existing filters (`filterstore`, automod) before insert.
  Staff approve or remove it from the existing hidden/staged queue, with a
  "From the fediverse" badge.
- A content warning in the remote `summary` becomes a forum spoiler wrapping
  the body. Remote HTML is reduced to plain text plus links (no markup kept
  beyond what the forum's markdown would produce). The body is capped at
  the composer cap.
- `Update(Note)` from the same actor edits its own reply. `Delete(Note)`
  removes it. Neither works on any other post.
- Local members can block a shadow member like any member. The block
  direction rules and visibility SQL apply unchanged.
- **Report remote content**: the existing report button works on shadow
  replies. Staff can also send a `Flag` back to the origin server (a
  per-report checkbox, off by default; the reporter's identity is never
  included and the instance actor sends it).

### P4 — Likes and boosts

- Inbound `Like` on a federated local post becomes a `like` reaction by the
  shadow member (`REACTION_VALUES`, `constants.mjs:113`). `Undo(Like)`
  removes it. `Dislike` (Lemmy) becomes `dislike`. Remote reactions count
  only while the shadow member is not banned and the server is not blocked.
  This works the same way as the wave-40 reactor-ban filter.
- Inbound `Announce` (boost) adds to a "Boosted N times on the fediverse"
  count on the post (stored, not shown per person).
- Outbound: local likes are **never** federated unless the member turns on a
  second opt-in, "Share my likes on the fediverse" (Q9), off by default.

---

## 2. Defaults law (FSF posture)

1. **Member federation is opt-in per member**, off by default (`/settings →
   Fediverse`). No actor, WebFinger answer or outbox exists until the member
   turns it on. Turning it off undoes it (Q6).
2. **Category federation is chosen by staff**, all off at launch (Q1). Staff
   pages `/admin → Federation` list each category with an on/off switch.
3. **What leaves the site** (complete list, also written on the settings
   page in plain words):
   - Member actor: forum username, display name, approved avatar URL, the
     profile page link, the public key. The bio only if the member ticks
     "Include my bio". Never: email, join date, last seen, presence,
     badges, follower names, block lists, notes, drafts, DMs, chat.
   - Post: title (roots), text with spoilers masked (below), the times it
     was written and edited, the category, the thread link, `inReplyTo`.
     Never: reactions by local members (unless P4 opt-in), view counts,
     staged/hidden posts, attachments (Q8).
   - Followers/following collections publish `totalItems` only. Item lists
     are never served.
4. **Network actions are explicit**: we fetch a remote actor only when it
   follows, replies, likes or boosts, or when we verify its signature. We
   never crawl other servers.
5. **Deletes and edits propagate**: `Update`/`Delete` for every edit,
   removal, hide, ban, opt-out and account deletion. Account deletion sends
   `Delete(Person)`.
6. **Blocks work both ways**: a member blocking a shadow member means that
   actor's replies, likes and follows are refused (`Reject(Follow)` and
   removal from followers), and nothing of that member's reaches it. Blocked
   servers (§3) get nothing and send nothing.
7. **Banned members never federate**: a ban sends `Delete` for their
   federated posts and stops their actor (410). Every outbound query joins
   `ACTIVE_BAN_SQL`.
8. **Spoiler masking**: outbound content passes through `maskSpoilers`
   (`api/core/spoilers.mjs`). A post with any spoiler gets `summary` =
   site-language "Contains spoilers" and `sensitive: true`, and its spoiler
   spans become "[spoiler — read on the forum]" links. Hidden text never
   leaves the site. Inbound CWs become forum spoilers (P3).
9. **Visibility law**: only `visibility = 'public'`, not staged, roots and
   ancestors viewable by a guest (`viewablePostSql`), in a federated board,
   by an opted-in, unbanned author. Ancestors must pass the same checks,
   else the reply is not federated.

---

## 3. Moderation and abuse controls

- **Server block list (defederation)**: `ap_instance_policies(host, policy)`
  with `policy IN ('block','silence','trusted')`. `block` drops inbound
  requests (401), stops outbound delivery, and purges that server's shadow
  members' staged content. `silence` means everything from it is staged.
  `trusted` means its replies skip staging. Staff manage it at
  `/admin → Federation → Servers`. Wildcard subdomains match
  (`*.example`).
- **Signature verification** (every inbox POST): draft-cavage
  `Signature` header with `(request-target) host date digest` required, a
  matching `Digest: SHA-256=` over the raw body, and `Date` within
  `AP_SIGNATURE_MAX_SKEW_SECONDS`. The keyId owner must equal the activity
  `actor`, and the actor host must match the keyId host. The key is fetched
  through the SSRF guard (`resolveHost` + `isPublicAddress`, reused from
  `api/link-preview.mjs`, not re-declared) and cached
  `AP_ACTOR_CACHE_SECONDS`. If verification fails, the actor is re-fetched
  once (key rotation), then the request gets 401. RFC 9421 verification is
  added in P2 if the review finds servers that send only 9421.
- **Rate limits**: new scopes in `RATE_LIMIT_BINDINGS`:
  `"ap-inbox": "WRITE_RATE_LIMITER"` keyed per remote **host**, and
  `"ap-read": "READ_RATE_LIMITER"` for actor/outbox/object GETs. No new
  wrangler binding.
- **Payload caps** (root `constants.mjs`): inbox body
  `AP_INBOX_MAX_BYTES` (256 KiB, read with `readCapped`), remote actor
  document `AP_ACTOR_MAX_BYTES` (64 KiB), remote note text
  `AP_REMOTE_TEXT_MAX_CHARS` (= composer cap), max `to`/`cc` recipients
  examined `AP_MAX_RECIPIENTS` (50), JSON depth `AP_MAX_JSON_DEPTH` (16, via
  `secure-json-parse`, already a dependency).
- **Spam**: new shadow members are staged-only (Q4). Per-host daily caps on
  new shadow members (`AP_NEW_REMOTE_ACTORS_PER_HOST_DAY`, 20). The existing
  word filter and automod run before insert. Replies are refused when the
  thread is locked or the board is staff-only for topics. Mentions in
  remote replies never notify local members who haven't opted in.
- **Duplicate and replay protection**: `ap_inbox_seen(activity_id)` with a
  7-day retention sweep in the same cron. A repeated activity id gets 202
  with no work.
- **Human-check bypass**: the server-to-server paths (`/ap/*`,
  `/.well-known/webfinger`, `/.well-known/nodeinfo`, `/nodeinfo/*`) must
  skip Anubis/ALTCHA, because remote servers cannot solve a challenge. They
  keep the rate limits and signatures instead. Pin this with a test so the
  bypass list never grows past these prefixes.

---

## 4. D1 schema (CREATE-only, fresh numbers 0088–0091)

These run under the NAME-PRESENCE ritual (`wempos-forum-ritual`). No
`ALTER` on existing tables: the opt-ins live in their own tables. No FK
`ON DELETE CASCADE` (D1 FK law: rename-rebuild cascades silently). Account
deletion and wipe paths delete rows explicitly, with a test that pins each
table in the wipe list.

**0088_activitypub_core.sql (P1)**
```sql
CREATE TABLE IF NOT EXISTS ap_member_settings (
  user_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  share_bio INTEGER NOT NULL DEFAULT 0 CHECK (share_bio IN (0,1)),
  manual_follows INTEGER NOT NULL DEFAULT 1 CHECK (manual_follows IN (0,1)),
  share_likes INTEGER NOT NULL DEFAULT 0 CHECK (share_likes IN (0,1)),
  enabled_at INTEGER, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ap_board_settings (
  board TEXT PRIMARY KEY,           -- gated by BOARD_VALUES in the handler
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  updated_by INTEGER, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ap_actor_keys (
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','board','instance')),
  actor_ref TEXT NOT NULL,          -- user id, board slug, or 'instance'
  key_id INTEGER NOT NULL,          -- rotation generation
  public_pem TEXT NOT NULL,
  private_wrapped BLOB NOT NULL,    -- AES-GCM(HKDF(AP_KEY_SECRET, actor)), see §5
  iv BLOB NOT NULL,
  created_at INTEGER NOT NULL, retired_at INTEGER,
  PRIMARY KEY (actor_kind, actor_ref, key_id));
CREATE INDEX IF NOT EXISTS idx_ap_actor_keys_live
  ON ap_actor_keys(actor_kind, actor_ref) WHERE retired_at IS NULL;
```

**0089_activitypub_delivery.sql (P2)**
```sql
CREATE TABLE IF NOT EXISTS ap_remote_actors (
  id INTEGER PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE, host TEXT NOT NULL,
  inbox TEXT NOT NULL, shared_inbox TEXT,
  public_key_id TEXT NOT NULL, public_key_pem TEXT NOT NULL,
  handle TEXT NOT NULL,             -- alice@mastodon.social, display only
  name TEXT, local_user_id INTEGER, -- shadow member (P3)
  fetched_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ap_remote_actors_host ON ap_remote_actors(host);
CREATE TABLE IF NOT EXISTS ap_follows (
  local_kind TEXT NOT NULL CHECK (local_kind IN ('user','board')),
  local_ref TEXT NOT NULL,
  remote_actor_id INTEGER NOT NULL,
  follow_activity_uri TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','accepted')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (local_kind, local_ref, remote_actor_id));
CREATE INDEX IF NOT EXISTS idx_ap_follows_remote ON ap_follows(remote_actor_id);
CREATE TABLE IF NOT EXISTS ap_deliveries (
  id INTEGER PRIMARY KEY,
  inbox TEXT NOT NULL, host TEXT NOT NULL,
  signer_kind TEXT NOT NULL, signer_ref TEXT NOT NULL,
  activity_json TEXT NOT NULL,      -- capped AP_ACTIVITY_MAX_BYTES
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL, claimed_until INTEGER,
  last_status INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ap_deliveries_due ON ap_deliveries(next_at) WHERE claimed_until IS NULL;
CREATE TABLE IF NOT EXISTS ap_instance_policies (
  host TEXT PRIMARY KEY,
  policy TEXT NOT NULL CHECK (policy IN ('block','silence','trusted')),
  note TEXT, updated_by INTEGER, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ap_instance_health (
  host TEXT PRIMARY KEY, unreachable_since INTEGER, last_ok_at INTEGER);
CREATE TABLE IF NOT EXISTS ap_inbox_seen (
  activity_uri TEXT PRIMARY KEY, seen_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ap_inbox_seen_age ON ap_inbox_seen(seen_at);
```

**0090_activitypub_remote_posts.sql (P3)**
```sql
CREATE TABLE IF NOT EXISTS ap_remote_posts (
  post_id INTEGER PRIMARY KEY,      -- local reply row
  object_uri TEXT NOT NULL UNIQUE,
  remote_actor_id INTEGER NOT NULL,
  received_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ap_remote_posts_actor ON ap_remote_posts(remote_actor_id);
CREATE TABLE IF NOT EXISTS ap_federated_posts (  -- which local posts went out (for Update/Delete fan-out)
  post_id INTEGER PRIMARY KEY, first_sent_at INTEGER NOT NULL, deleted_sent_at INTEGER);
```

**0091_activitypub_boosts.sql (P4)**
```sql
CREATE TABLE IF NOT EXISTS ap_announces (
  post_id INTEGER NOT NULL, remote_actor_id INTEGER NOT NULL,
  activity_uri TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, remote_actor_id));
```
(Likes reuse the existing `reactions` table via the shadow member: no new
table.)

**Bind budget** (`D1_MAX_BOUND_PARAMS` = 100): the widest single statement
is the delivery enqueue at 8 columns. Rows are chunked at
`floor(100 / 8) = 12` per INSERT; the helper takes the column count, never a
literal. Fan-out reads use `IN (SELECT …)` subqueries, not bound id lists.
Remote actor upsert is 11 binds. Key insert is 8. Test: every new statement
in `api/activitypub/*.mjs` stays under 100 binds at the max fan-out
(`AP_MAX_RECIPIENTS`), as `tests/*bind-budget*` pins for other modules.

---

## 5. Keys

- **Algorithm**: RSA-2048 `RSASSA-PKCS1-v1_5`/SHA-256 per actor (member,
  board, instance). This is what Mastodon, Lemmy and Misskey verify for
  draft-cavage signatures, and Workers WebCrypto has it built in. An
  Ed25519 key is added later for FEP-8b32 object integrity proofs. It is
  not needed for interop at P1–P4.
- **Generation**: a key pair is created lazily when the member opts in, or
  when staff enable the board (the instance key on first use), then
  exported as PKCS#8.
- **Storage**: D1 `ap_actor_keys.private_wrapped`. Each private key is
  encrypted with AES-256-GCM using a per-actor key derived with HKDF-SHA-256
  from the owner-held secret `AP_KEY_SECRET` (info =
  `"ap-key:" + kind + ":" + ref + ":" + key_id`), with a fresh 12-byte IV.
  This is the same pattern as `api/core/human-check.mjs:68`. A D1 dump
  alone never yields a usable key. `AP_KEY_SECRET` goes in via stdin only,
  is never printed or committed, and is added to `.dev.vars.example` as a
  placeholder name only. If the secret is missing, federation stays off and
  the routes answer 503. No fallback key exists.
- **Rotation**: `POST /api/admin/federation/rotate` (owner only) per actor
  or for all actors. It writes `key_id + 1`, marks the old key
  `retired_at`, sends `Update(Person|Group|Application)` to followers, and
  keeps verifying against the retired key for `AP_KEY_OVERLAP_SECONDS`
  (7 days). Rotating the secret itself means re-wrapping every key: an
  owner-run script, documented, never automatic.
- **Opt-out / delete**: the member's key rows are deleted after the final
  `Delete(Person)` deliveries leave the queue.

---

## 6. Libraries (FLOSS, licence + Workers check; npm registry, 2026-11-22)

| Package | Version / licence | Workers fit | Verdict |
|---|---|---|---|
| `@fedify/fedify` (+ `@fedify/vocab`, `@fedify/webfinger`) | 2.4.6, MIT (AGPL-compatible) | Has an adapter, `@fedify/cfworkers` 2.4.6 MIT, but it supplies a **KV** store and **Queues** message queue (KV is banned; Queues is a paid product). Brings about 20 runtime deps (jsonld, opentelemetry SDKs, temporal-polyfill, es-toolkit, pkijs …). It also owns its own request router. | **Not adopted.** We would have to write a D1 store and a cron queue for it anyway, and pull in a large dependency tree that clashes with "one per job, native first". Keep it as the **reference implementation** and use the `@fedify/cli` `lookup`/`inbox` tools for local interop testing only (dev tool, not shipped). |
| `activitypub-express` | 4.4.2, MIT | Express + MongoDB + `request`: does not run on Workers. | Rejected. |
| `@misskey-dev/node-http-message-signatures` | 1.1.3, MIT; deps `rfc4648`, `@lapo/asn1js`, `structured-headers` | Small. Supports draft-cavage + RFC 9421. Workers compatibility **not verified** (package name says node). | Fallback, only if the hand-written cavage code fails interop review. |
| `http-message-signatures` | 1.1.1, ISC | RFC 9421; small (`structured-headers`). | Fallback for RFC 9421 verification in P2 if needed. |

**Recommendation (Q2):** our own code in `api/activitypub/` (vanilla
imperative, like the rest of `api/`):
- JSON-LD as plain JSON with a fixed `@context` (`activitystreams` +
  `security/v1` + a small inline term map), never expanded. This matches
  what Mastodon expects in practice.
- draft-cavage signing and verifying with WebCrypto (about 80 lines).
- SSRF-safe fetch reused from `api/link-preview.mjs`.
- `secure-json-parse` (already a dependency) for inbound bodies.

No new runtime dependency. Every signature test vector comes from Mastodon's
published examples. Each claim in the review must cite a source URL and
date (parity-claim rule).

New files: `api/activitypub/{actors,webfinger,nodeinfo,outbox,objects,
signatures,keys,inbox,delivery,remote,shadow,policies,render}.mjs` (each
under 400 lines). `worker.mjs` routing gets a `/ap/` prefix dispatch plus a
new `scheduled()` export. `wrangler.toml` gets `[triggers] crons =
["* * * * *"]` and `AP_ENABLED = "off"`.

---

## 7. Routes, strings, tests, risks, effort

### Routes

| Phase | Method + path | Auth |
|---|---|---|
| P1 | GET `/.well-known/webfinger`, `/.well-known/nodeinfo`, `/nodeinfo/2.1` | public, `ap-read` limit |
| P1 | GET `/ap/actor`, `/ap/users/:id`, `/ap/boards/:slug`, `…/outbox`, `…/followers`, `…/following`, `/ap/posts/:id` | public, gated per §2 |
| P1 | content negotiation on `/posts/:id`, `/u/:name`, `/c/:slug` | public |
| P1 | GET/PUT `/api/me/federation` | member (own row) |
| P1 | GET/PUT `/api/admin/federation/boards` | staff |
| P2 | POST `/ap/inbox`, `/ap/users/:id/inbox`, `/ap/boards/:slug/inbox` | HTTP Signature, `ap-inbox` limit |
| P2 | GET `/api/me/federation/followers`, POST `…/followers/:rid/{accept,reject,remove}` | member |
| P2 | GET/PUT/DELETE `/api/admin/federation/servers` | staff |
| P2 | POST `/api/admin/federation/rotate` | owner |
| P2 | `scheduled()` cron: deliveries, `ap_inbox_seen` sweep, actor cache refresh | — |
| P3 | (inbox `Create/Update/Delete(Note)`); staged queue reuses `/api/admin/hidden` | staff |
| P3 | POST `/api/admin/reports/:id/flag-remote` | staff |
| P4 | (inbox `Like/Dislike/Announce/Undo`) | — |

MCP: no new tools in P1–P4 (the bot does not federate). `api/mcp.mjs` read
tools must hide shadow-member rows exactly as the web feed does. The test
pins this.

### Strings (`t()` keys; en.json + all 64 other locales, real translations, key + placeholder parity)

P1 (14): `fediverse.settingsTitle`, `fediverse.optInLabel`,
`fediverse.optInHelp` (what leaves the site, §2.3), `fediverse.shareBio`,
`fediverse.handleLine` ("Your fediverse handle: {handle}"),
`fediverse.optOutWarning` (copies may remain), `fediverse.optOutConfirm`,
`fediverse.disabledSite`, `admin.federationTitle`,
`admin.federationBoardToggle`, `admin.federationBoardHelp`,
`fediverse.spoilerSummary` ("Contains spoilers"),
`fediverse.spoilerLink` ("[spoiler — read on the forum]"),
`fediverse.moreRepliesLink` ("{count} more replies on the forum").
P2 (12): `fediverse.manualFollows`, `fediverse.followRequests`,
`fediverse.followAccept`, `fediverse.followReject`,
`fediverse.followRemove`, `fediverse.followersCount`,
`admin.federationServers`, `admin.federationPolicyBlock`,
`admin.federationPolicySilence`, `admin.federationPolicyTrusted`,
`admin.federationRotate`, `admin.federationUnreachable`.
P3 (6): `fediverse.remoteBadge` ("From the fediverse"),
`fediverse.remoteAuthor` ("{handle}"), `fediverse.stagedNotice`,
`admin.flagRemote`, `admin.flagRemoteHelp`, `fediverse.remoteBlocked`.
P4 (3): `fediverse.boostCount` ("Boosted {count} times on the fediverse"),
`fediverse.shareLikes`, `fediverse.shareLikesHelp`.
Server-rendered strings that leave the site (summary, spoiler link,
more-replies) use the **site default locale**.

### Tests (RED first, one file per phase)

**P1 `tests/ap-p1-outbound.test.mjs`**
1. WebFinger 404 (same body) for non-opted, banned, unknown and shadow members, and non-federated boards. 200 + `self` link for an opted-in member.
2. Actor JSON shape: `@context`, `id` uses the numeric id, `publicKey.owner === id`, no email/joined/lastSeen keys. Bio is absent unless `share_bio`.
3. `/ap/posts/:id` 404 for hidden, staged, banned author, non-opted author, non-federated board, and a reply whose ancestor is hidden. 200 `Page`/`Note` otherwise. Mutation-check each clause.
4. Spoiler masking: the spoiler text never appears in the outbound body; `summary` and `sensitive` are set.
5. Outbox paging never lists a post that test 3 would 404 (same predicate, shared helper).
6. Content negotiation: `Accept: application/activity+json` → 302 `/ap/…`; HTML is unchanged otherwise. The HTML has the `rel=alternate` link only when federated.
7. The followers collection exposes `totalItems` only.
8. Key wrap round-trip; a missing `AP_KEY_SECRET` → 503 and no key written. The private PEM never appears in any response or log line.
9. Signing vector: our cavage signature over a fixed request equals the published Mastodon vector.
10. Opt-in default: a new member has no `ap_member_settings` row → treated as off. Board default off.
11. The human-check bypass list equals exactly the AP prefixes.
12. Wipe list includes `ap_member_settings` and `ap_actor_keys`.

**P2 `tests/ap-p2-follow-deliver.test.mjs`**
1. Inbox 401 for: no signature, bad digest, skewed Date, keyId host ≠ actor host, blocked server. 413 over `AP_INBOX_MAX_BYTES`.
2. Follow of an opted-in member with `manual_follows=1` → pending, no Accept queued. After the member accepts → Accept queued.
3. Follow of a non-opted member or non-federated board → `Reject` or 404, no row.
4. A post create queues exactly one row per distinct shared inbox; enqueue happens in the same batch as the post insert.
5. The cron claims ≤ `AP_DELIVERY_BATCH`, with backoff math, drop after max attempts, and `claimed_until` preventing double sends.
6. Edit → `Update`; delete, hide, ban or opt-out → `Delete` to every follower inbox; `/ap/posts/:id` → 410.
7. Replayed activity id → 202, no side effects.
8. Bind budget: enqueue chunking at max recipients stays under 100.
9. A member block of a remote actor → Reject + follower removal; no later deliveries to it.

**P3 `tests/ap-p3-remote-replies.test.mjs`**
1. Remote `Create(Note)` → staged reply by a shadow member; a trusted server → public; a silenced server → staged.
2. A shadow member cannot log in, appears in no leaderboard, presence, search-users, newest-members or member counts, and shows in no MCP read tool unless the reply is public.
3. CW → spoiler wrap; HTML is stripped; length capped; word filter runs.
4. `Update`/`Delete(Note)` only from the owning actor; a forged actor → 401/403.
5. Reply to a locked thread, hidden post or non-federated board → rejected.
6. Per-host new-actor daily cap.
7. Flag-remote sends no reporter identity; it is off unless ticked.
8. Visibility: a local member who blocked the shadow member never sees its reply (mutation-check).

**P4 `tests/ap-p4-likes-boosts.test.mjs`**
1. Like/Undo(Like) → reaction add/remove; Dislike → dislike.
2. Reactions from banned shadow members or blocked servers are not counted (same predicate as the wave-40 reactor fix).
3. An Announce increments the boost count; a duplicate activity id is a no-op.
4. Local likes are never sent unless `share_likes=1`.

Every phase also re-runs `tests/i18n.test.mjs` (65-locale parity),
`tests/license-headers.test.mjs` (the 19-line header on every new `.mjs`)
and `reuse lint`.

### Risks

- **Anubis / human-check** in front of `/ap/*` would silently break all
  federation. The bypass is required, and it is test-pinned to exact
  prefixes.
- **Subrequest ceiling**: 50 per run on the free plan (Q10). A busy thread
  with many follower servers drains over several cron minutes. That is
  acceptable, but delivery lag must be documented.
- **D1 write growth**: deliveries and the replay table need retention
  sweeps (cron, `VITALS_RETENTION_DELETE_LIMIT`-style capped deletes).
- **Losing `AP_KEY_SECRET`** means every actor must be re-keyed, and some
  remote servers cache old keys for days. The owner must back the secret up
  offline.
- **Copies elsewhere can't be recalled**: `Delete` is a request, not a
  guarantee. The settings copy must say so plainly (Q6).
- **Harassment inflow** through replies and mentions: staged-by-default,
  per-host caps, server blocks and member blocks are the mitigations. Staff
  review load rises with every federated board.
- **Interop drift** (Mastodon RFC 9421 move, Lemmy Group semantics): the P2
  review checks against current Mastodon and Lemmy docs, with source URL and
  date.
- **Caching**: content-negotiated responses must send `Vary: Accept` so the
  HTML cache never serves JSON or the reverse.
- **Account and username identity**: actor ids use numeric user ids, so a
  rename sends `Update(Person)` instead of breaking follows. A test pins
  this.

### Effort (one lead seat, RED-first, at the recent wave pace)

| Phase | Size | Estimate | Notes |
|---|---|---|---|
| P1 | M | 1 wave (~1.2k lines + ~40 tests) | Read-only. Lowest risk; ships discoverability. MINOR bump. |
| P2 | L | 2 waves | Signatures, inbox, cron queue, admin servers page. Needs Q2–Q4, Q10 answered and `AP_KEY_SECRET` set by the owner. |
| P3 | L | 2 waves | Shadow members touch many read paths. Needs a visibility re-audit like wave 40 for shadow rows. |
| P4 | S–M | 0.5–1 wave | Reuses reactions; mostly mapping plus tests. |

## Laws

- CREATE-only migrations 0088–0091, applied under the NAME-PRESENCE ritual.
- No KV, no Queues, no new Durable Object. The Anubis DO stays the only
  exception.
- New caps live in root `constants.mjs` only: `AP_INBOX_MAX_BYTES`,
  `AP_ACTOR_MAX_BYTES`, `AP_ACTIVITY_MAX_BYTES`, `AP_REMOTE_TEXT_MAX_CHARS`,
  `AP_MAX_RECIPIENTS`, `AP_MAX_JSON_DEPTH`, `AP_SIGNATURE_MAX_SKEW_SECONDS`,
  `AP_ACTOR_CACHE_SECONDS`, `AP_DELIVERY_BATCH`,
  `AP_DELIVERY_BACKOFF_SECONDS`, `AP_DELIVERY_MAX_ATTEMPTS`,
  `AP_KEY_OVERLAP_SECONDS`, `AP_NEW_REMOTE_ACTORS_PER_HOST_DAY`,
  `AP_INBOX_SEEN_RETENTION_DAYS`.
- Every outbound and stored opt-in is off by default. Network actions are
  explicit. No wording-ban terms in strings or docs.
- `AP_KEY_SECRET` is owner-held, entered via stdin, and never printed or
  committed. `api/vendor/*.mjs` is untouched. AGPLv3 headers on every new
  file.
- Each phase: suite green bound to the SHA in an isolated worktree, the
  ship-review verdict, then `pnpm run deploy` only.
