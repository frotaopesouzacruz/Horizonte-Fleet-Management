"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Eye,
  History,
  Minus,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type {
  AccessInconsistency,
  AccessProfile,
  AccessProfileChange,
  PermissionRow,
} from "@/lib/admin/access-profiles";
import { setProfilePermissions, restoreProfileDefaults } from "@/lib/admin/access-actions";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { KpiCard } from "@/components/ui/kpi-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { ReasonDialog } from "@/components/admin/reason-dialog";

const numberFormat = new Intl.NumberFormat("pt-BR");

/** Module codes read like database columns; these are the names people use. */
const MODULE_LABELS: Record<string, string> = {
  organization: "Organização",
  members: "Membros",
  roles: "Perfis e permissões",
  units: "Filiais e unidades",
  cost_centers: "Centros de custo",
  users: "Colaboradores e usuários",
  operations: "Operações",
  vehicles: "Frota",
  drivers: "Condutores",
  audit: "Auditoria",
};

const moduleLabel = (module: string) => MODULE_LABELS[module] ?? module;

const SEVERITY: Record<AccessInconsistency["severity"], { label: string; variant: "danger" | "warning" | "neutral" }> = {
  high: { label: "Alta", variant: "danger" },
  medium: { label: "Média", variant: "warning" },
  low: { label: "Baixa", variant: "neutral" },
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface AccessProfilesViewProps {
  profiles: AccessProfile[];
  matrix: PermissionRow[];
  inconsistencies: AccessInconsistency[];
  changes: AccessProfileChange[];
  canManage: boolean;
}

/**
 * Administração → Perfis e permissões.
 *
 * The screen answers three questions and keeps them apart: which profiles exist
 * and how big they are, what each one may do, and what has been changed or is
 * inconsistent. Nothing here decides anything on its own — the inconsistency
 * panel reports, it does not correct, because "the system fixed your access
 * overnight" is not a sentence anybody should have to read.
 */
export function AccessProfilesView({
  profiles,
  matrix,
  inconsistencies,
  changes,
  canManage,
}: AccessProfilesViewProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  const [editing, setEditing] = React.useState<AccessProfile | null>(null);
  const [simulating, setSimulating] = React.useState<AccessProfile | null>(null);
  const [restoring, setRestoring] = React.useState<AccessProfile | null>(null);

  const administrator = profiles.find((profile) => profile.isAdministrator);
  const accounts = profiles.reduce((sum, profile) => sum + profile.memberCount, 0);
  const customised = profiles.filter(
    (profile) => profile.addedPermissions.length > 0 || profile.removedPermissions.length > 0,
  ).length;

  const modules = React.useMemo(() => {
    const grouped = new Map<string, PermissionRow[]>();
    for (const row of matrix) {
      const list = grouped.get(row.module) ?? [];
      list.push(row);
      grouped.set(row.module, list);
    }
    return [...grouped.entries()].sort((a, b) => moduleLabel(a[0]).localeCompare(moduleLabel(b[0]), "pt-BR"));
  }, [matrix]);

  /**
   * Returns a promise so the dialog that asked for a reason stays open when the
   * change is refused: the reason the person typed is still there to correct,
   * instead of having to be typed again.
   */
  const run = (
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
    done?: () => void,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      startTransition(async () => {
        const result = await action();
        if (result.ok) {
          toast({ title: success, variant: "success" });
          done?.();
          router.refresh();
          resolve();
        } else {
          toast({ title: result.error ?? "Não foi possível concluir a alteração.", variant: "danger" });
          reject(new Error(result.error ?? success));
        }
      });
    });

  return (
    <>
      <PageHeader
        title="Perfis e permissões"
        description="O perfil de acesso decide o que uma conta pode fazer no HFM. É diferente do perfil organizacional que vem da base corporativa, e nenhuma planilha, integração ou sincronização o altera."
      />

      <PageContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard size="compact" label="Perfis oficiais" value={profiles.length} icon={<ShieldCheck aria-hidden />} />
          <KpiCard size="compact" label="Contas com perfil" value={accounts} icon={<Users aria-hidden />} />
          <KpiCard
            size="compact"
            status={customised > 0 ? "warning" : "neutral"}
            label="Perfis fora do padrão"
            value={customised}
            icon={<Pencil aria-hidden />}
          />
          <KpiCard
            size="compact"
            status={inconsistencies.some((item) => item.severity === "high") ? "danger" : "neutral"}
            label="Pontos de atenção"
            value={inconsistencies.length}
            icon={<AlertTriangle aria-hidden />}
          />
        </div>

        <Tabs defaultValue="perfis">
          <TabsList>
            <TabsTrigger value="perfis">Perfis</TabsTrigger>
            <TabsTrigger value="matriz">Matriz de permissões</TabsTrigger>
            <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
          </TabsList>

          {/* ------------------------------------------------------- perfis */}
          <TabsContent value="perfis" className="pt-4">
            <Card>
              <CardContent className="p-0">
                <TableContainer className="rounded-none border-0">
                  {/* Fixed layout with a floor width: the descriptions are long
                      enough that an auto table would push Ações off the edge
                      instead of scrolling. */}
                  <Table layout="fixed" style={{ minWidth: 1080 }}>
                    <TableHeader>
                      <TableRow>
                        <TableHead style={{ width: 420 }}>Perfil</TableHead>
                        <TableHead style={{ width: 150 }}>Código técnico</TableHead>
                        <TableHead numeric style={{ width: 120 }}>Permissões</TableHead>
                        <TableHead numeric style={{ width: 100 }}>Contas</TableHead>
                        <TableHead style={{ width: 160 }}>Matriz</TableHead>
                        <TableHead style={{ width: 130 }}>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profiles.map((profile) => {
                        const drifted =
                          profile.addedPermissions.length > 0 || profile.removedPermissions.length > 0;
                        return (
                          <TableRow key={profile.roleId} className="h-(--table-row-height)">
                            <TableCell>
                              <span className="block font-medium text-fg">{profile.name}</span>
                              <span className="block truncate text-caption text-fg-muted" title={profile.description}>
                                {profile.description}
                              </span>
                            </TableCell>
                            <TableCell className="font-mono text-caption text-fg-secondary">{profile.code}</TableCell>
                            <TableCell numeric>{numberFormat.format(profile.permissionCount)}</TableCell>
                            <TableCell numeric>
                              {profile.memberCount === 0 ? (
                                <span className="text-fg-muted">—</span>
                              ) : (
                                numberFormat.format(profile.memberCount)
                              )}
                            </TableCell>
                            <TableCell>
                              {profile.isAdministrator ? (
                                <Badge variant="primary" appearance="soft">
                                  Catálogo completo
                                </Badge>
                              ) : drifted ? (
                                <Badge variant="warning" appearance="soft" dot>
                                  {profile.addedPermissions.length > 0
                                    ? `+${profile.addedPermissions.length}`
                                    : null}
                                  {profile.addedPermissions.length > 0 && profile.removedPermissions.length > 0
                                    ? " / "
                                    : null}
                                  {profile.removedPermissions.length > 0
                                    ? `−${profile.removedPermissions.length}`
                                    : null}
                                </Badge>
                              ) : (
                                <Badge variant="neutral" appearance="soft">
                                  Padrão oficial
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="flex items-center gap-0.5">
                                <IconButton
                                  label={`Simular o perfil ${profile.name}`}
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSimulating(profile)}
                                >
                                  <Eye aria-hidden />
                                </IconButton>
                                {canManage && !profile.isAdministrator ? (
                                  <>
                                    <IconButton
                                      label={`Editar a matriz de ${profile.name}`}
                                      variant="ghost"
                                      size="sm"
                                      disabled={pending}
                                      onClick={() => setEditing(profile)}
                                    >
                                      <Pencil aria-hidden />
                                    </IconButton>
                                    <IconButton
                                      label={`Restaurar o padrão de ${profile.name}`}
                                      variant="ghost"
                                      size="sm"
                                      disabled={pending || !drifted}
                                      onClick={() => setRestoring(profile)}
                                    >
                                      <RotateCcw aria-hidden />
                                    </IconButton>
                                  </>
                                ) : null}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>

            <p className="mt-3 text-caption text-fg-muted">
              O perfil {administrator?.name ?? "Administrador"} possui todas as permissões por definição e não pode ser
              reduzido — é ele que garante que a organização nunca fique sem quem administre o acesso. Para delegar a
              administração de acesso, atribua esse perfil a outra pessoa.
            </p>
          </TabsContent>

          {/* ------------------------------------------------------- matriz */}
          <TabsContent value="matriz" className="pt-4">
            <Card>
              <CardContent className="p-0">
                <TableContainer stickyHeader maxHeight="calc(100dvh - 24rem)" className="rounded-none border-0">
                  <Table layout="fixed" style={{ minWidth: 300 + profiles.length * 112 }}>
                    <TableHeader>
                      <TableRow>
                        <TableHead style={{ width: 300, zIndex: 21 }} className="sticky left-0 bg-surface-secondary">
                          Permissão
                        </TableHead>
                        {profiles.map((profile) => (
                          <TableHead
                            key={profile.roleId}
                            style={{ width: 112 }}
                            // The default header never wraps, which is right for
                            // a one-word column and wrong for "Liderança de
                            // Operações": here the name wraps rather than
                            // becoming "Liderança de Ope…".
                            className="text-center align-bottom leading-tight whitespace-normal"
                          >
                            {profile.name}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {modules.map(([module, rows]) => (
                        <React.Fragment key={module}>
                          <TableRow className="bg-surface-secondary">
                            <TableCell
                              colSpan={profiles.length + 1}
                              className="text-caption font-semibold tracking-wide text-fg-secondary uppercase"
                            >
                              {moduleLabel(module)}
                            </TableCell>
                          </TableRow>
                          {rows.map((row) => (
                            <TableRow key={row.code} className="h-(--table-row-height)">
                              <TableCell className="sticky left-0 bg-inherit" style={{ zIndex: 1 }}>
                                <span className="block truncate font-medium text-fg" title={row.description ?? row.name}>
                                  {row.name}
                                </span>
                                <span className="block font-mono text-caption text-fg-muted">{row.code}</span>
                              </TableCell>
                              {profiles.map((profile) => {
                                const granted = row.grantedCodes.includes(profile.code);
                                const isDefault = row.defaultCodes.includes(profile.code);
                                return (
                                  <TableCell key={profile.roleId} className="text-center">
                                    {granted ? (
                                      <span
                                        className={cn(
                                          "inline-flex items-center justify-center",
                                          isDefault ? "text-success" : "text-warning",
                                        )}
                                        title={isDefault ? "Concedida (padrão oficial)" : "Concedida fora do padrão"}
                                      >
                                        <Check className="size-4" aria-hidden />
                                        <span className="sr-only">
                                          {isDefault ? "Concedida" : "Concedida fora do padrão"}
                                        </span>
                                      </span>
                                    ) : (
                                      <span
                                        className={cn(isDefault ? "text-danger" : "text-fg-muted")}
                                        title={isDefault ? "Removida do padrão oficial" : "Não concedida"}
                                      >
                                        <Minus className="size-4" aria-hidden />
                                        <span className="sr-only">
                                          {isDefault ? "Removida do padrão" : "Não concedida"}
                                        </span>
                                      </span>
                                    )}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ))}
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>

            <p className="mt-3 text-caption text-fg-muted">
              Verde: concedida conforme o padrão oficial. Amarelo: concedida além do padrão. Vermelho: prevista no
              padrão e removida nesta organização.
            </p>
          </TabsContent>

          {/* ---------------------------------------------------- auditoria */}
          <TabsContent value="auditoria" className="flex flex-col gap-5 pt-4">
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-h3 font-semibold text-fg">Pontos de atenção</h2>
                <p className="text-body-sm text-fg-secondary">
                  O sistema aponta e não corrige: cada linha é uma decisão de alguém, não uma correção automática.
                </p>
              </div>

              {inconsistencies.length === 0 ? (
                <Alert variant="success">
                  <AlertTitle>Nenhuma inconsistência encontrada</AlertTitle>
                  <AlertDescription>
                    Todas as contas ativas possuem exatamente um perfil, com escopo compatível, e nenhum perfil difere
                    do padrão oficial.
                  </AlertDescription>
                </Alert>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <TableContainer className="rounded-none border-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead style={{ width: 110 }}>Severidade</TableHead>
                            <TableHead style={{ width: 260 }}>Referência</TableHead>
                            <TableHead>Situação</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {inconsistencies.map((item, index) => (
                            <TableRow key={`${item.kind}-${item.subjectId ?? index}`} className="h-(--table-row-height)">
                              <TableCell>
                                <Badge variant={SEVERITY[item.severity].variant} appearance="soft" dot>
                                  {SEVERITY[item.severity].label}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <span className="block truncate font-medium text-fg" title={item.subject}>
                                  {item.subject}
                                </span>
                              </TableCell>
                              <TableCell className="text-body-sm text-fg-secondary">{item.detail}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </CardContent>
                </Card>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-h3 font-semibold text-fg">Histórico de alterações</h2>
                <p className="text-body-sm text-fg-secondary">
                  Toda alteração de perfil e de matriz é registrada com o estado anterior, o novo e o motivo informado.
                  O registro não pode ser editado nem apagado.
                </p>
              </div>

              <Card>
                <CardContent className="p-0">
                  <TableContainer className="rounded-none border-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead style={{ width: 150 }}>Quando</TableHead>
                          <TableHead style={{ width: 200 }}>Quem alterou</TableHead>
                          <TableHead style={{ width: 240 }}>De → para</TableHead>
                          <TableHead>Motivo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {changes.length === 0 ? (
                          <TableEmpty colSpan={4} icon={<History />} message="Nenhuma alteração registrada." />
                        ) : (
                          changes.map((change) => (
                            <TableRow key={change.id} className="h-(--table-row-height)">
                              <TableCell className="text-caption tabular-nums text-fg-secondary">
                                {formatDateTime(change.createdAt)}
                              </TableCell>
                              <TableCell>
                                <span className="block truncate text-body-sm text-fg">
                                  {change.actorName ?? "Sistema"}
                                </span>
                                {change.targetName ? (
                                  <span className="block truncate text-caption text-fg-muted">
                                    sobre {change.targetName}
                                  </span>
                                ) : null}
                              </TableCell>
                              <TableCell className="font-mono text-caption text-fg-secondary">
                                {change.previousCodes.join(", ") || "—"} → {change.newCodes.join(", ") || "—"}
                              </TableCell>
                              <TableCell className="text-body-sm text-fg-secondary">{change.reason}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            </section>
          </TabsContent>
        </Tabs>
      </PageContent>

      {editing ? (
        <MatrixEditor
          key={editing.roleId}
          profile={editing}
          matrix={matrix}
          modules={modules}
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={(codes, reason) =>
            run(
              () => setProfilePermissions(editing.roleId, codes, reason),
              `Matriz do perfil ${editing.name} atualizada.`,
              () => setEditing(null),
            )
          }
        />
      ) : null}

      {simulating ? (
        <ProfileSimulation
          profile={simulating}
          modules={modules}
          onClose={() => setSimulating(null)}
        />
      ) : null}

      <ReasonDialog
        open={restoring !== null}
        onOpenChange={(open) => !open && setRestoring(null)}
        title={`Restaurar o padrão de ${restoring?.name ?? ""}`}
        description="As permissões voltam exatamente à matriz oficial do perfil. As pessoas que possuem este perfil passam a ver o sistema conforme esse padrão na próxima navegação."
        confirmLabel="Restaurar padrão"
        loading={pending}
        onConfirm={(reason) => {
          if (!restoring) return;
          return run(
            () => restoreProfileDefaults(restoring.roleId, reason),
            `Padrão do perfil ${restoring.name} restaurado.`,
            () => setRestoring(null),
          );
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Matrix editor                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One profile at a time, grouped by module.
 *
 * The permissions that administer access itself are shown and disabled rather
 * than hidden: an administrator asking "why can't Gente manage profiles" should
 * find the answer where they looked, not conclude the permission doesn't exist.
 */
function MatrixEditor({
  profile,
  matrix,
  modules,
  pending,
  onClose,
  onSave,
}: {
  profile: AccessProfile;
  matrix: PermissionRow[];
  modules: [string, PermissionRow[]][];
  pending: boolean;
  onClose: () => void;
  onSave: (codes: string[], reason: string) => Promise<void>;
}) {
  const initial = React.useMemo(
    () => matrix.filter((row) => row.grantedCodes.includes(profile.code)).map((row) => row.code),
    [matrix, profile.code],
  );
  const [codes, setCodes] = React.useState<string[]>(initial);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const toggle = (code: string, on: boolean) =>
    setCodes((current) => (on ? [...current, code] : current.filter((entry) => entry !== code)));

  const dirty =
    codes.length !== initial.length || codes.some((code) => !initial.includes(code));

  return (
    <>
      <Drawer open onOpenChange={(open) => !open && onClose()}>
        <DrawerContent size="lg">
          <DrawerHeader>
            <DrawerTitle>Matriz de permissões · {profile.name}</DrawerTitle>
          </DrawerHeader>

          <DrawerBody className="flex flex-col gap-5">
            <p className="text-body-sm text-fg-secondary">{profile.description}</p>

            {modules.map(([module, rows]) => (
              <fieldset key={module} className="flex flex-col gap-2">
                <legend className="text-body-sm font-semibold text-fg">{moduleLabel(module)}</legend>
                <div className="flex flex-col gap-1">
                  {rows.map((row) => {
                    const checked = codes.includes(row.code);
                    const isDefault = row.defaultCodes.includes(profile.code);
                    return (
                      <label
                        key={row.code}
                        className={cn(
                          "flex items-start gap-2.5 rounded-sm border border-border-subtle px-3 py-2",
                          row.reserved && "opacity-60",
                        )}
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={checked}
                          disabled={row.reserved}
                          onCheckedChange={(value) => toggle(row.code, Boolean(value))}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-body-sm font-medium text-fg">{row.name}</span>
                            {row.reserved ? (
                              <Badge variant="neutral" appearance="soft" size="sm">
                                Somente Administrador
                              </Badge>
                            ) : checked !== isDefault ? (
                              <Badge variant="warning" appearance="soft" size="sm">
                                {checked ? "Além do padrão" : "Removida do padrão"}
                              </Badge>
                            ) : null}
                          </span>
                          {row.description ? (
                            <span className="block text-caption text-fg-muted">{row.description}</span>
                          ) : null}
                          <span className="block font-mono text-caption text-fg-muted">{row.code}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </DrawerBody>

          <DrawerFooter>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button disabled={!dirty || pending} onClick={() => setConfirmOpen(true)}>
              Salvar matriz
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <ReasonDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Alterar a matriz de ${profile.name}`}
        description={`${codes.length} permissão(ões) para ${profile.memberCount} conta(s) com este perfil. A alteração vale para todas elas imediatamente.`}
        confirmLabel="Salvar matriz"
        loading={pending}
        onConfirm={(reason) => onSave(codes, reason)}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Read-only simulation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What this profile can do, in the product's own words.
 *
 * Strictly read-only, and it never assumes anybody's identity: it describes a
 * profile, it does not sign anyone in as anybody. A "simulation" that borrows a
 * real session is an impersonation, and an audit trail that cannot tell the
 * difference is worth nothing.
 */
function ProfileSimulation({
  profile,
  modules,
  onClose,
}: {
  profile: AccessProfile;
  modules: [string, PermissionRow[]][];
  onClose: () => void;
}) {
  const granted = modules
    .map(([module, rows]) => [module, rows.filter((row) => row.grantedCodes.includes(profile.code))] as const)
    .filter(([, rows]) => rows.length > 0);

  const seesEveryOperation = modules.some(([, rows]) =>
    rows.some((row) => row.code === "operations.access_all" && row.grantedCodes.includes(profile.code)),
  );

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="md">
        <DrawerHeader>
          <DrawerTitle>Simulação · {profile.name}</DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="flex flex-col gap-4">
          <Alert variant="info">
            <AlertTitle>Pré-visualização, sem assumir a identidade de ninguém</AlertTitle>
            <AlertDescription>
              Esta tela descreve o que o perfil permite. Nenhuma sessão é alterada e nenhuma ação é executada em nome de
              outra pessoa.
            </AlertDescription>
          </Alert>

          <p className="text-body-sm text-fg-secondary">{profile.description}</p>

          <div className="rounded-sm border border-border-subtle px-3 py-2">
            <p className="text-body-sm font-medium text-fg">Alcance por operação</p>
            <p className="text-caption text-fg-secondary">
              {seesEveryOperation
                ? "Enxerga todas as operações da organização, independentemente do escopo atribuído à conta."
                : "Enxerga apenas as operações atribuídas a cada conta. Sem escopo atribuído, nenhuma operação."}
            </p>
          </div>

          {granted.length === 0 ? (
            <Alert variant="warning">
              <AlertTitle>Nenhuma permissão</AlertTitle>
              <AlertDescription>
                Uma conta com este perfil entra no sistema e não enxerga nenhum módulo.
              </AlertDescription>
            </Alert>
          ) : (
            granted.map(([module, rows]) => (
              <section key={module} className="flex flex-col gap-1.5">
                <h3 className="text-body-sm font-semibold text-fg">{moduleLabel(module)}</h3>
                <ul className="flex flex-col gap-1">
                  {rows.map((row) => (
                    <li key={row.code} className="flex items-start gap-2 text-body-sm text-fg-secondary">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      <span>
                        {row.description ?? row.name}
                        <span className="block font-mono text-caption text-fg-muted">{row.code}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </DrawerBody>

        <DrawerFooter>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
