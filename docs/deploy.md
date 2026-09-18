# Deploying HFM

The application is a standard Next.js 16 app. It needs a host that runs Node
(Vercel is the path of least resistance) and the Supabase project it already
talks to.

## 1. Environment variables

| Variable | Where | Why |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | build + runtime | Project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | build + runtime | Publishable key. Safe in the browser: every query is still evaluated by RLS. |
| `NEXT_PUBLIC_SITE_URL` | runtime | Public origin, e.g. `https://hfm.suaempresa.com`. Used to build the links in the invitation and recovery e-mails. |
| `SUPABASE_SERVICE_ROLE_KEY` | runtime, server only | Optional. Enables the official invitation API. Without it access can still be granted — the account is created with a random secret nobody holds and the person sets their own password through the recovery e-mail. |

Never expose the service-role key to the browser: it bypasses RLS. On Vercel,
add it as a plain (non-`NEXT_PUBLIC_`) environment variable.

## 2. Vercel

1. Import the repository.
2. Add the variables above (Production and Preview).
3. Deploy. No build command override is needed; `npm run build` is correct.

`npm run build` deliberately does **not** enable `/dev/design-system`: that
route only exists in a build made with `NEXT_PUBLIC_ENABLE_DEV_PAGES=1`
(`npm run build:ui-test`).

## 3. Supabase configuration

In the dashboard, under **Authentication → URL Configuration**:

- **Site URL**: the same value as `NEXT_PUBLIC_SITE_URL`.
- **Redirect URLs**: add `https://<your-domain>/auth/confirm`. Invitation and
  recovery links land there; without it Supabase refuses the redirect.

Under **Authentication → Providers → Email**, keep e-mail confirmations on.

Recommended, and currently off: **Authentication → Policies → leaked password
protection**, which checks new passwords against HaveIBeenPwned.

The default Supabase mail sender is rate-limited and fine for a pilot. For real
use, configure SMTP so invitations are not throttled.

## 4. Database

Schema changes are versioned in `supabase/migrations/` and already applied to
the linked project. For a new environment:

```bash
supabase link --project-ref <ref>
supabase db push
```

## 5. First administrator

`public.create_organization()` requires a platform admin or a privileged
context, so the first organization is created once from the SQL editor (or with
the service-role key), never from the application. From then on every other
account is provisioned through Administration → Users.

## 6. Retention

`public.purge_expired_import_batches()` deletes import staging older than
`expires_at` (30 days). It is service-role only; schedule it with pg_cron or an
Edge Function so raw personal data does not linger.
