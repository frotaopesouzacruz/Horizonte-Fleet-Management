"use client";

import * as React from "react";
import { GitBranchPlus, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/governance/selects";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { Spinner } from "@/components/feedback/spinner";
import type {
  ChecklistAdminActions,
  CreateVersionResult,
  PublishResult,
  VersionBump,
  VersionValidation,
} from "@/lib/applications/admin-queries";

const number = new Intl.NumberFormat("pt-BR");

// ---------------------------------------------------------------------------
// Nova versão de trabalho (§43)
// ---------------------------------------------------------------------------
export function NewVersionDialog({
  open,
  onOpenChange,
  baseLabel,
  actions,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A versão publicada da qual o rascunho é copiado, quando houver. */
  baseLabel: string | null;
  actions: ChecklistAdminActions;
  onCreated: (result: CreateVersionResult) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {open ? (
          <NewVersionForm baseLabel={baseLabel} actions={actions} onCreated={onCreated} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewVersionForm({
  baseLabel,
  actions,
  onCreated,
  onClose,
}: {
  baseLabel: string | null;
  actions: ChecklistAdminActions;
  onCreated: (result: CreateVersionResult) => void;
  onClose: () => void;
}) {
  const [bump, setBump] = React.useState<VersionBump>("minor");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await actions.createVersion({ bump, notes: notes.trim() || null });
    setSaving(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "Não foi possível criar a versão de trabalho.");
      return;
    }
    onCreated(result.data);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nova versão de trabalho</DialogTitle>
        <DialogDescription>
          {baseLabel
            ? `Copia a versão ${baseLabel} inteira — clusters, perguntas, condicionais e regras — para um rascunho editável. A publicada continua valendo até você publicar o rascunho.`
            : "Cria a primeira versão do formulário, vazia, para você montar os clusters e as perguntas."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <FormField
          label="Tipo de versão"
          id="nova-versao-tipo"
          helperText="Menor (1.x) para ajustes de texto e ordem; maior (x.0) quando o formulário muda de significado."
        >
          <NativeSelect value={bump} onChange={(e) => setBump(e.target.value === "major" ? "major" : "minor")}>
            <option value="minor">Versão menor (ex.: 1.0 → 1.1)</option>
            <option value="major">Versão maior (ex.: 1.1 → 2.0)</option>
          </NativeSelect>
        </FormField>
        <FormField label="Notas da versão" id="nova-versao-notas" helperText="O que muda e por quê. Fica no histórico.">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button leadingIcon={<GitBranchPlus />} onClick={() => void submit()} loading={saving}>
          Criar rascunho
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Publicar (§46): valida primeiro, mostra erros e avisos, e só então publica
// ---------------------------------------------------------------------------
export function PublishDialog({
  open,
  onOpenChange,
  versionId,
  versionLabel,
  actions,
  onPublished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string;
  versionLabel: string;
  actions: ChecklistAdminActions;
  onPublished: (result: PublishResult) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {open ? (
          <PublishBody
            key={versionId}
            versionId={versionId}
            versionLabel={versionLabel}
            actions={actions}
            onPublished={onPublished}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PublishBody({
  versionId,
  versionLabel,
  actions,
  onPublished,
  onClose,
}: {
  versionId: string;
  versionLabel: string;
  actions: ChecklistAdminActions;
  onPublished: (result: PublishResult) => void;
  onClose: () => void;
}) {
  const [validation, setValidation] = React.useState<VersionValidation | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [publishing, setPublishing] = React.useState(false);
  const [publishError, setPublishError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    void actions.validateVersion(versionId).then((result) => {
      if (!active) return;
      if (result.ok && result.data) setValidation(result.data);
      else setLoadError(result.error ?? "Não foi possível validar a versão.");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [actions, versionId]);

  const publish = async () => {
    if (publishing) return;
    setPublishing(true);
    setPublishError(null);
    const result = await actions.publishVersion(versionId);
    setPublishing(false);
    if (!result.ok || !result.data) {
      setPublishError(result.error ?? "Não foi possível publicar a versão.");
      return;
    }
    onPublished(result.data);
  };

  const blocked = loading || Boolean(loadError) || !validation || validation.errors.length > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Publicar a versão {versionLabel}</DialogTitle>
        <DialogDescription>
          A publicação arquiva a versão publicada atual e torna esta imutável. Um checklist já
          aberto na versão anterior termina nela.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center gap-2 text-body-sm text-fg-muted">
            <Spinner size="sm" /> Validando a versão…
          </div>
        ) : null}

        {loadError ? (
          <Alert variant="danger">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        {validation ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">{number.format(validation.summary.clusters)} cluster(s)</Badge>
              <Badge variant="neutral">{number.format(validation.summary.questionsActive)} pergunta(s) ativa(s)</Badge>
              <Badge variant="neutral">{number.format(validation.summary.conditionals)} condicional(is)</Badge>
              <Badge variant="neutral">{number.format(validation.summary.rules)} regra(s)</Badge>
              <Badge variant="neutral">{number.format(validation.summary.operationsEnabled)} operação(ões) habilitada(s)</Badge>
            </div>

            {validation.errors.length > 0 ? (
              <Alert variant="danger">
                <AlertTitle>Impedimentos ({validation.errors.length})</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-4" aria-label="Erros de validação">
                    {validation.errors.map((issue, index) => (
                      <li key={`${issue.code}-${index}`}>{issue.message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="success">
                <AlertDescription>Nenhum impedimento: a versão pode ser publicada.</AlertDescription>
              </Alert>
            )}

            {validation.warnings.length > 0 ? (
              <Alert variant="warning">
                <AlertTitle>Avisos ({validation.warnings.length})</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-4" aria-label="Avisos de validação">
                    {validation.warnings.map((issue, index) => (
                      <li key={`${issue.code}-${index}`}>{issue.message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : null}

        {publishError ? (
          <Alert variant="danger">
            <AlertDescription>{publishError}</AlertDescription>
          </Alert>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={publishing}>
          Cancelar
        </Button>
        <Button leadingIcon={<Rocket />} onClick={() => void publish()} disabled={blocked} loading={publishing}>
          Publicar versão {versionLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
