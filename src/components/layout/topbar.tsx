"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, Building2, Check, ChevronDown, HelpCircle, LogOut, MapPin, Menu, RefreshCw, Search, Settings, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/ui/status-badge";
import type { NotificationItem, NotificationsResult } from "@/lib/home/notifications";
import { ThemeToggle } from "./theme-toggle";
import { useAppShell } from "./app-shell-context";

/* -------------------------------------------------------------------------- */
/* Context selectors (organization / unit)                                    */
/* -------------------------------------------------------------------------- */

const selectorTrigger = cn(
  "inline-flex h-8 max-w-56 items-center gap-2 rounded-sm px-2 text-body-sm hfm-transition hfm-focus-ring",
  "text-fg-secondary hover:bg-secondary hover:text-fg data-[state=open]:bg-secondary",
);

/**
 * Organization switcher. It only ever lists the caller's own memberships, and
 * the server action re-validates the choice — the cookie is a preference, not
 * an authorization.
 */
function OrganizationSelector({
  organizations,
  activeId,
  fallbackName,
  onSwitch,
}: {
  organizations: { id: string; name: string }[];
  activeId?: string;
  fallbackName: string;
  onSwitch?: (organizationId: string) => Promise<void>;
}) {
  const [pending, startTransition] = React.useTransition();
  const router = useRouter();
  const active = organizations.find((o) => o.id === activeId);
  const value = active?.name ?? fallbackName;
  const single = organizations.length <= 1;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Organização: ${value}`} className={selectorTrigger} disabled={pending}>
          <Building2 className="size-4 shrink-0 text-fg-muted" aria-hidden />
          <span className="truncate font-medium">{value}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Organização</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.length === 0 ? (
          <div className="px-2 py-1.5 text-caption text-fg-muted">Nenhum vínculo ativo.</div>
        ) : (
          organizations.map((organization) => (
            <DropdownMenuItem
              key={organization.id}
              disabled={organization.id === activeId || !onSwitch}
              onSelect={() =>
                startTransition(async () => {
                  await onSwitch?.(organization.id);
                  router.refresh();
                })
              }
            >
              <Check className={cn("size-4", organization.id === activeId ? "opacity-100" : "opacity-0")} aria-hidden />
              {organization.name}
            </DropdownMenuItem>
          ))
        )}
        {single ? null : (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-caption text-fg-muted">A troca recarrega os dados no contexto escolhido.</div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UnitSelector({ value }: { value: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Unidade: ${value}`} className={selectorTrigger}>
          <MapPin className="size-4 shrink-0 text-fg-muted" aria-hidden />
          <span className="truncate font-medium">{value}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Unidade</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>{value}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-caption text-fg-muted">O filtro por unidade entra com os módulos operacionais.</div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------------- */
/* Global search trigger (opens a command palette in a later stage)           */
/* -------------------------------------------------------------------------- */

function GlobalSearch({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-surface px-2.5 text-body-sm text-fg-muted hfm-transition hfm-focus-ring",
            "hover:border-border-strong hover:text-fg-secondary",
            className,
          )}
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="hidden truncate md:inline">Buscar no sistema…</span>
          <span className="sr-only md:hidden">Buscar</span>
          <kbd className="ml-auto hidden rounded-xs border border-border bg-surface-secondary px-1.5 font-sans text-overline text-fg-muted md:inline-block">
            Ctrl K
          </kbd>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(90vw,28rem)]">
        <p className="text-body-sm text-fg-secondary">A busca global será conectada aos cadastros de frota nas próximas etapas.</p>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------------- */
/* Topbar                                                                     */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Central de notificações                                                    */
/* -------------------------------------------------------------------------- */

const KIND: Record<NotificationItem["kind"], { label: string; tone: "danger" | "warning" | "info" }> = {
  alerta: { label: "Alerta", tone: "danger" },
  acao: { label: "Ação", tone: "warning" },
  informacao: { label: "Informação", tone: "info" },
};

/**
 * O sino. Nada é lido antes de a pessoa abrir; o que aparece é derivado do
 * que a Home de cada perfil já sabe (Ação / Alerta / Informação), nunca
 * inventado. Sem carregador (prévias, gestão) o sino diz que não há nada.
 */
function NotificationCenter({ load }: { load?: () => Promise<NotificationsResult> }) {
  const [result, setResult] = React.useState<NotificationsResult | null>(null);
  const [loading, startLoading] = React.useTransition();

  const refresh = React.useCallback(() => {
    if (!load) return;
    startLoading(async () => {
      const next = await load();
      setResult(next);
    });
  }, [load]);

  const items = result?.ok ? result.items : [];
  const urgent = items.filter((i) => i.kind !== "informacao").length;

  return (
    <Popover onOpenChange={(open) => open && result === null && refresh()}>
      <PopoverTrigger asChild>
        <IconButton label={urgent ? `Notificações (${urgent} que pedem ação)` : "Notificações"} variant="ghost" className="relative">
          <Bell aria-hidden />
          {urgent ? (
            <span
              aria-hidden
              className="absolute top-1 right-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-danger-fg"
            >
              {urgent > 9 ? "9+" : urgent}
            </span>
          ) : null}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(100vw-1rem,22rem)] p-0" data-testid="notificacoes">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-body-sm font-semibold">Notificações</span>
          {load ? (
            <Button variant="ghost" size="sm" leadingIcon={<RefreshCw />} disabled={loading} onClick={refresh}>
              Atualizar
            </Button>
          ) : null}
        </div>
        {!load || (result?.ok && items.length === 0) ? (
          <p className="px-3 py-6 text-center text-body-sm text-fg-muted">Nenhuma notificação no momento.</p>
        ) : loading && result === null ? (
          <p className="px-3 py-6 text-center text-body-sm text-fg-muted" role="status">
            Carregando…
          </p>
        ) : result && !result.ok ? (
          <p className="px-3 py-6 text-center text-body-sm text-danger" role="alert">
            {result.error}
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto" aria-label="Notificações">
            {items.map((item) => {
              const kind = KIND[item.kind];
              const body = (
                <>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={kind.tone} size="sm">
                      {kind.label}
                    </StatusBadge>
                    <span className="truncate text-body-sm font-medium text-fg">{item.title}</span>
                  </span>
                  <span className="mt-0.5 block text-caption text-fg-muted">{item.description}</span>
                </>
              );
              return (
                <li key={item.key}>
                  {item.href ? (
                    <Link href={item.href} className="block px-3 py-2.5 hfm-transition hover:bg-hover-overlay hfm-focus-ring">
                      {body}
                    </Link>
                  ) : (
                    <div className="px-3 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

export interface TopbarProps {
  /**
   * `portal`: o cabeçalho do Operacional e da Liderança — sem o seletor de
   * unidade e sem a busca global, que ainda são reservas da gestão e não
   * levam a nada nas telas desses perfis.
   */
  variant?: "full" | "portal";
  /** Display name of the signed-in user. */
  userName?: string;
  /** Linha abaixo do nome no menu da conta: e-mail, ou "Matrícula … · Perfil". */
  userEmail?: string;
  organizationName?: string;
  unitName?: string;
  /** Organizations the caller belongs to (active memberships only). */
  organizations?: { id: string; name: string }[];
  activeOrganizationId?: string;
  onSignOut?: () => Promise<void>;
  onSwitchOrganization?: (organizationId: string) => Promise<void>;
  /** "Meu perfil" no menu da conta; sem ele o item fica desabilitado. */
  profileHref?: string;
  /** Central de notificações: lida só quando o sino é aberto (ação do servidor). */
  loadNotifications?: () => Promise<NotificationsResult>;
}

export function Topbar({
  variant = "full",
  userName = "Usuário",
  userEmail,
  organizationName = "Organização",
  unitName = "Todas as unidades",
  organizations = [],
  activeOrganizationId,
  onSignOut,
  onSwitchOrganization,
  profileHref,
  loadNotifications,
}: TopbarProps) {
  const { setMobileOpen } = useAppShell();
  const [signingOut, startSignOut] = React.useTransition();
  const initials = userName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <header
      className={cn(
        "sticky top-0 z-(--z-topbar) flex h-(--topbar-height) items-center gap-2 border-b border-border bg-surface-topbar px-3 sm:px-4",
      )}
    >
      <IconButton label="Abrir menu" variant="ghost" className="lg:hidden" onClick={() => setMobileOpen(true)}>
        <Menu aria-hidden />
      </IconButton>

      <div className="hidden items-center gap-1 lg:flex">
        <OrganizationSelector
          organizations={organizations}
          activeId={activeOrganizationId}
          fallbackName={organizationName}
          onSwitch={onSwitchOrganization}
        />
        {variant === "full" ? (
          <>
            <span aria-hidden className="h-4 w-px bg-border" />
            <UnitSelector value={unitName} />
          </>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 justify-center px-1 md:justify-end">
        {variant === "full" ? (
          <GlobalSearch className="w-full min-w-0 max-w-xs md:w-[300px] md:max-w-none xl:w-[340px]" />
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <ThemeToggle />
        <NotificationCenter load={loadNotifications} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Menu do usuário"
              className="ml-1 inline-flex h-8 items-center gap-2 rounded-sm pr-1 pl-1 hfm-transition hover:bg-secondary hfm-focus-ring data-[state=open]:bg-secondary"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-primary-soft text-caption font-semibold text-primary-soft-fg">
                {initials || <User className="size-4" aria-hidden />}
              </span>
              <span className="hidden max-w-32 truncate text-body-sm font-medium text-fg xl:inline">{userName}</span>
              <ChevronDown className="hidden size-3.5 text-fg-muted xl:inline" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <div className="px-2 py-1.5">
              <p className="truncate text-body-sm font-semibold text-fg">{userName}</p>
              {userEmail ? <p className="truncate text-caption text-fg-muted">{userEmail}</p> : null}
            </div>
            <DropdownMenuSeparator />
            {profileHref ? (
              <DropdownMenuItem asChild>
                <Link href={profileHref}>
                  <User aria-hidden />
                  Meu perfil
                </Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                <User aria-hidden />
                Meu perfil
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled>
              <Settings aria-hidden />
              Preferências
              <DropdownMenuShortcut>⌘ ,</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <HelpCircle aria-hidden />
              Ajuda
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!onSignOut || signingOut}
              onSelect={() => startSignOut(async () => { await onSignOut?.(); })}
            >
              <LogOut aria-hidden />
              {signingOut ? "Saindo…" : "Sair"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
