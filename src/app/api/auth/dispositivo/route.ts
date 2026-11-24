import { NextResponse } from "next/server";
import { createDeviceCode } from "@/lib/auth/credentials";
import { currentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Gera o codigo para registrar um dispositivo novo.
 *
 * Exige sessao valida: quem pede o codigo ja precisa estar autenticado em algum
 * dispositivo. Sem isso, seria uma porta aberta para qualquer um pedir acesso.
 */
export async function POST() {
  // So o dono: o codigo registra passkey de DONO.
  if ((await currentSession())?.papel !== "dono") {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  return NextResponse.json({ codigo: await createDeviceCode(), validadeMinutos: 10 });
}
