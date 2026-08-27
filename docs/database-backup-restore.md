# Database backup & emergency restore

Daily off-server backups of the production Supabase database, and the
exact steps to recover from one in a real incident — not a theoretical
exercise. Read the "Emergency restore" section once, calmly, before you
ever need it; you should not be reading it for the first time during
an actual incident.

## How the backup works

`.github/workflows/backup.yml` runs once a day (default: 08:00 UTC ≈
03:00 Ecuador time) on GitHub's own runners — **not** on the Easypanel
server that runs the app. It:

1. Runs `pg_dump` against the production database's **direct**
   connection string (custom format, `--schema=public` only — see
   [Why `--schema=public` only](#why---schemapublic-only) below).
2. Uploads the dump to a Cloudflare R2 bucket, under the `daily/`
   prefix, named `wacrm-backup-<UTC timestamp>.dump`.
3. Relies on an R2 **Lifecycle Rule** (configured once, in the
   Cloudflare dashboard — not in code) to delete objects older than 30
   days. See [One-time R2 setup](#one-time-r2-setup).

`pg_dump` only *reads* the source database — running the workflow,
including a manual test run, can never modify or corrupt production
data. There is nothing here to be cautious about on the *backup* side;
all the risk in this system is on the *restore* side, which is why the
rest of this document is so explicit about it.

### Why `--schema=public` only

This app's own tables (contacts, deals, messages, …) all live in the
`public` schema — no migration in `supabase/migrations/` creates
another one. Supabase's own `auth`, `storage`, `realtime`, etc. schemas
are deliberately **excluded** from the dump: those are managed by
Supabase itself on every project, and blindly restoring them onto a
different (e.g. temporary recovery) project would fight with what
Supabase already provisions there. You are backing up *your business
data*, not Supabase's internal plumbing — Supabase's own infrastructure
already has its own durability story for that.

## One-time setup

You only need to do this once. After it's done, the workflow runs
itself.

### 1. Get the Postgres connection string

Supabase dashboard → your project → the green **"Connect"** button (top
of the dashboard) → **Connection Method**.

Normally "Direct connection" is preferred for a long-lived process, but
**use "Session pooler" instead for this workflow**: GitHub-hosted
runners don't have IPv6 egress, and Supabase's direct connection is
IPv6 by default (see the "Direct connections use IPv6 by default"
notice in that same panel) — a direct connection from a GitHub Actions
job will simply time out. Session pooler supports IPv4 and, unlike
"Transaction pooler", still holds one dedicated backend connection per
client for the duration, so `pg_dump`'s session-level assumptions don't
break the way they would over a transaction-mode pooler.

Select the **"Session pooler"** tab, copy the URI, and replace
`[YOUR-PASSWORD]` with your actual database password (reset it from
**Database → Settings** if you don't have it saved — resetting it does
**not** affect the app's `SUPABASE_SERVICE_ROLE_KEY` or anon key, it's a
separate credential).

It looks like:

```
postgresql://postgres.xxxxxxxxxxxx:YOUR-PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres
```

(Note the username is `postgres.<project-ref>`, not just `postgres` —
that's how the pooler knows which project to route to.)

### 2. Create the R2 bucket

1. Cloudflare dashboard → **R2** → **Create bucket**. Name it (e.g.
   `wacrm-backups`). Any location hint is fine.
2. **R2 → Manage API tokens → Create API token** — scope it to this
   one bucket, with **Object Read & Write** permission. Save the
   **Access Key ID** and **Secret Access Key** it shows you — R2 only
   shows the secret once.
3. Note your **Account ID** (shown on the R2 overview page, or in the
   right sidebar of the main Cloudflare dashboard).
4. **Bucket → Settings → Lifecycle rules → Add rule**: apply to
   objects with prefix `daily/`, action "Delete", age **30 days**.
   This is what enforces retention — there is no deletion code in the
   workflow, so this step is not optional.

### 3. Add the GitHub Actions secrets

Repo → **Settings → Secrets and variables → Actions → New repository
secret**. Add all five:

| Secret name | Value |
|---|---|
| `SUPABASE_DB_URL` | The direct connection string from step 1 |
| `R2_ACCOUNT_ID` | Your Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | From the R2 API token |
| `R2_SECRET_ACCESS_KEY` | From the R2 API token |
| `R2_BUCKET_NAME` | The bucket name from step 2 (e.g. `wacrm-backups`) |

These are **GitHub secrets, not Easypanel environment variables** —
this backup system never touches the app's own deployment or `.env`.
There is nothing to add in Easypanel for this feature.

### 4. Run it once, manually

Repo → **Actions** tab → **Database Backup** (left sidebar) → **Run
workflow** → confirm. This is the same "safe to run any time" workflow
described above — it only reads production, then writes to R2. Confirm
it goes green, then check the R2 bucket for the new `daily/wacrm-backup-…dump`
object.

## Testing a real restore (do this before you trust the system)

A backup that has never been restored is not a backup you can trust.
Do this once, right after setup, on a **throwaway** Supabase project —
never on production.

1. **Create a temporary Supabase project**: supabase.com dashboard →
   New project → any name (e.g. `wacrm-restore-test`) → any region. It
   has its own free tier; you'll delete it when done.
2. **Enable the `vector` extension** on the new project: **Database →
   Extensions** → search `vector` → enable. Without this, the restore
   errors out on `ai_knowledge_chunks` (`type "public.vector" does not
   exist`) and that table is silently skipped for the rest of the run.
   (`uuid-ossp`, the only other extension this app uses, is enabled by
   default on every new Supabase project — nothing to do there.)
4. **Get its direct connection string** the same way as step 1 above.
5. **Download the backup** you want to test (swap in the real object
   key):

   ```bash
   aws s3 cp \
     "s3://wacrm-backups/daily/wacrm-backup-2026-08-27T08-00-00Z.dump" \
     ./restore-test.dump \
     --endpoint-url "https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com"
   ```

   (Needs `aws-cli` installed locally, and `AWS_ACCESS_KEY_ID` /
   `AWS_SECRET_ACCESS_KEY` env vars set to the same R2 API token from
   setup step 2. Or just download it by hand from the R2 bucket browser
   in the Cloudflare dashboard — no `aws-cli` needed either way.)

6. **Restore into the temp project**:

   ```bash
   pg_restore \
     --dbname="postgresql://postgres:TEMP-PROJECT-PASSWORD@db.xxxxxxxxxxxx.supabase.co:5432/postgres" \
     --no-owner \
     --no-privileges \
     --clean \
     --if-exists \
     ./restore-test.dump
   ```

   `--no-owner --no-privileges`: the dump's role names won't exist on
   the new project, so restoring ownership/grants verbatim would just
   produce noisy errors — the data and schema restore fine without
   them. `--clean --if-exists`: drops each object before recreating it,
   so the command is safe to re-run.

   **Expect this to exit with an error code and a wall of `pg_restore:
   error` lines — that alone does not mean the restore failed.** Every
   table in this schema that has a column referencing `auth.users(id)`
   (`contacts.user_id`, `deals.user_id`, `accounts.owner_user_id`, …)
   will fail to re-add that one foreign key constraint, because the
   dump deliberately excludes the `auth` schema (see [Why
   `--schema=public` only](#why---schemapublic-only)) and a fresh
   project's `auth.users` has different rows than production's. This is
   expected and harmless: `pg_restore` loads each table's actual data
   *before* it tries to re-add constraints, so the real rows are already
   in place by the time these specific errors show up. Confirm this
   with the next step rather than assuming a failed exit code means a
   failed restore.

7. **Verify real data is there** — don't just eyeball it, count it:

   ```bash
   psql "<temp-project-connection-string>" -c "
     SELECT 'contacts' AS t, count(*) FROM public.contacts
     UNION ALL SELECT 'deals', count(*) FROM public.deals
     UNION ALL SELECT 'conversations', count(*) FROM public.conversations
     UNION ALL SELECT 'messages', count(*) FROM public.messages;"
   ```

   Row counts should roughly match what you'd expect from production.
   Also open the temp project's Table Editor and spot-check a couple of
   specific rows you recognize.
8. **Delete the temp project** (Project Settings → General → Delete
   project) once you've confirmed it. Do this every few months as a
   standing drill, not just once.

## Emergency restore (real incident)

Follow this in order. Don't skip the "why" callouts under pressure —
they're the parts that prevent a second mistake on top of the first.

### 1. Identify which backup to use

You want the **most recent backup from *before* the moment the problem
was introduced or discovered** — not necessarily the newest one
available (if bad data has been in production for a while, the newest
backup might already contain it).

List what's available, newest first:

```bash
aws s3 ls "s3://wacrm-backups/daily/" \
  --endpoint-url "https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com" \
  | sort -r
```

Object names are ISO-8601 timestamps (`wacrm-backup-2026-08-27T08-00-00Z.dump`),
so they sort chronologically as plain text. Pick the one dated before
the incident.

### 2. Download it

```bash
aws s3 cp \
  "s3://wacrm-backups/daily/<the-file-you-picked>.dump" \
  ./emergency-restore.dump \
  --endpoint-url "https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com"
```

### 3. Do NOT restore it onto production

**Restoring straight over the live database would overwrite every
real row created or changed since that backup was taken** — every
message, deal, and contact from customers between the backup time and
now would be destroyed to "fix" a smaller problem. This is true even
with `--data-only` or single-table restores if you're not extremely
careful about direction.

The correct process is always: **restore the backup into a separate,
temporary project, extract only the specific rows you actually need,
then insert *those* back into production.** Production itself is never
the restore target.

### 4. Restore into a fresh temporary Supabase project

Same as the [testing steps above](#testing-a-real-restore-do-this-before-you-trust-the-system):
create a new throwaway project, **enable the `vector` extension on it**
(Database → Extensions — otherwise `ai_knowledge_chunks` fails to
restore), get its direct connection string, and:

```bash
pg_restore \
  --dbname="<temp-project-direct-connection-string>" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  ./emergency-restore.dump
```

This will exit with an error and print a long list of `pg_restore:
error` lines about foreign keys to `auth.users` — that's expected (see
the callout in the testing section above) and does not mean the data
failed to load. Verify with the row-count query from step 7 of the
testing section before assuming anything is wrong.

### 5. Extract exactly what was lost — nothing else

Work out precisely which rows are missing/wrong (which contact, which
deal, which message thread) and pull only those. Two ways to do it,
depending on how much you need:

**A handful of specific rows** — query them out as `INSERT`
statements you can review before running:

```bash
psql "<temp-project-connection-string>" -c "\copy (
  SELECT * FROM contacts WHERE id = '<the-missing-contact-id>'
) TO STDOUT" > missing_contact.csv
```

then load that CSV into production the same way, once you've
eyeballed it:

```bash
psql "<production-direct-connection-string>" -c "\copy contacts FROM STDIN CSV" < missing_contact.csv
```

**A whole table's worth of missing rows** (e.g. every deal created in
a bad window) — filter by the column that identifies them (usually
`created_at`), same `\copy ... TO` / `\copy ... FROM` pair, scoped to
that `WHERE` clause.

Either way: **always target the smallest set of rows that actually
need restoring.** If a row already exists in production (e.g. a
contact that wasn't touched by the incident), re-inserting it will
either error on the primary key or, worse, silently duplicate data —
add `ON CONFLICT (id) DO NOTHING` to the production-side `INSERT` if
there's any chance of overlap:

```sql
-- If loading via a generated INSERT instead of \copy, wrap it like this:
INSERT INTO contacts (id, account_id, phone, name, created_at, ...)
VALUES (...)
ON CONFLICT (id) DO NOTHING;
```

### 6. Clean up

Delete the temporary Supabase project once you've confirmed production
looks right (next section). Don't leave it running with a copy of real
customer data sitting in it.

### 7. Verification checklist

Go through all of these before considering the incident closed:

- [ ] The specific row(s)/record(s) that were lost are now visible in
      production (Table Editor, or a targeted `SELECT`) with the
      expected values.
- [ ] No **duplicate** rows were introduced (spot-check row counts on
      the affected table before/after, or re-run the same `SELECT`
      that found the problem — it should now come back clean).
- [ ] Foreign-key relationships still make sense — e.g. a restored
      `deals` row still points at a `contact_id` that actually exists;
      a restored `messages` row's `conversation_id` still resolves.
- [ ] The app itself, in the browser, shows the recovered data where a
      real user would look for it (the contact's page, the pipeline
      board, the inbox thread) — not just correct in a raw query.
- [ ] The temporary Supabase project used for the restore has been
      deleted.
- [ ] A note of what happened and what was restored is written down
      somewhere (even just a comment on the relevant support/incident
      thread) for future reference.
