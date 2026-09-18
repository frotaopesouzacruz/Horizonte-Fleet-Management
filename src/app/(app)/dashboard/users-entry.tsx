import Link from "next/link";
import { ArrowRight, IdCard, KeyRound, Users } from "lucide-react";
import { Panel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDirectoryStats } from "@/lib/admin/queries";

/**
 * Entry point to the one module that exists.
 *
 * The dashboard has no indicators of its own yet, and a screen that lists only
 * what is still to come gives a person nowhere to go. The counts are read from
 * the directory under the caller's own RLS, so this panel shows exactly the
 * base that Administração → Usuários will open on — never a privileged total.
 */
export async function UsersEntry({ organizationId }: { organizationId: string }) {
  const stats = await getDirectoryStats(organizationId);

  const figures = [
    { icon: Users, label: "Colaboradores", value: stats.total },
    { icon: KeyRound, label: "Com acesso ao sistema", value: stats.withAccess },
    { icon: IdCard, label: "Sem acesso", value: stats.withoutAccess },
  ];

  return (
    <Panel
      title="Usuários e colaboradores"
      meta="Cadastro, importação da QLP, concessão de acesso e escopo por operação"
      actions={
        // asChild renders the child alone, so Button's own trailingIcon slot is
        // dropped: the arrow has to live inside the link.
        <Button asChild size="sm">
          <Link href="/administracao/usuarios">
            Abrir módulo
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      }
    >
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {figures.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-secondary text-fg-muted">
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <dt className="truncate text-caption text-fg-secondary">{label}</dt>
              <dd className="text-h3 font-semibold tabular-nums text-fg">{value}</dd>
            </div>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
