# Feature slate 2026-11-22-ab-testing (feature flags, private A/B experiments, beta channel). DRAFT

Owner asks, in order:
- "we should do a/b tests".
- 22:17: "as in like for example bob gets emoji picker while its invisible to tom". That makes **feature-flag experiments** the core of this slate.
- 22:20: "people can opt into beta testers which they get features before it hits production AND they get redirected to beta.wempos-forum.com while still being able to interact with the forum".
- 22:20: "owner is always beta tester".

Law: "private and anonymous" tracking is fine and "big brother" tracking is banned. No non-essential cookies. No user, IP or UA identifier in any stored row. Network actions are explicit. GPC/DNT are honoured. Defaults law: activity-revealing features are OPT-IN. FSF wording posture. AGPLv3. Migrations are CREATE-only and fresh-numbered. Every painted string goes through `t()` in all 66 locales.

Pattern source: this design reuses the web-vitals pipeline. It reads `migrations/0079_web_vitals.sql`, `api/vitals.mjs` (always-204 beacon, same-origin check, `rateLimit(…, "vitals")`, whole-or-nothing validation, daily upsert, pruning on write and on read) and `public/js/vitals.js` (`vitalsAllowed(nav)` GPC/DNT gate, `sendBeacon` falling back to `fetch` with `credentials: "omit"`). It also reuses the private analytics in `api/analytics.mjs` (`utcDay()`, DNT/GPC and bot skips, 90-day retention).

Nothing gets built until the owner answers the questions marked **OWNER**, which are collected in §12.

---

## 0. Real traffic: what an experiment can detect here

The figures below come from read-only aggregate SELECTs on remote `wempo-forum-data`, run 2026-11-23 ~03:20 UTC:

| Signal | Value | Note |
|---|---|---|
| Page-view counter (`page_view_counts`) | 278 shell loads on 2026-11-22, 39 so far on 11-23 | Counting began 11-22, so this is **1 full day** of data. 90% of loads are `home`. Only full page loads count; SPA route changes don't. |
| Posts created, last 28 days | 227 (**≈8.1/day**) | `posts.created_at` is in seconds. |
| New accounts, last 28 days | 17 (**≈0.6/day**) | |
| Members total | 134 | |
| Web-vitals samples since the start (11-22) | 15 (LCP 3, INP 1, CLS 2, FCP 4, TTFB 5) | **≈7 beacons/day.** The rate is still unproven: one day of data, and GPC/DNT users plus idle-loading reduce it. |

Sample sizes use a fixed horizon, a two-proportion z-test, two-sided α = 0.05 and power 0.80, so (z₀.₉₇₅ + z₀.₈)² = 7.84 and n per arm = 7.84·(p₁q₁ + p₂q₂)/(p₂ − p₁)².

- **Effects of +20 percentage points or more on a member action** (about 80 units per arm) take **about 4 weeks** at today's volume. **+10 pp effects need about 4 months**, which is not practical.
- **Signup-conversion tests are not feasible.** At 0.6 signups/day, even a large lift needs more than a year. The Altcha signup-friction test is **rejected** (see §9).
- **Perf tests through web-vitals are feasible only if the vitals rate rises.** At about 7/day, LCP-good 75%→85% (247 per arm) takes about 70 days. At 70/day it takes about 7 days. So the A/A test E0 (§9) runs first, to measure the real rate before anything is promised.

The desk has to state all of this honestly (§6).

---

## 1. Model: flags and experiments are one thing

A **feature** is a code module that can be switched off, such as `emoji-picker`. The features exist in code. Their run state lives in D1.

- **The feature registry is in code** (root `constants.mjs`, `EXPERIMENT_FEATURES`, frozen). Each entry holds:
  - the key and its variants (`["off","on"]`);
  - the audience (`members` | `everyone`);
  - the allowed `events`;
  - the `primary` metric (numerator event / denominator event), the guardrail events and `perf: true|false`;
  - `serverRoutes` (the API routes the server must gate, §4);
  - `defaultWhenUnset` (what everyone gets when no run row exists; for an existing feature like the emoji picker this is `on`).

  Code that tests a flag must name a key that is in the registry. A test pins that every `isEnabled("x")` call site uses a registered key.
- **The run state is staff-set in D1** (`experiments` table, §7):
  - `stage`: `off` | `beta` | `experiment` | `shipped`;
  - `rollout_pct` (0–100);
  - variant weights;
  - `force` (kill switch: `on` | `off` | null);
  - a per-experiment random `salt`;
  - the pre-registered `target_n` and `mde_pp`;
  - `analysis_start_day`, plus start and end dates.

  Staff start, ramp and stop experiments without a deploy.
- **Recommendation: hybrid** (code registry plus D1 state). A flag with no code behind it means nothing, so pure-D1 definitions add nothing. Pure-code state would need a deploy to ramp or kill. **OWNER Q1.**

How the stages resolve, in order:
1. `force` set: everyone gets the forced value, and nothing is counted.
2. `stage=off`: everyone gets `defaultWhenUnset`.
3. `stage=beta`: beta testers and the owner get `on`; everyone else gets the default.
4. `stage=experiment`: bucketed (§2).
5. `stage=shipped`: everyone gets `on`, and the code is due for flag removal.

At most `EXPERIMENT_MAX_RUNNING = 3` experiments can be at `stage=experiment` at once. That keeps the session cost bounded and keeps tests from overlapping much.

---

## 2. Assignment

### 2a. Signed-in members: deterministic, nothing stored
- `u = first 32 bits of SHA-256(salt ‖ ":" ‖ experiment_id ‖ ":" ‖ user_id) / 2³²`, computed on the fly in the worker (`crypto.subtle.digest`). **No assignment table.** The result is stable across devices and browsers.
- **The ramp is monotone.** A member is *enrolled* when `u_in < rollout_pct/100`, where `u_in` uses the hash with suffix `":in"`. The variant comes from a second, independent hash (suffix `":v"`) mapped onto the weights. Raising 10→50→100 keeps everyone already enrolled, so nobody flips variant during a ramp.
- **Members who are not enrolled get `defaultWhenUnset` and are not counted.**
- **Salt or secret? (OWNER Q2.)** The recommendation is a per-experiment 32-byte salt from `crypto.getRandomValues`, stored in `experiments.salt` and never returned by any API, including staff APIs. This needs no new owner-held secret. Anyone with D1 read access (staff and owner only) could recompute buckets, but they can already see overrides. The alternative is HMAC-SHA-256 under a new `EXPERIMENTS_SECRET`, put in by the owner via stdin.
- **Tom can't learn Bob's variant.** Flags go only in Bob's own `GET /api/session` response (already `no-store`; this slate pins it). They are never in the public HTML shell, a profile, a post, a feed, an export of another member, logs or a modlog line visible to members. The server never logs the bucket: `console.*` in `api/experiments.mjs` prints error *names* only, like `api/vitals.mjs`.
- **Accepted leak:** the DOM differs, so Bob could screenshot his composer. No technical fix exists, and it is stated on the privacy page.

### 2b. Guests: random per browser, localStorage only
- `localStorage["forum-exp:g"] = { "<expId>": { "u": <0..1>, "s": "<salt-epoch>" } }`, with `u` drawn from `crypto.getRandomValues`. Enrolment and variant use the same thresholds as for members, from the **public** run config: stage, rollout, weights and an epoch. The epoch is not the salt. It is embedded in the shell, is the same for everyone and is not secret. Bumping it rerolls guests.
- **Wipe decision:** the guest key is a device preference with no account link, so `wipeAccountLocalData` does **not** clear it. "Reset experiment choices" in Settings › Privacy clears it. When storage is blocked, the guest gets `defaultWhenUnset` and is not counted.
- On sign-in the member hash takes over. A guest can change variant at that moment; this is a minor contamination, accepted and documented.

### 2c. Excluded from stats, always
These people get a deterministic experience and send **no** beacon, and the server-side counters skip them:
- **GPC or DNT:** `defaultWhenUnset`. Client side this is `vitalsAllowed(nav)`; server side it is the `Sec-GPC: 1` / `DNT: 1` request headers.
- **Beta testers (§10) and the owner:** always `on` for every `beta` or `experiment` stage feature, unless `force` says otherwise. **They are excluded because self-selected enthusiasts would bias the "on" arm upward.** The desk states this next to every result.
- **Staff per-member overrides** (§5): forced to the chosen variant.
- **Not enrolled** (outside `rollout_pct`).
- **Any experiment while `force` is set.**

---

## 3. Client API (`public/js/flags.js`, new, about 150 lines)

```js
// Resolved once at boot from data the app already fetches. No extra request.
export function initFlags({ session, publicConfig, storage, nav })  // returns a frozen flag map
export const flagsReady                                            // Promise, resolves after initFlags
export function isEnabled(key)                                     // boolean; before ready → defaultWhenUnset
export function variantOf(key)                                     // "on" | "off" | null (not enrolled/excluded)
export function trackExposure(key)                                 // once per browser-day per experiment
export function trackEvent(key, event)                             // registered events only; no-op when excluded
```

- **Members:** `session.flags = { "emoji-picker": { v: "on", counted: true } }`, added to the existing `GET /api/session` member response in `api/session.mjs` (lines 120–124). `counted` is false for beta testers, overrides and GPC/DNT, so the client sends no beacon for them.
- **Guests:** `publicConfig` comes from a `<script type="application/json" id="exp-config">` in the shell. It is CSP-safe because it is data, not script. Everything else is resolved in the browser.
- **Lazy modules skip loading entirely.** The composer checks `if (!isEnabled("emoji-picker")) return;` before it renders the picker button. Without the button, `emoji-picker.js` (`defaultLoadPicmo = () => import("./vendor/picmo.js")`, line 67) is never imported. Gated UI mounts after `flagsReady`, so it can't flash and then vanish.
- **Daily dedupe** (this is what makes the unit a *browser-day*):
  - members: `localStorage["forum-exp-sent:u<id>"]`, cleared by `wipeAccountLocalData` (`routes/account-nav.js:320`);
  - guests: `forum-exp-sent:g`;
  - shape: `{expId: {event: "YYYY-MM-DD"}}`;
  - blocked storage means nothing is sent.

---

## 4. Server enforcement (hiding is not just CSS)

- `api/experiments.mjs` exports `resolveFlag(env, request, user, key)` and `requireFlag(env, request, user, key)`. `requireFlag` answers like an unknown route (404 JSON `not_found`), so the control group can't tell the feature exists. One D1 read per request is cached on the request object.
- Every registry entry with `serverRoutes` must call `requireFlag` at the top of its handler. **A test walks the registry and asserts each listed route returns 404 for a control-bucket member and works for an `on` member.**
- Example of a gated route: had the GIF picker been the feature, `api/gifs.mjs` search would be gated.
- **The emoji picker is client-only.** Picmo and its emoji data are static assets that bypass the worker. A control member could fetch `/js/vendor/picmo.js` by hand, but it grants no server capability, so this is accepted and stated.
- Gated features must never change server-rendered public HTML. The shell and SEO output are identical for every bucket, which keeps the edge cache and crawlers out of it. A test pins this.

---

## 5. Measurement: aggregate counters only

**Counter row:** `(day, experiment_id, variant, event) → count`. It has no IP, member id, UA, cookie, URL or time finer than the day. Retention is 90 days; pruning happens on write and on the staff read, as in vitals.

**Two writers:**
1. **Client beacon `POST /api/experiments/beacon`** carries `{ e: expId, v: variant, k: event }` (whole-or-nothing validation against the registry). It copies the vitals receive path:
   - `assertSameOrigin`;
   - `rateLimit(request, env, "experiments")`, a new `RATE_LIMITS` key → `READ_RATE_LIMITER` in `constants.mjs`;
   - `EXPERIMENT_MAX_BODY_BYTES = 256`;
   - **always 204**;
   - `credentials: "omit"`, so the server cannot link a beacon to a session.

   It is used for exposure (`composer_open`) and UI events (`emoji_inserted`).
2. **Server-side counts** for events the server already sees (`post_created`, `reply_created`). The handler computes the member's variant in memory, skips excluded people (§2c), and upserts one counter row through `ctx.waitUntil`. Errors are swallowed to a name-only log, as in analytics. This is tamper-proof and needs no beacon.

**Perf per variant:** the existing vitals beacon gains an optional `x: { e, v }` naming **at most one** experiment, the one whose registry entry has `perf: true`. Carrying several assignment pairs together would build a fingerprint-like combination, so a beacon never holds more than one. When `x` is present, the server also upserts `experiment_vitals_daily` (same 21 buckets, keyed `(day, experiment_id, variant, metric)`). `web_vitals_daily` stays untouched.

**Caps and abuse:**
- `EXPERIMENT_DAILY_CELL_CAP = 5000`: upserts stop once a cell reaches it, which bounds pollution from forged beacons.
- Client beacons are anonymous and can be forged. The UI shows a "client-reported" tag on those metrics. Primary metrics should prefer server-side events.

**k-anonymity style display:**
- `EXPERIMENT_K_MIN = 10`: any cell under K shows as "<10".
- No rate, CI or difference is shown until **every** cell of the primary metric is ≥ K **and** the pre-registered `target_n` is reached (§6).

**Metrics for the emoji picker:**

| Metric | Formula | Role |
|---|---|---|
| Post completion | `post_created` (server) / `composer_open` (beacon, browser-day) | primary |
| Insert rate | `emoji_inserted` / `post_created` | secondary, meaningful only in `on` |
| Composer abandon | 1 − completion | guardrail |

---

## 6. Statistics honesty

- **Before start, a power gate.** The staff start form requires a primary metric, a baseline (taken from the last 28 days of counters if any, else typed in) and an MDE in percentage points. It shows `n per arm`, using the §0 formula, and an **estimated duration** = n·arms / (units per day over the last 14 days at the chosen rollout). If the estimate is over `EXPERIMENT_MAX_DAYS = 56`, the Start button is disabled, with the line "Not enough traffic to detect this effect." `target_n` and `mde_pp` are stored and frozen once running.
- **Fixed horizon, no peeking.** While `n < target_n`, the panel shows only exposure counts per arm and a progress bar ("143 / 332 collected"). It shows no rates, no difference and no CI. That is the anti-peeking rule. Staff may still **stop** an experiment early with the kill switch for safety (a guardrail breach or a bug), but an early stop is recorded as "stopped early: no conclusion" and never shows a winner. Sequential designs (mSPRT, always-valid CIs) are deliberately deferred under KISS. **OWNER Q3**.
- **At the horizon the panel shows:**
  - per-arm Wilson 95% intervals;
  - the difference with a Newcombe 95% CI;
  - for count rates, a Poisson rate-ratio CI.

  The verdict is one of: "On is better" / "Off is better" (the CI excludes 0) / "No detectable difference at this size" (it never says "no effect").
- **Multiple metrics:** only the primary metric gets a verdict. Secondaries and guardrails are labelled "exploratory".
- **Ramps:** `analysis_start_day` resets to the day of the last rollout or weight change, and only counts from that day onward enter the analysis. Mixing pre- and post-ramp populations would bias the result.
- **Clustering caveat, stated in the UI:** the unit is a browser-day, not a person, so heavy posters weigh more and the CIs are somewhat too narrow. Fixing that would need per-person rows, which privacy rules out. The daily dedupe softens it.
- Every result also carries the line "Beta testers, the owner, staff overrides, GPC/DNT visitors and non-enrolled visitors are excluded."

---

## 7. D1 schema (CREATE-only, fresh numbers 0092–0094)

The remote ledger tops out at 0087, and the ActivityPub slate proposes 0088–0091. Before naming, re-check each NAME in `d1_migrations` with the ritual. If ActivityPub does not land first, keep these numbers anyway. Gaps are fine and renumbering is not.

**0092_experiments.sql**
```sql
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,                       -- must be a key of constants.mjs EXPERIMENT_FEATURES
  stage TEXT NOT NULL DEFAULT 'off' CHECK (stage IN ('off','beta','experiment','shipped')),
  rollout_pct INTEGER NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  weights TEXT NOT NULL DEFAULT '{"off":50,"on":50}',
  force TEXT CHECK (force IN ('on','off')),
  salt BLOB NOT NULL,                        -- 32 random bytes; never returned by any API
  public_epoch INTEGER NOT NULL DEFAULT 1,   -- guest reroll counter (public)
  primary_metric TEXT, baseline REAL, mde_pp REAL, target_n INTEGER,
  analysis_start_day TEXT, started_at INTEGER, ended_at INTEGER, end_note TEXT,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS experiment_overrides (       -- staff testing only; excluded from stats
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  set_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  set_at INTEGER NOT NULL,
  PRIMARY KEY (experiment_id, user_id)
);
CREATE TABLE IF NOT EXISTS experiment_counts_daily (    -- aggregates only; no FK (cheap upsert, pruned)
  day TEXT NOT NULL, experiment_id TEXT NOT NULL, variant TEXT NOT NULL, event TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, experiment_id, variant, event)
);
```
**0093_experiment_vitals.sql**: `experiment_vitals_daily (day, experiment_id, variant, metric, count, b0…b20, PRIMARY KEY (day, experiment_id, variant, metric))`. Same shape and comment as 0079.

**0094_beta_channel.sql**
```sql
CREATE TABLE IF NOT EXISTS beta_testers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_state (              -- single row; a missing row = beta NOT paused
  id INTEGER PRIMARY KEY CHECK (id = 1),
  beta_paused INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);
```

**Bind budget:**
- Session flag read: one query, `SELECT e.*, o.variant AS ov, (SELECT 1 FROM beta_testers WHERE user_id=?) AS beta FROM experiments e LEFT JOIN experiment_overrides o ON o.experiment_id=e.id AND o.user_id=? WHERE e.stage!='off' LIMIT 20`, with **2 binds**.
- Counter upsert: 4 binds. Vitals-per-variant upsert: 3 binds. Prune: 2.
- Everything is far below 100, and `tests/bind-budget*` is extended to cover it.

**Session cost:** one extra D1 read plus at most 2×3 SHA-256 digests per member `GET /api/session`. Guests pay nothing server-side.

---

## 8. Staff UI (desk → Site health → "Experiments")

`public/js/desk/site-health.js` (97 lines, a table built with `createElement` and `textContent`) grows a sibling module, `public/js/desk/experiments.js`, so neither file gets crowded.

- **List:** for each experiment, show its stage, rollout, force state and progress (`n / target_n`). For finished ones, show the verdict.
- **Controls** (all go through CSRF, `requireStaff` and the write rate limit, and each writes a modlog line `experiment.<action>` that never includes a member's variant):
  - Start, with the power gate (§6);
  - Ramp 10 / 25 / 50 / 100;
  - Stage → beta / shipped / off;
  - **Kill switch** (force on / force off / clear);
  - Stop (records "stopped early" if `n < target_n`).
- **Per-member override** (staff-only): look up a member by @handle and set `on`, `off` or clear. Overridden members are excluded from stats. The list shows the count of overrides, not who has them, except to the staff member who opens the override list.
- **Charts:** uPlot is on the approved list ("Chart.js (→ uPlot)", owner Nov 22). Vendor it under `public/js/vendor/uplot/` with its MIT notice in `REUSE.toml`, and lazy-load it only on this desk tab. It draws a daily cumulative-exposure line per arm. The CI view is a hand-drawn inline SVG forest plot (one row per metric, point and whisker) with no library. If uPlot vendoring slips, the panel falls back to a table, the same style as vitals.
- The beta kill switch (§10) lives on the same page as one large toggle.

---

## 9. First experiments, sized against real traffic

| # | Experiment | Audience | Primary metric | Expected run |
|---|---|---|---|---|
| **E0** | **A/A test** on a dummy flag `aa-check` (both arms identical) | everyone | `page_shell` exposure share; `post_created` per exposure | **7 days, fixed.** It validates bucketing balance (a χ² sample-ratio-mismatch check, alarm at p < 0.001) and the end-to-end pipeline, and measures the real units/day and vitals-beacon rate that every later estimate relies on. |
| **E1** | **Emoji-picker holdout** (owner's example: Bob has it, Tom doesn't) | members, 100% rollout, 50/50 | post completion (`post_created` / `composer_open` browser-days) | Baseline guess p≈0.6. Detecting +20 pp needs 78 per arm, so 157 units. At about 6 composer-days per day that is **≈4 weeks**. Smaller effects (+10 pp, ≈118 days) can't be detected, and the desk says so. |
| **E2** | **Lazy-load below-the-fold images** (`loading="lazy"` plus decoding hints on post images past the first two) | everyone | share of LCP samples "good" (≤ 2500 ms) via `experiment_vitals_daily` | 75%→85% needs 247 per arm. At about 7 vitals/day that is ≈70 days, **too long**. At 70/day (to be confirmed by E0) it is ≈7 days. E2 starts only if E0 shows at least 35 vitals/day (≈14 days). |
| ✗ | Altcha signup friction | guests | signup conversion | **Rejected.** At about 0.6 signups/day, any realistic effect needs more than a year. |

**OWNER Q4 (E1):** the emoji picker exists today, so its "off" arm *removes* a feature from half of the members for about 4 weeks. Is that acceptable? The alternative is to run E1 on the next *new* feature instead (same framework, no removal).

---

## 10. Beta channel (beta.wempos-forum.com)

### 10a. Hosting
- `wrangler.toml` gains `[env.beta]` with `name = "wempos-forum-beta"` and `routes = [{ pattern = "beta.wempos-forum.com", custom_domain = true }]`. The zone is already in the account, so the custom domain creates its DNS record.
- Wrangler envs do **not** inherit bindings, so `[env.beta]` must repeat:
  - `[[env.beta.d1_databases]]` FORUM_DB with **the same `database_id` e648d306-…** and `migrations_dir`;
  - `[env.beta.assets]` (same `./public`, `run_worker_first = true`);
  - every `[[env.beta.ratelimits]]`;
  - all vars.

  Var differences on beta:
  - `SITE_ORIGIN = "https://beta.wempos-forum.com"`, `CHANNEL = "beta"`, with prod gaining `CHANNEL = "prod"`;
  - `ANALYTICS_ENABLED = "false"`, so the page-view count is not doubled;
  - `ACCOUNTS_ORIGIN` unchanged;
  - `RELAY_WORKER_NAME` unchanged; relay calls only ever go to prod.

  A test parses `wrangler.toml` and pins **same database_id**, beta's `CHANNEL`, and **no `[env.beta.triggers]`**.
- **Rate limiters are shared:** beta reuses the same `namespace_id`s, so moving to beta doesn't give a member a second budget. **OWNER Q5** to confirm.
- `package.json` gains `"deploy:beta": "wrangler deploy --env beta --keep-vars --var COMMIT_SHA:$(git rev-parse --short HEAD)"`. Agents run `pnpm run deploy:beta`, never the bare command. The hookify rule `block-bare-wrangler-deploy` matches the regex `wrangler\s+deploy` in the *typed command*, so `pnpm run deploy:beta` passes it, and a typed `pnpm exec wrangler deploy --env beta` is still blocked, as intended. An AGENTS.md line and a wave-lead probe for `/api/version` on beta are added.
- **Release flow, beta first:**
  1. The wave branch is tested in an isolated worktree.
  2. Run `pnpm run deploy:beta` from that checkout, then probe and soak (`BETA_SOAK_HOURS`, **OWNER Q6**, recommended 12h).
  3. Merge and push `main`.
  4. Run `pnpm run deploy` from the pushed main tip, which promotes the same SHA.

  Main stays equal to prod, so the existing "push can fire a bare hosted build" rule is unchanged. The migrations a wave needs are applied under the NAME-PRESENCE ritual **before** step 2, because beta and prod share the database.

### 10b. Opt-in and redirect
- **Setting:** "Join beta testers" (Settings › Account). It is account-scoped, stored as a `beta_testers` row and **off by default** (defaults law). Joining or leaving goes through CSRF, a non-banned member and the write rate limit; deleting a missing row is a no-op.
- **Recommendation: merge** the flags clarification's "try beta features" and the beta channel into this ONE setting. Beta testers get redirected, get every `beta`-stage flag, always get `on` in experiments, and are excluded from stats. **OWNER Q7.**
- **On prod (`CHANNEL=prod`)**, for an HTML navigation only: `GET`, `Sec-Fetch-Mode: navigate` or `Accept` containing `text/html`, a known page route via `routeForPath`, not `/api/*`, not assets, not feeds or `.xml`/`.json`/`robots.txt`/`sitemap`, not `/.well-known/*`. If the session member is a beta tester or the owner, beta is not paused and there is no owner escape (§10d), the answer is **302** to `https://beta.wempos-forum.com` + the same path and query, with `Cache-Control: private, no-store` and `Vary: Cookie`. Everyone else is served normally.
- **On beta (`CHANNEL=beta`)**, for an HTML navigation: if beta is paused, the member is signed in but not a beta tester (opted out), or the owner used the escape, the answer is **302 back to prod**. A signed-out visitor sees a slim "Beta channel" page offering "Sign in with Wempo Accounts" (§10c) and "Go to wempos-forum.com". Beta never serves a guest shell to crawlers.
- **Leaving beta from beta:** the toggle writes the shared D1 row and then navigates to prod, and beta's next navigation redirects anyway.
- **Loop guard:** each side redirects only on its own rule, and a test pins that no state redirects both ways.

### 10c. Sign-in on beta
- Sessions are `__Host-wempo_session` (`api/core/auth.mjs:108`), host-only, so beta has its **own** session.
- **Recommendation: Accounts SSO only on beta.**
  - Beta's sign-in button goes to `https://accounts.wempos-forum.com/?return=https://beta.wempos-forum.com`.
  - The redemption is the existing `?wt=` → `POST /api/auth/sso/redeem` → Accounts `/api/sso/redeem` over `ACCOUNTS_WORKER`, so `[env.beta]` also needs the `ACCOUNTS_WORKER` service binding.
  - This needs a change in the **Accounts repo** (`~/wempo-accounts/constants.mjs`): add the beta origin to the return allowlist and the ticket site map, and teach `public/js/sso.js` that it is on beta.
  - It is one click when Accounts already has a session, and otherwise one password entry.
- Beta has **no** local password login and **no** registration (sign up on prod). So beta needs **no `PASSWORD_PEPPER`** and no Altcha secret, and no owner-held secret has to be copied to a second worker. The relay stays prod-only (the Accounts `FORUM_WORKER` binding still points at prod).
- `TENOR_API_KEY` on beta: either the owner adds it via stdin to the beta worker, or GIF search is disabled on beta. **OWNER Q8.**
- **Alternative (OWNER Q9):** a zero-click handoff, where prod mints a 60-second single-use ticket (sha256 stored in a new CREATE-only table in the shared D1) on the redirect, and beta redeems it. It needs no Accounts change, but it puts a one-time token in a URL.
- **CSRF and origin:** `assertSameOrigin` compares against `env.SITE_ORIGIN`, so beta accepts only the beta origin and prod only the prod origin. A test pins that a beta Origin is refused by prod and the reverse.

### 10d. The owner is always a beta tester
- `role === "owner"` is treated as a beta tester **without** a row. The owner is always redirected, gets every beta flag, sees no opt-out toggle (a note explains why) and is excluded from A/B stats.
- **Escape hatch (owner only, browser-session only):**
  - `https://wempos-forum.com/?channel=prod` sets `__Host-wempo_channel=prod; Path=/; Secure; HttpOnly; SameSite=Lax` with **no Max-Age/Expires**, so it dies when the browser closes. The staff desk has a matching "View production" link.
  - Prod skips the beta redirect only when the cookie is present **and** the session user's role is `owner`; anyone else's cookie is ignored. `?channel=beta`, or closing the browser, clears it.
  - It is strictly functional and owner-only, so it complies with the no-non-essential-cookies rule.
- The staff **beta kill switch** (`channel_state.beta_paused = 1`) returns everyone to prod, the owner included.
- **Pinned by tests:** the owner is always redirected; the escape works only for the owner role (an admin with the cookie is still redirected); the escape cookie has no Max-Age/Expires; the kill switch overrides the owner.

### 10e. Shared-database safety
- Beta code may use only schema prod already has, plus CREATE-only additive migrations applied **before** `deploy:beta` (NAME-PRESENCE ritual, by name, before and after).
- **New test `tests/migrations-additive.test.mjs`:** every migration numbered ≥ 0092 contains no `DROP`, no `ALTER … RENAME`, no `ALTER … DROP COLUMN`, and no `DELETE`/`UPDATE` without `WHERE`. Older files are grandfathered by number.
- **Expand/contract rule:** beta must not write a new enum value into a column prod reads (a new post `kind`, a new notification type, etc.) until prod's code can render it. Beta reads must tolerate prod-written rows, including NULLs in columns beta added.
- Data written on beta is real forum data. Posts made on beta are posts on prod.

### 10f. Single-runner jobs
- No cron `[triggers]` exist today. Beta must never get any (the wrangler test above).
- Any future `scheduled()` handler, ActivityPub delivery queue, digest email or retention sweep starts with `if (env.CHANNEL !== "prod") return;`. A grep test pins that every `scheduled`/queue handler calls `assertProdChannel(env)`.
- The launchd feature loop and bot ops target `https://wempos-forum.com` only. Prune-on-write paths are idempotent and safe on both workers.

### 10g. Same protections on beta
- **CSP:** the same headers module, so it is identical.
- **Rate limits:** shared, as above.
- **Anubis and Access:** the Anubis pass check (`api/core/anubis-pass.mjs`) runs the same in code, but the Anubis/Access front for the new hostname must be configured on the Cloudflare side for `beta.wempos-forum.com`. **OWNER Q10** (Access policy: everyone, or members only).
- **Robots:** every beta response carries `X-Robots-Tag: noindex, nofollow`. `robots.txt` is `Disallow: /`, sitemap, feeds and ActivityPub discovery are off, and `<link rel="canonical">` points at prod. A test pins this.
- **Banner:** a slim, dismissible-per-session "You're on the beta channel · Go to production · Leave beta" bar. **OWNER Q11** for the text.

### 10h. Flags interplay (summary)
Beta testers and the owner get all `beta`-stage flags `on` and always get `on` in `experiment`-stage features, and they never count. `force` beats everything. Beta-stage flags are `off` for everyone on prod who isn't a beta tester.

### 10i. Watchdog, probes, rollback
- **Probes after every `deploy:beta`:**
  - `GET https://beta.wempos-forum.com/api/version` returns `build` equal to the deployed SHA;
  - an HTML response carries `X-Robots-Tag: noindex`;
  - `POST /api/relay/password-verify` on beta does **not** succeed (403/404);
  - prod `/api/version` is unchanged.
- **Watchdog:** the existing site watchdog gains a beta target. If beta fails twice in a row, **auto-pause** beta (`beta_paused = 1`, through a staff-token desk call) so testers fall back to prod, and report to the lead.
- **Rollback:** either `pnpm exec wrangler rollback --env beta` (allowed, because it is not a deploy), or re-run `pnpm run deploy:beta` from the previous good SHA's checkout. Prod rollback is unchanged.

---

## 11. Privacy page, strings, tests, risks, effort

### Privacy text (Settings › Privacy, next to `settings.vitalsNote`)
- `settings.experimentsNote`: "Sometimes a feature is shown to some people and not others, so we can see if it helps. Signed-in members are sorted by a calculation on your account, so nothing is stored about which group you're in. Visitors who aren't signed in are sorted by a random number kept only in this browser. We count only daily totals per group (for example, how many posts were finished), never who did what, and we keep them for 90 days. Do Not Track or Global Privacy Control keeps you out of every test. Joining beta testers also keeps you out of the counts."
- `settings.betaNote`: "Beta testers use beta.wempos-forum.com, which shows the same forum and posts with newer features that may break. You'll sign in there once through Wempo Accounts. You can leave at any time."

### Strings (`t()` keys; `en.json` plus all 65 other locales, really translated, with key and placeholder parity)
- Settings and the composer: `settings.experimentsNote`, `settings.experimentsReset`, `settings.betaJoin`, `settings.betaJoinHint`, `settings.betaNote`, `settings.betaOwnerAlways`.
- Beta page and banner: `beta.banner`, `beta.goProd`, `beta.leave`, `beta.signInTitle`, `beta.signInBody`, `beta.signInButton`, `beta.paused`.
- Desk, general: `desk.experiments.title`, `.stage`, `.rollout`, `.force`, `.killOn`, `.killOff`, `.killClear`, `.start`, `.stop`, `.ramp`, `.override`, `.overrideCount`, `.progress` (`{collected}` / `{target}`), `.powerEstimate` (`{n}` per group, about `{days}` days), `.notEnoughTraffic`, `.notEnoughData`, `.belowK` ("<{k}"), `.excludedNote`.
- Desk, verdicts and caveats: `.verdictOn`, `.verdictOff`, `.verdictNone`, `.stoppedEarly`, `.exploratory`, `.clientReported`, `.clusterCaveat`, `.srmAlarm`.
- Desk, beta controls: `desk.beta.pause`, `desk.beta.resume`, `desk.beta.viewProd`.

### Tests (RED first, one file per phase)
**Phase A, flags core (`tests/wave-flags.test.mjs`):**
- Bucketing is deterministic and stable for the same (salt, id, user). Over 10k synthetic ids the split is within ±2% of the weights. The ramp 10→50→100 is monotone, so nobody already enrolled is dropped and nobody flips variant.
- Precedence is force > stage > beta/owner > override > bucket.
- `GET /api/session` puts flags only on the member's own response and sends `Cache-Control: no-store`. The salt never appears in any response (scan of all JSON bodies in the suite's fakes). The guest shell contains the public config only.
- Flags appear in no public surface: the profile, post, feed and export of another member are byte-identical across buckets.
- GPC or DNT: `counted:false`, `defaultWhenUnset`, no beacon. Beta tester, owner and override: `counted:false`.
- `requireFlag`: every registry `serverRoutes` entry returns 404 for control and 200 for on (registry walk). Mutation-check this test.
- Every `isEnabled("…")` key in `public/js` is in `EXPERIMENT_FEATURES`. `flags.js` dedupe keys are account-scoped and cleared by `wipeAccountLocalData`. The guest key is not cleared, and Reset clears it.
- The composer doesn't import `emoji-picker.js` when the flag is off (an injected loader spy is never called).

**Phase B, measurement and stats (`tests/wave-experiments-stats.test.mjs`):**
- The beacon always returns 204. A bad, oversized, cross-origin, unknown-event or rate-limited beacon writes nothing. A valid one upserts exactly one row of `(day, exp, variant, event)` with no other columns.
- Server-side `post_created` counting skips excluded people, swallows errors and never delays the response.
- The vitals beacon carries at most one experiment. `web_vitals_daily` behaviour is unchanged (the existing wave576 suite stays green).
- The cell cap is enforced. Retention prunes at 90 days on write and on read.
- K-min masking; no rate or CI while `n < target_n`; the power formula matches known values (p 0.6→0.8 → 78 per arm; 0.75→0.85 → 247 per arm); Wilson, Newcombe and Poisson CIs match reference values; the start is blocked past 56 days; the verdict wording, the early stop never yielding a verdict, the SRM alarm, and `analysis_start_day` resetting on a ramp.
- The bind budget is pinned.

**Phase C, beta channel (`tests/wave-beta-channel.test.mjs`):**
- `wrangler.toml`: `[env.beta]` uses the same `database_id`, `CHANNEL=beta`, no triggers and `ANALYTICS_ENABLED=false`. `package.json` `deploy:beta` contains `--env beta --keep-vars --var COMMIT_SHA:`.
- The redirect matrix covers channel × {guest, member, beta tester, owner, owner+escape, admin+escape} × {paused, not} × {HTML navigation, API, asset, feed, robots, sitemap, well-known}. Only the intended cells redirect, and no state loops.
- Owner pins: always redirected; the escape works for the owner only; the escape cookie has no Max-Age/Expires; the kill switch overrides the owner.
- The join/leave write needs CSRF, a non-banned member and the rate limit, and a missing-row delete is a no-op. Beta answers `X-Robots-Tag: noindex` and `robots.txt` disallows all.
- Prod refuses a beta Origin and beta refuses a prod Origin. Beta has no password-login or register route.
- `tests/migrations-additive.test.mjs` passes for 0092 and later. The `assertProdChannel` grep pin.

**Every phase:**
- i18n parity across 66 locales; license headers on new `.js` files; `reuse lint` with the uPlot entry.

### Risks
1. **Underpowered tests read as answers.** Mitigated by the power gate, fixed horizon, K-min and "no detectable difference" wording. The real traffic is small (§0).
2. **Forged client beacons.** Mitigated by server-side primary metrics, the cell cap and the "client-reported" tag.
3. **Bucket leakage between members.** Mitigated: there is no public surface and no logs, and tests pin both. The screenshot leak is accepted and disclosed.
4. **Beta code corrupting shared data.** Mitigated by the additive-migration test, the expand/contract rule, ritual-before-beta-deploy and the beta kill switch.
5. **Redirect loops, or members stranded on a broken beta.** Mitigated by the loop matrix test, the watchdog auto-pause and the owner escape.
6. **Accounts cross-repo change (§10c).** It touches the sign-in path, which broke all sign-ins on Nov 20. The cross-app-signin probes run before and after.
7. **Session latency.** One more D1 read per member session; capped at 3 running experiments.
8. **Double counting:** analytics is off on beta, beta testers are excluded, and a guest switching on sign-in is documented.

### Effort (one lead seat per phase, RED first, at the recent wave pace)
- **A, flags core** (registry, `flags.js`, session payload, `requireFlag`, the emoji-picker gate, overrides, kill switch, migration 0092 tables 1–2): **1 wave**.
- **B, measurement, stats and desk** (beacon, server counts, vitals-per-variant 0093, power gate, CIs, uPlot vendoring, desk panel): **1–1.5 waves**.
- **C, beta channel** (`[env.beta]`, `deploy:beta`, redirects, owner escape, SSO on beta, robots, watchdog, 0094): **1.5–2 waves**, plus a small Accounts-repo change and Cloudflare-side Anubis/Access setup for the new host (owner or lead).
- **Experiments themselves:** E0 runs 7 days, then E1 about 4 weeks; E2 depends on E0.
- **Order:** A → B → E0 running → C. C can run in parallel with E0 because it uses separate files except the `api/session.mjs` touch point.

---

## 12. OWNER questions (nothing builds until answered)
- **Q1:** Should experiment definitions be a code registry plus D1 run state (recommended), or pure D1 / pure code?
- **Q2:** Should buckets be hashed with a per-experiment salt in D1 (recommended, no new secret), or with an HMAC under a new owner-held `EXPERIMENTS_SECRET` that you put in via stdin?
- **Q3:** Fixed-horizon stopping (recommended), or sequential testing (mSPRT) later?
- **Q4:** E1 removes the existing emoji picker from about half of members for about 4 weeks. Is that OK, or should E1 run on the next new feature instead?
- **Q5:** Should beta share prod's rate-limit counters (recommended)?
- **Q6:** How long should beta soak before promotion to prod (recommended 12h)? Can a trivial fix skip the soak?
- **Q7:** Should "try beta features" and "Join beta testers" be one setting (recommended)? And who may join beta: anyone signed in (recommended), invite-only, or staff-picked?
- **Q8:** `TENOR_API_KEY` on beta. Will you add it via stdin, or should GIF search stay off on beta?
- **Q9:** Beta sign-in through Accounts SSO (recommended; needs the Accounts allowlist change), or a zero-click shared-DB handoff ticket?
- **Q10:** Anubis and Access for `beta.wempos-forum.com`. Same policy as prod? Who may pass Access?
- **Q11:** What should the beta banner say? Recommended: "You're on the beta channel. Things may break. Go to production · Leave beta."
- **Q12:** Should web vitals be collected on beta, as a separate stream, to catch perf regressions before promotion? Recommended: off in v1.

## Laws (every lane)
- CREATE-only migrations 0092–0094, re-verified by NAME against the remote ledger and applied under the NAME-PRESENCE ritual **before** either deploy.
- Deploy with `pnpm run deploy` (prod) and `pnpm run deploy:beta` (beta) only, never a bare deploy.
- Visibility law on every new read; secrets are never printed or committed; Firefox-only browser lanes; AGPLv3 notices; `t()` strings in all 66 locales.
- Commits end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
