import type { Metadata } from "next";
import { PageHeader, PageContent } from "@/components/layout/page-header";
import { requireSession, hasPermission } from "@/lib/auth/session";
import { DashboardPlaceholder } from "./dashboard-placeholder";
import { UsersEntry } from "./users-entry";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Visão geral da operação de frota.",
};

export default async function DashboardPage() {
  const session = await requireSession();
  const canSeeUsers = Boolean(session.activeOrganization) && hasPermission(session, "users.view");

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Visão geral da operação. Os indicadores são conectados quando os módulos operacionais entrarem."
      />
      <PageContent>
        <div className="flex flex-col gap-5">
          {canSeeUsers ? <UsersEntry organizationId={session.activeOrganization!.organizationId} /> : null}
          <DashboardPlaceholder />
        </div>
      </PageContent>
    </>
  );
}
