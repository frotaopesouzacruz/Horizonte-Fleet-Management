# Perfis e permissões

Etapa 05. The module that decides what a person may do inside HFM, and the one
place in the product where the answer to "why can this person see that?" has to
be complete.

Route: `/administracao/perfis`. Permission to open it: `roles.view`.

## 1. Three things called "perfil"

They were being used interchangeably in conversation, which is how a spreadsheet
ends up promoting somebody. They are kept apart, in the data model and in the
words on screen:

| | Where it lives | What it means | Who sets it |
|---|---|---|---|
| Perfil **organizacional** | `business_profiles`, via the assignment | The person's role in the company, as the QLP base describes it | The corporate base / an import |
| Perfil **de acesso** | `membership_roles` → `roles` | What the HFM account may do | An Administrador, deliberately |
| **Escopo de operações** | `membership_operation_scopes` | Which operations the account may read | An Administrador, deliberately |

Only the second one decides authorization, and it is never derived from the
first. **"Administrador" in a spreadsheet column is a job title, not a grant.**

## 2. The seven official profiles

The codes are the stable identity every check depends on. They are fixed by a
check constraint on `public.access_profiles`: adding an eighth profile is a
migration, not a click. Names and descriptions may be adjusted; a code never
changes.

| Código técnico | Nome | Em uma frase |
|---|---|---|
| `operacional` | Operacional | Executa a operação do dia a dia; enxerga apenas as operações às quais está vinculado. |
| `seguranca` | Segurança | Acompanha segurança operacional, condutores e habilitações. |
| `lideranca_operacoes` | Liderança de Operações | Lidera operações: pessoas, frota e indicadores das operações sob sua responsabilidade. |
| `gestor_frota` | Gestor de Frota | Veículos, condutores, unidades e centros de custo. |
| `gente` | Gente | Os dados das pessoas — e nunca o privilégio de acesso. |
| `gestao` | Gestão | Leitura executiva sobre toda a organização, auditoria inclusa. |
| `administrador` | Administrador | Controle total, inclusive perfis, permissões e escopo. |

Each organization owns its own seven roles (`roles.organization_id` set), so an
Administrador can tune the matrix without touching any other tenant.
`private.provision_access_profiles(organization_id)` creates them; it is
idempotent and **never rewrites the grants of a role that already exists**, so
running it again cannot silently restore a permission somebody removed on
purpose. `public.create_organization` calls it, so a new tenant is born with the
seven profiles and an owner holding Administrador.

The official default matrix lives in `public.access_profile_defaults` — stored,
not hard-coded in a function, so "restaurar padrões" has something real to
restore to and the screen can show which cells drifted.

### Two rules about Administrador

* **It always holds the whole catalogue.** A permission added by a future
  migration is its the moment it exists, and `set_role_permissions` refuses to
  reduce it. An organization that could carve permissions out of its own
  administrator profile could lock itself out.
* **The last active one cannot be removed.** A trigger on `membership_roles` and
  on `organization_memberships.status` raises
  *"Esta ação deixaria a organização sem um Administrador ativo."* An
  organization that never had one is unaffected: the check only runs when the
  change touches the administrator profile.

### Permissions reserved to it

`users.manage_roles`, `users.manage_operation_scope` and `roles.manage`
administer access itself. `private.is_reserved_access_permission()` names them
and `set_role_permissions` refuses to grant them to any other profile. Without
that, an Administrador could hand profile management to Gente and the rule
"somente o Administrador altera perfis de acesso" would quietly stop being true.

Delegating access administration is still possible, and there is exactly one way
to do it: **give the person the Administrador profile**, deliberately, with a
reason, where the audit trail can see it.

## 3. Nothing automatic ever changes an access profile

> CSV, XLSX, API externa, QLP, ERP, integração, webhook e sincronização **nunca**
> alteram o perfil de acesso de um usuário.

This is enforced in the database, not in the interface. `membership_roles`,
`membership_operation_scopes` and `role_permissions` each carry
`private.tg_access_privilege_guard()`, which refuses **every** write that does
not arrive through one of the audited RPCs:

* `public.set_membership_roles(membership, roles, reason)`
* `public.set_membership_operation_scopes(membership, operations)`
* `public.grant_employee_access(...)`
* `public.set_role_permissions(role, codes, reason)` / `public.restore_role_defaults(role, reason)`
* `public.create_organization(...)` and `private.provision_access_profiles(...)`

Those functions open the gate with `private.access_change_begin()`, which sets a
transaction-local GUC. Everything else — an import, an ERP writing through
PostgREST with the service key, a direct table write — fails loudly with

> *Perfil de acesso, escopo de operação e matriz de permissões só podem ser
> alterados pelas rotinas de administração de acesso. Importações, integrações e
> sincronizações não alteram acesso.*

Only a migration running as the database owner is exempt
(`private.is_migration_context()`). **service_role is deliberately not exempt**:
an integration holding the service key is exactly what this rule is about.

If a file declares a profile that disagrees with HFM, HFM wins and the file is
reported, never applied. The queue for that is
`public.access_profile_reviews`, reason code `import_declared_profile_ignored`.

## 4. Every change carries a reason

`set_membership_roles` and `set_role_permissions` reject a reason shorter than
three characters, and write the before, the after, the actor and the reason to
`public.access_profile_changes` — append-only, enforced by
`private.tg_block_mutation()`. The interface asks for it through `ReasonDialog`
while the person still remembers why; six months later that field is the only
thing that can answer "why does this person have this access".

`audit_logs` still records the row change underneath. The two are complementary:
one is the mechanical diff, the other is the decision.

## 5. Migrating off the legacy roles

The platform previously shipped five global roles — `org_admin`,
`fleet_manager`, `leadership`, `operator`, `viewer`. The migration
`20260919153000_migrate_legacy_roles.sql` moved every membership onto an
official profile under one rule:

> **it never grants anybody anything they did not already hold.**

For each membership the intended equivalent is computed, and its permission set
compared with what the account already has. If the equivalent would add even one
permission, the account gets `operacional` — the floor — and a review is queued
with `legacy_role_without_equivalent`, listing exactly which permissions were
withheld. Losing a permission is allowed; gaining one is not.

`roles.simulate` was granted to `org_admin` *before* the membership migration
ran, deliberately: that is what makes `administrador ⊆ org_admin` true and lets
the subset check pass honestly instead of being waived.

The five legacy roles are archived. Nothing in the application referenced them.

## 6. The screen

Three tabs, because there are three different questions.

**Perfis** — the seven, with how many permissions each carries, how many
accounts hold it, and whether an administrator has moved it away from the
official default (`+n` / `−n`). Actions: simulate, edit the matrix, restore the
default.

**Matriz de permissões** — every permission of the catalogue against the seven
profiles. Green: granted as the official default. Amber: granted beyond the
default. Red: in the default and removed here. The cell state is carried by an
icon and a `title`, never by colour alone.

**Auditoria** — `public.access_inconsistencies()` reports and does **not**
correct: an account with no profile, an account with more than one, access still
open for somebody who left, a scoped profile with no operation, a profile that
drifted, and the organization having a single Administrador. Below it, the
append-only change history.

### Simulation never becomes impersonation

The simulation drawer describes what a profile allows. It does not assume
anybody's identity, does not touch the session and executes nothing on anyone's
behalf. A "simulation" that borrows a real session is an impersonation, and an
audit trail that cannot tell the difference is worth nothing.

## 7. Reading it from the application

```ts
listAccessProfiles(organizationId)      // the seven, with size and drift
getPermissionMatrix(organizationId)     // the whole matrix, one round trip
listAccessInconsistencies(organizationId)
listProfileChanges(organizationId)
```

All of them read through `security invoker` views and functions, so RLS decides
what comes back; the `organizationId` argument narrows, it does not authorize.

Authorization in the application goes through permission **codes**, never
through a profile name:

```ts
session.permissions.includes("roles.manage")   // yes
user.profile === "administrador"               // never
```

Routes change; `/administracao/perfis` is a URL, not an identity. Permission
codes are the stable contract and are what every check — in the app, in an RPC
and in an RLS policy — is written against.
