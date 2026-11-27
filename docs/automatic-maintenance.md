# Automatic maintenance mode

The forum can switch itself to a static maintenance response when its core
loading path is repeatedly unhealthy, then restore normal service after
recovery.

## Behaviour

- A scheduled probe runs once per minute when the Cron trigger is enabled.
- The probe checks D1 connectivity, the required `site_settings` and `users`
  tables and columns, the HTML shell, the browser entry module
  (`/js/app.js`) and the real `/api/version` route.
- Three consecutive failed probes activate automatic maintenance mode.
- Three consecutive successful probes clear automatic maintenance mode.
- While active, ordinary requests receive the maintenance page with HTTP 503,
  `Cache-Control: no-store` and `Retry-After: 300`. The page's CSS and
  JavaScript remain available.
- Monitor state is stored in one singleton row in the forum's existing D1
  database. A single atomic UPSERT records each probe, preventing overlapping
  scheduled invocations from losing streak increments or overwriting newer
  transitions. No R2 bucket or extra storage service is required.

## Manual override

Set the Worker variable `MAINTENANCE_MODE` to `on` to force maintenance
immediately. The manual override takes priority over automatic recovery.
Unset the variable or set it to `off` to return to automatic control.

## Self-hosting

Apply the forum's migrations, including
`0077_automatic_maintenance_state.sql`, and enable the Cron trigger shown
in `wrangler.example.toml`. The monitor uses the existing `FORUM_DB`
binding; no R2 bucket needs to be created or configured.

## Limits

This is an application-level fail-safe. It detects repeated failures in the
forum's core Worker, required D1 schema and static-asset readiness path. It
cannot display a maintenance page if Cloudflare itself cannot route the
request, or if the Worker cannot start at all (for example, a broken
deployment that fails to load its module graph). If the monitor's D1 state
cannot be read, the automatic gate fails open so a monitor-storage problem
does not independently take the forum offline; the manual override remains
available.
