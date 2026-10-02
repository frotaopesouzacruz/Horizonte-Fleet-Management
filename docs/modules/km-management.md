# Gestão de Frota › Gestão de KM Rodado

The daily mileage ledger of the fleet. One official source per vehicle and day
(`km_daily_readings`), fed by the manual import of **Base Geral KM Rodado.xlsx →
aba "Controle KM Rodado"** today and, later, by connected spreadsheets or
telematics through the same pipeline. Everything the screens, the planner, the
reports and the rotation plan show is read from that ledger by database
routines, under the caller's RLS and scope. The browser never recalculates
mileage, status, coverage or dispersion.

Route: `/frota/km` (menu **Gestão de frota › Gestão de KM Rodado**, permission
`km.view`). Ten tabs, each behind its own permission:

| Tab | Permission | Routine |
|---|---|---|
| Visão geral | `km.view_dashboard` | `km_overview` |
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

## Integrations

- **Cadastro de Frotas**: plates and vehicle data are read, never written;
  "Histórico de KM" shortcut.
- **Fidelização / BRs / Lideranças**: context at the date (temporal), stored on
  each reading and refreshable by reprocessing.
- **Manutenção**: the KM ledger is the official odometer source
  (`vehicle_odometer_readings`), feeding entry KM, preventive cycles and the
  predictive engine; crossing a preventive milestone emits an event.

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

## Migrations

| File | Content |
|---|---|
| `20261003100000_km_foundation.sql` | permissions and profile defaults, status catalog, settings, data sources, ledger, audit, rotation tables, `import_batches` type `km`, `vehicle_odometer_readings.km_reading_id`, RLS |
| `20261003101000_km_context_import.sql` | parsers, classification, context at the date, continuity, odometer sync, import evaluation, staging/finalize, findings, consolidation, cancel |
| `20261003102000_km_reads.sql` | grid, freshness, overview, planner, daily, history, cohorts/dispersion/analysis, quality, batches, export page, export log, correction, review, reprocess, settings |
| `20261003103000_km_rotation.sql` | candidates, simulation, plans, item/plan status, revalidation, evaluation, Fidelização preview/apply |

Tests: `supabase/tests/remote/29_km.sql` (K1–K16).
