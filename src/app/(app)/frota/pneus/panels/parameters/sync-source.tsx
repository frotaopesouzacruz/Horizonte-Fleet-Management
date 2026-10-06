"use client";

import * as React from "react";
import { CloudDownload, KeyRound, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { SwitchField } from "@/components/ui/switch";
import { saveTireSyncSource } from "@/lib/tires/actions";
import {
  fmtInt, formatStamp, modernTerms, SYNC_RUN_STATUS_LABEL, SYNC_RUN_STATUS_TONE, type TireSyncSource,
} from "@/lib/tires/types";
import { numberError, parseNumber, useParamAction } from "./param-ui";

/**
 * Parâmetros → Fonte oficial (SharePoint). Onde fica a planilha Base Geral de
 * Pneus (site, biblioteca e caminho do arquivo) e como a sincronização
 * automática se comporta. Nenhum segredo passa por aqui: as credenciais do
 * aplicativo (Entra ID) ficam só nas variáveis do servidor. A rotina
 * `tire_sync_save_source` revalida tudo e grava a trilha de auditoria.
 */
type Field = "siteHostname" | "sitePath" | "driveName" | "filePath" | "webUrl" | "minInterval";

interface FormState {
  siteHostname: string;
  sitePath: string;
  driveName: string;
  filePath: string;
  webUrl: string;
  isActive: boolean;
  minInterval: string;
}

const INTERVAL_RULE = { integer: true, min: 5, max: 10080 } as const;

const fromSource = (s: TireSyncSource | null): FormState => ({
  siteHostname: s?.siteHostname ?? "",
  sitePath: s?.sitePath ?? "",
  driveName: s?.driveName ?? "",
  filePath: s?.filePath ?? "",
  webUrl: s?.webUrl ?? "",
  isActive: s?.isActive ?? true,
  minInterval: String(s?.minIntervalMinutes ?? 60),
});

/** Mesma normalização da rotina do banco (minúsculas no endereço, sem barras nas pontas do arquivo). */
const norm = {
  siteHostname: (v: string) => v.trim().toLowerCase(),
  sitePath: (v: string) => v.trim(),
  driveName: (v: string) => v.trim(),
  filePath: (v: string) => v.trim().replace(/^\/+|\/+$/g, ""),
  webUrl: (v: string) => v.trim(),
};

/** Espelha as checagens de `tire_sync_sources` (o banco continua decidindo). */
function validate(f: FormState): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  const host = norm.siteHostname(f.siteHostname);
  if (!host) e.siteHostname = "Obrigatório.";
  else if (!/^[a-z0-9-]+\.sharepoint\.com$/.test(host)) e.siteHostname = "Use só o endereço, sem https:// (ex.: empresa.sharepoint.com).";
  const site = norm.sitePath(f.sitePath);
  if (!site) e.sitePath = "Obrigatório.";
  else if (!/^\/sites\/[^/]+$/.test(site)) e.sitePath = "Use o formato /sites/NomeDoSite.";
  const drive = norm.driveName(f.driveName);
  if (!drive) e.driveName = "Obrigatório.";
  else if (drive.length > 120) e.driveName = "No máximo 120 caracteres.";
  const file = norm.filePath(f.filePath);
  if (!file) e.filePath = "Obrigatório.";
  else if (!/\.xlsx$/i.test(file)) e.filePath = "Informe o arquivo .xlsx (ex.: Gestão de Pneus/Base Geral Pneus Rodopar.xlsx).";
  else if (file.length < 5 || file.length > 400) e.filePath = "Entre 5 e 400 caracteres.";
  const web = norm.webUrl(f.webUrl);
  if (web && !/^https:\/\/\S+$/i.test(web)) e.webUrl = "Use o endereço completo, começando por https://.";
  else if (web.length > 1000) e.webUrl = "No máximo 1.000 caracteres.";
  const interval = numberError(f.minInterval, INTERVAL_RULE);
  if (interval) e.minInterval = interval;
  return e;
}

const fmtMinutes = (m: number | null | undefined) => {
  if (m == null) return "—";
  if (m % 1440 === 0) return `${fmtInt(m / 1440)} ${m === 1440 ? "dia" : "dias"}`;
  if (m % 60 === 0) return `${fmtInt(m / 60)} ${m === 60 ? "hora" : "horas"}`;
  return `${fmtInt(m)} min`;
};

export function SyncSourceSection({ source, canManage, onDone }: { source: TireSyncSource | null; canManage: boolean; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-5" data-testid="tires-param-source">
      <Alert variant="info" icon={<KeyRound />} data-testid="tires-param-source-credentials">
        <AlertTitle>As credenciais do aplicativo (Entra ID) não ficam aqui</AlertTitle>
        <AlertDescription>
          O acesso ao SharePoint usa um aplicativo registrado no Microsoft Entra ID. Locatário, cliente e segredo ficam só nas variáveis do servidor —{" "}
          <span className="font-mono text-caption">MS_GRAPH_TENANT_ID</span>, <span className="font-mono text-caption">MS_GRAPH_CLIENT_ID</span> e{" "}
          <span className="font-mono text-caption">MS_GRAPH_CLIENT_SECRET</span> —, nunca no banco nem nesta tela. Permissão de aplicativo:{" "}
          <span className="font-mono text-caption">Sites.Selected</span> (concedida só ao site da planilha) ou{" "}
          <span className="font-mono text-caption">Files.Read.All</span>.
        </AlertDescription>
      </Alert>
      {/* Remonta quando a fonte gravada muda (depois de salvar e recarregar). */}
      <SourceForm key={`${source?.id ?? "none"}:${source?.updatedAt ?? ""}`} source={source} canManage={canManage} onDone={onDone} />
      {source ? <SourceStatus source={source} /> : null}
    </div>
  );
}

function SourceForm({ source, canManage, onDone }: { source: TireSyncSource | null; canManage: boolean; onDone: () => void }) {
  const initial = React.useMemo(() => fromSource(source), [source]);
  const [form, setForm] = React.useState<FormState>(initial);
  const [submitted, setSubmitted] = React.useState(false);
  const { busy, run } = useParamAction(onDone);
  const saving = busy === "source";
  const errors = validate(form);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const interval = parseNumber(form.minInterval);
  // Link em branco não apaga o gravado (a rotina mantém o anterior): não conta como mudança.
  const webChanged = norm.webUrl(form.webUrl) !== "" && norm.webUrl(form.webUrl) !== (source?.webUrl ?? "");
  const changed: string[] = source
    ? [
        norm.siteHostname(form.siteHostname) !== source.siteHostname ? "siteHostname" : null,
        norm.sitePath(form.sitePath) !== source.sitePath ? "sitePath" : null,
        norm.driveName(form.driveName) !== source.driveName ? "driveName" : null,
        norm.filePath(form.filePath) !== source.filePath ? "filePath" : null,
        webChanged ? "webUrl" : null,
        form.isActive !== source.isActive ? "isActive" : null,
        interval !== source.minIntervalMinutes ? "minInterval" : null,
      ].filter((v): v is string => v !== null)
    : [];
  const changeCount = changed.length;
  const locationChanged = changed.some((k) => k === "siteHostname" || k === "sitePath" || k === "driveName" || k === "filePath");
  const shown = (key: Field) => (submitted || form[key] !== initial[key] ? errors[key] : undefined);
  const isChanged = (key: string) => source != null && changed.includes(key);

  const submit = async () => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0 || (source && changeCount === 0)) return;
    const ok = await run(
      "source",
      () =>
        saveTireSyncSource({
          siteHostname: norm.siteHostname(form.siteHostname),
          sitePath: norm.sitePath(form.sitePath),
          driveName: norm.driveName(form.driveName),
          filePath: norm.filePath(form.filePath),
          webUrl: norm.webUrl(form.webUrl) || null,
          isActive: form.isActive,
          minIntervalMinutes: interval as number,
        }),
      {
        success: source ? "Fonte oficial atualizada" : "Fonte oficial cadastrada",
        successDescription: locationChanged ? "Outro arquivo ou local: a próxima sincronização localiza a planilha de novo." : undefined,
        failure: "Não foi possível salvar a fonte oficial",
      },
    );
    if (ok) setSubmitted(false);
  };

  const reset = () => {
    setForm(initial);
    setSubmitted(false);
  };

  const text = (key: Exclude<Field, "minInterval">, label: string, opts: { help: React.ReactNode; placeholder: string; required?: boolean; className?: string }) => (
    <FormField
      label={label}
      required={opts.required !== false}
      labelHint={opts.required === false ? "Opcional" : undefined}
      error={shown(key)}
      helperText={
        isChanged(key) && !shown(key) ? (
          <span className="text-info-soft-fg">Gravado: {(source?.[key] as string | null | undefined) || "—"}</span>
        ) : (
          opts.help
        )
      }
      className={opts.className}
    >
      <Input
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={opts.placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={saving}
        className={cn(isChanged(key) && !shown(key) && "border-info")}
        data-testid={`tires-param-source-${key}`}
      />
    </FormField>
  );

  const location = [norm.siteHostname(form.siteHostname) + norm.sitePath(form.sitePath), norm.driveName(form.driveName), norm.filePath(form.filePath)]
    .filter(Boolean)
    .join(" › ");

  if (!canManage) {
    return (
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card variant="outlined" data-testid="tires-param-source-location">
          <CardHeader title="Localização da planilha" description="Onde fica a Base Geral de Pneus no SharePoint." />
          <CardContent>
            {source ? (
              <dl className="flex flex-col divide-y divide-border-subtle">
                <ReadRow label="Endereço do SharePoint" value={source.siteHostname} mono />
                <ReadRow label="Site" value={source.sitePath} mono />
                <ReadRow label="Biblioteca de documentos" value={source.driveName} />
                <ReadRow label="Caminho do arquivo" value={source.filePath} />
                <ReadRow
                  label="Link web"
                  value={
                    source.webUrl ? (
                      <a href={source.webUrl} target="_blank" rel="noreferrer" className="break-all text-link underline-offset-2 hover:underline hfm-focus-ring">
                        Abrir a planilha no SharePoint
                        <span className="sr-only"> (abre em nova aba)</span>
                      </a>
                    ) : null
                  }
                />
              </dl>
            ) : (
              <p className="text-body-sm text-fg-muted">Nenhuma fonte cadastrada.</p>
            )}
          </CardContent>
        </Card>
        <Card variant="outlined" data-testid="tires-param-source-automation">
          <CardHeader title="Sincronização automática" />
          <CardContent>
            <dl className="flex flex-col divide-y divide-border-subtle">
              <ReadRow label="Situação" value={source ? (source.isActive ? "Ativa" : "Pausada") : null} />
              <ReadRow label="Agenda automática" value={source?.scheduleLabel ?? null} />
              <ReadRow label="Intervalo mínimo entre execuções agendadas" value={source ? fmtMinutes(source.minIntervalMinutes) : null} />
            </dl>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      data-testid="tires-param-source-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {source ? null : (
        <Alert variant="warning" data-testid="tires-param-source-missing">
          <AlertTitle>Nenhuma fonte oficial cadastrada</AlertTitle>
          <AlertDescription>Sem a fonte, a sincronização com o SharePoint não roda (o envio manual da planilha segue como contingência).</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card variant="outlined" data-testid="tires-param-source-location">
          <CardHeader
            title="Localização da planilha"
            description="Onde fica a Base Geral de Pneus no SharePoint. A sincronização encontra o arquivo por estes dados (Microsoft Graph)."
          />
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {text("siteHostname", "Endereço do SharePoint", { placeholder: "empresa.sharepoint.com", help: "Só o domínio, sem https://." })}
              {text("sitePath", "Site", { placeholder: "/sites/NomeDoSite", help: "Como aparece no endereço do site." })}
            </div>
            {text("driveName", "Biblioteca de documentos", {
              placeholder: "Documentos Compartilhados",
              help: "Nome da biblioteca como aparece no SharePoint.",
            })}
            {text("filePath", "Caminho do arquivo", {
              placeholder: "Gestão de Pneus/Base Geral Pneus Rodopar.xlsx",
              help: "Pastas e nome do arquivo dentro da biblioteca, terminando em .xlsx.",
            })}
            {text("webUrl", "Link web", {
              required: false,
              placeholder: "https://empresa.sharepoint.com/sites/…/arquivo.xlsx",
              help: "Atalho para abrir a planilha a partir da tela. Em branco mantém o link já gravado.",
            })}
            {location ? (
              <p className="break-words text-caption text-fg-muted" data-testid="tires-param-source-path">
                <span className="font-semibold text-fg-secondary">Arquivo procurado:</span> {location}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card variant="outlined" data-testid="tires-param-source-automation">
          <CardHeader
            title="Sincronização automática"
            description="A agenda automática é diária e definida no agendador do servidor; aqui ela é ligada, pausada e limitada."
          />
          <CardContent className="flex flex-col gap-4">
            <SwitchField
              label="Fonte ativa"
              description="Pausada, a execução agendada não roda. “Sincronizar agora” (aba Sincronização) continua disponível."
              checked={form.isActive}
              onCheckedChange={(v) => set("isActive", v)}
              disabled={saving}
              className={cn("rounded-md border border-border", isChanged("isActive") && "border-info")}
              data-testid="tires-param-source-active"
            />
            <FormField
              label="Intervalo mínimo entre execuções agendadas"
              required
              error={shown("minInterval")}
              helperText={
                isChanged("minInterval") && !shown("minInterval") ? (
                  <span className="text-info-soft-fg">Gravado: {fmtMinutes(source?.minIntervalMinutes)}</span>
                ) : (
                  "A execução agendada é pulada se houve tentativa há menos tempo que isso (5 minutos a 7 dias)."
                )
              }
              className="sm:max-w-[18rem]"
            >
              <Input
                value={form.minInterval}
                onChange={(e) => set("minInterval", e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                trailingAddon="min"
                disabled={saving}
                className={cn(isChanged("minInterval") && !shown("minInterval") && "border-info")}
                data-testid="tires-param-source-minInterval"
              />
            </FormField>
            <div className="flex flex-col gap-0.5 rounded-md bg-surface-secondary px-3 py-2">
              <span className="text-caption text-fg-muted">Agenda automática</span>
              <span className="text-body-sm font-medium text-fg" data-testid="tires-param-source-schedule">
                {source?.scheduleLabel ?? "Diária (definida no agendador do servidor)"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="tires-param-source-save-card">
        <CardContent className="flex flex-col-reverse gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body-sm text-fg-muted" aria-live="polite">
            {!source
              ? "Preencha a localização e salve para cadastrar a fonte."
              : changeCount === 0
                ? "Nenhum valor alterado."
                : `${fmtInt(changeCount)} ${changeCount === 1 ? "valor alterado" : "valores alterados"}${
                    submitted && Object.keys(errors).length ? " — corrija os campos destacados." : "."
                  }${locationChanged ? " Mudar o arquivo ou o local faz a próxima sincronização localizá-lo de novo." : ""}`}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="ghost" leadingIcon={<RotateCcw />} onClick={reset} disabled={saving || (source != null && changeCount === 0)}>
              Descartar alterações
            </Button>
            <Button
              type="submit"
              variant="primary"
              leadingIcon={<Save />}
              loading={saving}
              disabled={source != null && changeCount === 0}
              data-testid="tires-param-source-save"
            >
              {source ? "Salvar fonte oficial" : "Cadastrar fonte oficial"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

function ReadRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-baseline sm:gap-x-4">
      <dt className="text-body-sm text-fg-secondary">{label}</dt>
      <dd className={cn("min-w-0 break-words text-body-sm font-medium text-fg", mono && "font-mono text-caption")}>{value ?? "—"}</dd>
    </div>
  );
}

/** Último resultado conhecido da fonte (o detalhe de cada execução fica na aba Sincronização). */
function SourceStatus({ source }: { source: TireSyncSource }) {
  const any = source.lastStatus || source.lastAttemptAt || source.lastSuccessAt || source.lastError;
  if (!any) {
    return (
      <p className="text-body-sm text-fg-muted" data-testid="tires-param-source-status">
        Nenhuma sincronização registrada para esta fonte ainda.
      </p>
    );
  }
  return (
    <Card variant="outlined" data-testid="tires-param-source-status">
      <CardHeader
        title="Última sincronização"
        description="O histórico completo, com cada execução e o log, fica na aba Sincronização Rodopar."
        actions={<CloudDownload className="size-4 text-fg-muted" aria-hidden />}
      />
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="flex flex-col gap-1">
            <dt className="text-caption text-fg-muted">Situação</dt>
            <dd>
              {source.lastStatus ? (
                <StatusBadge status={SYNC_RUN_STATUS_TONE[source.lastStatus] ?? "neutral"} size="sm" withIcon data-testid="tires-param-source-last-status">
                  {SYNC_RUN_STATUS_LABEL[source.lastStatus] ?? source.lastStatus}
                </StatusBadge>
              ) : (
                <span className="text-body-sm text-fg-muted">—</span>
              )}
            </dd>
          </div>
          <StatusFact label="Última tentativa" value={formatStamp(source.lastAttemptAt)} />
          <StatusFact label="Último sucesso" value={formatStamp(source.lastSuccessAt)} />
          <StatusFact label="Última mudança aplicada" value={formatStamp(source.lastChangeAt)} />
          <StatusFact label="Arquivo modificado no SharePoint em" value={formatStamp(source.lastFileModifiedAt)} />
          <StatusFact label="Falhas seguidas" value={fmtInt(source.consecutiveFailures)} />
        </dl>
        {source.lastError ? (
          <Alert variant={source.lastStatus === "falhou" ? "danger" : "warning"} data-testid="tires-param-source-last-error">
            <AlertTitle>Motivo informado na última execução</AlertTitle>
            <AlertDescription>{modernTerms(source.lastError)}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm font-medium text-fg tabular-nums">{value}</dd>
    </div>
  );
}
