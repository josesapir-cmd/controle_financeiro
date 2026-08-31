import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/session";
import { AuthForm } from "./AuthForm";

export const dynamic = "force-dynamic";

export default async function Entrar() {
  if (await currentSession()) redirect("/");

  return (
    <main className="page solo">
      <h1>Controle Financeiro</h1>
      <div style={{ marginTop: 20 }}>
        <AuthForm />
      </div>
    </main>
  );
}
