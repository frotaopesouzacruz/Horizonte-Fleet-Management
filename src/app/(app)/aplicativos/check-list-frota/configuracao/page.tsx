import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import {
  getChecklistAdminOverview,
  getChecklistVersionTree,
  type AdminVersionSummary,
  type ChecklistVersionTree,
} from "@/lib/applications/admin-queries";
import { getApplicationLinks, type ApplicationLinks } from "@/lib/applications/links-queries";
import { ConfigurationView, type ConfigurationTab } from "./configuration-view";

export const metadata: Metadata = {
  title: "Configuração · Check List de Frota",
  description: "Versões, clusters, perguntas, condicionais e aplicabilidade do Check List de Frota.",
};

type SearchParams = Record<string, string | string[] | undefined>;
const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

const TABS: ConfigurationTab[] = [
  "geral", "clusters", "perguntas", "operacoes", "tipos", "previa", "historico",
];

/** O rascunho, se houver; senão a publicada; senão a mais recente. */
function pickDefaultVersion(versions: AdminVersionSummary[]): AdminVersionSummary | null {
  return (
    versions.find((v) => v.status === "draft") ??
    versions.find((v) => v.status === "published") ??
    versions[0] ??
    null
  );
}

/**
 * Aplicativos → Check List de Frota → Configuração (§45–§47).
 *
 * A rota exige `configure` para entrar. O que cada pessoa pode ESCREVER —
 * criar versão, publicar, regras, vínculos — vai adiante como permissão
 * separada, e o banco confere tudo de novo na gravação.
 */
export default async function ChecklistConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { session, organization } = await requireOrganization("applications.checklist_fleet.configure");
  const has = (code: string) => session.isPlatformAdmin || session.permissions.includes(code);
  const params = await searchParams;

  const overview = await getChecklistAdminOverview(organization.organizationId);

  const requested = first(params, "versao");
  const selected =
    overview.versions.find((v) => v.id === requested) ?? pickDefaultVersion(overview.versions);

  let tree: ChecklistVersionTree | null = null;
  if (selected) {
    tree = await getChecklistVersionTree(organization.organizationId, selected.id);
  }

  // Perder os vínculos não é motivo para perder o editor: as abas de
  // operações e tipos carregam sozinhas quando o painel abre sem dados.
  let links: ApplicationLinks | undefined;
  if (overview.app) {
    links = await getApplicationLinks(organization.organizationId, { appId: overview.app.id }).catch(
      () => undefined,
    );
  }

  const tabParam = first(params, "aba") as ConfigurationTab | undefined;
  const initialTab = tabParam && TABS.includes(tabParam) ? tabParam : "geral";

  return (
    <ConfigurationView
      overview={overview}
      initialVersionId={selected?.id ?? null}
      initialTree={tree}
      links={links}
      initialTab={initialTab}
      today={new Date().toISOString().slice(0, 10)}
      perms={{
        configure: has("applications.checklist_fleet.configure"),
        createVersion: has("applications.checklist_fleet.create_version"),
        publish: has("applications.checklist_fleet.publish"),
        manageRules: has("applications.checklist_fleet.manage_rules"),
        manageOperationLinks: has("applications.manage_operation_links"),
        manageEquipmentLinks: has("applications.manage_equipment_links"),
      }}
    />
  );
}
