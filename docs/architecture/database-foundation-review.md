# Database foundation — review outcome (Etapa 01)

A six-lens adversarial review (tenant isolation, privilege escalation, PostgreSQL correctness, data integrity,
Supabase pitfalls, performance) produced 35 candidate findings against the draft migrations. Each one was triaged
before the schema was applied. This file records what changed and what was deliberately left as is.

## Fixed before applying

| Area | Defect | Fix |
| --- | --- | --- |
| Privilege escalation | `members.manage` could grant a role more powerful than the actor's own (indirect self-promotion to `org_admin`). | `private.role_within_actor_permissions()`: a role can only be assigned if the actor holds every permission it grants. |
| Privilege escalation | Archiving a role, or removing a member, left `membership_roles` rows behind; restoring either re-granted the old privileges. | Triggers delete the assignments on both transitions. |
| Privilege escalation | `roles.manage` could set `is_editable = false` and freeze a role permanently. | The flag is platform-managed; tenant updates are rejected. |
| Privilege escalation | `created_by` / `updated_by` were client-forgeable on INSERT. | Authorship is always taken from `auth.uid()` when a caller is authenticated. |
| Tenant isolation | `*.manage` without `*.view` could not manage: the RBAC policies read protected tables through plain subqueries, which run under the caller's own RLS. | Dedicated SECURITY DEFINER helpers (`can_view_membership`, `can_manage_membership_role`, `can_view_role`, `can_manage_role`, `can_grant_permission`). |
| Tenant isolation | An `organization.manage` holder could suspend or archive the whole tenant and lock every member out. | The organization lifecycle is platform-only, enforced by `private.tg_organizations_guard()`. |
| Correctness | `vehicle_status_history.changed_by` had `ON DELETE SET NULL` against an append-only table, so deleting an `auth.users` row failed. | The column carries no foreign key, like `audit_logs`. |
| Correctness | The same append-only trigger blocked the `CASCADE` from a hard-deleted vehicle. | The foreign key is `RESTRICT`: history is never destroyed by removing the vehicle row. |
| Correctness | `tg_set_stamps` re-pinned `created_by` on every UPDATE, defeating `ON DELETE SET NULL` from `auth.users`. | Privileged contexts may clear it; application users still cannot rewrite it. |
| Correctness | Two guard triggers were SECURITY INVOKER and could not call a private helper (found by the test suite, after apply). | Both are SECURITY DEFINER. |
| Audit | Rows for `organizations`, `membership_roles` and `role_permissions` landed with a NULL `organization_id`, invisible to tenant `audit.view` holders, and with no `entity_id` for the composite-key tables. | `tg_audit()` resolves the tenant for those tables and builds a composite `entity_id`. |
| Integrity | Soft-delete guards only ran on UPDATE, so a row could be INSERTed already archived without the archive permission. | The guards run on INSERT as well. |
| Integrity | Units and cost centers without a code had no uniqueness at all. | Unique per tenant by name as well as by code. |
| Integrity | An active vehicle, driver or cost center could reference an archived parent. | `private.assert_parent_active()` on insert and whenever the reference changes. |
| Integrity | A tenant catalog entry could shadow a global make or model. | Guard triggers reject the duplicate. |
| Integrity | 9-digit and 11-digit spellings of the same RENAVAM escaped the unique index. | Normalized: zero-padded to 11 digits. |
| Integrity | `organizations` carried two independent encodings of the same lifecycle fact (`status = 'archived'` and `deleted_at`). | A CHECK constraint ties them together. |
| Integrity | A user without a `profiles` row was locked out of every organization (the RLS helpers inner-join it). | Creating a membership creates the profile if it is missing. |
| Privileges | `authenticated` kept `TRUNCATE`, `REFERENCES` and `TRIGGER` on every table (Supabase grants ALL by default). | Revoked. |
| Privileges | Supabase's inherited `public.rls_auto_enable()` was callable through the API. | `EXECUTE` revoked from `public`, `anon` and `authenticated`. |
| Performance | Two composite foreign keys had no covering index (`cost_centers → organization_units`, `vehicle_status_history → vehicles`). | Both indexes now lead with `organization_id`. |

## Accepted, documented trade-offs

- **`created_by` / `updated_by` / `deleted_by` are not indexed.** They are never query predicates; the only cost is a
  scan when an `auth.users` row is deleted, which is rare. ~25 extra indexes would tax every write instead.
- **`outbox_events` has RLS enabled and no policy.** That is the intent: only `service_role` workers touch it.
- **`create_organization` is a SECURITY DEFINER function callable by `authenticated`.** It authorizes internally
  (platform admin or `service_role`) and raises otherwise; it has to be callable to be usable.
- **Restoring an archived row whose business key was reused fails with a raw `unique_violation`.** The partial unique
  indexes are the correct guarantee; surfacing a friendlier error belongs to the application layer.
- **An invitation can only be created for a user who already exists in `auth.users`.** Invitations to unregistered
  e-mail addresses need their own table and flow; it is deliberately out of scope for this stage.
- **`drivers.user_id` is not required to have a membership in the driver's organization.** A driver is an operational
  entity that may be linked to a login before (or without) being granted access.
