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
| `TURNSTILE_SITEKEY`, `TURNSTILE_HOSTNAMES` | Optional, see step 6. |
| `SOURCE_URL` | Where the footer's **Source code** link points. Leave it empty to link the upstream repository at the deployed commit. If you modify the forum, point this at YOUR source, e.g. `https://git.example.org/you/my-forum` (see below). Only `https://` addresses are used. |
| `RELAY_WORKER_NAME` | The name your Wempo Accounts copy knows this forum by. Keep `wempos-forum` unless you changed it there. |
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

## 6. Turnstile (optional)

Cloudflare Turnstile checks that a person, not a script, is signing up,
signing in or posting. It is off unless you turn it on; rate limits are
always on either way.

To turn it on, create a Turnstile widget in the Cloudflare dashboard for your
forum's hostname, then:

1. put its sitekey in `TURNSTILE_SITEKEY` and your hostname in
   `TURNSTILE_HOSTNAMES` in `wrangler.toml`, and
2. `pnpm exec wrangler secret put TURNSTILE_SECRET` with its secret key.

With no `TURNSTILE_SECRET`, the forum shows no widget and asks for no check.

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

Signed in as the owner, open **Admin**, then **Branding**
(`https://<your forum>/admin/branding`). Fill in:

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
