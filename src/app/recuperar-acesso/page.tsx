import type { Metadata } from "next";
import { RecoverAccessView } from "./recover-access-view";

export const metadata: Metadata = {
  title: "Recuperar acesso",
  description: "Recuperação de acesso à plataforma Horizonte Fleet Management.",
};

export default function RecoverAccessPage() {
  return <RecoverAccessView />;
}
