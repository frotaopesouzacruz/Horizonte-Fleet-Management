import { AppShell } from "@/components/layout/app-shell";

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  // User/organization context will come from the session in a later stage.
  return <AppShell topbar={{ userName: "Usuário HFM", organizationName: "Horizonte", unitName: "Todas as unidades" }}>{children}</AppShell>;
}
