# Running with Docker

The repo ships a multi-stage `Dockerfile` (Next.js standalone output,
runs as a non-root user) and a `docker-compose.yml` with a single
`app` service. Supabase is external — point the app at your hosted
(or self-hosted) Supabase project via env vars; no database container
is included.

## Quick start

1. Copy the env template and fill it in:

   ```bash
   cp .env.local.example .env.local
   ```

2. Build and start (the `--env-file` flag is required — Compose only
   reads `.env` by default for `${VAR}` substitution, and this project
   keeps its config in `.env.local`):

   ```bash
   docker compose --env-file .env.local up --build -d
   ```

3. The app is served on [http://localhost:3000](http://localhost:3000)
   (publish it elsewhere with `HOST_PORT=8080` in `.env.local`).

> Use `HOST_PORT`, not `PORT`, to move the published port. `PORT` is
> what the server listens on _inside_ the container, and `env_file`
> would inject it there — leaving the app on a port the mapping and
> the healthcheck don't target. Compose pins it to 3000 for that
> reason.

## Build-time vs runtime variables

- `NEXT_PUBLIC_*` variables are **inlined into the client bundle at
  build time**. They are passed as Docker build args by
  `docker-compose.yml`. If you change any of them, rebuild:
  `docker compose --env-file .env.local up --build -d`.
- Everything else (`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`,
  `META_APP_SECRET`, …) is read at **runtime** from `.env.local` via
  `env_file` and is never baked into the image — safe to change with
  just a container restart.

## Plain Docker (no Compose)

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t wacrm .

docker run -d --env-file .env.local -e PORT=3000 -p 3000:3000 wacrm
```

## Agency panel as a standalone EasyPanel service

The super-admin panel (`/agency`) can run as a **second, separate
service** on your EasyPanel instance instead of sharing a domain with
the client-facing app — e.g. `agencia.tudominio.com` for you, while
clients only ever see `app.tudominio.com`. The app already knows how
to do this (`src/proxy.ts`'s `AGENCY_STANDALONE_MODE` check) — nothing
in the repo needs to change, this is purely an EasyPanel configuration
step:

1. In EasyPanel, create a **new App service** (not a fork of the
   existing one — a second, independent service) pointed at the same
   Git repo/branch as your main `wacrm` deployment. It builds from the
   same `Dockerfile`, so no separate image to maintain.
2. Set every env var the main service has (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ENCRYPTION_KEY`, `SUPER_ADMIN_USER_ID`, etc. — same Supabase
   project, so both services see the same data) **plus**:
   ```
   AGENCY_STANDALONE_MODE=true
   ```
3. Assign it its own domain/subdomain in EasyPanel (with SSL, same as
   the main app).
4. Deploy. Visiting any path other than `/login`, `/agency`,
   `/forgot-password`, `/reset-password` (or their supporting
   `/api/agency/*`, `/api/locale`, `/auth/callback` routes) on this
   domain redirects to `/agency` (signed in) or `/login` (signed out)
   — see `src/proxy.ts`'s `AGENCY_STANDALONE_EXACT_PATHS`. Signing in
   still goes through the normal Supabase email/password flow; access
   itself is gated by `SUPER_ADMIN_USER_ID` matching the signed-in
   user (`requireSuperAdmin()`), not by which domain served the
   request — misconfiguring this env var never grants access, it only
   changes which URL you'd use to reach the panel.

## Notes

- Database migrations under `supabase/` are **not** run by the
  container — apply them with the Supabase CLI as described in the
  README.
- Nothing inside the container is scheduled. If you use automation
  Wait steps or flows, point an external scheduler at
  `GET /api/automations/cron` and `GET /api/flows/cron` on this
  deployment, sending the shared secret in the `x-cron-secret` header
  (`AUTOMATION_CRON_SECRET`, see `.env.local.example`). Both return
  503 until that variable is set.
- Same story for HOT-lead response-time alerts (migration 040):
  point the scheduler at `GET /api/cron/hot-lead-alerts` too, same
  `x-cron-secret` header and `AUTOMATION_CRON_SECRET`. Every 5 minutes
  is the recommended interval — tight enough that a per-account
  threshold of a few minutes is still meaningful, without hammering
  the DB. Set an account's `hot_lead_alert_minutes` to `0` to opt it
  out of the scan entirely.
- Same story for AI auto-reply auto-resume (migration 068): point the
  scheduler at `GET /api/cron/ai-auto-resume` too, same `x-cron-secret`
  header and `AUTOMATION_CRON_SECRET`, every 5 minutes. Off by default —
  it only does anything for an account that set
  `auto_resume_after_minutes` in Settings → AI Assistant.
- Same story for automatic Seguimiento follow-up (migration 077/078):
  point the scheduler at `GET /api/cron/followup-stage` too, same
  `x-cron-secret` header and `AUTOMATION_CRON_SECRET`, every 5 minutes.
  It only moves deals for accounts that (a) have a pipeline stage
  marked "Seguimiento" and (b) have `followup_after_hours` set above 0
  in Settings → AI Assistant (default 24).
- Same story for the sales-intelligence Risk Engine (migration 091):
  point the scheduler at `GET /api/cron/sales-intelligence` too, same
  `x-cron-secret` header and `AUTOMATION_CRON_SECRET`, every 5 minutes.
  Recomputes the same six checks already shown on the CEO dashboard's
  alert cards for every active account and keeps `sales_signals` in
  sync — no UI reads that table yet (fase 1 only), so skipping this
  cron for now costs nothing visible, but wiring it up early means the
  signal history is already accumulating once the Sales Command Center
  (a later fase) ships.
- Same story for the Promise Tracker (migration 092): point the
  scheduler at `GET /api/cron/promise-tracker` too, same
  `x-cron-secret` header and `AUTOMATION_CRON_SECRET`, every 5 minutes.
  Sweeps overdue promises and scans new agent messages for verbal
  commitments — only sends a message to the account's configured AI
  provider when it already matched a cheap keyword filter, never one
  call per message. Skipping this cron just means promises never get
  detected; it costs nothing else.
- Same story for calendar reminders (migration 057/079): point the
  scheduler at `GET /api/cron/event-reminders` too, same
  `x-cron-secret` header and `AUTOMATION_CRON_SECRET`, every 5 minutes.
  Raises each event's in-app reminder and, for appointments, the
  customer's WhatsApp reminder. Without it no reminder is ever sent.
- Same story for "lead going cold" alerts (migration 050): point the
  scheduler at `GET /api/cron/lead-staleness-alerts` too, same
  `x-cron-secret` header and `AUTOMATION_CRON_SECRET`, every 5 minutes
  (the first tier fires at 5 minutes unanswered).
- Full list of crons to schedule, all every 5 minutes with the same
  header: `/api/automations/cron`, `/api/flows/cron`,
  `/api/cron/hot-lead-alerts`, `/api/cron/ai-auto-resume`,
  `/api/cron/followup-stage`, `/api/cron/sales-intelligence`,
  `/api/cron/promise-tracker`, `/api/cron/event-reminders`,
  `/api/cron/lead-staleness-alerts`, `/api/cron/archive-media`,
  `/api/cron/webhook-retry` (this one every 1–2 minutes).
- `/api/cron/webhook-retry` (migration 112) re-runs inbound WhatsApp /
  Zernio / Messenger events that a restart or deploy interrupted after
  the provider already got its 200 — without it such an event is lost,
  since the provider never redelivers an acked webhook.
- `/api/cron/archive-media` (migration 111) copies recent customer
  photos / videos / voice notes into the private `inbound-media`
  bucket when the webhook's inline copy missed them — Meta deletes its
  copy after ~30 days, so without it old media stops loading.
- Database backups are the one exception to "point an external
  scheduler at this deployment" — they run as a GitHub Actions
  workflow instead (`.github/workflows/backup.yml`), deliberately
  outside this container so a daily `pg_dump` never competes with live
  traffic for CPU/network on the same box. See
  `docs/database-backup-restore.md` for setup and the emergency
  restore runbook.
