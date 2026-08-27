import { NextResponse } from "next/server";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { authConfig } from "@/lib/auth/config";
import {
  listCredentials,
  saveChallenge,
  takeChallenge,
  updateCounter,
} from "@/lib/auth/credentials";
import { createSession, pruneSessions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => ({}))) as {
    etapa?: string;
    challengeId?: string;
    resposta?: unknown;
  };

  const { rpID, origin } = authConfig();

  const host = (request.headers.get("host") ?? "").split(":")[0];
  if (host && host !== rpID) {
    return NextResponse.json(
      {
        error:
          `APP_DOMAIN esta como "${rpID}", mas o app foi aberto em "${host}". ` +
          "Passkey so funciona no dominio configurado — ajuste as variaveis e faca um novo deploy.",
      },
      { status: 400 },
    );
  }

  if (corpo.etapa === "opcoes") {
    const credenciais = await listCredentials();

    const opcoes = await generateAuthenticationOptions({
      rpID,
      allowCredentials: credenciais.map((c) => ({ id: c.id })),
      userVerification: "preferred",
    });

    const challengeId = await saveChallenge("login", opcoes.challenge);
    return NextResponse.json({ challengeId, opcoes });
  }

  if (corpo.etapa === "verificar") {
    const desafio = corpo.challengeId ? await takeChallenge(corpo.challengeId, "login") : null;
    if (!desafio) {
      return NextResponse.json({ error: "desafio expirado; tente de novo" }, { status: 400 });
    }

    const resposta = corpo.resposta as { id?: string };
    const credencial = (await listCredentials()).find((c) => c.id === resposta?.id);
    if (!credencial) {
      return NextResponse.json({ error: "credencial desconhecida" }, { status: 401 });
    }

    const verificacao = await verifyAuthenticationResponse({
      response: corpo.resposta as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
      expectedChallenge: desafio,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credencial.id,
        publicKey: credencial.publicKey,
        counter: credencial.counter,
        transports: credencial.transports as never,
      },
    }).catch(() => ({ verified: false }) as const);

    if (!verificacao.verified) {
      return NextResponse.json({ error: "autenticacao falhou" }, { status: 401 });
    }

    // O contador cresce a cada uso; se voltasse atras, seria sinal de credencial
    // clonada. A biblioteca ja recusa esse caso na verificacao.
    if ("authenticationInfo" in verificacao && verificacao.authenticationInfo) {
      await updateCounter(credencial.id, verificacao.authenticationInfo.newCounter);
    }

    await pruneSessions();
    await createSession(request.headers.get("user-agent"));

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "etapa desconhecida" }, { status: 400 });
}
