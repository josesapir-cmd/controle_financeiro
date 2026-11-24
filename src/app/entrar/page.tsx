import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/session";
import { AuthForm } from "./AuthForm";

export const dynamic = "force-dynamic";

export default async function Entrar() {
  const sessao = await currentSession();
  if (sessao) redirect(sessao.papel === "dono" ? "/" : "/assistente");

  return (
    <main className="page solo">
      <h1>Controle Financeiro</h1>
      <div style={{ marginTop: 20 }}>
        <AuthForm />
      </div>
    </main>
  );
}
