# Feature slate 2026-11-22-translate (an in-forum translation service, P1–P3). DRAFT

Owner, 2026-11-22 23:34: "what if WE BUILD OUR OWN TRANSLATION SERVICE FROM THE GROUND UP".

Why: Hosted Weblate's free plan needs 3 months of project history. Self-hosting Weblate is impossible on the owner's 8 GB laptop, whose disk is 90% full. Weblate can't run on Workers. The goal is a Weblate-class tool that is better *for this forum*, stays light, can be self-hosted, and is optional.

Law: module default OFF. FSF privacy posture: no tracking, no third parties, **no machine translation services**, limit data collection, network actions explicit. Free software only, and the wording is "free software", never "open source". AGPLv3. Migrations are CREATE-only and fresh-numbered. Every painted string goes through `t()` in all 66 tables. Visibility law. Section Q.

Baseline, read 2026-11-22 at `88cab59` (v5.85.1): `public/locales/en.json` has **1,356 keys** (flat, dotted); 34 are plural families (`.one`/`.other`) and no table has `.few` or `.many`; 209 keys carry `{placeholders}`; the longest English value is 353 characters; there are 66 tables (en plus 65).

`tests/i18n.test.mjs` pins: the exact en key set in every table, the same `{placeholder}` set per value, no empty value, at most 8% of values equal to English (`MAX_ENGLISH_SHARE`), and a `.other` for every `.one`.

Nothing builds until the **OWNER** questions in §12 are answered.

---

## 0. Decisions (recommended answers)

| # | Question | Recommendation |
|---|---|---|
| 1 | Identity | Module `translate`, default **OFF**. Pages `/translate` and `/translate/:locale`. API `/api/translate/*`. Members suggest. Staff review. The owner exports. Guests see progress only. |
| 2 | Source of truth | The static `public/locales/*.json`, read through the `ASSETS` binding. New en keys show up on the next deploy with no step. |
| 3 | Data | One CREATE-only migration `00XX_translate.sql` (the lead assigns the number; 0088–0094 are reserved). P1: `translate_suggestions`. P2: `translate_votes` and `translate_glossary`. Translation memory is **derived** from the static tables, not stored. |
| 4 | Validation | Server-side mirror of `tests/i18n.test.mjs`, plus length cap, word filter, text-only, rate limit, CSRF, Anubis and `assertNotBanned`. |
| 5 | Delivery | **(a) Export.** The owner runs a local read-only export script, the merged JSON is committed, CI gates it, `pnpm run deploy` ships it. P3 adds a staff-only, client-side *preview* (part of c). A public live overlay (b) is **rejected**. |
| 6 | Better than Weblate | Translation memory from 90k shipped strings, glossary, key context, placeholder chips, a plural helper on `Intl.PluralRules`, progress per locale, keyboard-first, reading works without JS, a11y, RTL. |
| 7 | Privacy | Store only member id, value, status and day-precision times. Credit is **opt-in**; the default is "a member". No IP, no UA. Account deletion cascades. Rejected rows are pruned after 90 days. |
| 8 | Strings | **45** `translate.*` keys × 66 tables = 2,970 entries (P1 40, P2 5). |
| 10 | Phasing | P1 suggest, review, export (MINOR). P2 votes, TM, glossary (MINOR). P3 staff preview (MINOR). |

---

## 1. Identity, routes, permissions

**Module.** `translate` is registered in `api/core/modules.mjs` with `defaultEnabled: false`.

**Dependency:** the module system is **not on main** (`api/core/modules.mjs` is absent at `88cab59`). It lands from its own slate first. If the lead must ship before then, the fallback is a single `TRANSLATE_ENABLED` var that is off when unset, swapped for the module check when modules land. The lead decides.

With the module off:
- every `/api/translate/*` route answers like an unknown route: 404 JSON `not_found`;
- `/translate` falls to the normal not-found view;
- no nav link, settings row or desk tab renders;
- no `translate.js` is imported.

**Routes:**

| Route | Who | Note |
|---|---|---|
| `GET /translate`, `/translate/:locale` | anyone | SPA views. The progress list renders from data the shell already loads (§6, no JS needed for reading). |
| `GET /api/translate/progress` | anyone | Done/total per locale, computed from the static tables. Cached per isolate under the `COMMIT_SHA` stamp. |
| `GET /api/translate/:locale/keys?filter=&q=&cursor=` | anyone | Keys, English source, the current value and context. Signed-in members also get **counts** of pending suggestions. |
| `GET /api/translate/:locale/:key/suggestions` | signed-in | Pending suggestions for one key. Visibility law: rows by banned or blocked authors are hidden from non-staff. |
| `POST /api/translate/:locale/:key/suggestions` | member, not banned | Create a suggestion. |
| `DELETE /api/translate/suggestions/:id` | the author | Withdraw. This is a hard delete of the author's own pending row. |
| `POST /api/translate/suggestions/:id/review` | staff (`requireStaff`) | `{action: "approve"|"reject", note?}` |
| `GET /api/translate/review?locale=&cursor=` | staff | The queue. |
| `POST /api/translate/suggestions/:id/vote` and `DELETE` (P2) | member, not the author | One vote per member. |
| `GET/POST/DELETE /api/translate/glossary` (P2) | GET anyone; writes staff | |

**Permissions.** No new role or permission is needed. The existing helpers cover each action:
- **Suggest:** any signed-in member who is not banned (`requireUser` + `assertNotBanned`).
- **Review:** staff, admin or owner (`requireStaff`). Staff already curate every visible surface. A per-member "translator" grant is deferred until the queue outgrows staff (**OWNER Q3**).
- **Export:** owner only. It happens off-worker (§5), so there is no export route to guard.
- **Guests:** read-only progress and sources. Guests never see suggestion text. It is member content, and keeping it behind sign-in limits scraping.

---

## 2. Source of truth: the static tables

- The worker reads `/locales/en.json` and `/locales/<code>.json` through `env.ASSETS.fetch`, the same binding `worker.mjs:300` uses. The parsed tables are memoised per isolate and keyed by `COMMIT_SHA`, so a deploy clears them. Locale codes are validated against `LOCALES` from `public/js/i18n.js` before any fetch.
- **New keys appear automatically.** A key that gets added to en.json (and copied into all tables, as the i18n test demands) is in the next deploy's assets and shows on `/translate` with no import step.
- **Changed sources.** Each suggestion stores `source_hash`, the SHA-256 of the English value when the suggestion was made. If en changes, the hash no longer matches. The row then shows "source changed" and **cannot be approved**; the author or staff must resubmit.
- **Removed keys.** Their rows are hidden and skipped on export, then pruned (§7).
- **"Missing" means** the value equals English, the "copy of English" heuristic. The value cannot be absent, because the test requires every key in every table. Keys allow-listed as legitimately identical (brand names, "GIF") come from `TRANSLATE_SAME_AS_EN_OK`, a frozen list in `constants.mjs`.

---

## 3. Data model (`migrations/00XX_translate.sql`, CREATE-only)

```sql
CREATE TABLE IF NOT EXISTS translate_suggestions (
  id INTEGER PRIMARY KEY,
  locale TEXT NOT NULL CHECK (length(locale) BETWEEN 2 AND 12),
  msg_key TEXT NOT NULL CHECK (length(msg_key) BETWEEN 3 AND 120),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 1000),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credit INTEGER NOT NULL DEFAULT 0 CHECK (credit IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT CHECK (review_note IS NULL OR length(review_note) <= 200),
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_day INTEGER NOT NULL,          -- UTC day number, not a timestamp
  reviewed_day INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tsugg_queue ON translate_suggestions (locale, status, id);
CREATE INDEX IF NOT EXISTS idx_tsugg_key ON translate_suggestions (locale, msg_key, status);
CREATE INDEX IF NOT EXISTS idx_tsugg_user ON translate_suggestions (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tsugg_pending
  ON translate_suggestions (locale, msg_key, user_id) WHERE status = 'pending';

-- P2 (same migration, so one ritual; tables stay empty until P2 ships)
CREATE TABLE IF NOT EXISTS translate_votes (
  suggestion_id INTEGER NOT NULL REFERENCES translate_suggestions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (suggestion_id, user_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS translate_glossary (
  id INTEGER PRIMARY KEY,
  locale TEXT NOT NULL,
  term TEXT NOT NULL CHECK (length(term) BETWEEN 1 AND 60),
  translation TEXT NOT NULL CHECK (length(translation) BETWEEN 1 AND 120),
  note TEXT CHECK (note IS NULL OR length(note) <= 200),
  UNIQUE (locale, term)
);
```

- **No `reviews` table.** A review is a status change on the suggestion row, with `reviewer_id` and `reviewed_day`. Approving one suggestion moves any *other* pending rows for the same `(locale, msg_key)` to `rejected` with the note "superseded", in one `batch()`.
- **No translation-memory table.** TM comes from the static tables at request time (§6).
- The FKs follow the D1 FK-enforce law: a fresh CREATE, no rename-rebuild. Deleting a user cascades suggestions and votes and sets `reviewer_id` to NULL.
- **Bind budget** (`D1_MAX_BOUND_PARAMS = 100`):
  - The keys page is `TRANSLATE_PAGE_SIZE = 50`. Its pending counts come from one query, `WHERE locale = ? AND status = 'pending' AND msg_key IN (SELECT value FROM json_each(?)) GROUP BY msg_key`. That is **2 binds** at any page size.
  - The queue page is `locale = ? AND status = 'pending' AND id > ? ORDER BY id LIMIT ?`, **3 binds**, with banned/blocked filtering through `ACTIVE_BAN_SQL` and the blocks helper (≤ 4 more).
  - A test pins every statement at ≤ 10 binds.
- **Caps:**
  - `TRANSLATE_PENDING_PER_MEMBER_MAX = 200` (checked inside the INSERT);
  - `TRANSLATE_PENDING_PER_KEY_MAX = 10` (the rows a reviewer has to read);
  - `TRANSLATE_GLOSSARY_PER_LOCALE_MAX = 500`.

---

## 4. Validation laws (server, `api/translate-validate.mjs`; pure functions, shared with the client for instant feedback)

The server re-runs every check. The client copy is only a convenience.

1. **Known locale and key.** `locale` is in `LOCALES` and is not `en`. `msg_key` exists in the current en table. `source_hash` is equal to the current hash, else 409 `translate_stale`.
2. **Placeholders.** The sorted `{name}` set (regex `/\{(\w+)\}/g`, the same as the test) equals English's, else 422 `translate_placeholders`. No unbalanced `{` or `}`.
3. **Plural families.**
   - A `.one` or `.other` suggestion is accepted only for a key en has.
   - `.few` and `.many` are **refused**: the test requires the exact en key set and en has neither.
   - The plural helper (§6) previews which numbers hit which form.
4. **Length.** `TRANSLATE_VALUE_MAX_CHARS(en) = min(1000, max(3 × en.length, en.length + 60))` graphemes, else 422 `translate_too_long`. 1000 is the hard cap and matches the table CHECK. It sits well above the 353-character longest source.
5. **No copy of English.** A value equal to English (trimmed, case-folded) is refused unless the key is in `TRANSLATE_SAME_AS_EN_OK` (422 `translate_copy`). This guards the 8% `MAX_ENGLISH_SHARE` gate before CI has to.
6. **Text only.**
   - Values are painted with `textContent`, and the stored value is refused if it contains `<…>` tags, `&…;` entities, any control character, newlines included (no en value has one), bidi override characters U+202A–U+202E and U+2066–U+2069, or a leading or trailing space that English lacks (422 `translate_markup`).
   - Markup is refused, **not** silently stripped, so the translator sees why.
7. **Word filter.** `filterWords(env)` from `api/filterstore.mjs`, the same as tags and automod. A hit refuses with 422 `translate_filtered`; it is never rewritten.
8. **Gates on every write:**
   - `requireUser` plus `requireCsrf` (which checks same-origin);
   - `assertNotBanned(env, userId)`;
   - the `anubisApiGate` path that already covers `/api/*` writes;
   - `rateLimit(request, env, "translate")`, a new `RATE_LIMIT_BINDINGS` key → `WRITE_RATE_LIMITER`;
   - plus the per-member pending cap.
   - Reviews also pass through `requireStaff`.
9. **Duplicates.** The same value as an existing pending row for that key becomes a vote in P2, and in P1 a 409 `translate_duplicate` with no new row.

Every error code is mapped in `api/core/error-codes.mjs`, and each has a `translate.error.*` key.

---

## 5. Delivery: compare and recommend

| | (a) Export, committed | (b) Live overlay on `/locales/xx.json` | (c) Hybrid |
|---|---|---|---|
| Path to prod | Git → CI (`tests/i18n.test.mjs`, `reuse lint`) → `pnpm run deploy` | D1 row → live on the next fetch | prod via (a); staff preview via overlay |
| Quality gates | All CI gates, every time | Only the §4 server checks; the 8% share and the full-table parity are never re-run | same as (a) |
| Hot path | Static assets bypass the worker and are Anubis-exempt (`anubis-gate.mjs:43`) | Every locale fetch hits the worker plus D1, and the static plain-404 rule (`worker.mjs:201`) has to change | unchanged for the public |
| Cache | Immutable per deploy (`?v=` stamp) | Needs `no-store` or purge-on-approve. The `?v=` buster no longer describes the content | unchanged |
| Rollback | `git revert`, redeploy | Edit D1 rows in prod, which is a prod write outside the ritual | `git revert` |
| Self-hosters | Plain files they own. Works with the module off | Their strings live only in their D1 | files |
| Speed | Next deploy (several a day here) | Instant | Instant for staff only |

**Recommendation: (a) for prod. In P3, add a staff-only *client-side* preview, a narrow version of (c).**

(b) would make D1 a second, ungated source of shipped text and would put the worker on the hot path of every page boot. That trades the forum's main strength, static, gated assets, for minutes of latency.

**How the export works (P1). It reads only and writes nothing to prod:**

- `scripts/translate-export.mjs` (no dependencies) runs `pnpx wrangler d1 execute <db> --remote --json --command "SELECT locale,msg_key,value,source_hash FROM translate_suggestions WHERE status='approved'"`.
  - Prod D1 *reads* are allowed. No session token or secret is involved.
- For each locale, it:
  - drops rows whose `source_hash` no longer matches local en;
  - overlays the rows onto `public/locales/<code>.json`, keeping **en key order**;
  - writes the files in their existing indent style (the script detects it);
  - runs `node --test tests/i18n.test.mjs`;
  - prints a per-locale diff count.
- The lead commits (`chore: translations from /translate (N strings, M locales)`), pushes, and runs `pnpm run deploy` last.
- **"Live" status is derived, not written.** An approved row whose value equals the shipped static value shows as **live**. So the export never needs a prod write to mark rows done.
- Self-hosters use the same script against their own database name (§11).

**P3 preview.** For staff with `?translate-preview=1`, `i18n.js` merges `GET /api/translate/:locale/approved` (staff-only, `no-store`) over the loaded table *in that browser only*. Public assets are never changed.

---

## 6. "Better than Weblate", and still light

No new runtime dependency. A vanilla `public/js/routes/translate.js` stays under 400 lines, with `translate-validate.mjs` (shared) and `api/translate.mjs` on the server.

1. **Translation memory from what ships.**
   - 66 tables × 1,356 keys ≈ 90k vetted strings.
   - For the key being translated, TM shows other keys in the *same locale* whose **English** value is identical or near (token Jaccard ≥ 0.6), each with its shipped translation. For example, "Cancel" was already translated 40 times.
   - It is computed on demand from the memoised tables, top 5, with nothing stored.
   - It also shows the **same key in sibling locales** (pt for es, sr-Latn for sr, zh-Hant for zh-Hans) as reference.
2. **Glossary (P2).**
   - Staff set per-locale terms ("post", "thread", "owner", "free software").
   - A glossary term found in the English source is underlined, with its required rendering beside it.
   - If the suggestion lacks the term, a *warning* shows. It does not block.
3. **Context without screenshots.**
   - The key path itself (`settings.vitalsNote`).
   - A **"used in"** list: the client files and lines that call `t("<key>")`/`tn(...)`. A build-free script `scripts/translate-context.mjs` emits `public/locales/_context.json` from the same regex the i18n test uses. It is committed and pinned fresh by a test (**OWNER Q5**: one file is ~60 KB).
   - Optional one-line `en` notes in a sibling `public/locales/_notes.json`, edited by PR.
   - The `_` prefix keeps both files out of the `LOCALES` disk-parity test, which needs a one-line filter change (note it in the PR).
4. **Placeholder highlighting.**
   - `{name}` tokens render as chips in the source.
   - In the editor, missing or extra placeholders are listed live.
   - A chip can be clicked to insert the placeholder.
5. **Plural helper.**
   - For `.one`/`.other` families it shows `new Intl.PluralRules(locale).select(n)` for n = 0, 1, 2, 5, 11, 21, 101.
   - Each n shows which stored form the live `tn()` will pick. `tn` only reads `.one`, plus `.other` as the fallback for `few`/`many`, so a translator sees, for example, that Polish 5 uses `.other`.
6. **Progress per locale.**
   - Done/total and percent, where done means a value not equal to English, or on the allow-list.
   - Also a pending count, plus a "needs review" filter (`filter=missing|suggested|mine|all`).
7. **Keyboard-first.**
   - `j`/`k` next and previous key, `Enter` edit, `Ctrl+Enter` submit, `Esc` cancel, `/` search, `a`/`r` approve and reject in the queue.
   - No single-key binding fires inside an input.
   - The `?` help string is listed.
8. **Reading works without JS.**
   - There is no build step, so no generated HTML table. Instead the `<noscript>` block links to the raw `/locales/<code>.json` files and to CONTRIBUTING's PR flow.
   - A no-JS visitor can still read every string.
9. **a11y.**
   - The list is a `<table>` with headers; the editor is a labelled `<textarea>`.
   - Errors live in an `aria-live="polite"` region; focus returns to the row after submit; contrast tokens come from the theme.
10. **RTL.**
    - The editor sets `dir` and `lang` from the *target* locale (`localeDir(code)`); the English source keeps `dir="ltr"`.
    - The page chrome follows the viewer's own locale.
11. **Honest scope.** There is no machine translation, no "suggest with AI", and no third-party fetch. The page states this.

---

## 7. Privacy

- **Stored per suggestion:** member id, locale, key, value, source hash, a credit flag, status, and **day-precision** dates. No IP, UA, session id, request id or timestamp finer than the day. Logs print error *names* only.
- **Attribution is opt-in.**
  - `credit = 0` by default, and the author shows as "a member", even to other members.
  - With `credit = 1`, the username shows beside the suggestion.
  - Staff always see the author, because they need it for moderation.
  - The export script **never** writes names into locale files. Credits, if any, go in CHANGELOG by owner choice (**OWNER Q4**).
- **Retention:**
  - Rejected rows are pruned after `TRANSLATE_REJECTED_RETENTION_DAYS = 90`, by prune-on-write in the review handler (bounded delete, as in vitals).
  - Approved rows are kept while their `source_hash` matches the en value; stale or removed-key rows are pruned after 90 days.
- **Account deletion:** an FK `CASCADE` removes the member's suggestions and votes. Reviewed rows lose the reviewer through `SET NULL`.
  - Already-shipped strings stay in git. They are free-software contributions under the project licence, and the suggest form says this before the first submit (`translate.privacyNote`).
- **Data export:** a member's own suggestions join `EXPORT_SECTION_CAPS` (`translateSuggestions: TRANSLATE_PENDING_PER_MEMBER_MAX`) in the existing account export.
- **Votes (P2)** are counts only. Who voted is never returned, not even to staff.

---

## 8. Strings (`translate.*`; en.json plus all 65 other tables, really translated, with key and placeholder parity)

**P1, 40 keys:**
- **Navigation and page:** `nav`, `title`, `intro`, `pickLocale`, `progress` (`{done}`, `{total}`, `{percent}`).
- **Filters and search:** `filter.all`, `filter.missing`, `filter.suggested`, `filter.mine`, `search`.
- **Key panel:** `source`, `current`, `context`, `placeholders`, `pluralHelper`.
- **Suggest flow:** `suggestionLabel`, `submit`, `submitted`, `suggestions.one`/`.other` (`{count}`), `withdraw`.
- **Review:** `review.queue`, `review.approve`, `review.reject`, `review.note`.
- **Export:** `export`, `exportNote`.
- **Credit, sign-in and help:** `credit`, `anonymous`, `signInToHelp`, `empty`, `keyboardHelp`, `privacyNote`.
- **Errors:** `error.placeholders`, `error.plural`, `error.tooLong` (`{max}`), `error.copyOfEnglish`, `error.markup`, `error.filtered`, `error.stale`.

**P2, 5 keys:** `votes.one`/`.other` (`{count}`), `voteUp`, `tm`, `glossary`.

**Total: 45 keys × 66 tables = 2,970 entries.** Translations go through the normal wave (translator seats, the parity test). They are not left as English, because English-valued entries count against the 8% share.

---

## 9. Tests (RED first; `tests/translate-p1.test.mjs`, `-p2`, `-p3`)

P1:
1. **Module off:**
   - every `/api/translate/*` route → 404 `not_found`;
   - `/translate` renders not-found;
   - no nav link;
   - `translate.js` is not imported by `router.js` until the module is on (static scan).
2. **Validation, one test each:**
   - placeholder set mismatch, extra placeholder and unbalanced brace → 422;
   - a `.few` key → 422;
   - over `TRANSLATE_VALUE_MAX_CHARS` → 422;
   - copy of English → 422, with an allow-listed key accepted;
   - `<b>`, an entity, a newline or a bidi override → 422;
   - a word-filter hit → 422;
   - a stale `source_hash` → 409;
   - an unknown locale, `en`, or an unknown key → 404.
3. **Auth gates:**
   - guest POST → 401;
   - a banned member → 403 (`assertNotBanned`);
   - a missing or cross-origin CSRF → 403;
   - review by a member → 403;
   - review by an admin → 200.
4. **Rate limit:** the `"translate"` key is mapped in `RATE_LIMIT_BINDINGS`, and a denied limiter → 429.
5. **Caps:** the 201st pending row for a member → 409; the 11th pending row for a key → 409; a duplicate value → 409.
6. **Visibility:**
   - suggestions by an actively banned author or across a block are hidden from members and shown to staff;
   - guests get counts only, never text;
   - a `credit = 0` author's username is absent from the member JSON.
7. **Bind budget:** every SQL string in `api/translate.mjs` binds ≤ 10, and the keys page at size 50 binds 2 (the fake-D1 harness counts the binds).
8. **Approve supersedes:** approving one row rejects the other pending rows for that key in the same batch.
9. **Export:**
   - `scripts/translate-export.mjs` given fixture rows outputs tables that pass the same parity, placeholder and 8%-share functions (import them, or run `tests/i18n.test.mjs` on a temp dir);
   - en key order is preserved;
   - stale rows are dropped;
   - no username appears in the output.
10. **Privacy:**
    - the migration has no `ip`, `ua` or `*_at` timestamp columns (schema scan);
    - deleting a user cascades the rows;
    - rejected rows older than 90 days are pruned on the next review.
11. **Strings:** all 40 P1 keys are in all 66 tables (the existing i18n test covers this); `translate.*` keys are a contiguous block.
12. **License headers:** the new `.js`/`.mjs` files carry the 19-line notice.

P2: votes are unique per member, an author can't vote on their own row, the response holds counts only, TM ranking on fixtures, the glossary cap at 500 and its staff-only writes.

P3: the preview route is staff-only and `no-store`; the public `/locales/*` bytes are unchanged with the module on (pinned by hash in a test).

---

## 10. Phasing and version impact (SemVer per CONTRIBUTING)

| Phase | Scope | Version |
|---|---|---|
| **P1** | Migration (all three tables), `api/translate.mjs`, `translate-validate.mjs`, the `/translate` views, the review queue in the desk, `scripts/translate-export.mjs`, the context script, 40 strings, docs | MINOR |
| **P2** | Votes (sorted by votes in the queue), translation memory, glossary, 5 strings | MINOR |
| **P3** | Staff-only client preview | MINOR |

- Each phase is one lead seat, RED first.
- The migration runs once under the full NAME-PRESENCE ritual, before P1 deploys.
- P2 and P3 add no migration.

---

## 11. Self-hosting, and replacing the Weblate plan

**Add a `docs/self-hosting.md` section, "13. Translations page (optional)":**
1. It ships off. Turn on the `translate` module (or the interim `TRANSLATE_ENABLED` var).
2. The migration is already in `migrations/`; step 4 applies it.
3. To ship approved strings, run `node scripts/translate-export.mjs --db <your-db-name>`, review the diff, commit, and deploy.
4. It needs no extra binding, secret, third-party account or container. It uses only D1 and `ASSETS`.

**`docs/translating.md` does not exist at `88cab59`, and no file in the repo mentions Weblate.** The Weblate plan was never committed. P1 creates `docs/translating.md`, covering:
- **Two ways to help.** (1) On the forum at `/translate`: sign in, suggest, staff review. (2) **Pull requests are still welcome**: edit `public/locales/<code>.json` directly, following CONTRIBUTING's Translations section (which gets a one-line link to the new doc).
- How review and export work, and the privacy and credit rules (§7).
- "No machine translation, no third parties."

---

## 12. OWNER questions (nothing builds until answered)

| Q | Ask | Recommendation |
|---|---|---|
| Q1 | Delivery: export (a), live overlay (b) or hybrid (c)? | (a), plus the P3 staff preview |
| Q2 | Guests: progress only, or also read suggestion text? | Progress only |
| Q3 | Reviewers: staff only, or a per-member "translator" grant later? | Staff now; revisit when the queue exceeds about 50 pending |
| Q4 | Credit: opt-in name on the suggestion only, or also a CHANGELOG line per release? | Opt-in on-site only; CHANGELOG counts without names |
| Q5 | Ship `_context.json` (~60 KB, generated, committed) for the "used in" panel? | Yes, in P1 |
| Q6 | Ship P1 before the module system lands, behind the interim var? | No: wait for modules (one gate, not two) |

## Laws (every lane)

pnpm/pnpx only; `pnpm run deploy` last; never touch `api/vendor/*.mjs`; AGPLv3 headers; CREATE-only migration under NAME-PRESENCE; no prod D1 writes outside the ritual (the export **reads** only); no secrets printed; free-software browsers only for visual checks; "free software" wording; no machine translation and no third-party calls; Section Q in every brief.
