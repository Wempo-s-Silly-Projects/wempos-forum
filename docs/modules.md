# Modules: switch whole features on or off

Wempo's Forum is built so a small forum or a self-hosted copy only runs what
it wants. Each optional feature is a **module**. A module that is off is
gone: its API routes answer `404`, its browser code is not loaded, and its
menu entries are hidden. Nothing is half on.

The list lives in one place: `api/core/modules.mjs`.

## The modules today

| Module | What it is | Default | Env switch |
|---|---|---|---|
| `automod` | Lets a local AutoMod runner read new posts and hide or flag them | on, once set up | `AUTOMOD_ENABLED = "true"` and the `AUTOMOD_KEY` secret |
| `analytics` | Aggregate page-view counts (no cookies, no visitor data) | on, once set up | `ANALYTICS_ENABLED = "true"` |
| `web-vitals` | Anonymous page-speed reports | on | `MODULE_WEB_VITALS=off` |
| `human-check` | The human check on sign-up and posting | read-only | `HUMAN_CHECK` (`anubis`, `altcha` or `off`) |
| `chat` | The chat lobby and direct messages | on | `MODULE_CHAT=off` |
| `polls` | Polls on threads | on | `MODULE_POLLS=off` |
| `wall` | Posts members leave on each other's profiles | on | `MODULE_WALL=off` |
| `fun` | The fun extras members can switch on for themselves | on | `MODULE_FUN=off` |
| `saturday-fools` | The Saturday joke (needs `fun`) | on, once set up | `SATURDAY_FOOLS = "on"` |
| `link-previews` | The "show link preview" button | on | `MODULE_LINK_PREVIEWS=off` |
| `embeds` | Video, audio and 3D players for links in posts | on | `MODULE_EMBEDS=off` |

"On, once set up" means the module is off until its env switch (and secret,
if any) is in place, exactly as before modules existed.

## How a module decides

Each module is resolved in this order. The first rule that applies wins.

1. **Env hard-off.** `MODULE_<ID>=off` (the id upper-cased, `-` becomes `_`,
   for example `MODULE_LINK_PREVIEWS=off`) turns a module off. So does a
   module's own older switch not holding its "on" value: `AUTOMOD_ENABLED`,
   `ANALYTICS_ENABLED`, `HUMAN_CHECK` and `SATURDAY_FOOLS`. Nothing in the
   desk can override an env hard-off.
2. **Setup.** A module that needs a secret stays off until it is set
   (`automod` needs `AUTOMOD_KEY`).
3. **The owner's choice** from the desk, stored in the `instance_modules`
   table (migration `0095_instance_modules.sql`).
4. **The default** in the registry.

Then **dependencies**: a module whose dependency is off is off too. Turning
`fun` off also turns `saturday-fools` off.

`MODULE_<ID>=on` does nothing: env can only switch a module off, never force
one on past the owner.

## Switching modules

### With env (hosting config)

Add a var to `[vars]` in your `wrangler.toml` and deploy:

```toml
[vars]
MODULE_CHAT = "off"
MODULE_EMBEDS = "off"
```

This is the right place for anything you never want on.

### From the desk

Owners (not admins) get a **Modules** page in the moderation desk
(`/admin/modules`). Each module has a switch with a short description.
A switch the server decides (an env hard-off, missing setup, or the
read-only human check) is shown but disabled. The page warns what a module
needs and what turning it off also turns off.

The desk uses `GET /api/admin/modules` and `PUT /api/admin/modules` with
`{"id": "chat", "enabled": false}`. Both are owner-only; the write needs the
CSRF token and is rate limited.

### For clients

`GET /api/site` is public and returns `{"modules": [...]}`: the ids of the
modules that are on. It never includes env names, secrets or who changed
what. The page shell also carries `<meta name="site-modules-off">` listing
the browser-side modules that are off (no meta when none are), which
`public/js/site-modules.js` reads without a network request.

## The rule for new features

Every **new** feature, including every Discourse-parity feature, ships as a
module with default "off". A self-hoster gets nothing they did not ask for;
the owner turns it on from the desk. Anything that sends data to a third
party stays default "off" forever.

A new module needs:

1. an entry in `MODULES` in `api/core/modules.mjs` (`id`, `labelKey`,
   `descriptionKey`, `default: "off"`, `deps`, the API `paths` it owns, and
   `client: true` if it has browser code);
2. its label and description in every `public/locales/*.json`;
3. tests for both states: off answers `404` and loads nothing in the
   browser; on works.

Its tables are created by a normal migration on every deployment, whether
the module is on or not, so turning it on later needs no migration.
