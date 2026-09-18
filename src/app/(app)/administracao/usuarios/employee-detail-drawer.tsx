"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  Pause,
  Pencil,
  Play,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Drawer, DrawerContent, DrawerHeader, DrawerBody, DrawerFooter, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { LoadingState } from "@/components/feedback/loading-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { EMPLOYMENT_STATUS_LABELS, ACCESS_STATUS_LABELS } from "@/lib/admin/qlp";
import type { DirectoryOptions } from "@/lib/admin/queries";
import { loadEmployeeDetail, type EmployeeDetailPayload } from "@/lib/admin/detail-actions";
import {
  archiveEmployee,
  restoreEmployee,
  grantAccess,
  resendInvite,
  setAccessStatus,
  setOperationScopes,
  setRoles,
} from "@/lib/admin/actions";
import { formatDate } from "./users-view";

const ACCESS_TONE = {
  active: "success",
  invited: "pending",
  suspended: "warning",
  removed: "neutral",
  none: "neutral",
} as const;

const LICENSE_STATE = {
  valid: { tone: "success" as const, label: "Válida" },
  expiring: { tone: "warning" as const, label: "Próxima do vencimento" },
  expired: { tone: "danger" as const, label: "Vencida" },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm text-fg">{children || "—"}</dd>
    </div>
  );
}

/**
 * Detail of one employee.
 *
 * The tabs mirror the real separation of concerns: who the person is, where
 * they sit in the organization, whether they have an HFM account (a different
 * thing entirely), their licence, and what happened to the record.
 */
export function EmployeeDetailDrawer({
  employeeId,
  options,
  onClose,
  onEdit,
}: {
  employeeId: string | null;
  options: DirectoryOptions;
  onClose: () => void;
  onEdit: (id: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [detail, setDetail] = React.useState<EmployeeDetailPayload | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [revealed, setRevealed] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);

  // Opening another record resets the view during render instead of through an
  // effect, so the drawer never paints the previous person's data for a frame.
  const [shownId, setShownId] = React.useState(employeeId);
  if (shownId !== employeeId) {
    setShownId(employeeId);
    setDetail(null);
    setRevealed(false);
  }

  React.useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    void loadEmployeeDetail(employeeId).then((result) => {
      if (!cancelled) setDetail(result);
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId, reloadToken]);

  const loading = Boolean(employeeId) && detail === null;

  const can = (permission: string) => detail?.permissions.includes(permission) ?? false;
  const row = detail?.directory;

  function run(action: () => Promise<{ ok: boolean; error?: string; warning?: string }>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast({ title: successMessage, description: result.warning, variant: result.warning ? "warning" : "success" });
        setReloadToken((token) => token + 1);
        router.refresh();
      } else {
        toast({ title: "Ação não concluída", description: result.error, variant: "danger" });
      }
    });
  }

  return (
    <Drawer open={Boolean(employeeId)} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent side="right" size="lg" className="w-[min(100vw,44rem)]">
        <DrawerHeader>
          <DrawerTitle>{row?.full_name ?? "Colaborador"}</DrawerTitle>
          <DrawerDescription>
            {row ? `Matrícula ${row.employee_code} · ${row.job_position_name ?? "Sem cargo"}` : "Carregando registro…"}
          </DrawerDescription>
          {row ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge
                status={row.employment_status === "active" ? "success" : row.employment_status === "on_leave" ? "warning" : "neutral"}>{EMPLOYMENT_STATUS_LABELS[row.employment_status ?? ""] ?? "—"}</StatusBadge>
              <StatusBadge
                status={ACCESS_TONE[(row.access_status ?? "none") as keyof typeof ACCESS_TONE] ?? "neutral"}
              >{`Acesso: ${ACCESS_STATUS_LABELS[row.access_status ?? "none"]}`}</StatusBadge>
              {row.deleted_at ? <Badge variant="neutral">Cadastro inativo</Badge> : null}
            </div>
          ) : null}
        </DrawerHeader>

        <DrawerBody>
          {loading && !detail ? (
            <LoadingState label="Carregando colaborador…" />
          ) : !detail || !row ? (
            <EmptyState title="Registro indisponível" description="O colaborador não foi encontrado ou você não tem acesso a ele." />
          ) : (
            <Tabs defaultValue="cadastro">
              <TabsList className="mb-4">
                <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
                <TabsTrigger value="vinculo">Vínculo</TabsTrigger>
                <TabsTrigger value="acesso">Acesso</TabsTrigger>
                <TabsTrigger value="cnh">CNH</TabsTrigger>
                <TabsTrigger value="historico">Histórico</TabsTrigger>
              </TabsList>

              {/* ---------------------------------------------------- cadastro */}
              <TabsContent value="cadastro">
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Nome completo">{row.full_name}</Field>
                  <Field label="Matrícula">{row.employee_code}</Field>
                  <Field label="Situação">{EMPLOYMENT_STATUS_LABELS[row.employment_status ?? ""]}</Field>
                  <Field label="Data de admissão">{formatDate(row.admission_date)}</Field>
                  <Field label="E-mail corporativo">
                    {row.corporate_email ?? <span className="text-fg-muted">Não informado</span>}
                  </Field>
                  <Field label="CPF">
                    {detail.masked?.has_cpf ? (
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">
                          {revealed && detail.sensitive?.cpf ? formatCpf(detail.sensitive.cpf) : detail.masked.cpf_masked}
                        </span>
                        {can("users.view_sensitive") && detail.sensitive?.cpf ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            leadingIcon={revealed ? <EyeOff /> : <Eye />}
                            onClick={() => setRevealed((value) => !value)}
                          >
                            {revealed ? "Ocultar" : "Exibir"}
                          </Button>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-fg-muted">Não informado</span>
                    )}
                  </Field>
                  <Field label="Data de nascimento">
                    {detail.sensitive?.birth_date && revealed
                      ? formatDate(detail.sensitive.birth_date)
                      : detail.masked?.birth_year
                        ? `${detail.masked.birth_year} (ano)`
                        : <span className="text-fg-muted">Restrito</span>}
                  </Field>
                  <Field label="Última atualização">{formatDateTime(row.updated_at)}</Field>
                </dl>
                {!can("users.view_sensitive") ? (
                  <p className="mt-4 text-caption text-fg-muted">
                    CPF e data de nascimento completos exigem a permissão de visualização de dados pessoais.
                  </p>
                ) : null}
              </TabsContent>

              {/* ----------------------------------------------------- vínculo */}
              <TabsContent value="vinculo">
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Cargo">
                    {row.job_position_code ? `${row.job_position_code} · ${row.job_position_name}` : row.job_position_name}
                  </Field>
                  <Field label="Área">{row.employment_area_name}</Field>
                  <Field label="Operação">{row.operation_name}</Field>
                  <Field label="Localidade">{row.work_location_name}</Field>
                  <Field label="Filial">
                    {row.organization_unit_code
                      ? `${row.organization_unit_code} · ${row.organization_unit_name}`
                      : row.organization_unit_name}
                  </Field>
                  <Field label="Líder imediato">{row.manager_name}</Field>
                  <Field label="Perfil organizacional">{row.business_profile_name}</Field>
                </dl>

                {detail.assignments.length > 1 ? (
                  <>
                    <Separator className="my-4" />
                    <h3 className="mb-2 text-body-sm font-semibold text-fg">Movimentações anteriores</h3>
                    <ul className="flex flex-col gap-2">
                      {detail.assignments
                        .filter((assignment) => !assignment.is_current)
                        .map((assignment) => (
                          <li key={assignment.id} className="rounded-sm border border-border-subtle px-3 py-2 text-body-sm">
                            <span className="text-fg">{assignment.job_positions?.name ?? "Sem cargo"}</span>
                            {assignment.operations?.name ? (
                              <span className="text-fg-secondary"> · {assignment.operations.name}</span>
                            ) : null}
                            <span className="block text-caption text-fg-muted">
                              {formatDate(assignment.effective_from)} — {formatDate(assignment.effective_to)}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-4 text-caption text-fg-muted">
                    Este colaborador possui apenas o vínculo atual. Movimentações futuras ficam registradas aqui.
                  </p>
                )}
              </TabsContent>

              {/* ------------------------------------------------------ acesso */}
              <TabsContent value="acesso">
                <AccessTab
                  detail={detail}
                  options={options}
                  pending={pending}
                  onGrant={(roleIds, operationIds) =>
                    run(() => grantAccess(row.id!, roleIds, operationIds), "Acesso concedido. O convite foi enviado por e-mail.")
                  }
                  onRoles={(roleIds) =>
                    run(() => setRoles(row.membership_id!, roleIds), "Perfil de acesso atualizado.")
                  }
                  onScopes={(operationIds) =>
                    run(() => setOperationScopes(row.membership_id!, operationIds), "Operações permitidas atualizadas.")
                  }
                  onStatus={(status) =>
                    run(
                      () => setAccessStatus(row.id!, status),
                      status === "active" ? "Acesso reativado." : "Acesso suspenso.",
                    )
                  }
                  onResend={() => run(() => resendInvite(row.id!), "Convite reenviado.")}
                />
              </TabsContent>

              {/* --------------------------------------------------------- CNH */}
              <TabsContent value="cnh">
                {detail.license ? (
                  <>
                    {row.license_state ? (
                      <div className="mb-4">
                        <StatusBadge
                          status={LICENSE_STATE[row.license_state as keyof typeof LICENSE_STATE]?.tone ?? "neutral"} withIcon>{LICENSE_STATE[row.license_state as keyof typeof LICENSE_STATE]?.label ?? "—"}</StatusBadge>
                      </div>
                    ) : null}
                    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Categoria">{detail.license.category}</Field>
                      <Field label="Número">
                        {detail.license.license_number ? (
                          can("users.view_sensitive") && revealed ? (
                            <span className="tabular-nums">{detail.license.license_number}</span>
                          ) : (
                            <span className="tabular-nums">
                              {"•".repeat(Math.max(0, detail.license.license_number.length - 3))}
                              {detail.license.license_number.slice(-3)}
                            </span>
                          )
                        ) : null}
                      </Field>
                      <Field label="Validade">{formatDate(detail.license.expiration_date)}</Field>
                      <Field label="1ª habilitação">{formatDate(detail.license.first_license_date)}</Field>
                      <Field label="Pontuação">
                        {detail.license.points === null ? null : `${detail.license.points} ponto(s)`}
                      </Field>
                    </dl>
                    <p className="mt-4 text-caption text-fg-muted">
                      A gestão completa de CNH (renovações, bloqueios, anexos) entra com o módulo de Motoristas.
                    </p>
                  </>
                ) : (
                  <EmptyState
                    title="Sem CNH cadastrada"
                    description="Este colaborador não possui dados de habilitação. A CNH é opcional e não é exigida de funções administrativas."
                  />
                )}
              </TabsContent>

              {/* --------------------------------------------------- histórico */}
              <TabsContent value="historico">
                {!can("users.audit_view") ? (
                  <EmptyState
                    title="Histórico restrito"
                    description="A leitura do histórico de alterações exige a permissão correspondente."
                  />
                ) : detail.history.length === 0 ? (
                  <EmptyState title="Sem eventos" description="Nenhuma alteração registrada para este cadastro." />
                ) : (
                  <ol className="flex flex-col gap-2">
                    {detail.history.map((event) => (
                      <li key={event.id} className="flex gap-3 rounded-sm border border-border-subtle px-3 py-2">
                        <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
                        <span className="min-w-0">
                          <span className="block text-body-sm text-fg">{describeAudit(event.action, event.entity_type)}</span>
                          {event.changed_fields?.length ? (
                            <span className="block truncate text-caption text-fg-muted">
                              Campos: {event.changed_fields.join(", ")}
                            </span>
                          ) : null}
                          <span className="block text-caption text-fg-muted">{formatDateTime(event.created_at)}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="mt-4 text-caption text-fg-muted">
                  O histórico é somente leitura: registros de auditoria não podem ser alterados nem removidos.
                </p>
              </TabsContent>
            </Tabs>
          )}
        </DrawerBody>

        {row ? (
          <DrawerFooter>
            {row.deleted_at ? (
              can("users.archive") ? (
                <Button
                  variant="secondary"
                  leadingIcon={<ArchiveRestore />}
                  disabled={pending}
                  onClick={() => run(() => restoreEmployee(row.id!), "Cadastro reativado.")}
                >
                  Reativar cadastro
                </Button>
              ) : null
            ) : (
              <>
                {can("users.update") ? (
                  <Button variant="secondary" leadingIcon={<Pencil />} onClick={() => onEdit(row.id!)}>
                    Editar
                  </Button>
                ) : null}
                {can("users.archive") ? (
                  <Button
                    variant="ghost"
                    leadingIcon={<Archive />}
                    disabled={pending}
                    onClick={async () => {
                      const hasAccess = row.access_status === "active" || row.access_status === "invited";
                      const confirmed = await confirm({
                        title: "Inativar colaborador",
                        description: hasAccess
                          ? "Este colaborador possui acesso ativo ao HFM. O cadastro será inativado e o acesso suspenso. Nenhum dado é excluído e a conta de autenticação é preservada."
                          : "O cadastro será inativado. Nenhum dado é excluído e o histórico é preservado.",
                        confirmLabel: "Inativar",
                        destructive: true,
                      });
                      if (confirmed) run(() => archiveEmployee(row.id!, true), "Cadastro inativado.");
                    }}
                  >
                    Inativar
                  </Button>
                ) : null}
              </>
            )}
          </DrawerFooter>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/* Access tab                                                                 */
/* -------------------------------------------------------------------------- */

function AccessTab({
  detail,
  options,
  pending,
  onGrant,
  onRoles,
  onScopes,
  onStatus,
  onResend,
}: {
  detail: EmployeeDetailPayload;
  options: DirectoryOptions;
  pending: boolean;
  onGrant: (roleIds: string[], operationIds: string[]) => void;
  onRoles: (roleIds: string[]) => void;
  onScopes: (operationIds: string[]) => void;
  onStatus: (status: "active" | "suspended") => void;
  onResend: () => void;
}) {
  const row = detail.directory;
  const can = (permission: string) => detail.permissions.includes(permission);
  const hasAccount = Boolean(row.membership_id);

  const [roleIds, setRoleIds] = React.useState<string[]>(detail.roleIds);
  const [operationIds, setOperationIds] = React.useState<string[]>(detail.scopeOperationIds);

  // A reload brings a new `detail` object: the pickers follow it during render,
  // so a saved change is reflected without a second commit.
  const [source, setSource] = React.useState(detail);
  if (source !== detail) {
    setSource(detail);
    setRoleIds(detail.roleIds);
    setOperationIds(detail.scopeOperationIds);
  }

  const grantsAllOperations = React.useMemo(
    () => row.access_all_operations ?? false,
    [row.access_all_operations],
  );

  if (!hasAccount) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="info">
          <AlertTitle>Sem acesso ao HFM</AlertTitle>
          <AlertDescription>
            Este colaborador existe na base corporativa, mas não possui conta no sistema. Conceder acesso é uma decisão
            separada da situação do colaborador.
          </AlertDescription>
        </Alert>

        {!row.corporate_email ? (
          <Alert variant="warning">
            <AlertTitle>E-mail corporativo obrigatório</AlertTitle>
            <AlertDescription>
              Para provisionar o acesso é necessário um e-mail válido. Edite o cadastro e informe o e-mail corporativo.
            </AlertDescription>
          </Alert>
        ) : null}

        {can("users.manage_access") ? (
          <>
            <RolePicker roles={options.roles} value={roleIds} onChange={setRoleIds} disabled={!can("users.manage_roles")} />
            <OperationPicker
              operations={options.operations}
              value={operationIds}
              onChange={setOperationIds}
              disabled={!can("users.manage_operation_scope")}
              allNote={roleGrantsAll(options, roleIds)}
            />
            <div>
              <Button
                leadingIcon={<KeyRound />}
                disabled={pending || !row.corporate_email || roleIds.length === 0}
                onClick={() => onGrant(roleIds, operationIds)}
              >
                Conceder acesso ao HFM
              </Button>
              <p className="mt-2 text-caption text-fg-muted">
                O colaborador receberá um e-mail para definir a própria senha. Nenhuma senha é definida ou visualizada
                por administradores.
              </p>
            </div>
          </>
        ) : (
          <p className="text-body-sm text-fg-muted">Você não possui permissão para conceder acesso.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Status de acesso">{ACCESS_STATUS_LABELS[row.access_status ?? "none"]}</Field>
        <Field label="E-mail de login">{row.corporate_email}</Field>
        <Field label="Acesso desde">{formatDateTime(row.access_since)}</Field>
        <Field label="Última atualização de acesso">{formatDateTime(row.access_updated_at)}</Field>
      </dl>

      <Separator />

      <RolePicker
        roles={options.roles}
        value={roleIds}
        onChange={setRoleIds}
        disabled={!can("users.manage_roles")}
        onSave={can("users.manage_roles") ? () => onRoles(roleIds) : undefined}
        saving={pending}
        dirty={!sameSet(roleIds, detail.roleIds)}
      />

      {grantsAllOperations ? (
        <Alert variant="info">
          <AlertTitle>Acesso a todas as operações</AlertTitle>
          <AlertDescription>
            O perfil atribuído concede a permissão <code>operations.access_all</code>, então esta conta enxerga todas as
            operações da organização independentemente da lista abaixo.
          </AlertDescription>
        </Alert>
      ) : null}

      <OperationPicker
        operations={options.operations}
        value={operationIds}
        onChange={setOperationIds}
        disabled={!can("users.manage_operation_scope")}
        onSave={can("users.manage_operation_scope") ? () => onScopes(operationIds) : undefined}
        saving={pending}
        dirty={!sameSet(operationIds, detail.scopeOperationIds)}
        allNote={grantsAllOperations}
      />

      <Separator />

      <div className="flex flex-wrap gap-2">
        {row.access_status === "invited" && can("users.invite") ? (
          <Button variant="secondary" leadingIcon={<Mail />} disabled={pending} onClick={onResend}>
            Reenviar convite
          </Button>
        ) : null}
        {can("users.manage_access") && row.access_status === "active" ? (
          <Button variant="secondary" leadingIcon={<Pause />} disabled={pending} onClick={() => onStatus("suspended")}>
            Suspender acesso
          </Button>
        ) : null}
        {can("users.manage_access") && (row.access_status === "suspended" || row.access_status === "invited") ? (
          <Button variant="secondary" leadingIcon={<Play />} disabled={pending} onClick={() => onStatus("active")}>
            Reativar acesso
          </Button>
        ) : null}
      </div>

      {row.access_role_names?.length ? (
        <div>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-body-sm font-semibold text-fg">
            <ShieldCheck className="size-4 text-fg-muted" aria-hidden />
            Permissões derivadas
          </h3>
          <p className="text-caption text-fg-muted">
            As permissões vêm exclusivamente dos perfis atribuídos ({row.access_role_names.join(", ")}). O perfil
            organizacional importado da base não concede privilégio algum.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function RolePicker({
  roles,
  value,
  onChange,
  disabled,
  onSave,
  saving,
  dirty,
}: {
  roles: { id: string; label: string; description: string | null }[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  onSave?: () => void;
  saving?: boolean;
  dirty?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-body-sm font-semibold text-fg">Perfil de acesso (HFM)</legend>
      <p className="text-caption text-fg-muted">
        Define o que a conta pode fazer no sistema. Não confundir com o perfil organizacional da base.
      </p>
      <div className="flex flex-col gap-1.5">
        {roles.map((role) => (
          <label
            key={role.id}
            className={cn(
              "flex items-start gap-2.5 rounded-sm border border-border-subtle px-3 py-2",
              disabled && "opacity-60",
            )}
          >
            <Checkbox
              className="mt-0.5"
              checked={value.includes(role.id)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange(checked ? [...value, role.id] : value.filter((id) => id !== role.id))
              }
            />
            <span className="min-w-0">
              <span className="block text-body-sm font-medium text-fg">{role.label}</span>
              {role.description ? <span className="block text-caption text-fg-muted">{role.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
      {onSave ? (
        <div>
          <Button size="sm" variant="secondary" disabled={!dirty || saving} onClick={onSave}>
            Salvar perfis
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}

function OperationPicker({
  operations,
  value,
  onChange,
  disabled,
  onSave,
  saving,
  dirty,
  allNote,
}: {
  operations: { id: string; label: string }[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  onSave?: () => void;
  saving?: boolean;
  dirty?: boolean;
  allNote?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-body-sm font-semibold text-fg">Operações permitidas</legend>
      <p className="text-caption text-fg-muted">
        Quais operações esta conta pode consultar no HFM. Uma lista vazia significa nenhuma operação — nunca
        &ldquo;todas&rdquo;. O acesso irrestrito é concedido apenas por permissão explícita.
      </p>
      {operations.length === 0 ? (
        <p className="text-body-sm text-fg-muted">Nenhuma operação cadastrada ainda.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {operations.map((operation) => {
            const checked = value.includes(operation.id);
            return (
              <label
                key={operation.id}
                className={cn(
                  "inline-flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-body-sm hfm-transition",
                  checked ? "border-primary bg-primary-soft text-primary-soft-fg" : "border-border-subtle text-fg-secondary",
                  disabled ? "opacity-60" : "cursor-pointer hover:border-border-strong",
                  allNote && "opacity-70",
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(next) =>
                    onChange(next ? [...value, operation.id] : value.filter((id) => id !== operation.id))
                  }
                />
                {operation.label}
              </label>
            );
          })}
        </div>
      )}
      {value.length === 0 && !allNote && !disabled ? (
        <p className="flex items-center gap-1.5 text-caption text-warning">
          <AlertTriangle className="size-3.5" aria-hidden />
          Sem operações atribuídas, esta conta não verá dados operacionais.
        </p>
      ) : null}
      {onSave ? (
        <div>
          <Button size="sm" variant="secondary" disabled={!dirty || saving} onClick={onSave}>
            Salvar operações
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- */

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((value) => b.includes(value));
}

function roleGrantsAll(options: DirectoryOptions, roleIds: string[]) {
  // The definitive answer comes from the database; this only softens the UI.
  return options.roles.some((role) => roleIds.includes(role.id) && /admin|leadership/i.test(role.label));
}

function formatCpf(cpf: string) {
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const AUDIT_LABELS: Record<string, string> = {
  INSERT: "Cadastro criado",
  UPDATE: "Cadastro alterado",
  DELETE: "Registro removido",
};

function describeAudit(action: string | null, entity: string | null) {
  const base = AUDIT_LABELS[action ?? ""] ?? action ?? "Evento";
  // entity_type is schema-qualified in the trail ("public.employees").
  const table = (entity ?? "").replace(/^public\./, "");
  if (table === "employee_assignments") return `${base} · vínculo`;
  if (table === "employee_private_data") return `${base} · dados pessoais`;
  if (table === "driver_licenses") return `${base} · CNH`;
  if (table === "organization_memberships") return `${base} · acesso`;
  return base;
}
