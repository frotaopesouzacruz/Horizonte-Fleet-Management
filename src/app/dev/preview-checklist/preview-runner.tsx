"use client";

import * as React from "react";
import { ChecklistRunner, type RunnerStart } from "@/app/(app)/aplicativos/check-list-frota/checklist-runner";
import type { ChecklistForm } from "@/lib/applications/queries";

/**
 * O executor com um formulário fixo.
 *
 * A amostra não é aleatória: traz um caso de cada coisa que o executor precisa
 * distinguir — pergunta positiva, pergunta invertida com descrição obrigatória,
 * condicional de escolha única, condicional de múltipla escolha, item crítico e
 * pergunta com orientação operacional. São exatamente os seis comportamentos
 * que quebram sem ninguém perceber.
 */
export const FORM: ChecklistForm = {
  appId: "app-1",
  appName: "Check List de Frota",
  versionId: "ver-1",
  versionLabel: "1.0",
  minDurationSeconds: 60,
  maxDurationSeconds: 600,
  vehicle: { id: "veh-1", licensePlate: "ABC1D23", fleetCode: "FR-0142" },
  clusters: [
    {
      id: "cl-1",
      clusterKey: "5s",
      name: "5S",
      questions: [
        {
          id: "q-1", questionKey: "5s.limpeza_externa",
          text: "A frota está limpa externamente?",
          conformingAnswer: "yes", criticality: "media", isRequired: true,
          allowsNote: true, noteRequired: false, guidance: null, conditional: null,
        },
      ],
    },
    {
      id: "cl-2",
      clusterKey: "funilaria",
      name: "Funilaria",
      questions: [
        {
          id: "q-2", questionKey: "funilaria.avaria",
          text: "Possui alguma avaria? Exemplo: amassado, arranhão, quebra ou dano aparente.",
          // Invertida: SIM é inconformidade.
          conformingAnswer: "no", criticality: "media", isRequired: true,
          allowsNote: true, noteRequired: false, guidance: null,
          conditional: {
            fieldKey: "descricao_avaria", triggerAnswer: "yes",
            label: "Descreva a avaria identificada.", fieldType: "text",
            isRequired: true, options: [],
          },
        },
      ],
    },
    {
      id: "cl-3",
      clusterKey: "implementos",
      name: "Implementos / Carroceria",
      questions: [
        {
          id: "q-3", questionKey: "implementos.camera_re",
          text: "A câmera de ré está funcionando?",
          conformingAnswer: "yes", criticality: "media", isRequired: true,
          allowsNote: true, noteRequired: false,
          guidance: "Nesta operação os veículos podem não sair de fábrica com este equipamento. Conforme regra operacional aprovada, responda SIM quando o veículo não o possuir.",
          conditional: null,
        },
        {
          id: "q-4", questionKey: "implementos.prateleiras",
          text: "As prateleiras estão em boas condições?",
          conformingAnswer: "yes", criticality: "media", isRequired: true,
          allowsNote: true, noteRequired: false, guidance: null,
          conditional: {
            fieldKey: "local_inconformidade", triggerAnswer: "no",
            label: "Onde está a inconformidade?", fieldType: "single_select",
            isRequired: true,
            options: [
              { value: "bau_lateral", label: "Baú lateral" },
              { value: "bau_traseiro", label: "Baú traseiro" },
            ],
          },
        },
      ],
    },
    {
      id: "cl-4",
      clusterKey: "luzes",
      name: "Luzes e Sinalização",
      questions: [
        {
          id: "q-5", questionKey: "luzes.freio",
          text: "As luzes de freio estão funcionando?",
          conformingAnswer: "yes", criticality: "critica", isRequired: true,
          allowsNote: true, noteRequired: false, guidance: null,
          conditional: {
            fieldKey: "lado_falha", triggerAnswer: "no",
            label: "Qual lado apresenta falha?", fieldType: "single_select",
            isRequired: true,
            options: [
              { value: "esquerdo", label: "Esquerdo" },
              { value: "direito", label: "Direito" },
            ],
          },
        },
        {
          id: "q-6", questionKey: "luzes.farois",
          text: "Os faróis estão funcionando?",
          conformingAnswer: "yes", criticality: "media", isRequired: true,
          allowsNote: true, noteRequired: false, guidance: null,
          conditional: {
            fieldKey: "itens_falha", triggerAnswer: "no",
            label: "Qual item apresenta falha?", fieldType: "multi_select",
            isRequired: true,
            options: [
              { value: "farol_esquerdo", label: "Farol esquerdo" },
              { value: "farol_direito", label: "Farol direito" },
              { value: "milha_esquerdo", label: "Milha esquerdo" },
              { value: "milha_direito", label: "Milha direito" },
            ],
          },
        },
      ],
    },
  ],
};

const START: RunnerStart = {
  form: FORM,
  operationId: "op-1",
  operationName: "Last Mille MG",
  checklistType: "saida",
  operationalDate: "2026-09-22",
  vehicleLabel: "ABC1D23",
  brCode: "BR0024706",
};

export function PreviewRunner() {
  return (
    <ChecklistRunner
      start={START}
      idempotencyKey="preview-fixo"
      onFinished={() => {}}
      onCancel={() => {}}
    />
  );
}
