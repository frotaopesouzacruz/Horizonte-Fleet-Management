"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Download,
  Eye,
  FileSpreadsheet,
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
  EffectiveAccess,
  PermissionRow,
  SimulatableMembership,
} from "@/lib/admin/access-profiles";
import { setProfilePermissions, restoreProfileDefaults, loadEffectiveAccess } from "@/lib/admin/access-actions";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { KpiCard } from "@/components/ui/kpi-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormField } from "@/components/ui/form-field";
import { FilterBar, FilterGroup } from "@/components/ui/filter-bar";
import { SearchField } from "@/components/ui/search-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { LoadingState } from "@/components/feedback/loading-state";
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
import { ACCESS_STATUS_LABELS } from "@/lib/admin/qlp";
import { navigation } from "@/components/layout/navigation";

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

/**
 * The sidebar, as permission codes.
 *
 * Taken from the navigation model itself rather than retyped here: a simulation
 * that lists a menu the product no longer has is worse than no simulation.
 */
const NAVIGATION_PERMISSIONS = navigation.flatMap((group) =>
  group.items.map((item) => ({ label: item.label, permission: item.permission })),
);

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
  memberships: SimulatableMembership[];
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
  memberships,
  canManage,
}: AccessProfilesViewProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  const [editing, setEditing] = React.useState<AccessProfile | null>(null);
  const [simulating, setSimulating] = React.useState<AccessProfile | null>(null);
  const [restoring, setRestoring] = React.useState<AccessProfile | null>(null);

  const [auditPeriod, setAuditPeriod] = React.useState("all");
  const [auditKind, setAuditKind] = React.useState("all");
  const [auditProfile, setAuditProfile] = React.useState("all");
  const [auditQuery, setAuditQuery] = React.useState("");
  // Captured once: "últimos 30 dias" must not drift while the page is open, and
  // reading the clock inside a memo would make the filter impure.
  const [renderedAt] = React.useState(() => Date.now());

  const administrator = profiles.find((profile) => profile.isAdministrator);
  const accounts = profiles.reduce((sum, profile) => sum + profile.memberCount, 0);
  const customised = profiles.filter(
    (profile) => profile.addedPermissions.length > 0 || profile.removedPermissions.length > 0,
  ).length;

  const roleCodeById = React.useMemo(
    () => new Map(profiles.map((profile) => [profile.roleId, profile.code])),
    [profiles],
  );

  const visibleChanges = React.useMemo(() => {
    const since =
      auditPeriod === "all" ? null : renderedAt - Number(auditPeriod) * 24 * 60 * 60 * 1000;
    const needle = auditQuery.trim().toLowerCase();

    return changes.filter((change) => {
      if (since && new Date(change.createdAt).getTime() < since) return false;
      if (auditKind === "matrix" && !change.roleId) return false;
      if (auditKind === "membership" && !change.membershipId) return false;

      if (auditProfile !== "all") {
        const touched = [
          ...change.previousCodes,
          ...change.newCodes,
          change.roleId ? (roleCodeById.get(change.roleId) ?? "") : "",
        ];
        if (!touched.includes(auditProfile)) return false;
      }

      if (needle) {
        const haystack = [change.actorName, change.targetName, change.reason]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }

      return true;
    });
  }, [changes, auditPeriod, auditKind, auditProfile, auditQuery, roleCodeById, renderedAt]);

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
        secondaryActions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" leadingIcon={<Download />}>
                Exportar matriz
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel>Matriz completa, um perfil por coluna</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href="/administracao/perfis/export?format=xlsx" download>
                  <FileSpreadsheet aria-hidden /> XLSX
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/administracao/perfis/export?format=csv" download>
                  <FileSpreadsheet aria-hidden /> CSV
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
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
            <TabsTrigger value="simulacao">Simulação</TabsTrigger>
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
                  <Table layout="fixed" style={{ minWidth: 1340 }}>
                    <TableHeader>
                      <TableRow>
                        <TableHead style={{ width: 420 }}>Perfil</TableHead>
                        <TableHead style={{ width: 150 }}>Código técnico</TableHead>
                        <TableHead numeric style={{ width: 120 }}>Permissões</TableHead>
                        <TableHead numeric style={{ width: 100 }}>Contas</TableHead>
                        <TableHead style={{ width: 160 }}>Matriz</TableHead>
                        <TableHead style={{ width: 110 }}>Situação</TableHead>
                        <TableHead style={{ width: 150 }}>Última alteração</TableHead>
                        <TableHead style={{ width: 150 }}>Ações</TableHead>
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
                              {/* An official profile is always in use: it exists
                                  for the organization whether anybody holds it
                                  or not. "Ativo" here means the role is live,
                                  not that somebody is wearing it. */}
                              <Badge variant="success" appearance="soft" dot>
                                Ativo
                              </Badge>
                            </TableCell>
                            <TableCell className="text-caption tabular-nums text-fg-secondary">
                              {profile.lastChangedAt ? formatDateTime(profile.lastChangedAt) : "—"}
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

          {/* ---------------------------------------------------- simulação */}
          <TabsContent value="simulacao" className="pt-4">
            <AccountSimulation memberships={memberships} modules={modules} />
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

              {/* Filtros sobre as últimas {changes.length} alterações carregadas.
                  O filtro é local por escolha: uma janela pequena e honesta vale
                  mais que um filtro que parece varrer todo o histórico e não
                  varre. */}
              <FilterBar className="py-0" label="Filtros da auditoria">
                <FilterGroup label="Período">
                  <Select value={auditPeriod} onValueChange={setAuditPeriod}>
                    <SelectTrigger size="sm" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todo o período</SelectItem>
                      <SelectItem value="7">Últimos 7 dias</SelectItem>
                      <SelectItem value="30">Últimos 30 dias</SelectItem>
                      <SelectItem value="90">Últimos 90 dias</SelectItem>
                    </SelectContent>
                  </Select>
                </FilterGroup>

                <FilterGroup label="Tipo">
                  <Select value={auditKind} onValueChange={setAuditKind}>
                    <SelectTrigger size="sm" className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os eventos</SelectItem>
                      <SelectItem value="membership">Perfil de uma conta</SelectItem>
                      <SelectItem value="matrix">Matriz de um perfil</SelectItem>
                    </SelectContent>
                  </Select>
                </FilterGroup>

                <FilterGroup label="Perfil">
                  <Select value={auditProfile} onValueChange={setAuditProfile}>
                    <SelectTrigger size="sm" className="w-52">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os perfis</SelectItem>
                      {profiles.map((profile) => (
                        <SelectItem key={profile.roleId} value={profile.code}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterGroup>

                <SearchField
                  value={auditQuery}
                  onChange={(event) => setAuditQuery(event.target.value)}
                  onClear={() => setAuditQuery("")}
                  size="sm"
                  placeholder="Buscar por pessoa ou motivo"
                  aria-label="Buscar no histórico de alterações"
                  wrapperClassName="w-full sm:w-72"
                />
              </FilterBar>

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
                        {visibleChanges.length === 0 ? (
                          <TableEmpty
                            colSpan={4}
                            icon={<History />}
                            message={
                              changes.length === 0
                                ? "Nenhuma alteração registrada."
                                : "Nenhuma alteração corresponde aos filtros."
                            }
                          />
                        ) : (
                          visibleChanges.map((change) => (
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
        description={
          restoring ? (
            <span className="flex flex-col gap-2">
              <span className="text-body-sm">
                As permissões voltam exatamente à matriz oficial do perfil. Quem possui este perfil passa a ver o
                sistema conforme esse padrão na próxima navegação.
              </span>
              {/* What restoring actually undoes, before it undoes it: the
                  permissions added beyond the default leave, the ones removed
                  from it come back. */}
              <ChangeSummary
                added={restoring.removedPermissions}
                removed={restoring.addedPermissions}
                affected={restoring.memberCount}
              />
            </span>
          ) : undefined
        }
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
 * The `<resource>.view` a code depends on, or null.
 *
 * `users.create` without `users.view` describes an account that may register a
 * colaborador and then cannot see the screen it would register them on. The
 * database refuses that combination; this is the same rule, said early enough
 * that nobody has to discover it by being rejected.
 */
function dependencyOf(code: string, catalogue: Set<string>): string | null {
  const [resource, action] = code.split(".");
  if (!resource || !action || action === "view") return null;
  const dependency = `${resource}.view`;
  return catalogue.has(dependency) ? dependency : null;
}

/** Permissions grouped module → resource, in the order an administrator reads them. */
function groupByResource(rows: PermissionRow[]): [string, PermissionRow[]][] {
  const grouped = new Map<string, PermissionRow[]>();
  for (const row of rows) {
    const resource = row.code.split(".")[0] ?? row.module;
    const list = grouped.get(resource) ?? [];
    list.push(row);
    grouped.set(resource, list);
  }
  // `.view` first inside each resource: it is the one the others depend on.
  for (const list of grouped.values()) {
    list.sort((a, b) => {
      const aView = a.code.endsWith(".view") ? 0 : 1;
      const bView = b.code.endsWith(".view") ? 0 : 1;
      return aView - bView || a.name.localeCompare(b.name, "pt-BR");
    });
  }
  return [...grouped.entries()];
}

/**
 * One profile at a time, grouped by module and then by resource.
 *
 * The permissions that administer access itself are shown and disabled rather
 * than hidden: an administrator asking "why can't Gente manage profiles" should
 * find the answer where they looked, not conclude the permission doesn't exist.
 *
 * Nothing is saved while boxes are being ticked. The change is summarised —
 * what was added, what was removed, how many accounts it reaches — and only
 * then, with a reason, does it leave the screen.
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
  const catalogue = React.useMemo(() => new Set(matrix.map((row) => row.code)), [matrix]);
  const initial = React.useMemo(
    () => matrix.filter((row) => row.grantedCodes.includes(profile.code)).map((row) => row.code),
    [matrix, profile.code],
  );
  const [codes, setCodes] = React.useState<string[]>(initial);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const held = React.useMemo(() => new Set(codes), [codes]);

  /**
   * Toggling a resource's `view` off takes its dependants with it. Leaving them
   * ticked and invalid would only move the rejection to the save button.
   */
  const toggle = React.useCallback(
    (code: string, on: boolean) =>
      setCodes((current) => {
        const next = new Set(current);
        if (on) {
          next.add(code);
          const dependency = dependencyOf(code, catalogue);
          if (dependency) next.add(dependency);
        } else {
          next.delete(code);
          if (code.endsWith(".view")) {
            for (const other of [...next]) {
              if (dependencyOf(other, catalogue) === code) next.delete(other);
            }
          }
        }
        return [...next];
      }),
    [catalogue],
  );

  /** "Marcar todos" / "Limpar" for one resource — never for the whole matrix. */
  const setResource = React.useCallback(
    (rows: PermissionRow[], on: boolean) =>
      setCodes((current) => {
        const next = new Set(current);
        for (const row of rows) {
          if (row.reserved) continue;
          if (on) next.add(row.code);
          else next.delete(row.code);
        }
        if (!on) {
          // Clearing a resource must not leave a dependant of it behind.
          for (const other of [...next]) {
            const dependency = dependencyOf(other, catalogue);
            if (dependency && !next.has(dependency)) next.delete(other);
          }
        }
        return [...next];
      }),
    [catalogue],
  );

  const added = codes.filter((code) => !initial.includes(code));
  const removed = initial.filter((code) => !codes.includes(code));
  const dirty = added.length > 0 || removed.length > 0;

  return (
    <>
      <Drawer open onOpenChange={(open) => !open && onClose()}>
        <DrawerContent size="lg">
          <DrawerHeader>
            <DrawerTitle>Matriz de permissões · {profile.name}</DrawerTitle>
          </DrawerHeader>

          <DrawerBody className="flex flex-col gap-5">
            <p className="text-body-sm text-fg-secondary">{profile.description}</p>

            {dirty ? (
              <Alert variant="warning">
                <AlertTitle>Alterações não salvas</AlertTitle>
                <AlertDescription>
                  {added.length} adicionada(s) e {removed.length} removida(s). Nada foi aplicado ainda.
                </AlertDescription>
              </Alert>
            ) : null}

            {modules.map(([module, rows]) => (
              <section key={module} className="flex flex-col gap-3">
                <h3 className="text-body-sm font-semibold text-fg">{moduleLabel(module)}</h3>

                {groupByResource(rows).map(([resource, resourceRows]) => {
                  const selectable = resourceRows.filter((row) => !row.reserved);
                  const allOn = selectable.length > 0 && selectable.every((row) => held.has(row.code));
                  return (
                    <fieldset key={resource} className="flex flex-col gap-2 rounded-sm border border-border-subtle p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <legend className="font-mono text-caption text-fg-secondary">{resource}</legend>
                        {selectable.length > 1 ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={allOn}
                              onClick={() => setResource(resourceRows, true)}
                            >
                              Marcar todos
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={selectable.every((row) => !held.has(row.code))}
                              onClick={() => setResource(resourceRows, false)}
                            >
                              Limpar
                            </Button>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-1">
                        {resourceRows.map((row) => {
                          const checked = held.has(row.code);
                          const isDefault = row.defaultCodes.includes(profile.code);
                          const dependency = dependencyOf(row.code, catalogue);
                          const blocked = Boolean(dependency) && !held.has(dependency as string);
                          return (
                            <label
                              key={row.code}
                              className={cn(
                                "flex items-start gap-2.5 rounded-sm px-2 py-1.5",
                                (row.reserved || blocked) && "opacity-60",
                              )}
                            >
                              <Checkbox
                                className="mt-0.5"
                                checked={checked}
                                disabled={row.reserved || blocked}
                                onCheckedChange={(value) => toggle(row.code, Boolean(value))}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="text-body-sm font-medium text-fg">{row.name}</span>
                                  {row.reserved ? (
                                    <Badge variant="neutral" appearance="soft" size="sm">
                                      Somente Administrador
                                    </Badge>
                                  ) : blocked ? (
                                    <Badge variant="neutral" appearance="soft" size="sm">
                                      Requer {dependency}
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
                  );
                })}
              </section>
            ))}
          </DrawerBody>

          <DrawerFooter>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button disabled={!dirty || pending} onClick={() => setConfirmOpen(true)}>
              Salvar alterações
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <ReasonDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Alterar a matriz de ${profile.name}`}
        description={
          <ChangeSummary
            added={added}
            removed={removed}
            affected={profile.memberCount}
          />
        }
        confirmLabel="Salvar matriz"
        loading={pending}
        onConfirm={(reason) => onSave(codes, reason)}
      />
    </>
  );
}

/** What exactly is about to change, before it changes. */
function ChangeSummary({
  added,
  removed,
  affected,
}: {
  added: string[];
  removed: string[];
  affected: number;
}) {
  return (
    <span className="flex flex-col gap-2">
      <span className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm">
        <span>
          Permissões adicionadas: <strong className="tabular-nums">{added.length}</strong>
        </span>
        <span>
          Permissões removidas: <strong className="tabular-nums">{removed.length}</strong>
        </span>
        <span>
          Contas afetadas: <strong className="tabular-nums">{numberFormat.format(affected)}</strong>
        </span>
      </span>

      {added.length > 0 ? (
        <span className="block font-mono text-caption text-success">+ {added.join(", ")}</span>
      ) : null}
      {removed.length > 0 ? (
        <span className="block font-mono text-caption text-danger">− {removed.join(", ")}</span>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Simulation of a real account                                               */
/* -------------------------------------------------------------------------- */

/**
 * What one real account can do today.
 *
 * It describes an account; it never becomes one. No session is touched, no
 * action is executed on anybody's behalf, and nothing here writes. A
 * "simulation" that borrows a real session is an impersonation, and an audit
 * trail that cannot tell the difference is worth nothing.
 */
function AccountSimulation({
  memberships,
  modules,
}: {
  memberships: SimulatableMembership[];
  modules: [string, PermissionRow[]][];
}) {
  const [selected, setSelected] = React.useState<string>("");
  const [access, setAccess] = React.useState<EffectiveAccess | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, startLoading] = React.useTransition();

  const choose = (membershipId: string) => {
    setSelected(membershipId);
    setAccess(null);
    setError(null);
    if (!membershipId) return;
    startLoading(async () => {
      const result = await loadEffectiveAccess(membershipId);
      if (result.ok && result.data) setAccess(result.data);
      else setError(result.error ?? "Não foi possível carregar o acesso desta conta.");
    });
  };

  const held = React.useMemo(() => new Set(access?.permissions ?? []), [access]);

  // The sidebar is derived from permissions, so the simulation can say exactly
  // which entries this account sees without guessing.
  const menu = React.useMemo(
    () =>
      NAVIGATION_PERMISSIONS.map((entry) => ({
        ...entry,
        visible: !entry.permission || held.has(entry.permission),
      })),
    [held],
  );

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="info">
        <AlertTitle>Pré-visualização, sem assumir a identidade de ninguém</AlertTitle>
        <AlertDescription>
          Esta aba descreve o que a conta selecionada pode fazer. Nenhuma sessão é alterada e nenhuma ação é executada
          em nome de outra pessoa.
        </AlertDescription>
      </Alert>

      <div className="max-w-md">
        <FormField label="Conta" helperText="Somente contas com vínculo ativo, suspenso ou convite pendente.">
          <Select value={selected} onValueChange={choose}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione uma conta" />
            </SelectTrigger>
            <SelectContent>
              {memberships.map((membership) => (
                <SelectItem key={membership.membershipId} value={membership.membershipId}>
                  {membership.name}
                  {membership.profileCodes.length > 0 ? ` · ${membership.profileCodes.join(", ")}` : " · sem perfil"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      {loading ? <LoadingState label="Carregando o acesso efetivo…" /> : null}

      {error ? (
        <Alert variant="danger">
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {access ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <h3 className="text-body-sm font-semibold text-fg">Identidade e perfil</h3>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SimField label="Conta">{access.name ?? "—"}</SimField>
                <SimField label="E-mail">{access.email ?? "—"}</SimField>
                <SimField label="Situação do acesso">
                  {ACCESS_STATUS_LABELS[access.status] ?? access.status}
                </SimField>
                <SimField label="Perfil de acesso">
                  {access.profiles.length > 0
                    ? access.profiles.map((profile) => profile.name).join(", ")
                    : "Nenhum perfil atribuído"}
                </SimField>
              </dl>

              <Separator />

              <h3 className="text-body-sm font-semibold text-fg">Alcance por operação</h3>
              {access.accessAllOperations ? (
                <p className="text-body-sm text-fg-secondary">
                  Enxerga <strong>todas</strong> as operações da organização, independentemente do escopo atribuído.
                </p>
              ) : access.operations.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {access.operations.map((operation) => (
                    <li key={operation.id}>
                      <Badge variant="neutral" appearance="soft">
                        {operation.name}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-sm text-warning">
                  Nenhuma operação atribuída: esta conta não enxerga operação alguma.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <h3 className="text-body-sm font-semibold text-fg">Menu visível</h3>
              <ul className="flex flex-col gap-1.5">
                {menu.map((entry) => (
                  <li key={entry.label} className="flex items-center gap-2 text-body-sm">
                    {entry.visible ? (
                      <Check className="size-4 shrink-0 text-success" aria-hidden />
                    ) : (
                      <Minus className="size-4 shrink-0 text-fg-muted" aria-hidden />
                    )}
                    <span className={cn(entry.visible ? "text-fg" : "text-fg-muted line-through")}>{entry.label}</span>
                    <span className="sr-only">{entry.visible ? "visível" : "bloqueado"}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardContent className="flex flex-col gap-3 p-4">
              <h3 className="text-body-sm font-semibold text-fg">
                Permissões efetivas ({numberFormat.format(access.permissions.length)})
              </h3>
              {access.permissions.length === 0 ? (
                <p className="text-body-sm text-warning">
                  Esta conta entra no sistema e não enxerga nenhum módulo.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {modules.map(([module, rows]) => {
                    const granted = rows.filter((row) => held.has(row.code));
                    if (granted.length === 0) return null;
                    return (
                      <section key={module} className="flex flex-col gap-1">
                        <h4 className="text-caption font-semibold tracking-wide text-fg-secondary uppercase">
                          {moduleLabel(module)}
                        </h4>
                        <ul className="flex flex-col gap-0.5">
                          {granted.map((row) => (
                            <li key={row.code} className="flex items-start gap-1.5 text-caption text-fg-secondary">
                              <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                              <span>{row.name}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function SimField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="truncate text-body-sm text-fg">{children}</dd>
    </div>
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
