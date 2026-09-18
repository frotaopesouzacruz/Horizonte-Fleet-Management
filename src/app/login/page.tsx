import type { Metadata } from "next";
import { LoginView } from "./login-view";

export const metadata: Metadata = {
  title: "Entrar",
  description: "Acesso à plataforma Horizonte Fleet Management.",
};

export default function LoginPage() {
  return <LoginView />;
}
