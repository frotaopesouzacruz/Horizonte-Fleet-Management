"use client";

import * as React from "react";
import { Eye, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/governance/selects";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ChecklistRunner, type RunnerStart } from "@/app/(app)/aplicativos/check-list-frota/checklist-runner";
import type { ChecklistForm, ChecklistType } from "@/lib/applications/queries";
import type { AdminOperation, AdminVehicleType, ChecklistAdminActions } from "@/lib/applications/admin-queries";

/**
 * Pré-visualização (§45): o formulário que um veículo hipotético responderia
 * sob esta versão, no MESMO executor do motorista — para que o que a
 * administração vê seja o que o campo vai ver. Nada é gravado nem enviado.
 */
export function PreviewPanel({
  versionId,
  versionLabel,
  operations,
  vehicleTypes,
  actions,
  today,
}: {
  versionId: string;
  versionLabel: string;
  operations: AdminOperation[];
  vehicleTypes: AdminVehicleType[];
  actions: ChecklistAdminActions;
  today: string;
}) {
  const [checklistType, setChecklistType] = React.useState<ChecklistType>("saida");
  const [operationId, setOperationId] = React.useState("");
  const [vehicleTypeId, setVehicleTypeId] = React.useState("");
  const [subcategoryId, setSubcategoryId] = React.useState("");
  const [form, setForm] = React.useState<ChecklistForm | null>(null);
  const [runKey, setRunKey] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const subcategories = React.useMemo(
    () => vehicleTypes.find((t) => t.id === vehicleTypeId)?.subcategories.filter((s) => s.isActive) ?? [],
    [vehicleTypes, vehicleTypeId],
  );

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    const result = await actions.loadVersionPreview({
      versionId,
      operationId: operationId || null,
      vehicleTypeId: vehicleTypeId || null,
      vehicleSubcategoryId: subcategoryId || null,
    });
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "Não foi possível montar a pré-visualização.");
      setForm(null);
      return;
    }
    setForm(result.data);
    setRunKey((k) => k + 1);
  };

  const operation = operations.find((o) => o.id === operationId);
  const vehicleType = vehicleTypes.find((t) => t.id === vehicleTypeId);

  const start: RunnerStart | null = form
    ? {
        form,
        operationId: operationId || "previa",
        operationName: operation?.name ?? "Qualquer operação",
        checklistType,
        operationalDate: today,
        vehicleLabel: vehicleType ? `PRÉVIA · ${vehicleType.name}` : "PRÉVIA",
        brCode: null,
      }
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div>
            <h3 className="text-h4 font-semibold text-fg">Simular o formulário da versão {versionLabel}</h3>
            <p className="text-caption text-fg-muted">
              Escolha o contexto e veja exatamente o que o motorista receberia: a aplicabilidade
              e as orientações são resolvidas pelo banco, como na execução real. Nada é gravado.
            </p>
          </div>
          <FormGrid columns={2}>
            <FormField label="Tipo de checklist" id="previa-tipo">
              <NativeSelect fieldSize="sm" value={checklistType} onChange={(e) => setChecklistType(e.target.value === "retorno" ? "retorno" : "saida")}>
                <option value="saida">Saída de rota</option>
                <option value="retorno">Retorno de rota</option>
              </NativeSelect>
            </FormField>
            <FormField label="Operação" id="previa-operacao">
              <NativeSelect fieldSize="sm" value={operationId} onChange={(e) => setOperationId(e.target.value)}>
                <option value="">Qualquer operação</option>
                {operations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}{o.isEnabled ? "" : " (não habilitada)"}</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Tipo de equipamento" id="previa-tipo-equipamento">
              <NativeSelect fieldSize="sm" value={vehicleTypeId} onChange={(e) => { setVehicleTypeId(e.target.value); setSubcategoryId(""); }}>
                <option value="">Qualquer tipo</option>
                {vehicleTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Subcategoria" id="previa-subcategoria">
              <NativeSelect fieldSize="sm" value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)} disabled={subcategories.length === 0}>
                <option value="">Qualquer subcategoria</option>
                {subcategories.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </NativeSelect>
            </FormField>
          </FormGrid>
          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button leadingIcon={<Eye />} onClick={() => void generate()} loading={loading}>
              {form ? "Gerar nova prévia" : "Gerar prévia"}
            </Button>
            {form ? (
              <Button variant="secondary" leadingIcon={<RotateCcw />} onClick={() => setForm(null)}>
                Encerrar prévia
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {start ? (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3" data-testid="previa-executor">
          <Alert variant="info">
            <AlertDescription>
              Prévia da versão {form?.versionLabel}: {form?.clusters.length ?? 0} cluster(s) e{" "}
              {form?.clusters.reduce((n, c) => n + c.questions.length, 0) ?? 0} pergunta(s) aplicáveis
              ao contexto escolhido. Nada do que for respondido aqui é enviado.
            </AlertDescription>
          </Alert>
          <ChecklistRunner
            key={runKey}
            start={start}
            idempotencyKey={`preview-${versionId}-${runKey}`}
            preview
            onFinished={() => setForm(null)}
            onCancel={() => setForm(null)}
          />
        </div>
      ) : (
        <EmptyState
          icon={<Eye />}
          title="Nenhuma prévia gerada"
          description="Escolha o contexto acima e gere a prévia para percorrer o formulário como o motorista."
        />
      )}
    </div>
  );
}
