import Link from "next/link";
import { ArrowUpRight, Boxes, Database, LayoutGrid, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/ui/card";
import { navigation } from "@/components/layout/navigation";

/**
 * The dashboard is intentionally empty of numbers: no operational module is
 * implemented yet and inventing indicators would be worse than showing none.
 * It states what is ready, what comes next, and where to inspect the system.
 */

const foundations = [
  {
    icon: Database,
    title: "Fundação de dados",
    description:
      "Esquema multi-tenant com RLS, RBAC por permissões, auditoria append-only e master data de frota já aplicados.",
  },
  {
    icon: LayoutGrid,
    title: "Design system",
    description:
      "Tokens, temas claro e escuro, app shell e componentes base prontos para receber as telas operacionais.",
  },
  {
    icon: ShieldCheck,
    title: "Segurança",
    description:
      "Isolamento entre organizações validado por testes automatizados, com bloqueio de escalação de privilégio.",
  },
];

export function DashboardPlaceholder() {
  const plannedModules = navigation
    .flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })))
    .filter((item) => item.planned);

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-4 md:grid-cols-3">
        {foundations.map(({ icon: Icon, title, description }) => (
          <div key={title} className="rounded-md border border-border bg-surface p-4">
            <span className="flex size-8 items-center justify-center rounded-sm bg-surface-secondary text-fg-muted">
              <Icon className="size-4" aria-hidden />
            </span>
            <h2 className="mt-3 text-h4 font-semibold text-fg">{title}</h2>
            <p className="mt-1 text-body-sm text-fg-secondary">{description}</p>
          </div>
        ))}
      </section>

      <Panel
        title="Módulos previstos"
        meta={`${plannedModules.length} módulos · entram nas próximas etapas`}
        padding="none"
        actions={
          <Link
            href="/dev/design-system"
            className="inline-flex items-center gap-1 rounded-xs text-body-sm font-medium text-link hover:text-link-hover hover:underline"
          >
            Ver design system
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        }
      >
        <ul className="divide-y divide-border-subtle">
          {plannedModules.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex items-center gap-3 px-4 py-2.5">
                <Icon className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-fg">{item.label}</span>
                <span className="shrink-0 truncate text-caption text-fg-muted">{item.group}</span>
              </li>
            );
          })}
        </ul>
      </Panel>

      <p className="flex items-center gap-2 text-caption text-fg-muted">
        <Boxes className="size-3.5" aria-hidden />
        Cada módulo referencia veículos, motoristas, unidades e centros de custo por id, sem duplicar cadastro.
      </p>
    </div>
  );
}
