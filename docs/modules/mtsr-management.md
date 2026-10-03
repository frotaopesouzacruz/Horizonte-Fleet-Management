# Segurança › Gestão de MTSR

The official conformity register of the vehicle's safety components (MDVR,
Câmeras/CFTV, Teclado Macro, Travas do Baú Lateral and Traseiro, Sirene do
Sistema, Geotab). One official state per vehicle × component
(`mtsr_component_status`), fed only by validated field inspections, by the
backoffice and by the historical import; one "last valid inspection" date per
vehicle (`mtsr_vehicle_facts`) that drives the inspection deadline. Deadline,
conformity, criticality and the main critical component are computed by database
routines over the same filtered fleet (`private.mtsr_fleet_filtered`), under the
caller's RLS and operation scope. The browser never recalculates a status, a
deadline, a criticality or a source priority.

Route: `/seguranca/mtsr` (menu **Segurança › Gestão de MTSR**, permission
`mtsr.view`). Eight tabs, each behind its own permission; the field app lives at
`/aplicativos/vistoria-mtsr` (menu **Aplicativos › Vistoria MTSR**):

| Tab | Permission | Routine |
|---|---|---|
| Visão geral | `mtsr.dashboard.view` | `mtsr_dashboard` |
| Conformidade | `mtsr.conformity.view` | `mtsr_fleet_status`, `mtsr_vehicle_sheet` |
| Vistorias recebidas | `mtsr.inspection.review` | `mtsr_inspections_received`, `mtsr_inspection_detail`, `mtsr_inspection_validate` (`…validate`), `mtsr_inspection_return` (`…return`), `mtsr_inspection_reject` (`…reject`) |
| Manutenções | `mtsr.view` | `mtsr_maintenance_links` (direct read), `mtsr_maintenance_open` (`mtsr.maintenance.open` + `maintenance.create`), `mtsr_maintenance_link` / `mtsr_maintenance_unlink` / `mtsr_maintenance_candidates` (`mtsr.maintenance.link`) |
| Ingestão | `mtsr.ingestion.manage`, `mtsr.backoffice.update` or `mtsr.import` | `mtsr_ingestion_events` (direct read), `mtsr_component_status_update` (`…backoffice.update`), `mtsr_ingest_events` (`…ingestion.manage`), `stage_mtsr_import` / `process_mtsr_import` / `mtsr_import_history` (`mtsr.import`) |
| Cadastros | `mtsr.component.manage`, `mtsr.parameters.manage` or `mtsr.ingestion.manage` | `mtsr_catalog`, `mtsr_save_component`, `mtsr_save_component_services`, `mtsr_save_parameters`, `mtsr_save_source`, `mtsr_save_component_sources` |
| Auditoria | `mtsr.audit.view` | `mtsr_events_list` |
| Saúde e cobertura | `mtsr.dashboard.view` | `mtsr_health` |
| Vistoria MTSR (app) | `applications.mtsr.execute` | `mtsr_inspection_context`, `mtsr_inspection_vehicles`, `mtsr_inspection_submit`, `mtsr_my_inspections`, `mtsr_inspection_detail` (own) |

Exports (`mtsr.export`) are listed in their own section below. The ingestion
pipeline, the import and the connectors are described in
[`mtsr-ingestion.md`](./mtsr-ingestion.md).

## Non-negotiable rules

- **The catalogue decides who verifies what.** Every component has a
  `verification_mode`: `field` (answered in the Vistoria MTSR app) or
  `backoffice` (MDVR, Câmeras, Geotab: answered by the backoffice or by a
  connector). Nothing is hard-coded: components, aliases, priority, evidence
  policy and the mode itself are edited in Cadastros.
- **Submitting an inspection changes nothing.** A field inspection arrives as
  `pendente_validacao`; the official state moves only when the review validates
  it (`mtsr_inspection_validate`). Returning or rejecting (reason ≥ 5
  characters) never touches the state.
- **Validation applies only field components.** An item whose component is
  configured as backoffice is skipped (`skipped_reason = 'backoffice'`): a field
  inspection never overwrites a backoffice component.
- **An older reading never overwrites a newer one (stale).** In validation, an
  item whose component already has a `reference_date` later than the inspection
  date is skipped (`skipped_reason = 'stale'`). In ingestion the same reading is
  recorded as `ignored` / `stale`.
- **The last valid inspection never goes back.** `mtsr_vehicle_facts.last_valid_inspection_date`
  only advances (validation and import both use `greatest`).
- **Deadline is parameterised with validity.** `mtsr_parameter_sets` holds one
  row per validity period (`effective_from`, `effective_to`); the engine reads
  the set in force on the evaluation date (`private.mtsr_params_at`). Defaults
  (HFC): conforme ≤ 29 days, atenção 30–45, vencido > 45; without any
  inspection the deadline is `pendente`.
- **Conformity and criticality are formulas, not fields.**
  - conformity: no known component → `sem_informacao`; any NOK → `nao_conforme`;
    otherwise `conforme`;
  - criticality: no NOK → `sem_criticidade`; NOK with deadline conforme →
    `media`; NOK with deadline atenção → `alta`; NOK with deadline vencido or
    pendente → `critica`;
  - main component: among the NOK components, the one with the lowest
    `priority` (then `sort_order`).
- **Maintenance is the corporate module, through a link.** A NOK opens a
  maintenance with `private.maintenance_create_internal` and the system origin
  `mtsr`; the relation lives in `mtsr_maintenance_links` (N:N). Completing the
  maintenance **does not** make the component OK: the link goes to
  `awaiting` and the component is flagged `awaiting_revalidation` until a new
  reading from any non-system source closes it (`REVALIDACAO_REALIZADA`).
  Cancelling or reopening the maintenance clears the flag.
- **Evidence retention is parameterised.** Photos live in the private bucket
  `mtsr-evidence` (JPEG/PNG/WebP, 10 MB, up to 6 per item), reachable only
  through short signed URLs issued by the server. `evidence_retention_inspections`
  (default 2) and `evidence_retention_days` (optional) decide which evidence of
  validated or rejected inspections may be purged; the purge is marked
  (`purged_at`, event `EVIDENCIA_EXPURGADA`), never silent.
- **RBAC by permission code, never by profile name.** Scope says *where*:
  `operations.access_all` sees everything; otherwise the vehicle's operation in
  today's context (Fidelização → allocation; leadership BR → city → operation)
  must be in `accessible_operation_ids`, or the vehicle in
  `private.vehicle_scope_ids`.
- **Filters are IDs** (operation, state, city, BR, leader, unit, type, vehicle,
  deadline, conformity, criticality, component + status, awaiting, fleet
  scope); the plate/fleet search is the only text.

## Permissions

Seventeen codes, all in Administração › Perfis & Permissões:

| Code | What it allows |
|---|---|
| `mtsr.view` | Enter Segurança › Gestão de MTSR (and the Manutenções tab). |
| `mtsr.dashboard.view` | Visão geral and Saúde e cobertura. |
| `mtsr.conformity.view` | Conformity matrix and the vehicle's MTSR 360° sheet. |
| `mtsr.inspection.review` | Queue and detail of received inspections. |
| `mtsr.inspection.validate` | Validate (makes the field components official); also evidence retention. |
| `mtsr.inspection.return` | Return an inspection to the field, with reason. |
| `mtsr.inspection.reject` | Reject an inspection, with reason. |
| `mtsr.component.manage` | Components, aliases, evidence policy, component → service mapping. |
| `mtsr.parameters.manage` | Deadlines, retention and SLAs with validity history; also evidence retention. |
| `mtsr.backoffice.update` | Record the official state of backoffice components (or a manual correction). |
| `mtsr.ingestion.manage` | Sources, priority per component, `mtsr_ingest_events`. |
| `mtsr.maintenance.open` | Open a corporate maintenance from a NOK (also needs `maintenance.create`). |
| `mtsr.maintenance.link` | Link / unlink an existing maintenance to a component. |
| `mtsr.export` | The three XLSX exports. |
| `mtsr.import` | Historical conformity import. |
| `mtsr.audit.view` | Domain event trail. |
| `applications.mtsr.execute` | Run the Vistoria MTSR app and follow one's own inspections. |

The app permission is named `applications.mtsr.execute`, in module
`applications`, because the field inspection is an **operational app** like
the Check List de Frota: it follows the Aplicativos architecture (enabled
operations and equipment types, `applications.view` for the menu) and is held
by operational profiles that never enter the management module. The sixteen
`mtsr.*` codes govern the portal; the seventeenth governs the field.

Defaults (`access_profile_defaults`, adjustable): Administrador and Segurança —
all seventeen; Gestor de Frota — view, dashboard, conformity, the four
inspection codes, backoffice update, maintenance open/link, export, audit;
Gestão — view, dashboard, conformity, export, audit; Liderança de Operações —
view, dashboard, conformity, review, export and the app; Operacional — the app.
Nothing grants access because of a profile's name; no import or routine
changes anyone's profile.

## Data model (`public`)

| Table | Purpose |
|---|---|
| `mtsr_components` | Catalogue per organisation: code, name, description, `verification_mode` (`field` / `backoffice`), `base_criticality`, `priority` (lower = more critical), `sort_order`, `is_active`, `context_label` (e.g. "CFTV"), evidence policy (`evidence_required_when_ok/nok`, `observation_required_when_nok`), `aliases` for header and connector matching. |
| `mtsr_component_services` | Component → service of the corporate maintenance catalogue (`maintenance_services`), with `is_default`; pre-fills the maintenance opened from a NOK. No parallel service catalogue. |
| `mtsr_parameter_sets` | Engine parameters with validity: `conforme_max_days`, `attention_min_days`, `attention_max_days`, `evidence_retention_inspections`, `evidence_retention_days`, `review_sla_days` (2), `maintenance_open_sla_days` (3), `revalidation_sla_days` (7), note. One row per `effective_from`; the current one has `effective_to` null. |
| `mtsr_ingestion_sources` | Sources of backoffice state: `source_type` (`manual_import`, `backoffice_manual`, `geotab_api`, `mdvr_api`, `cftv_api`, `other_connector`), `is_enabled`, `is_available` (an adapter exists), `priority`, non-sensitive `config`, `last_event_at`. |
| `mtsr_component_sources` | Priority of each source per component (lower wins). |
| `mtsr_vehicle_facts` | Per vehicle: `last_valid_inspection_date`, `last_valid_inspection_id`, `last_valid_source`, `last_submission_at`. Advances, never goes back. |
| `mtsr_inspections` | A field inspection: protocol `MTSR-AAAA-NNNNNN`, app, vehicle + plate/fleet snapshots, operational context frozen on the date (IDs + name snapshots), inspector (user, employee, snapshots), `inspection_date`, `inspected_at`, `submitted_at`, status (`pendente_validacao`, `validada`, `retornada`, `rejeitada`), counters, reviewer and reason, `client_submission_id` (idempotency). |
| `mtsr_inspection_items` | One component per row: `ok` / `nok`, observation, evidence count, `applied_at` + `applied_history_id` when validation applied it, `skipped_reason` (`backoffice`, `stale`). |
| `mtsr_inspection_evidence` | Photos in the private bucket: path, MIME, size, sha256, `captured_at`, `purged_at` + `purge_reason`. |
| `mtsr_ingestion_events` | Raw + normalised record of every event from any source, with `hash` (idempotency), `status` (`received`, `applied`, `ignored`, `rejected`, `conflict`), `outcome_reason`, `history_id`, `import_batch_id`. |
| `mtsr_component_status` | The official current state per vehicle × component: status, `reference_date`, source (`source_type`, `source_system`, `source_id`, `ingestion_event_id`, `inspection_id`, `inspection_item_id`), observation, `awaiting_revalidation` + `awaiting_since` + `awaiting_maintenance_id`, `status_changed_at`. |
| `mtsr_component_status_history` | Append-only trail of every official change (from → to, reference date, source, inspection, maintenance, actor). |
| `mtsr_maintenance_links` | N:N link between `maintenances` and a component: `link_type` (`opened_from_nok`, `linked_existing`, `import`), `status` (`active`, `unlinked`), `requires_revalidation`, `revalidation_status` (`pending`, `awaiting`, `done`, `not_required`, `cancelled`), maintenance status snapshot, concluded / revalidated stamps, reason. |
| `mtsr_events` | Append-only domain trail (23 event types below), with vehicle, component, source type, inspection, maintenance, ingestion event, history, payload, reason, actor (real name; "Sistema" only without a session) and `source` (`user`, `system`, `import`, `integration`). |

Reused, not duplicated: `vehicles` (never created here), `maintenances` /
`maintenance_items` / `maintenance_origins` (system origin `mtsr`),
`maintenance_services`, `import_batches` (type `mtsr_conformity`) /
`import_rows` / `import_errors`, `operational_apps` (`vistoria_mtsr`),
`checklist_app_operations` and `vehicle_type_apps` (eligibility),
`audit_logs` (exports and catalogue triggers), `outbox_events`
(`mtsr.inspection.submitted/validated/returned/rejected`).

Stamps, tenant guard and `tg_audit` run on every catalogue and state table;
`mtsr_component_status_history` and `mtsr_events` are append-only
(`tg_block_mutation`).

## Engine

`private.mtsr_vehicle_eval(org, as_of)` evaluates every vehicle of the
organisation on a date, from the official state and the parameters in force:
`days_since` = date − last valid inspection, `deadline_status`
(`private.mtsr_deadline_status`), `conformity_status`, `criticality`, NOK / OK /
known / unknown / awaiting counts, main component and the number of field and
backoffice components. `private.mtsr_fleet_filtered(org, filters, today)` joins
that evaluation with the vehicle, today's context by IDs
(`private.km_context_pairs`), open linked maintenances and pending inspections,
applies the person's scope and the ID filters, and is the single dataset behind
the matrix, the dashboard, the sheet, the health page and the exports — the same
filters give the same numbers everywhere.

`private.mtsr_apply_status` is the only door to the official state: it creates
the row when missing, writes the history, closes a pending revalidation when the
source is not `system`, updates the status and emits the specific event plus
`STATUS_COMPONENTE_ALTERADO` and `NOK_IDENTIFICADO` when the status changes.
Callers: validation (`field_inspection`), ingestion
(`private.mtsr_ingest_one`, for the import, the backoffice and connectors).

## Routines

Public (`security definer`, permission checked inside, `authenticated` only):

| Routine | Role |
|---|---|
| `mtsr_catalog` | Components, sources, priorities, service mapping, services, parameters in force and history, origin `mtsr`. |
| `mtsr_fleet_status` | Conformity matrix: paginated (≤ 1,000 rows per call), sorted on the server (`criticality`, `deadline`, `nok`, `last_inspection`, `plate`, `operation`), with the cells of every active component, groups by operation and the summary. |
| `mtsr_dashboard` | KPIs, distributions (criticality, deadline, conformity), by component / operation / city / type, NOK ranking, maintenance by status and aging, inspections by status and 12-week trend, sources. `empty` says there is no base yet. |
| `mtsr_vehicle_sheet`, `mtsr_vehicle_summary` | MTSR 360° sheet (components with last 10 history rows, inspections, maintenances, events) and the summary for the Cadastro de Frotas vehicle tab. |
| `mtsr_inspection_context`, `mtsr_inspection_vehicles`, `mtsr_inspection_submit`, `mtsr_my_inspections` | The app: catalogue of field components and evidence limits, eligible vehicles (active, in scope, operation + type enabled in Aplicativos), idempotent submission (all field components answered, OK/NOK, observation and photo per policy, ≤ 30 days old, not future), own inspections. |
| `mtsr_inspections_received`, `mtsr_inspection_detail` | Review queue (≤ 500 per call; KPIs; inspector and operation options; SLA from the parameters) and detail with the review flags. |
| `mtsr_inspection_validate`, `mtsr_inspection_return`, `mtsr_inspection_reject` | The review decisions described in the rules. |
| `mtsr_component_status_update` | Backoffice update of one vehicle (several components; observation required for NOK; reference date not future); goes through ingestion with `force` (never stale / conflict). |
| `mtsr_ingest_events` | Events from an enabled and available source (connectors); see the ingestion document. |
| `mtsr_maintenance_open`, `mtsr_maintenance_link`, `mtsr_maintenance_unlink`, `mtsr_maintenance_candidates`, `mtsr_for_maintenance` | Corporate maintenance from a NOK (one open maintenance per component unless justified with ≥ 10 characters; default services from the mapping; priority from the vehicle's criticality), link an existing one (same vehicle, not cancelled; a completed one goes straight to awaiting), unlink with reason, candidates of the last 180 days, and the inverse read for the Manutenção drawer. |
| `stage_mtsr_import`, `process_mtsr_import`, `mtsr_import_history` | Historical import (see the ingestion document). |
| `mtsr_events_list`, `mtsr_health` | Audit trail (≤ 500 per call) and coverage indicators. |
| `mtsr_save_component`, `mtsr_save_component_services`, `mtsr_save_parameters`, `mtsr_save_source`, `mtsr_save_component_sources` | Cadastros. Nomenclature is enforced ("CFTV", never "CCTV"; the MTSR siren is the "Sirene do Sistema", never the reverse siren). A source without an adapter cannot be enabled. A new parameter validity closes the previous one. |
| `mtsr_evidence_purge_candidates`, `mtsr_evidence_mark_purged` | Retention: candidates beyond the kept inspections or days; the server deletes the objects and marks the rows. |
| `log_mtsr_export` | Records an export in `audit_logs` and as `EXPORTACAO`; no record, no file. |

Private (`service_role` only): `mtsr_actor_name`, `mtsr_log`, `mtsr_params_at`,
`mtsr_deadline_status`, `mtsr_normalize_status`, `mtsr_resolve_component`,
`mtsr_vehicle_eval`, `mtsr_apply_status`, `mtsr_source_priority`,
`mtsr_ingest_one`, `mtsr_fleet_filtered`, `mtsr_require_view`,
`mtsr_assert_nomenclature`, `mtsr_app`, `mtsr_inspection_json`,
`mtsr_inspection_can_review`, `mtsr_inspection_lock`,
`mtsr_on_maintenance_completed`, `tg_maintenances_mtsr` (deferred constraint
trigger on `maintenances`).

## Audit events (`mtsr_events.event_type`)

`STATUS_COMPONENTE_ALTERADO`, `VISTORIA_ENVIADA`, `VISTORIA_VALIDADA`,
`VISTORIA_RETORNADA`, `VISTORIA_REJEITADA`, `NOK_IDENTIFICADO`,
`MANUTENCAO_ABERTA`, `MANUTENCAO_VINCULADA`, `MANUTENCAO_DESVINCULADA`,
`MANUTENCAO_CONCLUIDA`, `MANUTENCAO_CANCELADA`, `MANUTENCAO_REABERTA`,
`REVALIDACAO_REALIZADA`, `ATUALIZACAO_BACKOFFICE`, `IMPORTACAO`,
`ALTERACAO_MANUAL`, `INGESTAO_IGNORADA`, `INGESTAO_CONFLITO`,
`PARAMETROS_ALTERADOS`, `COMPONENTE_ALTERADO`, `FONTE_ALTERADA`,
`EVIDENCIA_EXPURGADA`, `EXPORTACAO`. The Auditoria tab and its export read
them through `mtsr_events_list`; the vehicle sheet shows the last 200 of a
vehicle.

## Security

RLS on every `mtsr_*` table, `select` only for `authenticated`, all writes
revoked and done through the routines above. Catalogue tables are visible with
`mtsr.view` (components also with `applications.mtsr.execute`, because the app
reads the field catalogue). Per-vehicle tables (facts, status, history, links,
ingestion events) require `mtsr.view` and the vehicle in
`private.vehicle_scope_ids('mtsr.view')`; `mtsr_events` requires
`mtsr.audit.view`; inspections are visible to the module scope **or** to their
own inspector with the app permission; items and evidence follow the parent
inspection. The evidence bucket has no policy for `authenticated`: only signed
URLs issued by the server after a permission check. Exports are logged before
the file is produced.

## Integrations

- **Cadastro de Frotas**: vehicles are read, never written; plate and fleet
  code are snapshots; the vehicle detail gets an MTSR summary
  (`mtsr_vehicle_summary`).
- **Manutenção**: opening from a NOK uses the corporate routine with the system
  origin `mtsr` (not selectable by hand); the wizard preset accepts
  `mtsrComponentId`, `mtsrComponentName`, `mtsrInspectionItemId`; the drawer
  reads `mtsr_for_maintenance`; the trigger on `maintenances` reflects
  completion (awaiting revalidation), cancellation and reopening.
- **Operações / Tipos de Equipamento › Aplicativos**: the app `vistoria_mtsr`
  is eligible where the operation and the equipment type enable it (the seed
  mirrors the Check List de Frota links); the Saúde tab counts enabled
  operations and types.
- **Fidelização / BRs / Lideranças**: today's context by IDs through the
  official resolvers, frozen on each inspection.

## Exports (parity with the screen)

| Export | Route | Kind in `audit_logs` / `EXPORTACAO` |
|---|---|---|
| Matriz de conformidade (Resumo + one row per vehicle, one column per component OK/NOK/—, non-conforming rows highlighted) | `/seguranca/mtsr/export/conformidade` | `conformidade` |
| Vistorias recebidas (same filters as the tab; SLA from the parameters) | `/seguranca/mtsr/export/vistorias` | `vistorias` |
| Auditoria (payload summarised as text) | `/seguranca/mtsr/export/auditoria` | `auditoria` |

All three read the routines page by page until the total (no row cap), take the
filters from the URL (`parseMtsrFilters` + `mtsrFiltersPayload`, plus the tab's
own parameters) and reuse the KM workbook kit
(`frota/km/relatorio/xlsx-kit.ts`). File names: `mtsr-<kind>-AAAAMMDD.xlsx`.

## Front-end

| Path | Role |
|---|---|
| `src/lib/mtsr/types.ts`, `url.ts` | Contracts, labels and tones, permissions, filters ↔ URL ↔ payload. |
| `src/lib/mtsr/queries.ts`, `loaders.ts`, `rpc.ts` | Server-only reads (one loader per tab) and the RPC bridge with the fixture store for the preview. |
| `src/lib/mtsr/actions.ts`, `app-actions.ts`, `evidence.ts` | Portal and app server actions; signed URLs for the private bucket. |
| `src/lib/mtsr/import-sheet.ts`, `template.ts`, `import-actions.ts`, `import-client.ts` | Import: browser reader, model workbook, server steps, client pipeline. |
| `src/components/mtsr/badges.tsx` | Status badges (deadline, conformity, criticality, component, inspection, revalidation, ingestion outcome, verification mode). |
| `src/app/(app)/seguranca/mtsr/*` | Page, view, filters and the tab panels; `panels/ingestion/import-section.tsx` is the import; `export/*` the three routes and `export-log.ts`. |
| `src/app/(app)/aplicativos/vistoria-mtsr/*` | The field app. |

## Migrations

| File | Content |
|---|---|
| `20261003130000_mtsr_foundation.sql` | permissions and profile defaults, system origin `mtsr`, batch type `mtsr_conformity`, all tables, indexes, triggers, RLS, private bucket, app `vistoria_mtsr`, seeds (components, parameters, sources, priorities, service mapping) |
| `20261003131000_mtsr_engine.sql` | parameters in force, deadline, status normaliser, component resolver, vehicle evaluation, `mtsr_apply_status`, source priority, `mtsr_ingest_one`, `mtsr_ingest_events`, backoffice update, filtered fleet, catalogue, matrix, dashboard, sheet, summary, events, health, Cadastros |
| `20261003132000_mtsr_inspections.sql` | app context, eligible vehicles, submission, detail, own inspections, review queue, validate / return / reject, evidence retention |
| `20261003133000_mtsr_maintenance_import.sql` | maintenance open / link / unlink, lifecycle trigger, inverse read, candidates, `stage_mtsr_import`, `process_mtsr_import`, `mtsr_import_history`, `log_mtsr_export` |

## Known limitations (real pending items)

- **Connectors are registered but not implemented.** `geotab_api`, `mdvr_api`,
  `cftv_api` and `other_connector` exist in `mtsr_ingestion_sources` with
  `is_available = false` and `is_enabled = false`; `mtsr_save_source` refuses to
  enable them and `mtsr_ingest_events` refuses their events. No API is
  invented: the backoffice components are fed by the manual update and by the
  import until a real integration exists (how to add one is in
  `mtsr-ingestion.md`).
- **The initial service mapping covers only Câmeras and Travas.** The seed maps
  `cameras` to "Reparo ou substituição das câmeras de monitoramento veicular"
  and both `travas_bau_*` to "Reparo de portas, maçanetas e fechaduras do
  compartimento de carga", only when the service exists in the organisation's
  catalogue with that exact normalised name. MDVR, Teclado Macro, Sirene do
  Sistema and Geotab have no default service: opening a maintenance from their
  NOK asks for the service, and the Saúde tab counts them as
  `components_without_service` until Cadastros maps them.
- Evidence purge runs on demand (`applyEvidenceRetention`); there is no
  scheduled job yet.
- The dashboard's flow KPIs (SLA of review, NOK without maintenance, awaiting
  over SLA) follow the filtered vehicles, but the sources block is
  organisation-wide.
