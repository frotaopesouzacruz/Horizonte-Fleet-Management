# Segurança › Gestão de MTSR — Ingestão

How the official state of a component gets written from outside a field
inspection: the manual backoffice update, the historical conformity import and,
in the future, connectors. Everything enters through the same door
(`private.mtsr_ingest_one` → `private.mtsr_apply_status`), is recorded in
`mtsr_ingestion_events` and obeys the same priority and idempotency rules. The
module overview is in [`mtsr-management.md`](./mtsr-management.md).

## Sources and priorities

`mtsr_ingestion_sources` (per organisation, editable in Cadastros):

| Code | Type | Available | Enabled | Priority | Notes |
|---|---|---|---|---|---|
| `backoffice_manual` | `backoffice_manual` | yes | yes | 20 | Manual update by the management (CFTV, MDVR, Geotab, corrections). |
| `manual_import` | `manual_import` | yes | yes | 40 | Legacy conformity spreadsheet, with preview and reconciliation. |
| `geotab_api` | `geotab_api` | **no** | no | 10 | Connector not implemented. |
| `mdvr_api` | `mdvr_api` | **no** | no | 10 | Connector not implemented. |
| `cftv_api` | `cftv_api` | **no** | no | 10 | Connector not implemented. |
| `other_connector` | `other_connector` | **no** | no | 50 | Reserved for future integrations. |

`mtsr_component_sources` sets the priority **per component** (lower wins); the
seed gives every component backoffice 20, import 40, other 50, and the dedicated
connector 10 to Geotab (`geotab_api`), MDVR (`mdvr_api`) and Câmeras
(`cftv_api`). `private.mtsr_source_priority` resolves a reading's priority:
`field_inspection` is always 0 (best), then the component's row for that source,
then the source's own priority, then the best priority of that source type, then
100.

## The ingestion event

`mtsr_ingest_events(p_organization_id, p_source_code, p_events jsonb)` requires
`mtsr.ingestion.manage` and a source that is **enabled and available**;
`p_events` is an array of objects with these keys:

| Key | Meaning |
|---|---|
| `vehicle_id` or `license_plate` | The vehicle. The plate is normalised (`private.normalize_plate`) and must exist in `vehicles`. **Never created.** |
| `component_id` or `component_code` | The component; the code matches `code`, the name or any alias (`private.mtsr_resolve_component`). |
| `status` | Free text normalised by `private.mtsr_normalize_status` to `ok`, `nok` or `sem_informacao` (see "accepted values"). |
| `reference_date` | Date of the reading (ISO). Default: `source_timestamp` in São Paulo, else today. |
| `source_timestamp` | When the source produced the reading (optional). |
| `source_record_id` | The source's own identifier (optional; part of the hash). |
| `source_system` | Overrides the source's `source_system` (optional). |
| `observation` | Free text kept with the reading (optional). |
| `confidence` | Numeric 0–1 (optional, stored only). |
| `raw` | The original record, stored as received (optional; defaults to the whole event). |

Every event is written to `mtsr_ingestion_events` first (raw + normalised), then
decided:

| Outcome | Reason | When |
|---|---|---|
| `rejected` | `vehicle_not_found` | Plate / id not in the Cadastro de Frotas. |
| `rejected` | `component_not_found` | Code, name or alias unknown. |
| `rejected` | `status_unknown` | Text not recognised as OK / NOK / sem informação. |
| `rejected` | `future_date` | `reference_date` after today. |
| `ignored` | `stale` | The component already has a reading with a later `reference_date`. |
| `conflict` | `lower_priority_source` | Same `reference_date`, and the current reading comes from a better-priority source (field inspection, backoffice over import, connector over backoffice). |
| `ignored` | `no_change` | Same date, same priority, same status. |
| `applied` | — | `private.mtsr_apply_status` ran: history row, status, events. |

Stale and conflict also emit `INGESTAO_IGNORADA` / `INGESTAO_CONFLITO` in
`mtsr_events` with the reason. The comparison is skipped when the current state
is `sem_informacao` or has no `reference_date`, and when the caller forces
(`p_force`, used only by the backoffice update).

**Idempotency by hash.** `hash = md5(source code | vehicle id or normalised
plate | component id or normalised code | reference date | normalised status |
source_record_id)`, unique per organisation. A repeated event returns the
original event's outcome with `duplicate = true` and writes nothing.

The event applied through this door is `ATUALIZACAO_BACKOFFICE` for connectors,
`IMPORTACAO` for the import, and for the manual source `ATUALIZACAO_BACKOFFICE`
when the component is a backoffice one or `ALTERACAO_MANUAL` when it is a field
component (a manual correction of a field reading).

## Manual backoffice update

`mtsr_component_status_update(p_organization_id, {vehicle_id, reference_date?,
source_system?, reference?, items: [{component_id, status, observation?,
reference_date?}]})`, permission `mtsr.backoffice.update`, vehicle in the
caller's scope. Rules: at least one item; the reference date cannot be in the
future (default today); a NOK requires an observation; each item goes through
`mtsr_ingest_one` with the source `backoffice_manual` and **force** — it is a
deliberate statement by the management, so stale and priority checks do not
apply, and a rejection (unknown component or status) aborts the whole call.
The screen (Ingestão › Atualização do backoffice) calls `updateBackofficeStatus`
in `src/lib/mtsr/actions.ts`.

## Historical conformity import

Permission `mtsr.import`. Pipeline, all in the browser and in
`stage_mtsr_import` / `process_mtsr_import`:

```
upload → leitura (navegador) → load (staging em blocos) → validate → finalize (prévia)
       → confirmação → process (ingestão por manual_import, em blocos) → histórico
```

### The model workbook

`buildMtsrTemplate` (`src/lib/mtsr/template.ts`) generates
`modelo-conformidade-mtsr.xlsx` from the **active** components of the catalogue:
sheet **Conformidade** with the fixed columns and one column per component (data
validation list OK / NOK / Sem informação, 2,000 rows), plus a sheet
**Instruções** with the rules below.

| Column | Required | Meaning |
|---|---|---|
| Placa | yes (or Frota) | Identifies the vehicle in the Cadastro de Frotas. Aliases: `placa`, `placa do veiculo`, `veiculo`. |
| Frota | no | Used only when Placa is empty. Aliases: `frota`, `codigo frota`, `cod frota`, `numero frota`. |
| Última vistoria | no | Date of the last valid inspection (dd/mm/aaaa, ISO or an Excel date). Feeds the deadline; never goes back. Aliases: `ultima vistoria`, `data ultima vistoria`, `data da ultima vistoria`, `ultima verificacao`, `data`. |
| Observação | no | Free text kept with every reading of the row. Aliases: `observacao`, `observacoes`, `obs`. |
| one per component | no | Status of that component. The header matches the component's name, code or any alias (accents, case and punctuation ignored). |

**Accepted values** (`private.mtsr_normalize_status`): OK — `ok`, `conforme`,
`funcionando`, `operante`, `sim`, `bom`, `regular`, `normal`, `1`, `true`,
`ativo`; NOK — `nok`, `n ok`, `não conforme`, `inoperante`, `defeito`,
`avariado`, `quebrado`, `não`, `n`, `falha`, `pendente reparo`, `0`, `false`,
`inativo`, `não funciona`; Sem informação — empty, `-`, `—`, `n/a`, `na`, `sem
informação`, `desconhecido`, `não informado`, `ni`. Texts containing those words
(`nok`, `não conforme`, `inoperante`, `defeito`, `avaria`, `falha`; `ok`,
`conforme`, `operante`) are recognised too; anything else is ignored with a
warning and the row continues with its other values.

### Pipeline

1. **Leitura** (`readMtsrImportFile`, ExcelJS in the browser): the sheet named
   `Conformidade` or, failing that, the first sheet whose first 20 rows contain
   a Placa header; the header row maps the fixed columns and the component
   columns; unknown headers are listed; the file's SHA-256 is computed. The
   file is refused when no component column and no Última vistoria exist, or
   when there are no data rows.
2. **Load** (`stage_mtsr_import` phase `load`, blocks of 500 rows, halving on
   a timeout): the first block creates the `import_batches` row (type
   `mtsr_conformity`, file name, hash, size, column mapping, `already_imported`
   when a completed batch has the same hash, `reference_default`); rows go to
   `import_rows` with their real row number. Loading after validation started
   is refused.
3. **Validate** (phase `validate`, in steps): plate (normalised) or fleet code
   resolved to a vehicle, active first; `last_inspection_date` parsed and
   checked against today; every component cell resolved and normalised;
   per-row status `valid` / `warning` / `error` with the finding codes below.
4. **Finalize** (phase `finalize`): refuses while rows are pending; builds the
   preview — totals, vehicles, rows with a date, recognised cells, period, by
   component (OK / NOK / sem informação), unknown plates, the first 60 findings
   (errors first), the first 25 rows as a sample, `already_imported` and
   `reference_default` — and marks the batch `validated`.
5. **Confirmação**: the screen (`MtsrImportSection`) shows the preview and asks;
   the confirm button is disabled when no row is usable (valid + warning).
6. **Process** (`process_mtsr_import`, blocks of up to 500 rows, resumable):
   for every usable row, each normalised component goes through
   `mtsr_ingest_one` with the source `manual_import`, `reference_date` = the
   row's date or the batch's `reference_default` (default today),
   `source_record_id = batch:row`, `source_system` = the file name, event
   `IMPORTACAO`; the row's date advances `mtsr_vehicle_facts` with `greatest`
   (and `last_valid_source = manual_import` only when it advanced). Rows become
   `updated` (something applied or a date given) or `skipped`; a database error
   on one row marks it `failed` with the message and the batch continues. When
   nothing is left the batch is `completed`, `stats` (applied, ignored,
   conflict, rejected, duplicate, rows, facts) are stored in the summary and the
   event `IMPORTACAO` is logged.

### Finding codes (`import_errors.code`)

| Code | Level | Meaning |
|---|---|---|
| `import_unknown_vehicle` | error | Placa/frota not found in the Cadastro de Frotas — the import never creates vehicles. The plate is listed in `unknown_plates`. |
| `invalid_date` | error | Última vistoria could not be read as a date. |
| `future_date` | error | Última vistoria after today. |
| `no_components` | warning | No recognised component status and no date: nothing to apply. |
| `partial` | warning | Some values or columns were not recognised and were ignored; the message lists them. |
| `failed` | error | The database refused the row during processing (message = the error). |

Errors keep the row out; warnings do not block.

### What the import never does

- create a vehicle, an operation or a component;
- overwrite a reading with a later `reference_date` (stale → ignored);
- beat a field inspection or a backoffice reading of the same date (conflict);
- move `last_valid_inspection_date` backwards;
- duplicate: the reading hash and the file hash recognise what already entered
  (re-importing the same file gives duplicates, not new history);
- touch Perfis & Permissões, the Cadastro de Frotas or the maintenance base.

### History

`mtsr_import_history(org, limit)` (permission `mtsr.import` or
`mtsr.audit.view`) lists the latest `mtsr_conformity` batches with totals,
`summary.stats`, the author's name and the first 50 findings. The Ingestão tab
shows it under the import.

## Enabling a connector in the future

Nothing in the module invents an API. To add a real integration (Geotab, MDVR,
CFTV or another system):

1. Build the adapter **outside the database** (an Edge Function, a scheduled
   job or a server action): authenticate with the vendor, read the vehicle ×
   component state and translate it into the event contract above
   (`license_plate` or `vehicle_id`, `component_code` matching a catalogue code
   or alias, `status` text, `reference_date` or `source_timestamp`,
   `source_record_id` for idempotency, `raw` with the original record).
2. Call `mtsr_ingest_events(org, '<source code>', events)` with a session
   that holds `mtsr.ingestion.manage` (or the service role). The routine
   normalises, deduplicates and applies with the component's priority for that
   source; the result lists applied / ignored / conflict / rejected / duplicate
   per event.
3. Only then flip `is_available = true` on the source (that column is not
   editable from the screen on purpose: `mtsr_save_source` refuses to enable a
   source whose adapter does not exist) and enable it in Cadastros › Fontes,
   adjusting `mtsr_component_sources` if the priority should differ from the
   seed (dedicated connector 10 > backoffice 20 > import 40 > other 50).
4. Add the component aliases the vendor uses (Cadastros › Componentes), so
   `component_code` resolves without a translation table.

Until then the Saúde tab counts the backoffice components as
`components_without_source` when no enabled and available source is mapped to
them, and the Visão geral lists every source with `is_available`,
`is_enabled`, the last event and the events of the last 30 days.
