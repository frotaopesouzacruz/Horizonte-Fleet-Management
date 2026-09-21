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

### How a new module's permissions reach the existing roles

"Never rewrites a role that already exists" was right about customisation and
wrong about everything else: a permission created **after** an organization was
born never reached it at all. The catalogue grew, the roles did not, and the
gap was invisible because the only account testing it was a platform admin,
which bypasses permission checks entirely.

It had already happened three times when it was found — `equipment_types.*` (9),
`leadership.*` (5), `fidelization.*` (8) and `branches.*` (10): **32 permissions
in the catalogue and in no role**, so Tipos de Equipamento, Lideranças,
Fidelização and Filiais were shipped and unreachable for every real user,
including an organization's own Administrador.

`private.sync_access_profile_defaults(organization_id)` materialises the
catalogue into the roles that already exist, and the statement-level trigger
`access_profile_defaults_sync` runs it whenever a migration inserts into
`access_profile_defaults` — so the next module cannot repeat the omission,
rather than relying on remembering a line. `provision_access_profiles` calls it
too.

The sync is **additive and conservative**: it grants a code to an organization
only when that code appears in none of its roles, which means the module is new
to that tenant and nobody could have decided anything about it yet. A permission
an administrador deliberately removed stays removed — `restore_role_defaults` is
how one asks for the default back. It moves what a role may do; it never moves
who holds which role, so §3 below is untouched.

What that conservatism leaves behind, and should: after the sync, nine cells of
the current organization still differ from the catalogue, all of them
`vehicles.*` in Gestão, Gestor de Frota and Liderança de Operações. Those codes
were already in use in the tenant, so the sync cannot tell "removed on purpose"
from "never granted" and refuses to guess. The Perfis e Permissões screen shows
exactly which cells drifted, and restoring them is a decision someone takes with
a reason attached.

### Two rules about Administrador

* **It always holds the whole catalogue.** A permission added by a future
  migration becomes its the moment it exists — that is what the sync above makes
  true in practice, and it was not true before — and `set_role_permissions`
  refuses to reduce it. An organization that could carve permissions out of its own
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

### Permissions depend on their own `view`

`users.create` without `users.view` describes an account that may register a
colaborador and then cannot see the screen it would register them on. It is not
dangerous — it is incoherent, and an incoherent matrix is one an administrator
cannot reason about. `private.permission_dependency()` names the
`<resource>.view` each code requires, `set_role_permissions` refuses the
combination, and the editor greys the dependants out and un-ticks them when the
`view` goes, so the rule is visible before it is enforced.

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

### When the file disagrees

The guard makes the wrong outcome impossible; `public.flag_import_profile_divergences()`
makes it **visible**. After validation, every row whose declared profile reads
as one of the seven and differs from the account's HFM profile gets:

* a `warning` on the row, code `profile_mismatch`, saying in words that the HFM
  profile was preserved;
* a pending review in `public.access_profile_reviews`
  (`import_declared_profile_ignored`) for an Administrador to settle.

`private.official_profile_from_text()` is what reads the column — "Admin", "RH",
"Liderança", "SESMT" and the rest. Recognising the word grants nothing: the
result is only ever compared and reported, never written.

There is no "aplicar todos os perfis da planilha" button, and there will not be
one. That control is a mass privilege escalation with a friendly label.

Tested end to end, both directions:

| Perfil HFM | Planilha diz | Depois | Resultado |
|---|---|---|---|
| Operacional | Administrador | **Operacional** | aviso + revisão |
| Administrador | Operacional | **Administrador** | aviso + revisão |
| Gestor de Frota | Administrador | **Gestor de Frota** | aviso + revisão |

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

**Simulação** — pick an account and see what it can actually do: its profile,
its operation scope, which sidebar entries it sees, and every effective
permission grouped by module. `public.membership_effective_access()` is the one
answer to "what can this person do", so no two screens can disagree about it.
The menu list is derived from the navigation model itself rather than retyped,
because a simulation that lists a menu the product no longer has is worse than
no simulation.

**Auditoria** — `public.access_inconsistencies()` reports and does **not**
correct: an account with no profile, an account with more than one, access still
open for somebody who left, a scoped profile with no operation, a profile that
drifted, and the organization having a single Administrador. Below it, the
append-only change history.

The change history can be filtered by period, by event type (an account's
profile vs. a profile's matrix) and by profile, and searched by person or
reason. The filter is local, over the last 200 entries the page loaded, and the
screen says so: a small honest window beats a filter that looks like it sweeps
the whole history and does not.

**Exportação** — `/administracao/perfis/export?format=xlsx|csv` writes the whole
matrix, one row per permission and one column per profile, with what this
organization grants *and* the official default beside it. The two questions an
auditor asks are "who can do this" and "is that the standard"; a file that
answers only the first sends them back to the screen.

### Simulation never becomes impersonation

The simulation drawer describes what a profile allows. It does not assume
anybody's identity, does not touch the session and executes nothing on anyone's
behalf. A "simulation" that borrows a real session is an impersonation, and an
audit trail that cannot tell the difference is worth nothing.

## 7. Reading it from the application

```ts
listAccessProfiles(organizationId)         // the seven, with size and drift
getPermissionMatrix(organizationId)        // the whole matrix, one round trip
listAccessInconsistencies(organizationId)
listProfileChanges(organizationId)
listSimulatableMemberships(organizationId)
getEffectiveAccess(membershipId)           // the one answer, for the simulation
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

## 8. What was tested, and how

Run against the live schema under real identities, not mocked:

| Teste | Resultado |
|---|---|
| Operacional, Segurança‑equivalente, Gente, Liderança e Gestor de Frota tentam promover alguém a Administrador | bloqueado (4/4) |
| Os mesmos tentam alterar o próprio perfil | bloqueado (4/4) |
| Os mesmos tentam editar a matriz | bloqueado (4/4) |
| Administrador muda Operacional → Gestor de Frota | permitido e auditado |
| `INSERT` / `DELETE` direto em `membership_roles` e `role_permissions` | bloqueado pelo guarda |
| Troca de perfil sem motivo | bloqueada |
| Remover o último Administrador | bloqueado |
| Administrador da organização A altera perfil na organização B | bloqueado |
| Administrador da organização A edita a matriz da organização B | bloqueado |
| Administrador da organização A lista perfis da organização B | 0 visíveis |
| `users.create` sem `users.view` | bloqueado |
| Importação declarando outro perfil, nos dois sentidos | perfil HFM preservado, aviso e revisão |

The test accounts and the second organization were removed afterwards. The
entries they produced in `access_profile_changes` were not: that table is
append-only by design, and the first exception to it is not going to be mine.
They are real changes that really happened, with "teste" in the reason field. A
clean trail before go-live means replaying the migrations on a fresh database,
not editing an append-only table.
