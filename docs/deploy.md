# Deploying HFM

The application is a standard Next.js 16 app. It needs a host that runs Node
(Vercel is the path of least resistance) and the Supabase project it already
talks to.

## 0. Current environment

| | |
| --- | --- |
| Public URL | `https://horizonte-fleet-management.vercel.app` |
| Vercel project | `horizonte-fleet-management` (Hobby) |
| Supabase project | `jgyvaltwqntpcjqounty`, region `sa-east-1` |
| Function region | `gru1` (São Paulo) — next to the database |

## 1. Environment variables

| Variable | Where | Why |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | build + runtime | Project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | build + runtime | Publishable key. Safe in the browser: every query is still evaluated by RLS. |
| `NEXT_PUBLIC_SITE_URL` | runtime | Public origin. Used to build the links in the invitation and recovery e-mails. Only set it on Production: on Preview the origin changes per deployment, and `siteOrigin()` then falls back to the request headers, which is the right value. |
| `SUPABASE_SERVICE_ROLE_KEY` | runtime, server only | Optional, **not set**. Enables the official invitation API. Without it access can still be granted — the account is created with a random secret nobody holds and the person sets their own password through the recovery e-mail. |

The `NEXT_PUBLIC_` prefix is not decoration: those three are read in the
browser, so they have to be inlined at build time. The Supabase↔Vercel
integration also installs `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_PROJECT_ID`; the application does not read them and they are left
untouched.

Never expose the service-role key to the browser: it bypasses RLS. On Vercel,
add it as a plain (non-`NEXT_PUBLIC_`) environment variable.

## 2. Vercel

1. Import the repository.
2. Add the variables above (Production and Preview).
3. Deploy. No build command override is needed; `npm run build` is correct.

`npm run build` deliberately does **not** enable `/dev/design-system`: that
route only exists in a build made with `NEXT_PUBLIC_ENABLE_DEV_PAGES=1`
(`npm run build:ui-test`).

**Deployment protection** (Settings → Deployment Protection) is set to
*Vercel Authentication — Preview only*. Production has to be publicly
reachable: the application has its own authentication, and RLS is the real
boundary. Previews stay behind the Vercel login so a half-finished branch is
never a public URL.

## 3. Supabase configuration

In the dashboard, under **Authentication → URL Configuration**:

- **Site URL**: `https://horizonte-fleet-management.vercel.app`.
- **Redirect URLs**: add `https://horizonte-fleet-management.vercel.app/auth/confirm`.
  Invitation and recovery links land there; without it Supabase refuses the
  redirect and the person cannot set a password.

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

That bootstrap is done: the organization exists and one account is attached to
it. There is no seeded password anywhere — the first access goes through
**Esqueci minha senha** on `/login`, which sends the recovery link. This only
works once the two Supabase URL settings in §3 are in place.

### The NULL-token trap

That first account was created with a direct SQL `INSERT`. Supabase's
`auth.users` has **no `DEFAULT ''`** on `confirmation_token`, `recovery_token`,
`email_change` and `email_change_token_new`, so omitting them stores `NULL` —
and GoTrue scans those columns into a non-nullable Go `string`. One `NULL` makes
**every** `/token` and `/recover` call for that user fail with HTTP 500
(`error finding user: converting NULL to string is unsupported`), before any
token is generated and before SMTP is ever reached. It looks exactly like "the
e-mail is not arriving".

Any row written into `auth.users` outside the Auth API must set all eight token
columns to `''`. `tests.new_user` in `supabase/tests/helpers/install.sql` does.
Prefer the Auth API; when you cannot, check afterwards:

```sql
select count(*) from auth.users
 where confirmation_token is null or recovery_token is null
    or email_change is null or email_change_token_new is null;
```

### Sign-in identity

Supabase Auth identifies an account by an e-mail or a phone number and by
nothing else. The base is split in two, and `business_profiles.login_method`
says which half a person is in:

| `login_method` | Profiles | People | Signs in with |
| --- | --- | --- | --- |
| `employee_code` | Operacional | 123 | the matrícula |
| `email` | the other six | 20 | the registered corporate e-mail |

The split is exact: every Operacional employee has no e-mail, and every
employee on another profile has one. It is a stored column, not a match against
the profile's name — renaming "Operacional" would otherwise lock 123 people out
in silence.

A matrícula is carried by a derived login address, `<matrícula>@<HFM_LOGIN_DOMAIN>`,
defaulting to `<namespace>.invalid`. RFC 2606 §2 reserves the `.invalid` TLD for
names that must never resolve, so the address is provably undeliverable and no
DNS work is needed. It is not a contact address and is never displayed as one;
`employees.corporate_email` stays NULL for those 123 people.

Point `HFM_LOGIN_DOMAIN` at a real subdomain only after publishing a null MX
(`MX 0 .`) and `v=spf1 -all` on it, or a mailbox could one day exist at an
address the product treats as unreachable.

The address is derived, never looked up. A resolver endpoint would answer "does
matrícula 140349 exist?" to anyone who asked, and the codes are sequential.
