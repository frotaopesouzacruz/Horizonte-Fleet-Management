import Link from "next/link";
import { CircleDot, ClipboardCheck, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import type { HomeAppCard } from "@/lib/portal/home-status";

const ICON: Record<string, React.ReactNode> = {
  checklist_frota: <ClipboardCheck />,
  vistoria_mtsr: <ShieldCheck />,
  vistoria_pneus: <CircleDot />,
};

const CHIP: Record<HomeAppCard["tone"], string> = {
  primary: "bg-primary text-primary-fg",
  info: "bg-info-soft text-info-soft-fg",
  highlight: "bg-highlight-soft text-highlight-soft-fg",
};

/**
 * Um aplicativo como azulejo: 2 por linha no celular, 3 ou 4 no desktop.
 * O azulejo inteiro é o link, com alvo de toque de 96px.
 */
export function AppTile({ app }: { app: HomeAppCard }) {
  return (
    <Link
      href={app.href}
      data-testid={`app-${app.code}`}
      className={cn(
        "group flex min-h-24 flex-col gap-2 rounded-xl border border-border bg-surface-raised p-3.5 shadow-card outline-none hfm-transition hfm-focus-ring",
        "hover:-translate-y-px hover:border-border-emphasis hover:shadow-card-hover",
      )}
    >
      <span aria-hidden className={cn("flex size-10 items-center justify-center rounded-lg [&_svg]:size-5", CHIP[app.tone])}>
        {ICON[app.code] ?? <ClipboardCheck />}
      </span>
      <span className="min-w-0">
        <span className="block text-body-sm font-semibold text-fg">{app.name}</span>
        <span className="mt-0.5 block text-caption text-fg-muted">{app.description}</span>
      </span>
    </Link>
  );
}

export function AppGrid({ apps }: { apps: HomeAppCard[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" aria-label="Aplicativos">
      {apps.map((app) => (
        <li key={app.code}>
          <AppTile app={app} />
        </li>
      ))}
    </ul>
  );
}
