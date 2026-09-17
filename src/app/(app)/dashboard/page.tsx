import type { Metadata } from "next";
import { PageHeader, PageContent } from "@/components/layout/page-header";
import { DashboardPlaceholder } from "./dashboard-placeholder";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Visão geral da operação de frota.",
};

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Visão geral da operação. Os indicadores são conectados quando os módulos operacionais entrarem."
      />
      <PageContent>
        <DashboardPlaceholder />
      </PageContent>
    </>
  );
}
