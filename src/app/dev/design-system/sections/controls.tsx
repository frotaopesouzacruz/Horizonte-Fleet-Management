"use client";

import * as React from "react";
import { Download, Filter, Plus, Save, Trash2, Truck } from "lucide-react";
import { Specimen } from "../design-system-view";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid, FormActions } from "@/components/ui/form-field";
import { SearchField } from "@/components/ui/search-field";
import { DateInput, DateRangeInput } from "@/components/ui/date-input";
import { CheckboxField } from "@/components/ui/checkbox";
import { RadioGroup, RadioField } from "@/components/ui/radio-group";
import { SwitchField } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SimpleTooltip } from "@/components/ui/tooltip";

export function ControlsSection() {
  const [search, setSearch] = React.useState("");
  const [plan, setPlan] = React.useState("preventiva");

  return (
    <div className="flex flex-col gap-8">
      <Specimen title="Botões" description="Hierarquia única: primary › secondary › outline › ghost › danger.">
        <Button variant="primary">Salvar</Button>
        <Button variant="secondary">Secundário</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Excluir</Button>
        <Button variant="link">Link</Button>
      </Specimen>

      <Specimen title="Botões · estados e tamanhos">
        <Button size="sm" leadingIcon={<Plus />}>
          Pequeno
        </Button>
        <Button size="md" leadingIcon={<Truck />}>
          Médio
        </Button>
        <Button size="lg" leadingIcon={<Save />}>
          Grande
        </Button>
        <Button loading>Carregando</Button>
        <Button disabled>Desabilitado</Button>
        <IconButton label="Baixar" variant="outline">
          <Download />
        </IconButton>
        <SimpleTooltip content="Remover registro">
          <IconButton label="Remover" variant="danger">
            <Trash2 />
          </IconButton>
        </SimpleTooltip>
      </Specimen>

      <Specimen title="Campos de texto" className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
        <FormField label="Placa" required helperText="Formato Mercosul ou antigo.">
          <Input placeholder="ABC1D23" />
        </FormField>
        <FormField label="Código de frota">
          <Input placeholder="HFM-0001" />
        </FormField>
        <FormField label="Hodômetro" helperText="Última leitura registrada.">
          <Input type="number" placeholder="120000" trailingAddon="km" />
        </FormField>
        <FormField label="RENAVAM" error="Informe os 11 dígitos do RENAVAM.">
          <Input defaultValue="123456" aria-invalid />
        </FormField>
        <FormField label="Senha de integração" helperText="Campo com alternância de visibilidade.">
          <PasswordInput placeholder="••••••••" />
        </FormField>
        <FormField label="Chassi (VIN)" className="sm:col-span-2">
          <Input placeholder="9BWZZZ377VT004251" disabled defaultValue="Indisponível no cadastro" />
        </FormField>
        <FormField label="Observações" className="sm:col-span-2">
          <Textarea placeholder="Notas operacionais sobre o veículo…" minRows={3} />
        </FormField>
      </Specimen>

      <Specimen title="Seleção" className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
        <FormField label="Unidade operacional" required>
          <Select defaultValue="sp">
            <SelectTrigger>
              <SelectValue placeholder="Selecione a unidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sp">São Paulo — Matriz</SelectItem>
              <SelectItem value="cps">Campinas — CD</SelectItem>
              <SelectItem value="rj">Rio de Janeiro — Base</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Tipo de veículo">
          <Select>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="car">Automóvel</SelectItem>
              <SelectItem value="van">Van</SelectItem>
              <SelectItem value="truck">Caminhão</SelectItem>
              <SelectItem value="moto">Motocicleta</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Data de aquisição">
          <DateInput />
        </FormField>
        <FormField label="Período de análise">
          <DateRangeInput />
        </FormField>
      </Specimen>

      <Specimen title="Opções" className="grid w-full max-w-3xl gap-5 sm:grid-cols-3">
        {/* A bare <Label> would point at nothing: these head a group of controls,
            so the group carries the name through aria-labelledby. */}
        <div role="group" aria-labelledby="ds-prefs" className="flex flex-col gap-2">
          <p id="ds-prefs" className="text-label font-medium text-fg-secondary">
            Preferências
          </p>
          <CheckboxField label="Exigir checklist diário" description="Bloqueia a saída sem checklist." defaultChecked />
          <CheckboxField label="Notificar vencimentos" />
          <CheckboxField label="Indisponível" disabled />
        </div>
        <div className="flex flex-col gap-2">
          <p id="ds-plan" className="text-label font-medium text-fg-secondary">
            Plano de manutenção
          </p>
          <RadioGroup value={plan} onValueChange={setPlan} aria-labelledby="ds-plan">
            <RadioField value="preventiva" label="Preventiva" description="Por quilometragem ou tempo." />
            <RadioField value="preditiva" label="Preditiva" description="Baseada em telemetria." />
            <RadioField value="corretiva" label="Corretiva" />
          </RadioGroup>
        </div>
        <div role="group" aria-labelledby="ds-integrations" className="flex flex-col gap-2">
          <p id="ds-integrations" className="text-label font-medium text-fg-secondary">
            Integrações
          </p>
          <SwitchField label="Telemetria" description="Sincroniza a cada 15 minutos." defaultChecked />
          <SwitchField label="Webhooks" />
        </div>
      </Specimen>

      <Specimen title="Busca e ações" className="flex w-full max-w-3xl flex-col gap-3">
        <SearchField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder="Buscar veículo por placa, código ou chassi…"
          shortcutHint="Ctrl K"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" leadingIcon={<Filter />}>
            Filtros
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Ações em massa
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem>
                <Download />
                Exportar seleção
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Truck />
                Transferir unidade
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive>
                <Trash2 />
                Arquivar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm">
                Popover
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              <p className="text-body-sm text-fg-secondary">
                Camada flutuante para filtros e conteúdo auxiliar, com sombra média e animação de 160ms.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </Specimen>

      <Specimen title="Formulário completo" className="w-full max-w-3xl">
        <form className="w-full rounded-md border border-border bg-surface p-4">
          <FormGrid columns={2}>
            <FormField label="Nome do motorista" required>
              <Input placeholder="Nome completo" />
            </FormField>
            <FormField label="Matrícula" helperText="Código interno do colaborador.">
              <Input placeholder="E-00123" />
            </FormField>
          </FormGrid>
          <FormActions className="mt-4">
            <Button variant="ghost">Cancelar</Button>
            <Button leadingIcon={<Save />}>Salvar motorista</Button>
          </FormActions>
        </form>
      </Specimen>
    </div>
  );
}
