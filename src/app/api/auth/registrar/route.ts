import { NextResponse } from "next/server";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { authConfig } from "@/lib/auth/config";
import {
  checkRecoveryCode,
  createRecoveryCode,
  hasCredentials,
  listCredentials,
  saveChallenge,
  saveCredential,
  takeChallenge,
} from "@/lib/auth/credentials";
import { createSession, currentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Registro de passkey.
 *
 * Tres caminhos permitidos, e apenas eles:
 *   1. bootstrap — nao ha nenhuma credencial ainda;
 *   2. adicionar dispositivo — ja autenticado;
 *   3. recuperacao — com o codigo guardado offline.
 *
 * A janela de bootstrap se fecha sozinha na primeira credencial gravada. Nao
 * depende de o dono lembrar de desligar nada, que e o tipo de passo esquecido
 * que deixa um app aberto na internet.
 */
async function podeRegistrar(recoveryCode?: string): Promise<boolean> {
  if (!(await hasCredentials())) return true;
  if (await currentSession()) return true;
  if (recoveryCode) return checkRecoveryCode(recoveryCode);
  return false;
}

export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => ({}))) as {
    etapa?: string;
    recoveryCode?: string;
    challengeId?: string;
    label?: string;
    resposta?: unknown;
  };

  const { rpID, rpName } = authConfig();

  if (!(await podeRegistrar(corpo.recoveryCode))) {
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  if (corpo.etapa === "opcoes") {
    const existentes = await listCredentials();

    const opcoes = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: "dono",
      userDisplayName: "Dono",
      attestationType: "none",
      // Impede registrar duas vezes o mesmo dispositivo.
      excludeCredentials: existentes.map((c) => ({ id: c.id })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    const challengeId = await saveChallenge("registro", opcoes.challenge);
    return NextResponse.json({ challengeId, opcoes });
  }

  if (corpo.etapa === "verificar") {
    const desafio = corpo.challengeId ? await takeChallenge(corpo.challengeId, "registro") : null;
    if (!desafio) {
      return NextResponse.json({ error: "desafio expirado; tente de novo" }, { status: 400 });
    }

    const { origin } = authConfig();
    const primeira = !(await hasCredentials());

    const verificacao = await verifyRegistrationResponse({
      response: corpo.resposta as Parameters<typeof verifyRegistrationResponse>[0]["response"],
      expectedChallenge: desafio,
      expectedOrigin: origin,
      expectedRPID: rpID,
    }).catch((erro: unknown) => {
      return { verified: false, erro: erro instanceof Error ? erro.message : "falhou" } as const;
    });

    if (!verificacao.verified || !("registrationInfo" in verificacao)) {
      return NextResponse.json({ error: "registro nao verificado" }, { status: 400 });
    }

    const info = verificacao.registrationInfo;
    if (!info) return NextResponse.json({ error: "registro sem dados" }, { status: 400 });

    await saveCredential({
      id: info.credential.id,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      transports: info.credential.transports,
      label: corpo.label?.slice(0, 60),
    });

    await createSession(request.headers.get("user-agent"));

    // O codigo de recuperacao aparece uma unica vez, no bootstrap. Guardamos
    // apenas o HMAC, entao nao ha como reexibi-lo depois.
    const recoveryCode = primeira ? await createRecoveryCode() : undefined;

    return NextResponse.json({ ok: true, recoveryCode });
  }

  return NextResponse.json({ error: "etapa desconhecida" }, { status: 400 });
}

/** Diz se o app ainda precisa da primeira passkey, para a tela saber o que mostrar. */
export async function GET() {
  return NextResponse.json({ bootstrap: !(await hasCredentials()) });
}
