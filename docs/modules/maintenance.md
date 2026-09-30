# Gestão de Frota › Manutenção (Etapa 16)

The maintenance module for the fleet: scheduling, execution, preventive (MP cycles), predictive (technical plans), a general base, reference data and imports. It lives at `/frota/manutencao`, in the menu **Gestão de frota**, below **Cadastro de frotas**.

Maintenance is not a parallel system. Every maintenance record points to the official **vehicle** (`vehicles.id`, never the plate text). Operation, city, BR and leadership come from the official sources of Stages 08, 13 and 15, resolved **on the date of the event** and preserved as a snapshot. KM comes from the fleet's official reading (`vehicle_odometer_readings`).

How the HFC (the Lovable reference) was mapped, and the comparison with it, is in [`hfc-maintenance-mapping.md`](./hfc-maintenance-mapping.md).

## Screens (7 tabs)

| Tab | What it answers | Permission |
|---|---|---|
| **Visão geral** | TMM, corrective TMM and P90, volume versus previous period, downtime, SLA, immobilised and available fleet, open work, overdue items, preventive and predictive status, possible recurrence, monthly volume by type, mix, aging, volume × TMM by cluster, top services and suppliers | `maintenance.view_dashboard` |
| **Programação & execução** | 9 queue KPIs (to schedule, scheduled, in progress, scheduled today, exit forecast overdue, overdue without scheduling, late for entry, over SLA, completed today). Each KPI filters the list below using the **same definition** as the database. | `maintenance.view` |
| **Preventiva** | Vehicle × MP1..MPn matrix with milestone, remaining or excess KM, status, adherence and open maintenance. Generating a maintenance is idempotent. The inactive fleet is shown as history. | `maintenance.view` (generating needs `manage_preventive`) |
| **Preditiva** | Technical status (KM or days band) kept **separate** from execution status. Alerts, vehicle × item matrix, verifications (CONFORME / MONITORAR / NÃO CONFORME / NÃO REALIZADO) with a traceable decision, cycle history and reset. | `maintenance.view` (actions need `manage_predictive`) |
| **Base geral** | Paginated table sorted on the server, and hierarchy Operação → Cidade → BR → Veículo | `maintenance.view_base` |
| **Cadastros** | Clusters, services (with the Services × Check List mapping), suppliers, preventive parameters, predictive plans (versions, items, script, coverage), origins, settings | `manage_*` (read-only without it) |
| **Importações** | 5 layouts (clusters, services, suppliers, preventive parameters, maintenance base), preview, confirmation, history | `maintenance.import` |

Screens shared by all tabs:
- **Maintenance detail drawer:** the whole lifecycle, KM, services, Check List findings, possible recurrence and the audit trail.
- **Opening wizard:** FROTA → SERVIÇO → PROGRAMAÇÃO → KM → REVISÃO.
- **Export:** XLSX/CSV with the on-screen filters, no row cap, and an audit entry.
- **"Manutenção" tab in the vehicle detail of Cadastro de Frotas:** a query against the base, not a copy.

All screen state lives in the URL: tab, filters (`de`, `ate`, `operacao`, `uf`, `cidade`, `br`, `lideranca`, `tipo`, `situacao`, `fornecedor`, `cluster`, `servico`, `veiculo`, `fila`…), sort order and page. The server loads **only the open tab**.

## Data model (`public`)

| Table | Role |
|---|---|
| `maintenances` | The maintenance record, described in the list below this table. |
| `maintenance_items` | One service per row (MANUTENÇÃO → ITENS): service and cluster snapshot, criticality, status and result per item. |
| `maintenance_events` | Append-only audit trail: event, from → to, reason, payload (before/after), author (real name), source `user` / `import` / `system`. `occurred_at = clock_timestamp()`. |
| `maintenance_status_history` | View over the events that change status. |
| `maintenance_finding_links` | N:N link between a maintenance and a non-conforming Check List answer, with the resolution status. |
| `maintenance_types`, `maintenance_origins` | Controlled catalogues. Types are global and extensible. Origins are global plus per organisation; the system origins cannot be picked by hand. |
| `maintenance_clusters`, `maintenance_services`, `maintenance_suppliers` | Reference data. |
| `maintenance_checklist_service_links` | **Services × Check List**: app + stable `question_key` (+ conditional field) → service. This is the same relation the Action Plan will use. |
| `maintenance_preventive_rules`, `maintenance_preventive_cycles` | Preventive: parameters per type / subcategory / model, and MP1..n cycles per vehicle. |
| `maintenance_predictive_plans`, `_plan_items`, `_plan_versions`, `_coverage`, `_cycles`, `_verifications` | Predictive: versioned technical plan, items (KM / days / engine hours), technical script, service coverage, cycles and verifications. |
| `maintenance_settings` | Per organisation: aging buckets, recurrence window, KM windows, default SLA, overdue-without-scheduling threshold, predictive forecast. |

A `maintenances` row holds:
- **Identity:** `id` (uuid) and `code` MAN-AAAA-NNNNNN, sequential per organisation and year.
- **Vehicle:** the vehicle plus snapshots of plate, fleet number, type, subcategory and model.
- **Operational context on the date:** operation, city, state, BR, leader, branch, fidelisation assignment and source, with name snapshots.
- **Dates:** request date, scheduled date and time, expected exit, **actual** entry and exit.
- **TMM:** `duration_hours`, a generated column. It is exact when both times exist and counted by date otherwise.
- **Entry KM:** value, status, source, official reading, difference and justification.
- **Links:** preventive cycle, predictive cycle and item, verification, checklist execution, import batch and key.

### State machine

```
Há agendar ──agendar──▶ Agendado ──registrar entrada──▶ Em execução ──concluir──▶ Concluído
   ▲  │                    │ ▲                                              │
   │  └─cancelar           │ └─reprogramar (reason, before/after)           └─reabrir (reason ≥ 10) ─▶ Em execução
   │                       └─desfazer agendamento (reason) ─▶ Há agendar
   └── Cancelado / Não realizada ──reabrir──┘
```

The transitions are decided in the database (`private.maintenance_transition_allowed`); the screen only shows `detail.transitions`.
- **Completion** requires the actual exit and a decision per item.
- **Reopening** restores the preventive and predictive effects.
- **TMM** always uses the actual entry and actual exit, never the request date.

### KM (`private.maintenance_resolve_km`)
Official source: `vehicle_odometer_readings`. There is no second KM base.

| Status | Rule |
|---|---|
| `validated` | Official reading on the reference date itself |
| `compatible` | Reading within `km_compatible_days` (default 3) |
| `estimated` | Interpolation between readings, or the nearest reading within `km_estimated_max_days` (default 30) |
| `to_review` | Readings exist but are too far away |
| `not_found` | The vehicle has no reading |
| `pending_future` | Future reference date |
| `manual` | KM entered with a justification (≥ 5 characters) that is consistent with the neighbouring readings |
| `divergent` | KM entered that falls outside the neighbouring readings. Recorded and flagged; **does not block**. |

The daily routine (`hfm_maintenance_daily`, pg_cron, 06:15) reprocesses pending, not-found and to-review KM. It never touches manual KM.

### Preventive
- **Milestone:** `initial_km + n × interval_km`, n = 1..`cycle_count`. The most specific active rule wins: model > subcategory > type.
- **Status** (`private.maintenance_preventive_status`):
  - `km < milestone − alert` → Não atingida;
  - `≤ milestone` → A programar;
  - `≤ milestone + tolerance` → Vencida;
  - beyond that → Crítica;
  - Realizada once completed. Adherence is early, on time or late.
- **Generating from a cycle** is idempotent: `created = false` returns the one that already exists. Completing it marks the cycle; reopening undoes that.

### Predictive
- Each item has KM and/or day intervals with bands: alert = Próximo, schedule = A programar, tolerance = Vencido, beyond = Crítico.
- Precedence:
  - no KM comes first;
  - no reference → Inspeção inicial;
  - otherwise the worse of the KM band and the day band;
  - a NÃO CONFORME verification caps the status at A programar and opens a maintenance (idempotent).
- MONITORAR reduces the interval.
- Completing a service with full coverage restarts the item's cycle.
- Only an **approved** plan feeds the engine. A sensitive change to an approved plan requires a reason and creates a new version.
- **Engine hours:** stored, but not yet used in the calculation. This is pending.

### Duplicates and recurrence
- **Duplicate:** an open maintenance on the same vehicle with the same service or cluster blocks the new one (`unique_violation`, hint `maintenance_duplicate`). The wizard offers three ways out: open the existing one, add to it (`maintenance_add_items`), or open a new one with a justification of at least 10 characters, which is recorded.
- **Possible recurrence:** same vehicle + same cluster within `recurrence_window_days` (default 30). It is shown as a signal to investigate, never as a confirmed defect. It appears in the detail, in the overview and in the vehicle history.

## Integrations
- **Fleet:**
  - FK `(organization_id, vehicle_id)`;
  - an inactive vehicle cannot be opened;
  - the inactive fleet is viewed as history (`frota=inactive`);
  - the "Manutenção" tab in the vehicle detail reads `vehicle_maintenance_history(vehicle_id)`.
- **Operational context:** resolved from fidelisation (BR) or, failing that, from allocation, and from the leadership in force, **on the date** (`private.maintenance_context`, which reuses `adherence_planned_fleet` and `adherence_leader_at`). It is preserved as a snapshot.
- **Check List / Action Plans:**
  - a non-conforming answer (`checklist_execution_answers.is_conforming = false`) can open a maintenance or be linked to one (N:N);
  - the suggested service comes from `maintenance_checklist_service_links`;
  - on completion the link is resolved according to the item result (resolved, partially resolved or not resolved);
  - the HFM has **no Action Plan module yet**, and the integration uses exactly the relation the Action Plan will use.
- **Outbox:** `private.emit_event('maintenance.created', …)` feeds future consumers.

## Security
- **RBAC:** 20 permissions `maintenance.*`, listed in the table below.

| Code | Administrador | Gestor de Frota | Gestão | Liderança Op. | Segurança | Operacional / Gente |
|---|---|---|---|---|---|---|
| view, view_base | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| view_dashboard | ✓ | ✓ | ✓ | ✓ | — | — |
| create | ✓ | ✓ | — | ✓ | — | — |
| export, view_audit | ✓ | ✓ | ✓ | — | — | — |
| edit, schedule, reschedule, start, complete, reopen, reprocess, import, manage_* | ✓ | ✓ | — | — | — | — |

  - These are **defaults** (`access_profile_defaults`) that Administração › Perfis & Permissões can adjust.
  - Nothing grants access because of a profile's name.
  - No import or routine changes anyone's access profile.
  - Migration `20260928106000` fixed defaults that had not reached the Gestão, Liderança and Segurança roles.
  - Permission says *what*; operation scope says *where*. Administrador and Gestão hold `operations.access_all` and reach every operation. Gestor de Frota, Liderança and Segurança reach only the operations in their scope (`membership_operation_scopes`), and a write on a vehicle outside it is refused (suite 20, T105).
- **RLS:**
  - `maintenances`: organisation (`permitted_org_ids('maintenance.view')`) + scope by the context's operation (`accessible_operation_ids`), or by the vehicle's scope (`vehicle_in_scope`) when there is no context;
  - items, events and links follow the parent maintenance;
  - cycles and verifications follow the vehicle.
- **Direct writes are not allowed:** `revoke all` from `anon` and `authenticated`, and `grant select` only.
- **Writes:** every write goes through a `SECURITY DEFINER` RPC that checks permission, scope (`assert_vehicle_access` / `maintenance_lock`), transition and integrity in the same transaction.
- **Multi-tenancy:** composite FKs `(organization_id, id)` and `tg_prevent_tenant_change`.
- **Audit:**
  - `maintenance_events`, append-only;
  - `audit_logs` (`tg_audit`) on catalogue and parameter tables;
  - `log_maintenance_export`: no audit record, no file;
  - predictive reset in `audit_logs`;
  - the author is always the real name (`maintenance_actor_name`). "Sistema" is used only when there is no session: the daily routine, or a routine triggered by a completion.

## Import (`stage_maintenance_import` / `process_maintenance_import`)
- **Batches:** the file is read in the browser and sent in parts, with no row cap. Each batch stores a sha256 hash, so a file already imported is flagged. Validation and writing also happen in parts.
- **Preview:** new, updates, unchanged, conflicts, duplicates in file, errors, unknown vehicle / service / supplier.
- **Idempotency:** the key is vehicle + type + reference date + work order + the supplier text as written in the file. Re-importing does not duplicate a maintenance or an item; re-importing after a de-para fills the supplier link of the same maintenance.
- **Batch lookup (fixed in `20261001100100`):** the validation parts and the preview carry no `kind`; the base and the batch type now come from the batch itself. Before, catalogue batches (`maintenance_catalog`) were looked up as `maintenance` and the screen said "Esta importação não está mais aberta. Envie a planilha novamente.".
- **Layouts of the operation's spreadsheets (`20261001100000` / `20261001100100`):** the columns, their labels and the downloaded XLSX template follow the files 06 Clusters, 07 Fornecedores, 08 Parâmetros, 09 Serviços and 10 Manutenções; the old header names are still accepted.
  - *Clusters:* Cluster, Código, Descrição, Criticidade (+ Status). Re-importing keeps the code and what the file does not bring.
  - *Serviços:* Categoria (= cluster), Serviço, Tipos Manutenção ("Não se aplica" = no type; Preditiva turns on the predictive flag), Criticidade, Status, Outros Nomes.
  - *Fornecedores:* Cod Rodopar (`external_code`), Parceiro Comercial, CNPJ / CPF, Categoria, Tipo (`service_type`), Modelo de Pagamento (`payment_terms`), Validação Financeiro (`financial_validation`), Outros Nomes (`alias_names`). An invalid CNPJ/CPF, or one already used by another supplier (or by an earlier row of the file), enters as a supplier without document, with a warning. A supplier is identified by its name only: a CNPJ or a code never renames an existing supplier. Two rows with the same name are an error.
  - *Parâmetros:* Tipo Equipamento accepts a subcategory ("Toco", "Truck" → Caminhão + subcategory); Modelo accepts a subcategory ("10,5 m³" → Van + subcategory); "—" means empty; Criticidade and Status are stored.
  - *Manutenções:* Placa, Tipo de Manutenção, Categoria (Cluster), Serviço, Parceiro Comercial, OS, Data Agendada, Data/Hora de Entrada, Previsão de Saída, Data/Hora de Saída, KM de Entrada, Situação, Origem.
- **De-para ("Outros nomes"):** suppliers and services have `alias_names`, editable in the catalogue forms and importable. The records base recognises a supplier by name, trade name, other name, CNPJ, the canonical form of the name (no accents, punctuation or "Ltda/S/A/Eireli/ME") or the part before "|", always only when the match is unique. A supplier that is not recognised no longer blocks the row: the maintenance is created without the link and keeps the text in `maintenances.supplier_name_informed` (shown as "fora do catálogo"); the preview lists these names. A service is recognised by name or other name; when the row's cluster differs from the catalogue and the name is unique, the catalogue wins (warning).
- **Records rules:** entry/exit dates are required and checked only when the status is a fact (Em execução, Concluído); a scheduled entry in the future is fine. KM with decimals is read as a number (148398.88 → 148398). Rows of the same workshop entry with different statuses leave the maintenance in the least advanced status and each item with its own; the exit is the last one. An exit earlier than the entry time on the same day drops both times (duration by date). A service repeated in the same entry is a warning and creates no second item.
- **What the import never does:**
  - create a vehicle or an operation;
  - create a service or a supplier in the records base;
  - change Profiles & Permissions;
  - rewrite the history of a maintenance a user has changed (that is a conflict);
  - delete links to findings.

## Code
- **Database:** `supabase/migrations/20260928100000` … `20260928106000_maintenance_*.sql`, `20261001100000_maintenance_import_layouts.sql` (columns, de-para, catalogue writes) and `20261001100100_maintenance_import_routines.sql` (stage/process).
- **Server:**
  - `src/lib/maintenance/queries.ts` (server-only);
  - `actions.ts` (`"use server"`, `Result<T>`);
  - `import-actions.ts`, `import-client.ts`, `import-columns.ts`;
  - `types.ts` (vocabulary and formatters) and `url.ts` (filters ↔ URL).
- **Screens:** `src/app/(app)/frota/manutencao/*`, `src/components/maintenance/*`, preview at `src/app/dev/preview-manutencao`.
- **Tests:**
  - `supabase/tests/remote/20_maintenance.sql` (T93–T105): one `do` block against the database with data; it ends with `raise exception 'ROLLBACK_TESTES…'`, so everything it creates is rolled back and the PASS/FAIL lines come back in the error message;
  - `supabase/tests/remote/23_maintenance_import_layouts.sql` (L1–L8): catalogue imports in parts without `kind`, the five layouts, de-para, unknown supplier kept by name, cluster mismatch, KM with decimals, mixed statuses, re-import after de-para;
  - `tests/ui/maintenance.spec.ts` (tabs, queues, matrices, wizard, Leadership profile, import layout and XLSX template, supplier commercial data and other names, mobile without horizontal scroll, Axe in light and dark);
  - T106 (regression): the other remote suites and the whole Playwright suite.

## Known limitations (real pending items)
- **Action Plans:** the HFM has no Action Plan module. The integration covers the Check List finding, the Services × Check List mapping and the N:N links; the Action Plan screen itself is a future stage.
- **KM:** there is no dedicated "Gestão de KM" module in the HFM. The official source is `vehicle_odometer_readings`, fed by the fleet register and corrections.
- **Engine hours:** stored in predictive items but not used in the calculation.
- **Socorro em Rota and Entrega Técnica:** they are **origins** of a corrective maintenance, not their own modules.
- **Costs:** there are no maintenance costs yet: parts, labour, quotes.
- **Overview filters:** the preventive and predictive indicators respect the person's scope, not the filter bar. The Preventiva and Preditiva tabs do filter.
- **Matrix pagination:** the preventive and predictive matrices come whole from the server and are paginated in the browser. That is fine for the current fleet (~90 vehicles), but will need server-side pagination at a few thousand vehicles.
