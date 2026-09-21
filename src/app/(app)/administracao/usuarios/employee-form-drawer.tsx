"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, IdCard, KeyRound, Save, User, Building2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Drawer, DrawerContent, DrawerHeader, DrawerBody, DrawerFooter, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectContent, SelectEmpty, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { LoadingState } from "@/components/feedback/loading-state";
import { useToast } from "@/components/feedback/toast";
import { EMPLOYMENT_STATUS_LABELS, isValidCpf } from "@/lib/admin/qlp";
import type { DirectoryOptions, Option } from "@/lib/admin/queries";
import { loadEmployeeDetail } from "@/lib/admin/detail-actions";
import { saveEmployee, grantAccess } from "@/lib/admin/actions";

const STEPS = [
  { id: "pessoal", label: "Dados pessoais", icon: User },
  { id: "vinculo", label: "Vínculo", icon: Building2 },
  { id: "cnh", label: "CNH", icon: IdCard },
  { id: "acesso", label: "Acesso HFM", icon: KeyRound },
] as const;

type StepId = (typeof STEPS)[number]["id"];

interface FormState {
  id: string | null;
  employee_code: string;
  full_name: string;
  cpf: string;
  birth_date: string;
  employment_status: string;
  admission_date: string;
  corporate_email: string;
  job_position_id: string;
  employment_area_id: string;
  operation_id: string;
  work_location_id: string;
  organization_unit_id: string;
  business_profile_id: string;
  manager_employee_id: string;
  license_category: string;
  license_number: string;
  license_expiration_date: string;
  license_first_date: string;
  license_points: string;
  grantAccess: boolean;
  roleIds: string[];
  operationIds: string[];
}

const EMPTY: FormState = {
  id: null,
  employee_code: "",
  full_name: "",
  cpf: "",
  birth_date: "",
  employment_status: "active",
  admission_date: "",
  corporate_email: "",
  job_position_id: "",
  employment_area_id: "",
  operation_id: "",
  work_location_id: "",
  organization_unit_id: "",
  business_profile_id: "",
  manager_employee_id: "",
  license_category: "",
  license_number: "",
  license_expiration_date: "",
  license_first_date: "",
  license_points: "",
  grantAccess: false,
  roleIds: [],
  operationIds: [],
};

/**
 * Registration and editing, as a short wizard.
 *
 * The form can be completed and saved without an e-mail: most of the corporate
 * base has none, and an employee is not an account. The access step is the only
 * place that changes, and it is opt-in.
 */
export function EmployeeFormDrawer({
  open,
  employeeId,
  options,
  permissions,
  isPlatformAdmin,
  onOpenChange,
}: {
  open: boolean;
  employeeId: string | null;
  options: DirectoryOptions;
  permissions: string[];
  isPlatformAdmin: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = React.useState<StepId>("pessoal");
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [loading, setLoading] = React.useState(false);
  const [saving, startSaving] = React.useTransition();
  const [touched, setTouched] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const can = (permission: string) => isPlatformAdmin || permissions.includes(permission);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  // Opening the drawer (or switching records) resets the form during render:
  // an effect would show the previous record for one frame.
  const [session, setSession] = React.useState(() => `${open}:${employeeId ?? ""}`);
  const currentSession = `${open}:${employeeId ?? ""}`;
  if (session !== currentSession) {
    setSession(currentSession);
    setStep("pessoal");
    setTouched(false);
    setServerError(null);
    setForm(EMPTY);
    setLoading(open && Boolean(employeeId));
  }

  React.useEffect(() => {
    if (!open || !employeeId) return;

    let cancelled = false;
    void loadEmployeeDetail(employeeId)
      .then((detail) => {
        if (cancelled || !detail) return;
        const row = detail.directory;
        setForm({
          ...EMPTY,
          id: row.id,
          employee_code: row.employee_code ?? "",
          full_name: row.full_name ?? "",
          cpf: detail.sensitive?.cpf ?? "",
          birth_date: detail.sensitive?.birth_date ?? "",
          employment_status: row.employment_status ?? "active",
          admission_date: row.admission_date ?? "",
          corporate_email: row.corporate_email ?? "",
          job_position_id: row.job_position_id ?? "",
          employment_area_id: row.employment_area_id ?? "",
          operation_id: row.operation_id ?? "",
          work_location_id: row.work_location_id ?? "",
          organization_unit_id: row.organization_unit_id ?? "",
          business_profile_id: row.business_profile_id ?? "",
          manager_employee_id: row.manager_employee_id ?? "",
          license_category: detail.license?.category ?? "",
          license_number: detail.license?.license_number ?? "",
          license_expiration_date: detail.license?.expiration_date ?? "",
          license_first_date: detail.license?.first_license_date ?? "",
          license_points: detail.license?.points === null || detail.license?.points === undefined ? "" : String(detail.license.points),
          grantAccess: false,
          roleIds: detail.roleIds,
          operationIds: detail.scopeOperationIds,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, employeeId]);

  const codeError = touched && !form.employee_code.trim() ? "Informe a matrícula." : undefined;
  const nameError = touched && form.full_name.trim().length < 2 ? "Informe o nome completo." : undefined;
  const cpfDigits = form.cpf.replace(/\D/g, "");
  const cpfError = touched && cpfDigits && !isValidCpf(cpfDigits.padStart(11, "0")) ? "CPF inválido." : undefined;
  const emailError =
    touched && form.corporate_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.corporate_email)
      ? "E-mail inválido."
      : undefined;
  const accessEmailError =
    form.grantAccess && !form.corporate_email ? "Informe um e-mail corporativo para conceder acesso." : undefined;

  const blocking = Boolean(codeError || nameError || cpfError || emailError || accessEmailError);
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  function submit() {
    setTouched(true);
    setServerError(null);

    if (!form.employee_code.trim() || form.full_name.trim().length < 2) {
      setStep("pessoal");
      return;
    }
    if (cpfDigits && !isValidCpf(cpfDigits.padStart(11, "0"))) {
      setStep("pessoal");
      return;
    }
    if (form.grantAccess && !form.corporate_email) {
      setStep("acesso");
      return;
    }

    startSaving(async () => {
      const data = new FormData();
      const put = (key: string, value: string | null) => data.set(key, value ?? "");
      if (form.id) put("id", form.id);
      put("employee_code", form.employee_code.trim());
      put("full_name", form.full_name.trim());
      put("corporate_email", form.corporate_email.trim().toLowerCase());
      put("employment_status", form.employment_status);
      put("admission_date", form.admission_date);
      put("cpf", cpfDigits ? cpfDigits.padStart(11, "0") : "");
      put("birth_date", form.birth_date);
      put("job_position_id", form.job_position_id);
      put("employment_area_id", form.employment_area_id);
      put("operation_id", form.operation_id);
      put("work_location_id", form.work_location_id);
      put("organization_unit_id", form.organization_unit_id);
      put("business_profile_id", form.business_profile_id);
      put("manager_employee_id", form.manager_employee_id);
      put("license_category", form.license_category);
      put("license_number", form.license_number);
      put("license_expiration_date", form.license_expiration_date);
      put("license_first_date", form.license_first_date);
      put("license_points", form.license_points);

      const result = await saveEmployee(data);
      if (!result.ok || !result.data) {
        setServerError(result.error ?? "Não foi possível salvar.");
        return;
      }

      if (form.grantAccess) {
        const access = await grantAccess(result.data.id, form.roleIds, form.operationIds);
        if (!access.ok) {
          toast({
            title: "Colaborador salvo, acesso não concedido",
            description: access.error,
            variant: "warning",
          });
          onOpenChange(false);
          router.refresh();
          return;
        }
        toast({ title: "Colaborador salvo e acesso concedido.", description: access.warning, variant: "success" });
      } else {
        toast({ title: form.id ? "Colaborador atualizado." : "Colaborador cadastrado.", variant: "success" });
      }

      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" size="lg" className="w-[min(100vw,42rem)]">
        <DrawerHeader>
          <DrawerTitle>{form.id ? "Editar colaborador" : "Novo colaborador"}</DrawerTitle>
          <DrawerDescription>
            O cadastro do colaborador independe de conta no sistema. O acesso ao HFM é concedido separadamente.
          </DrawerDescription>

          <nav aria-label="Etapas do cadastro" className="mt-3 flex flex-wrap gap-1">
            {STEPS.map((item, index) => {
              const Icon = item.icon;
              const active = item.id === step;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStep(item.id)}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-body-sm hfm-transition hfm-focus-ring",
                    active ? "bg-primary-soft font-medium text-primary-soft-fg" : "text-fg-secondary hover:bg-secondary",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{item.label}</span>
                  <span className="sm:hidden">{index + 1}</span>
                </button>
              );
            })}
          </nav>
        </DrawerHeader>

        <DrawerBody>
          {loading ? (
            <LoadingState label="Carregando cadastro…" />
          ) : (
            <div className="flex flex-col gap-4">
              {serverError ? (
                <Alert variant="danger">
                  <AlertTitle>Não foi possível salvar</AlertTitle>
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              ) : null}

              {step === "pessoal" ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Nome completo" required error={nameError} className="sm:col-span-2">
                    <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} autoComplete="off" />
                  </FormField>
                  <FormField label="Matrícula" required error={codeError}>
                    <Input value={form.employee_code} onChange={(e) => set("employee_code", e.target.value)} inputMode="numeric" />
                  </FormField>
                  <FormField label="Situação" required>
                    <Select value={form.employment_status} onValueChange={(value) => set("employment_status", value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(EMPLOYMENT_STATUS_LABELS).map(([id, label]) => (
                          <SelectItem key={id} value={id}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="CPF" error={cpfError} helperText="Opcional. Armazenado com acesso restrito.">
                    <Input
                      value={form.cpf}
                      onChange={(e) => set("cpf", e.target.value)}
                      inputMode="numeric"
                      placeholder="000.000.000-00"
                    />
                  </FormField>
                  <FormField label="Data de nascimento">
                    <DateInput value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
                  </FormField>
                  <FormField label="Data de admissão">
                    <DateInput value={form.admission_date} onChange={(e) => set("admission_date", e.target.value)} />
                  </FormField>
                  <FormField
                    label="E-mail corporativo"
                    error={emailError}
                    helperText="Opcional para o cadastro; obrigatório apenas para conceder acesso ao sistema."
                  >
                    <Input
                      type="email"
                      value={form.corporate_email}
                      onChange={(e) => set("corporate_email", e.target.value)}
                      placeholder="nome@empresa.com.br"
                    />
                  </FormField>
                </div>
              ) : null}

              {step === "vinculo" ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <OptionSelect label="Cargo" value={form.job_position_id} onChange={(v) => set("job_position_id", v)} options={options.positions} />
                  <OptionSelect label="Área" value={form.employment_area_id} onChange={(v) => set("employment_area_id", v)} options={options.areas} />
                  <OptionSelect label="Operação" value={form.operation_id} onChange={(v) => set("operation_id", v)} options={options.operations} />
                  <OptionSelect label="Localidade" value={form.work_location_id} onChange={(v) => set("work_location_id", v)} options={options.locations} />
                  <OptionSelect label="Filial" value={form.organization_unit_id} onChange={(v) => set("organization_unit_id", v)} options={options.units} />
                  <OptionSelect label="Líder imediato" value={form.manager_employee_id} onChange={(v) => set("manager_employee_id", v)} options={options.managers} />
                  <OptionSelect
                    label="Perfil organizacional"
                    value={form.business_profile_id}
                    onChange={(v) => set("business_profile_id", v)}
                    options={options.profiles}
                    helperText="Classificação da base corporativa. Não concede nenhum privilégio no sistema."
                    className="sm:col-span-2"
                  />
                </div>
              ) : null}

              {step === "cnh" ? (
                <>
                  <p className="text-body-sm text-fg-secondary">
                    Opcional. Colaboradores administrativos não precisam de CNH — deixe em branco para ignorar esta etapa.
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField label="Categoria" helperText="Letras de A a E (ex.: AB, D).">
                      <Input
                        value={form.license_category}
                        onChange={(e) => set("license_category", e.target.value.toUpperCase().replace(/[^A-E]/g, ""))}
                        maxLength={3}
                      />
                    </FormField>
                    <FormField label="Número">
                      <Input
                        value={form.license_number}
                        onChange={(e) => set("license_number", e.target.value.replace(/\D/g, ""))}
                        inputMode="numeric"
                        maxLength={11}
                      />
                    </FormField>
                    <FormField label="Validade">
                      <DateInput value={form.license_expiration_date} onChange={(e) => set("license_expiration_date", e.target.value)} />
                    </FormField>
                    <FormField label="1ª habilitação">
                      <DateInput value={form.license_first_date} onChange={(e) => set("license_first_date", e.target.value)} />
                    </FormField>
                    <FormField label="Pontuação">
                      <Input
                        value={form.license_points}
                        onChange={(e) => set("license_points", e.target.value.replace(/\D/g, ""))}
                        inputMode="numeric"
                        maxLength={2}
                      />
                    </FormField>
                  </div>
                </>
              ) : null}

              {step === "acesso" ? (
                <div className="flex flex-col gap-4">
                  {!can("users.manage_access") ? (
                    <Alert variant="info">
                      <AlertTitle>Concessão de acesso indisponível</AlertTitle>
                      <AlertDescription>
                        Você pode cadastrar o colaborador, mas não possui permissão para conceder acesso ao sistema.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      <label className="flex items-start gap-2.5 rounded-sm border border-border-subtle px-3 py-2.5">
                        <Checkbox
                          className="mt-0.5"
                          checked={form.grantAccess}
                          onCheckedChange={(checked) => set("grantAccess", Boolean(checked))}
                        />
                        <span>
                          <span className="block text-body-sm font-medium text-fg">Conceder acesso ao sistema agora</span>
                          <span className="block text-caption text-fg-muted">
                            Envia um convite por e-mail. O colaborador define a própria senha; nenhuma senha é escolhida
                            aqui.
                          </span>
                        </span>
                      </label>

                      {accessEmailError ? (
                        <Alert variant="warning">
                          <AlertTitle>E-mail obrigatório</AlertTitle>
                          <AlertDescription>{accessEmailError}</AlertDescription>
                        </Alert>
                      ) : null}

                      {form.grantAccess ? (
                        <>
                          <Separator />
                          <fieldset className="flex flex-col gap-2">
                            <legend className="text-body-sm font-semibold text-fg">Perfil de acesso</legend>
                            <div className="flex flex-col gap-1.5">
                              {options.roles.map((role) => (
                                <label key={role.id} className="flex items-start gap-2.5 rounded-sm border border-border-subtle px-3 py-2">
                                  <Checkbox
                                    className="mt-0.5"
                                    checked={form.roleIds.includes(role.id)}
                                    onCheckedChange={(checked) =>
                                      set(
                                        "roleIds",
                                        checked ? [...form.roleIds, role.id] : form.roleIds.filter((id) => id !== role.id),
                                      )
                                    }
                                  />
                                  <span>
                                    <span className="block text-body-sm font-medium text-fg">{role.label}</span>
                                    {role.description ? (
                                      <span className="block text-caption text-fg-muted">{role.description}</span>
                                    ) : null}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </fieldset>

                          <fieldset className="flex flex-col gap-2">
                            <legend className="text-body-sm font-semibold text-fg">Operações permitidas</legend>
                            <p className="text-caption text-fg-muted">
                              Sem operações atribuídas a conta não enxerga dados operacionais. Lista vazia nunca significa
                              &ldquo;todas&rdquo;.
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {options.operations.map((operation) => (
                                <label
                                  key={operation.id}
                                  className={cn(
                                    "inline-flex cursor-pointer items-center gap-2 rounded-sm border px-2.5 py-1.5 text-body-sm",
                                    form.operationIds.includes(operation.id)
                                      ? "border-primary bg-primary-soft text-primary-soft-fg"
                                      : "border-border-subtle text-fg-secondary hover:border-border-strong",
                                  )}
                                >
                                  <Checkbox
                                    checked={form.operationIds.includes(operation.id)}
                                    onCheckedChange={(checked) =>
                                      set(
                                        "operationIds",
                                        checked
                                          ? [...form.operationIds, operation.id]
                                          : form.operationIds.filter((id) => id !== operation.id),
                                      )
                                    }
                                  />
                                  {operation.label}
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </DrawerBody>

        <DrawerFooter className="justify-between">
          <Button
            variant="ghost"
            leadingIcon={<ArrowLeft />}
            disabled={stepIndex === 0 || saving}
            onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].id)}
          >
            Voltar
          </Button>
          <div className="flex gap-2">
            {stepIndex < STEPS.length - 1 ? (
              <Button variant="secondary" trailingIcon={<ArrowRight />} onClick={() => setStep(STEPS[stepIndex + 1].id)}>
                Avançar
              </Button>
            ) : null}
            <Button leadingIcon={form.grantAccess ? <Check /> : <Save />} loading={saving} disabled={blocking && touched} onClick={submit}>
              {form.grantAccess ? "Salvar e conceder acesso" : "Salvar colaborador"}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function OptionSelect({
  label,
  value,
  onChange,
  options,
  helperText,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  helperText?: string;
  className?: string;
}) {
  return (
    <FormField label={label} helperText={helperText} className={className}>
      <Select value={value || "__none"} onValueChange={(next) => onChange(next === "__none" ? "" : next)}>
        <SelectTrigger>
          <SelectValue placeholder="Não informado" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">Não informado</SelectItem>
          {options.length === 0 ? (
            <SelectEmpty>Nenhum item cadastrado para {label.toLowerCase()}.</SelectEmpty>
          ) : (
            options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.hint ? `${option.hint} · ${option.label}` : option.label}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </FormField>
  );
}
