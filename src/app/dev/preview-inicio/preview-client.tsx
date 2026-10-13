"use client";

import * as React from "react";
import { OperationalHomeView, type OperationalHomeProps } from "@/app/(app)/inicio/operational-home";
import { DETAILS } from "../preview-historico/fixture";
import type { ExecutionDetail } from "@/lib/applications/history-queries";

/**
 * O "Meu resumo" da prévia com o detalhe do checklist vindo de dados fixos.
 * O carregador é uma função de cliente — a página (servidor) não pode passá-la.
 */
const SAMPLES = Object.values(DETAILS);

async function loadDetail(id: string): Promise<{ ok: true; data: ExecutionDetail } | { ok: false; error: string }> {
  const sample = id.endsWith("-retorno") ? SAMPLES[2] : id.endsWith("-02-saida") || id.includes("-11-") ? SAMPLES[0] : SAMPLES[1];
  return sample ? { ok: true, data: { ...sample, id } } : { ok: false, error: "Checklist não encontrado no seu escopo." };
}

export function PreviewOperationalHome(props: Omit<OperationalHomeProps, "detailLoader">) {
  return <OperationalHomeView {...props} detailLoader={loadDetail} />;
}
