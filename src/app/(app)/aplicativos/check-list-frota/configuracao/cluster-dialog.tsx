"use client";

import * as React from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SwitchField } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import type { AdminCluster, ChecklistAdminActions } from "@/lib/applications/admin-queries";

/**
 * Criar ou renomear um cluster. A chave (`cluster_key`) é derivada do nome pelo
 * banco na criação e não muda depois: ela é o que identifica o cluster entre
 * versões.
 */
export function ClusterDialog({
  open,
  onOpenChange,
  versionId,
  cluster,
  actions,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string;
  cluster: AdminCluster | null;
  actions: ChecklistAdminActions;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        {open ? (
          <ClusterForm
            key={cluster?.id ?? "new"}
            versionId={versionId}
            cluster={cluster}
            actions={actions}
            onSaved={onSaved}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ClusterForm({
  versionId,
  cluster,
  actions,
  onSaved,
  onClose,
}: {
  versionId: string;
  cluster: AdminCluster | null;
  actions: ChecklistAdminActions;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(cluster?.name ?? "");
  const [isRequired, setIsRequired] = React.useState(cluster?.isRequired ?? true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    if (saving) return;
    if (!name.trim()) {
      setError("Informe o nome do cluster.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await actions.saveCluster({
      id: cluster?.id,
      versionId,
      name: name.trim(),
      isRequired,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Não foi possível salvar o cluster.");
      return;
    }
    onSaved();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{cluster ? "Editar cluster" : "Novo cluster"}</DialogTitle>
        <DialogDescription>
          {cluster
            ? `Chave ${cluster.clusterKey} — não muda ao renomear.`
            : "Um grupo de perguntas apresentado como uma etapa do checklist."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <FormField label="Nome" required id="cluster-nome">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Luzes e Sinalização"
            autoFocus
          />
        </FormField>
        <SwitchField
          label="Cluster obrigatório"
          description="O motorista não conclui o checklist sem passar por este cluster."
          checked={isRequired}
          onCheckedChange={setIsRequired}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button leadingIcon={<Save />} onClick={() => void submit()} loading={saving}>
          {cluster ? "Salvar cluster" : "Criar cluster"}
        </Button>
      </DialogFooter>
    </>
  );
}
