# Gestão de Frota › Gestão de KM Rodado

The daily mileage ledger of the fleet. One official source per vehicle and day
(`km_daily_readings`), fed by the manual import of **Base Geral KM Rodado.xlsx →
aba "Controle KM Rodado"** today and, later, by connected spreadsheets or
telematics through the same pipeline. Everything the screens, the planner, the
reports and the rotation plan show is read from that ledger by database
routines, under the caller's RLS and scope. The browser never recalculates
mileage, status, coverage or dispersion.

Route: `/frota/km` (menu **Gestão de frota › Gestão de KM Rodado**, permission
`km.view`). Eleven tabs, each behind its own permission:

| Tab | Permission | Routine |
|---|---|---|
| Visão geral | `km.view_dashboard` | `km_overview` |
| KM atual | `km.view` | `km_fleet_current` |
| Análise gerencial | `km.view_analysis` | `km_analysis` |
| Planner mês/dia | `km.view_planner` | `km_planner` |
| Visão diária | `km.view_daily` | `km_daily` |
| Histórico por frota | `km.view_history` | `km_vehicle_history` |
| Plano de rodízio | `km.rotation.view` | `km_rotation_candidates`, `km_rotation_plans_list`, `km_rotation_plan_detail` |
| Qualidade de dados | `km.view_quality` | `km_quality`, `km_settings_get` |
| Importação | `km.import` | `stage_km_import`, `km_import_findings`, `process_km_import`, `cancel_km_import` |
| Lotes | `km.import` or `km.view_audit` | `km_import_batches`, `km_import_findings` |
| Relatórios | `km.export` | export routes below |

## Non-negotiable rules

- **SEM LEITURA ≠ SEM MOVIMENTO.** A day without trustworthy odometer data is
  `no_reading` with `distance_validated = null` (a check constraint enforces
  it). It is never 0 km, never counted as low usage and never ranked as the
  lowest mileage. A day with a valid reading and movement within the tolerance
  is `no_movement` and keeps its small distance.
- **The imported value is never overwritten.** `odometer_*_imported` and
  `distance_imported` keep what the source said; corrections change the current
  columns and leave a trail.
- **KM never creates vehicles and never edits the Cadastro de Frotas.** Plates
  are resolved to `vehicle_id` (with `plate_snapshot`); Frota/Tipo/Modelo from
  the sheet are only compared (`registry_divergence`).
- **A manual correction is never overwritten silently.** A later import that
  disagrees with a corrected day is reported as `manual_correction_kept` and
  skipped.
- **The rotation plan only suggests.** Nothing moves without approval, and the
  Fidelização changes only through "Aplicar na Fidelização" (preview, explicit
  confirmation, two permissions, one transaction).
- **Filters are IDs.** Operation, state, city, BR, leader, unit, type,
  subcategory, model, vehicle; text only in the plate search.

## Data model (`public`)

| Table | Purpose |
|---|---|
| `km_reading_statuses` | Central status catalog: reading statuses (`validated`, `no_movement`, `high_mileage`, `km_divergence`, `pending_review`, `inconsistent`, `no_reading`), alerts (`registry_divergence`, `odometer_jump`, `odometer_regression`) and import (`unregistered_plate`), with tone, `has_reading`, `counts_distance`, order and description. |
| `km_settings` | Per-organization parameters (defaults in `private.km_settings_of` when no row exists): no-movement tolerance 1 km, divergence tolerance 1 km, high mileage 800 km/day, odometer jump 500 km, regression tolerance 5 km, minimum coverage 50 %, minimum cohort size 3, IQR factor 1.5, rotation minimum gap 5,000 km, rotation revalidation after 7 days. |
| `km_data_sources` | The `KmDataSource` contract: `source_type` (`manual_xlsx`, `connected_spreadsheet`, `telematics_api`, `other_import`, `manual_entry`), name, priority, non-sensitive config, `last_ingested_at`. Credentials never live here. |
| `km_daily_readings` | The ledger, unique on (organization, vehicle, date). Snapshots (plate, fleet code); three distance layers (`distance_imported`, `distance_calculated`, `distance_validated`); imported and current odometers; status, alerts and alert detail; correction flags; context at the date (operation, operation city, state, city, BR, fidelization assignment, leader, unit, `context_source`); source columns (`source_type`, `source_id`, `source_reference`, `source_hash`, `ingested_at`, `import_batch_id`). |
| `km_reading_audit` | Append-only trail (`import_update`, `correction`, `review`, `reprocess`, `context_refresh`) with changes, reason, actor and batch. |
| `km_rotation_plans`, `km_rotation_plan_items`, `km_rotation_events` | Rotation plans (code `ROD-00001`), items with the analysis snapshot, gaps, reduction, priority, justification, status, planned date, responsible, execution odometers and Fidelização application; append-only events. |

Reused, not duplicated: `vehicles` and the fleet catalog, `import_batches`
(type `km`) / `import_rows` / `import_errors`, `vehicle_odometer_readings`
(new column `km_reading_id`), `fidelization_assignments`,
`leadership_assignments`, `operation_brs`, `outbox_events`
(`private.emit_event`), `audit_logs` (exports).

## Classification (`private.km_classify`)

Precedence: no reading → inconsistent (end < start, or only one odometer) →
divergence (|informed − calculated| above the tolerance; the calculated value
wins) → high mileage → no movement → validated. Validated distance =
max(calculated, 0). High mileage on a divergent day becomes an alert. Continuity
against the previous day with a reading (in the file or in the ledger) adds
`odometer_regression` (status `pending_review`) or `odometer_jump`.

## Import pipeline

upload → leitura (browser) → staging → validação → comparação → prévia →
confirmação → consolidação → enriquecimento → sincronização → finalização.

1. The browser opens the workbook and takes **only** the sheet whose normalized
   name is `controle km rodado`; otherwise the import stops with "A aba Controle
   KM Rodado não foi localizada." No other sheet is ever picked by similar
   columns. The header row is detected; each row keeps its real row number;
   Excel numbers travel as JSON numbers, text goes to the pt-BR parser
   (`km_parse_number`, `km_parse_date`: ISO, dd/mm/aaaa, dd/mm/aa, Excel serial).
2. `stage_km_import` phase `load` (blocks of 2,000 rows) checks the sheet name,
   creates the batch (file name, SHA-256, size, sheet, header row, source) and
   writes each row already evaluated (`private.km_import_evaluate`): plate
   resolution, statuses, registry divergence, inactive/archived vehicle, future
   date (error with odometer; ignored placeholder without), manual correction
   kept, and the action against the ledger (create / update / skip).
3. `finalize` (once, while draft): file duplicates (same plate+date: identical →
   first wins with a warning; different values → none is written), continuity
   signals, re-flagged updates, and the preview summary — period, rows, plates,
   vehicles, KM total, create / update / unchanged / manual kept, by status,
   unregistered plates, duplicates, future rows, ignored placeholders, already
   imported (same hash), comparison by month, vehicle and operation.
4. `process_km_import` (blocks): audits updates, upserts readings with the
   context at the date (`private.km_context_pairs`: Fidelização → allocation →
   leadership, same rules as the adherence planner), syncs the final odometer
   to `vehicle_odometer_readings` (source `telemetry`, `km_reading_id`), and on
   completion records counts, `last_ingested_at`, the event
   `km.readings_imported` and `km.preventive_milestone_reached` for open
   preventive cycles crossed (only for vehicles with a baseline).

Idempotency: key (organization, vehicle, date); the row hash makes an identical
row a no-op; the file hash flags a re-import in the preview. The same pipeline
receives any future source — only `source_type` changes. **Automatic
synchronization is not implemented in this stage.**

## Reads

`private.km_grid(org, from, to, filters)` is the single dataset: every eligible
vehicle × every day of the period, with the reading or an explicit
`no_reading`, the context (from the reading, or resolved for the missing day),
`in_filter` and `is_future`. Eligible = active vehicles plus any vehicle with a
reading in the period (`fleet_status` changes it). Overview, planner, daily,
analysis, quality, rotation and every export read it, so the same filters give
the same numbers everywhere (suite 29, K9).

- Period: `date_from`/`date_to` (max 400 days) or `competence` (AAAA-MM), or by
  default the competence of the last day with a reading.
- Reference day: the last day of the period with validated KM.
- Freshness (`private.km_vehicle_freshness`): days since the last reading,
  counted against yesterday — Atualizado, 1 dia, 2–3, 4–7, > 7, nunca.
- Coverage: days with reading / elapsed vehicle-days.

### Analysis and dispersion

Cohorts by technical equivalence with fallback (`private.km_cohorts`): N1 type ·
subcategory · model, N2 type · subcategory, N3 type, when the finer cohort has
fewer eligible vehicles than the minimum. Eligibility requires the minimum
coverage; vehicles below it are excluded from the statistics and never called
low-usage. `private.km_dispersion` gives mean, median, Q1, Q3, P10, P90, range,
IQR, coefficient of variation, percentiles, robust z = 0.6745·(x − median)/MAD,
bands (muito acima / acima / dentro / abaixo / muito abaixo da faixa, coorte
insuficiente, dados insuficientes), IQR outliers shown as **"Ponto para
análise"**, and quadrants by the cohort medians of odometer × daily mileage
(Prioridade de alívio, Utilização compensatória, Em equalização, Pode absorver
rodagem). Projections 30/60/90 days use the period's daily average with a
confidence by coverage; the preventive forecast uses the next open cycle.

### Data quality

DQ score = 50 × coverage + 30 × consistency (1 − problem readings / readings) +
20 × freshness (updated active vehicles / active vehicles). Manual correction
(`km_correct_reading`, `km.correct`, reason ≥ 10 characters) changes the
current odometers, reclassifies, audits, syncs the official odometer and emits
`km.odometer_corrected`. `km_review_reading` closes a pending review with a
reason. `km_reprocess` (`km.reprocess`) refreshes the context and reclassifies a
period with the current parameters, auditing every change.
`km_save_settings` (`km.manage_parameters`) emits `km.settings_updated`.

## Rotation plan

`km_rotation_candidates`: pairs within the same cohort (and the same operation
in the default scope), by default only between different cities, where A has a
higher odometer and a higher daily mileage than B and the gap is at least the
configured minimum. With G = odometer A − odometer B and D = (daily A − daily
B) × horizon: gap without rotation = G + D, with rotation = |G − D|, reduction
= (G + D) − |G − D|. Priority by reduction (legacy HFC bands): Alta ≥ 50 %,
Média ≥ 20 %, Baixa ≥ 5 %, below that Sem benefício. Only active vehicles, not
in maintenance in progress and with a reading in the last 15 days enter the
suggestions. Each vehicle appears in at most one suggestion (greedy by
reduction). "Condicionado" flags overdue or near preventive and maintenance in
progress or scheduled. Scenarios for 30/60/90 days and a deterministic
justification come with every pair.

Plans store server-evaluated items (the browser never sends numbers). Status
flow: Sugerido → Aprovado (`km.rotation.approve`) → Programado
(`km.rotation.schedule`, planned date required) → Executado
(`km.rotation.execute`, records both official odometers at the execution date)
or Cancelado (reason required). The plan status follows its active items.
Revalidation recomputes non-executed items with the latest data (stale after
`rotation_stale_days`). Executed items get a post-rotation evaluation (gap at
execution × today, daily mileage before × after). Plans and items are never
deleted — cancelled instead.

**Aplicar na Fidelização** (`km.rotation.apply_fidelization` **and**
`fidelization.change_vehicle` on both BRs): preview of both current
assignments, explicit `confirm: true`, then the official
`invert_fidelization_vehicles` in the same transaction, with the item stamped,
an event and `km.rotation_applied_to_fidelization`.

## KM atual das frotas (`km_fleet_current`)

A snapshot of today, not a period: one row per vehicle in the KM scope and
filters (default: active vehicles; `fleet_status` `all`/`inactive` widen it)
with the **official current odometer** — the most recent non-superseded row of
`vehicle_odometer_readings`, whatever wrote it — plus today's context
(Fidelização → allocation → Lideranças via `private.km_context_pairs`), the
reading's `source`, whether it came from the KM ledger (`km_reading_id` set),
`days_since` (today − reading date, never negative) and the freshness code:
`recent` (today or yesterday), `stale` (2 days or more), `never` (no reading at
all → `odometer_km` null, never 0). `p_filters.freshness` (array of those codes)
restricts the rows; the summary (vehicles, recent, stale, never, avg/max days,
operations, from_km_module, last_reading_date) is computed over the same set.
Context filters (operation, BR, leader, unit, state, city) apply to today's
context. The screen groups the rows by operation ("Sem operação" last), links
each plate to Histórico por frota and exports the same set
(`export/km-atual`, kind `km_atual` in `log_km_export`).

## Integrations

- **Cadastro de Frotas**: plates and vehicle data are read, never written;
  "Histórico de KM" shortcut.
- **Fidelização / BRs / Lideranças**: context at the date (temporal), stored on
  each reading and refreshable by reprocessing.
- **Manutenção**: the KM ledger is the official odometer source
  (`vehicle_odometer_readings`), feeding entry KM, preventive cycles and the
  predictive engine; crossing a preventive milestone emits an event.

### Odometer synchronisation audit (2026-10)

One table is the official odometer for the whole system:
`public.vehicle_odometer_readings` (`source` ∈ initial_registration,
manual_correction, import, checklist, fuelling, maintenance, telemetry;
`superseded_by` marks corrected rows; `km_reading_id` ties a row to a KM day).

| Module | Writes | Reads |
|---|---|---|
| Cadastro de Frotas | initial registration, `correct_vehicle_odometer`, vehicle import, scope mutations | `vehicle_directory` (latest non-superseded → `current_odometer_km`, `odometer_reading_date`, `odometer_source`) |
| Gestão de KM | `private.km_sync_odometer` on every imported day with a trustworthy end odometer (source `telemetry`, note "Gestão de KM — hodômetro final do dia", supersedes the previous row for the same day on change) | `km_fleet_current`; rotation execution odometers |
| Manutenção | entry KM of a maintenance (source `maintenance`) | `private.maintenance_resolve_km` (exact/previous/next reading, `km_compatible_days`, `km_estimated_max_days`), preventive matrix and predictive overview (latest reading per vehicle) |
| Check List / Abastecimento | none yet — the `checklist` and `fuelling` sources are reserved | — |

Conclusions: every module that needs KM reads the same latest row, and the KM
import feeds that row, so Cadastro, Manutenção and KM agree on the current
odometer by construction. Known gaps, by design or pending: Check List and
fuelling do not record odometers; KM-origin rows are labelled `telemetry`
(the screen shows them as "Gestão de KM" through `km_reading_id`; a dedicated
`km` source would need a constraint change); the Visão geral freshness
distribution (`private.km_vehicle_freshness`) counts only KM-ledger readings,
while KM atual uses the official odometer of any source and shows its origin;
Operação in `vehicle_directory` comes from `vehicle_operation_assignments`,
whereas KM uses the Fidelização → allocation → Lideranças context, so the two
labels can differ for a plate whose Fidelização moved.

## Security

RLS on every table: readings are visible when their operation is accessible
(`private.accessible_operation_ids`) or, without operation, when the vehicle is
in the caller's `km.view` scope; rotation plans and events need `km.rotation.view`
in the organization, and an item is visible only when both vehicles are in the
caller's rotation scope. Direct writes are revoked from `authenticated`; every change
goes through a `security definer` routine that checks permission and scope.
Exports are logged in `audit_logs` (`log_km_export`).

Permissions (19): `km.view`, `km.view_dashboard`, `km.view_planner`,
`km.view_daily`, `km.view_history`, `km.view_analysis`, `km.view_quality`,
`km.import`, `km.export`, `km.correct`, `km.reprocess`, `km.rotation.view`,
`km.rotation.create`, `km.rotation.approve`, `km.rotation.schedule`,
`km.rotation.execute`, `km.rotation.apply_fidelization`, `km.view_audit`,
`km.manage_parameters`. Defaults: Administrador and Gestor de Frota — all;
Gestão — views, export, rotation view/approve, audit; Liderança de Operações —
views, rotation view, export; Segurança — view and dashboard.

## Reports (parity with the screen)

| Report | Route | Kind in `audit_logs` |
|---|---|---|
| Controle Mensal (model of the "KM Rodado" sheet) | `/frota/km/export/controle-mensal` | `controle_mensal` |
| Base Consolidada (XLSX/CSV, unpaged) | `/frota/km/export/base` | `base` |
| Relatório Gerencial (XLSX) | `/frota/km/export/gerencial` | `gerencial` |
| Relatório Gerencial (PDF via print) | `/frota/km/relatorio` | `gerencial` (pdf) |
| Qualidade de Dados | `/frota/km/export/qualidade` | `qualidade` |
| Plano de Rodízio | `/frota/km/export/rodizio?plano=` | `rodizio` |

All use the same routines and filters as the screen.

## Front-end (`src/app/(app)/frota/km`)

The route is a server component: it resolves the caller's `km.*` permissions,
reads the URL (`aba`, the ID filters, `modo`, `sub`, `dia`, `veiculo`), loads
only the active tab's data through the routines above and hands typed
`{ data, ctx }` to the tab's panel. Nothing is recomputed in the browser;
`kmRpc` (`src/lib/km/rpc.ts`) camelizes the payloads and `byCode()` reads the
status catalog by code.

| Path | Role |
|---|---|
| `page.tsx`, `km-view.tsx`, `shared.ts` | Route `/frota/km`, tab registry with its permission, `KmPanelContext` / `KmViewData` contracts, PageHeader and the global tab list. |
| `km-filters.tsx` | Global filter bar (competência, operação, UF, cidade, tipo, placa, …) — values are IDs, the plate search is the only text. |
| `panels/overview-panel.tsx` + `overview/*` | Visão geral: KPIs, KM por dia, status and freshness distributions, vehicle rank, insights (`components/km-insights.tsx`). |
| `panels/fleet-panel.tsx` + `fleet/model.ts` | KM atual: metric strip, freshness chips (`leitura` in the URL), search, table grouped by operation (collapsible), plate → Histórico, export link; `model.ts` only groups, labels the source and picks the tone. |
| `panels/analysis-panel.tsx` + `analysis/*` | Análise gerencial: by operation, by location (Operação → Estado → Cidade → BR), dispersion with bands and "Ponto para análise", quadrants, projections. |
| `panels/planner-panel.tsx` + `planner/*` | Planner mês/dia: heat grid (`model.ts`), legend, summary, compact/detailed mode, export of the Controle Mensal. |
| `panels/daily-panel.tsx` + `daily/*` | Visão diária: day picker, ranking, vehicles without reading, inconsistencies. |
| `panels/history-panel.tsx` + `history/*` | Histórico por frota: vehicle picker, cards, charts, month tables. |
| `panels/rotation-panel.tsx` + `rotation/*` | Plano de rodízio: suggestions, analysis drawer (A ⇄ B), add-to-plan dialog, plans table, plan detail and items, status dialogs, Fidelização preview and apply. |
| `panels/quality-panel.tsx` + `quality/*` | Qualidade de dados: score gauge, indicators, fleet health, issues table, `components/correction-dialog.tsx`, parameters. |
| `panels/import-panel.tsx` + `import/*` | Importação: source card (only the official sheet), pipeline steps, open batches, preview summary, findings, outcome. |
| `panels/batches-panel.tsx` + `batches/*` | Lotes: table and batch detail. |
| `panels/reports-panel.tsx` + `reports/*` | Relatórios: report cards → `export/{base,controle-mensal,gerencial,qualidade,rodizio,km-atual}/route.ts` (XLSX via `relatorio/xlsx-kit.ts`, each download logged by `relatorio/export-log.ts` → `log_km_export`) and the printable `relatorio/page.tsx` (`report-document.tsx`, `print-button.tsx`). |

Fixture preview for design and UI tests: `/dev/preview-km` (`kmFixtureStore`);
Playwright: `tests/ui/km.spec.ts`.

## Migrations

| File | Content |
|---|---|
| `20261003100000_km_foundation.sql` | permissions and profile defaults, status catalog, settings, data sources, ledger, audit, rotation tables, `import_batches` type `km`, `vehicle_odometer_readings.km_reading_id`, RLS |
| `20261003101000_km_context_import.sql` | parsers, classification, context at the date, continuity, odometer sync, import evaluation, staging/finalize, findings, consolidation, cancel |
| `20261003102000_km_reads.sql` | grid, freshness, overview, planner, daily, history, cohorts/dispersion/analysis, quality, batches, export page, export log, correction, review, reprocess, settings |
| `20261003103000_km_rotation.sql` | candidates, simulation, plans, item/plan status, revalidation, evaluation, Fidelização preview/apply |
| `20261003111000_km_fleet_current.sql` | `km_fleet_current`: KM atual das frotas (official current odometer of any source, today's context, freshness) |

Tests: `supabase/tests/remote/29_km.sql` (K1–K16).
