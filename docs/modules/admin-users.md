# Administration · Users

First functional structure of HFM. It manages the corporate people base, the
optional system accounts on top of it, and the operation scope that every
future module will reuse.

## 1. Objective

One place to answer three different questions that are routinely conflated:

- **Who works here?** The employee directory, imported from the corporate base.
- **Who can sign in?** HFM accounts, granted one at a time and on purpose.
- **What may each account read?** Roles (what they can do) and operation scope
  (whose data they can do it to).

## 2. Employee vs auth user

```
employees ──optional──▶ organization_memberships.employee_id ──▶ auth.users
```

An employee is a person in the corporate base. Of the 144 rows in the reference
file, 124 have no e-mail at all, so creating an account for each would be both
impossible and wrong. The rules that follow from that:

- An employee is registered with **no e-mail and no account**.
- An e-mail is required only to **provision access**, because Supabase Auth
  identifies a user by it.
- The link lives on the **membership**, not on the profile: one auth user may
  belong to several organizations and is a different employee in each.
- Employment situation (`employment_status`) and access state (`access_status`)
  are separate. Someone can be active in the company with no access, and an
  account can be suspended while the person keeps working.

## 3. Entities

| Table | Role |
| --- | --- |
| `employees` | Corporate people base. `employee_code` (matrícula) is the business key, unique per organization. |
| `employee_private_data` | CPF and birth date. Separate table, separate permission, redacted from the audit trail. |
| `driver_licenses` | CNH. Optional; one live record per employee. |
| `employee_assignments` | Position, area, operation, unit, location, organizational profile and manager, over time. One row per employee is `is_current`. |
| `job_positions`, `employment_areas`, `work_locations`, `business_profiles` | Catalogues, deduplicated by an accent- and case-insensitive normalized label. |
| `operations` | Minimal master data for the future Operations module; already the axis of the access scope. |
| `organization_units` | Reused for "Filial" — the existing structure was semantically the right one. |
| `membership_operation_scopes` | Which operations an account may read. |
| `access_profile_mappings` | Optional, administrator-approved suggestion from an imported profile to an HFM role. Never applied by an import. |
| `import_batches`, `import_rows`, `import_errors` | Import staging with retention. |
| `employee_directory` (view) | Read model of the module. `security_invoker`, so every policy still applies. |

Position and unit arrive as `"462 - Auxiliar De Estoque"` and are split into
code + name. Manager arrives as a name and becomes `manager_employee_id`.

## 4. Permissions

`users.view`, `users.view_sensitive`, `users.create`, `users.update`,
`users.archive`, `users.import`, `users.export`, `users.export_sensitive`,
`users.invite`, `users.manage_access`, `users.manage_roles`,
`users.manage_operation_scope`, `users.bulk_manage`, `users.audit_view`,
`users.manage_master_data`, `operations.view`, `operations.manage`,
`operations.access_all`.

`org_admin` holds all of them. `fleet_manager` and `leadership` read the
directory; `leadership` also holds `operations.access_all` and the history.
`operator` and `viewer` only see the operations catalogue.

The sidebar hides the module without `users.view`, the route re-checks it
server-side, and RLS enforces it. The first two are courtesies; the third is the
boundary.

## 5. Operation scope

This is the part that every future module inherits, so it is stated once:

- **An empty scope means no operation, never "all".** Access to everything is
  the explicit `operations.access_all` permission. A forgotten scope therefore
  fails closed instead of leaking the tenant.
- `private.accessible_operation_ids()` is the single definition of the axis, and
  `private.can_access_operation(uuid)` the convenience wrapper. Frota,
  Manutenção, Pneus, Checklist and the rest scope through those, not through
  their own copy of the rule.
- Policies evaluate the axis as one InitPlan per query, not once per row.
- Two different things keep two different columns:
  `employee_assignments.operation_id` is **where the person works**;
  `membership_operation_scopes` is **what their account may read**.

Nobody edits their own access: changing your own roles, status or operation
scope is refused, in the RPC and again in a trigger.

## 6. Restricted data

CPF, birth date and licence number are restricted:

- They live outside `employees` and outside the directory view.
- Reading them needs `users.view_sensitive`; the default interface shows a
  masked CPF (`***.***.***-12`) served by `employee_masked_identifiers()`.
- Writing them is part of `users.create` / `users.update`, otherwise the people
  who fill the registration form could not fill it. Every write is audited with
  the value redacted.
- The audit trigger is attached with an explicit redaction list, verified by the
  test suite: `cpf`, `birth_date` and `license_number` never reach `audit_logs`.

## 7. Granting access

1. `prepare_employee_access()` validates everything that can be validated
   *before* an account exists: permission, e-mail, roles within the actor's own
   permissions, operations of the right tenant.
2. The server action creates or finds the auth user — `inviteUserByEmail` with a
   service-role key, otherwise `signUp` with a discarded random secret followed
   by a password-definition e-mail.
3. `grant_employee_access()` binds membership, roles and scope in one
   transaction and emits `user.access_granted`.

An administrator never sees or chooses a password. The account starts as
`invited` and becomes `active` when the person sets their own.

## 8. Import

`upload → staging → validation → preview → confirmation → persistence → audit`

The application parses the file (XLSX or CSV), recognises the 19 QLP headers,
and normalizes values: Excel date serials, `dd/mm/yyyy`, `"-"` as empty,
digit-only CPF with the leading zeros spreadsheets eat, `"code - name"` splits.
The database owns what only it can know: uniqueness, conflicts with existing
records, catalogue resolution and manager resolution.

- **The file is never stored.** It is read in memory and becomes staging rows
  that expire after 30 days — one copy of the personal data instead of two.
  `file_hash` still recognises a repeated upload and says so.
- Errors block their row; warnings do not. Both are listed before anything is
  written, and the whole batch is one transaction.
- Modes: validate only, create only, create and update. The business key is
  `organization_id + employee_code`; CPF detects conflicts.
- **An import never creates an auth user, never assigns a role and never widens
  an operation scope.** A changed "Perfil" column changes an organizational
  label, not a privilege.

## 9. Export

Respects the filters currently applied. Three layouts: the HFM base, the
original 19-column QLP format, and an empty import template. XLSX or CSV.

Restricted columns are opt-in and need `users.export_sensitive`; they are
fetched through their own policy, so without the permission the file simply
cannot contain them. Every export is recorded as `user.exported`.

## 10. Audit

`employee.created/updated/archived`, `user.access_granted/suspended/reactivated`,
`user.role_changed`, `user.operation_scope_changed`, `user.exported`,
`user.import_started/completed`. The trail is append-only: `DELETE` on
`audit_logs` is refused even for a superuser.

## 11. Known limits

- The Operations module itself is not built: only the master data the directory
  and the scope need.
- `drivers.employee_id` was added as an optional link. Nothing was migrated or
  dropped; the Drivers module decides when the employee becomes the source of
  identity.
- Organizational profile → role mapping exists as a table and is never applied
  automatically. The UI for approving a mapping comes with the Settings module.
