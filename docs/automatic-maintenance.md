# Automatic maintenance mode

The forum can switch itself to a static maintenance response when its core
loading path is repeatedly unhealthy, then restore normal service after
recovery.

## Behaviour

- A scheduled probe runs once per minute.
- The probe checks D1 with `SELECT 1`, the HTML shell, the browser entry
  module (`/js/app.js`) and the real `/api/version` route.
- Three consecutive failed probes activate automatic maintenance mode.
- Three consecutive successful probes clear automatic maintenance mode.
- While active, ordinary requests receive the maintenance page with HTTP 503,
  `Cache-Control: no-store` and `Retry-After: 300`. The page's CSS and
  JavaScript remain available.
- The state is stored as one small JSON object in the dedicated
  `wempos-forum-health` R2 bucket. It contains only probe streaks and
  timestamps, never forum or member data.

## Manual override

Set the Worker variable `MAINTENANCE_MODE` to `on` to force maintenance
immediately. The manual override takes priority over automatic recovery.
Unset the variable or set it to `off` to return to automatic control.

## Self-hosting

Create an R2 bucket, bind it as `MAINTENANCE_STATE`, and enable the Cron
trigger shown in `wrangler.example.toml`. The bucket name can be changed as
long as the binding name remains `MAINTENANCE_STATE`.

## Limits

This is an application-level fail-safe. It detects repeated failures in the
forum's core Worker, D1 and static-asset readiness path. It cannot display a
maintenance page if Cloudflare itself cannot route the request, or if the
Worker cannot start at all (for example, a broken deployment that fails to
load its module graph). A failed read/write to the state bucket is fail-open:
the forum continues serving normally rather than taking the site offline
because the monitor's own storage is unavailable.
