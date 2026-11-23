# Running your own Wempo's Forum

You can run your own copy of Wempo's Forum on your own Cloudflare account.
A copy is two workers that share one D1 database:

- **the forum** (this repository), and
- **Wempo Accounts**, the sign-in site
  ([Wempo-s-Silly-Projects/wempo-accounts](https://github.com/Wempo-s-Silly-Projects/wempo-accounts)).
  Members sign in there, and it sends them back to your forum signed in.

This is the same pairing wempos-forum.com runs. The forum is free software
under the GNU AGPL, version 3 or later: if you run a changed copy for other
people, you must offer them its source code.

## What you need

- A Cloudflare account (the Workers free plan is enough to start).
- Node.js 22 or newer and [pnpm](https://pnpm.io). Use pnpm, not npm.
- This repository and the Wempo Accounts repository, cloned.

## 1. Install

```sh
pnpm install
pnpm exec wrangler login
```

## 2. Create the database

```sh
pnpm exec wrangler d1 create my-forum-data
```

Keep the `database_name` and `database_id` it prints. Wempo Accounts uses
this same database later.

## 3. Make your wrangler.toml

```sh
cp wrangler.example.toml wrangler.toml
```

`wrangler.toml` is yours and is never committed. Open it and fill in every
line marked `CHANGE ME`:

| Setting | What to put there |
|---|---|
| `name` | Your forum worker's name, e.g. `my-forum`. |
| `database_name`, `database_id` | The values from step 2. |
| `SITE_ORIGIN` | Your forum's public address, e.g. `https://forum.example.org`. Leave it empty to use the `workers.dev` address. When set, the `workers.dev` address redirects there. |
| `ACCOUNTS_ORIGIN` | Your Wempo Accounts address, e.g. `https://accounts.example.org`. Sign-in does not work until this is set. |
| `SOURCE_URL` | Where the footer's **Source code** link points. Leave it empty to link the upstream repository at the deployed commit. If you modify the forum, point this at YOUR source, e.g. `https://git.example.org/you/my-forum` (see below). Only `https://` addresses are used. |
| `RELAY_WORKER_NAME` | The name your Wempo Accounts copy knows this forum by. Keep `wempos-forum` unless you changed it there. |
| `OG_IMAGE_URL` | Optional. The picture link previews show for every page. Leave it empty to use the forum's own `/og-image.png`, or set a full `https://` (or `http://`) image address, ideally 1200x630. Anything that isn't such an address falls back to the default. |
| `ANALYTICS_ENABLED` | Optional, off in the example file. See step 11. |
| `AUTOMOD_ENABLED` | Optional, left out (off) in the example file. See step 12. |
| `[[services]] service` | Your Wempo Accounts worker's name (from step 8). |

To use your own domain, add it as a custom domain for the worker in the
Cloudflare dashboard, then set `SITE_ORIGIN` to it.

## 4. Apply the database migrations

```sh
D1_DATABASE=my-forum-data pnpm run db:migrate:remote
```

`D1_DATABASE` is the `database_name` from step 2. (For a local test copy, use
`pnpm run db:migrate:local` the same way.)

## 5. Set the secrets

Secrets are never written in any file. Set each one with Wrangler; it asks
for the value:

```sh
pnpm exec wrangler secret put PASSWORD_PEPPER
pnpm exec wrangler secret put SETUP_SECRET
pnpm exec wrangler secret put RELAY_TOKEN
```

- `PASSWORD_PEPPER`: a long random value (32 to 256 characters). It is mixed
  into every password. Pick it once and never change it, or nobody can sign
  in any more.
- `SETUP_SECRET`: a long random value (32 or more characters). You type it
  once on the `/setup` page to create the owner account.
- `RELAY_TOKEN`: a long random value shared with Wempo Accounts. Set the same
  value on both workers.

`.dev.vars.example` lists every name with a short note, for local testing
with `pnpm run dev` (copy it to `.dev.vars`, which is never committed).

## 6. Human check (optional)

The `HUMAN_CHECK` setting picks how the forum tells people from scripts. Set
it in `wrangler.toml` under `[vars]` (it is not a secret). Rate limits are
always on, whatever you pick.

| `HUMAN_CHECK` | What it does |
|---|---|
| `anubis` (default) | [Anubis](https://github.com/TecharoHQ/anubis) checks browsers before pages load (see "Running Anubis" below). Until it is set up, or whenever it cannot be reached, the forum falls back to the `altcha` check. |
| `altcha` | A lightweight check you host yourself: signing up, signing in and posting cost a browser a second or two of hashing (ALTCHA; no third-party script, frame or cookie). |
| `off` | No human check. |

For `altcha`, set the mode and store a long random key as a secret:

```toml
[vars]
HUMAN_CHECK = "altcha"
```

```sh
openssl rand -hex 32 | pnpm exec wrangler secret put ALTCHA_HMAC_KEY
```

With no `ALTCHA_HMAC_KEY`, `altcha` mode asks for no check. A legacy
`TURNSTILE_SECRET`, if still stored, derives the key instead.

### Running Anubis

The forum talks to the whole, unmodified Anubis program (tested with
v1.28.2) in its subrequest ("forward-auth") mode, as described in Anubis's
own guide, `docs/docs/admin/configuration/subrequest-auth.mdx`. Anubis runs
on a machine you control; the Worker reaches it over HTTPS.

1. **Policy.** Use a policy file that imports Anubis's default rules and
   answers a deny with 403 (the Worker reads 200 as pass, 403 as deny, a
   307 to `/.within.website/` as "show the challenge"). A ready copy is in
   [`deploy/anubis/botPolicies.yaml`](../deploy/anubis/botPolicies.yaml).
2. **Environment.** Run Anubis with:
   - `TARGET=" "` (a single space: subrequest mode, no upstream);
   - `POLICY_FNAME` pointing at the policy file above;
   - `CUSTOM_REAL_IP_HEADER=X-Wempo-Client-Ip`. Cloudflare rewrites
     `X-Forwarded-For`, so the Worker sends the visitor's address (from
     `CF-Connecting-IP`) in this header and always overwrites any value a
     visitor sends. Rules that allow known good crawlers by address (the
     Internet Archive, for one) depend on it;
   - a fixed `ED25519_PRIVATE_KEY_HEX`, so the signing key survives restarts.
     Keep the default `-jwt-restriction-header X-Real-IP`: a pass cookie is
     then only good from the address that earned it.
3. **Reach it.** Put Anubis behind HTTPS, for example with a Cloudflare
   Tunnel to a hostname such as `anubis-origin.example.com`.
4. **Tell the forum.** In `wrangler.toml` under `[vars]`:

   ```toml
   HUMAN_CHECK = "anubis"
   ANUBIS_URL = "https://anubis-origin.example.com"
   # The public half of ED25519_PRIVATE_KEY_HEX (64 hex digits; not a secret).
   ANUBIS_PUBLIC_KEY_HEX = "..."
   ```

5. **Cloudflare Access (optional, recommended).** To keep the Anubis
   hostname private, protect it with a Cloudflare Access application whose
   only policy is a service token, and store the token as two secrets:

   ```sh
   pnpm exec wrangler secret put ANUBIS_ACCESS_CLIENT_ID
   pnpm exec wrangler secret put ANUBIS_ACCESS_CLIENT_SECRET
   ```

   The Worker sends them with every request to Anubis, never forwards a
   visitor's own `CF-Access-*` headers, and never passes Access's
   `CF_Authorization` cookie to the browser. Without Access, set
   `ANUBIS_ACCESS = "none"` under `[vars]` instead: the Anubis hostname is
   then public, and the Worker still overwrites the client-address header.
   Anubis counts as configured only with `ANUBIS_URL`,
   `ANUBIS_PUBLIC_KEY_HEX` and either both Access secrets or
   `ANUBIS_ACCESS = "none"`; otherwise `anubis` mode uses `altcha`.

How it behaves:

- Every page navigation is checked first (API calls, feeds, discovery
  documents and static files are not). A visitor Anubis wants to test is
  sent to its challenge, which the Worker serves on your own domain under
  `/.within.website/`.
- Signing up, signing in, posting and replying need either a valid Anubis
  pass cookie (checked by the Worker itself with `ANUBIS_PUBLIC_KEY_HEX`; a
  deny never counts) or a solved `altcha` check.
- If Anubis is slow (over 1.5 seconds), down, or Access answers instead of
  it, pages still load and the forum asks for the `altcha` check instead. Set
  `ALTCHA_HMAC_KEY` so that fallback works; without it, writes need the
  Anubis pass.

## 7. Deploy the forum

```sh
pnpm run deploy
```

Always deploy with `pnpm run deploy`: it stamps the build with the current
commit so open browser tabs know when to load fresh code.

## 8. Deploy Wempo Accounts alongside

Members sign in through Wempo Accounts, so your forum needs its own copy.
Clone
[wempo-accounts](https://github.com/Wempo-s-Silly-Projects/wempo-accounts)
and follow its README, with these settings so the two workers find each other:

- the **same D1 database** as the forum (step 2),
- the **same `RELAY_TOKEN`** secret as the forum (step 5),
- its forum service binding pointing at your forum worker's `name`,
- your forum's address on its list of sites allowed to sign in.

Then put the Accounts worker's name in the forum's `[[services]] service`
line and its address in `ACCOUNTS_ORIGIN`, and run `pnpm run deploy` again.

## 9. Create the owner account

Visit `https://<your forum>/setup` and enter your `SETUP_SECRET` to create
the owner account. The setup page only works while the forum has no owner.

## 10. Name your forum

Signed in as the owner, open the **Moderation desk** (in the header's
**Account** menu), then **Branding** (`https://<your forum>/admin/branding`). Fill in:

- **Forum name**: shown in the header, the browser tab, the home page, the
  two-factor app entry and the pages written for search engines and agents
  (up to 60 characters).
- **Tagline**: shown after the name at the top of the home page (up to 120
  characters).
- **Footer**: the line at the bottom of every page (up to 200 characters).

Press **Save branding**, then reload the page. Leave a box empty to go back
to the default (the name "Wempo's Forum" and its tagline and footer). The
default tagline and footer are translated for each language; your own are
shown exactly as you typed them. Admins can change these too.

## 11. Visit counts (optional)

The forum can count visits privately. When `ANALYTICS_ENABLED` is exactly
`"true"` in `wrangler.toml`, each page view adds one to a total for that day
and that kind of page (home, a thread, a profile, a board...), and, when the
visitor came from another site, one to a total for that site's name. That is
all it keeps. It stores no IP address, no member, no browser details, no
cookie, no page address and no record of single visits. Browsers that send
Do Not Track (`DNT: 1`) or Global Privacy Control (`Sec-GPC: 1`) are never
counted, and neither are bots or `HEAD` requests. Totals older than 90 days
are deleted.

Staff see the totals on the moderation desk's **Visits** page
(`https://<your forum>/admin/visits`).

The example `wrangler.toml` ships with `ANALYTICS_ENABLED = "false"`, so a
new copy counts nothing. To turn counting on, set it to `"true"` and deploy.
To turn it off again, set it back to `"false"` (or delete the line) and
deploy; the totals already counted expire on their own after 90 days.

## 12. AutoMod (optional)

AutoMod lets a program you run yourself hide rule-breaking posts, hand out
short bans and flag items for staff, through a private API. It is off unless
**both** of these are true:

1. `AUTOMOD_ENABLED = "true"` is set in `[vars]` (the example file leaves it
   commented out), and
2. the `AUTOMOD_KEY` secret is set:
   `pnpm exec wrangler secret put AUTOMOD_KEY` with a long random value.

The key alone never turns it on, and with either one missing every
`/api/automod/*` address answers 404. What AutoMod can do, and how to switch
it off or replace the key if it ever leaks, is in the
[admin guide](admin-guide.md#automod-api).

## Sharing your source code

The forum is licensed under the GNU Affero General Public License, version 3
or later. Section 13 of that license says that if you run a modified copy for
other people over a network, you must offer those people the source code of
the version you are running. The footer's **Source code** link does that.

Out of the box it points at the upstream repository, at the exact commit
`pnpm run deploy` stamped. That is only correct while you run the code
unchanged. If you modify the forum, point this at YOUR source: publish your
changed copy somewhere people can download it, then set `SOURCE_URL` in
`wrangler.toml` to that address and deploy again. Anything that is not an
`https://` address is ignored and the default link is used instead.

## Updating later

```sh
git pull
pnpm install
D1_DATABASE=my-forum-data pnpm run db:migrate:remote
pnpm run deploy
```

Apply migrations before deploying, so the new code finds the tables it needs.
