import { NextResponse } from "next/server";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { authConfig } from "@/lib/auth/config";
import {
  createRecoveryCode,
  hasCredentials,
  listCredentials,
  saveChallenge,
  saveCredential,
  takeRegistrationChallenge,
} from "@/lib/auth/credentials";
import { autorizarRegistro, concluirRegistro, propositoDoRegistro } from "@/lib/auth/registro";
import { createSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Compara o dominio configurado com o dominio de onde a requisicao veio.
 *
 * Quando divergem, o navegador recusa com "The RP ID X is invalid for this
 * domain" — mensagem correta, porem sem indicacao do que fazer. Aqui a causa e
 * a correcao ficam explicitas, com os dois valores lado a lado.
 */
function conferirDominio(request: Request, rpID: string): string | null {
  const host = (request.headers.get("host") ?? "").split(":")[0];
  if (!host || host === rpID) return null;

  return (
    `APP_DOMAIN esta como "${rpID}", mas o app foi aberto em "${host}". ` +
    `Ajuste APP_DOMAIN para "${host}" e APP_ORIGIN para "https://${host}" ` +
    "nas variaveis de ambiente, e faca um novo deploy."
  );
}

export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => ({}))) as {
    etapa?: string;
    recoveryCode?: string;
    codigo?: string;
    challengeId?: string;
    label?: string;
    resposta?: unknown;
  };

  const { rpID, rpName } = authConfig();

  const divergencia = conferirDominio(request, rpID);
  if (divergencia) return NextResponse.json({ error: divergencia }, { status: 400 });

  const codigo = corpo.codigo ?? corpo.recoveryCode;

  if (corpo.etapa === "opcoes") {
    const concessao = await autorizarRegistro(codigo);
    if (!concessao) {
      return NextResponse.json(
        { error: codigo ? "codigo invalido ou vencido" : "nao autorizado" },
        { status: 401 },
      );
    }

    const existentes = await listCredentials();
    const assistente = concessao.tipo === "convite";

    const opcoes = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: assistente ? "assistente" : "dono",
      userDisplayName: assistente ? "Assistente" : "Dono",
      attestationType: "none",
      // Impede registrar duas vezes o mesmo dispositivo.
      excludeCredentials: existentes.map((c) => ({ id: c.id })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    const challengeId = await saveChallenge(propositoDoRegistro(concessao), opcoes.challenge);
    return NextResponse.json({ challengeId, opcoes });
  }

  if (corpo.etapa === "verificar") {
    const guardado = corpo.challengeId
      ? await takeRegistrationChallenge(corpo.challengeId)
      : null;
    if (!guardado) {
      return NextResponse.json({ error: "desafio expirado; tente de novo" }, { status: 400 });
    }
    const desafio = guardado.challenge;

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

    // O codigo so e gasto aqui, com a passkey ja verificada: uma biometria
    // cancelada no meio nao queima o convite.
    const papel = await concluirRegistro(guardado.purpose);
    if (!papel) {
      return NextResponse.json(
        { error: "a autorizacao venceu ou ja foi usada; peca um codigo novo" },
        { status: 401 },
      );
    }

    await saveCredential({
      id: info.credential.id,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      transports: info.credential.transports,
      label: corpo.label?.slice(0, 60),
      papel,
    });

    await createSession(request.headers.get("user-agent"), papel);

    // O codigo de recuperacao aparece uma unica vez, no bootstrap. Guardamos
    // apenas o HMAC, entao nao ha como reexibi-lo depois.
    const recoveryCode = primeira && papel === "dono" ? await createRecoveryCode() : undefined;

    return NextResponse.json({ ok: true, papel, recoveryCode });
  }

  return NextResponse.json({ error: "etapa desconhecida" }, { status: 400 });
}

/**
 * Diz se o app ainda precisa da primeira passkey, para a tela saber o que
 * mostrar.
 *
 * Falha de banco vira mensagem, nao 500: a tela de entrada e a unica porta do
 * app, e quebra-la sem explicacao deixa o usuario sem saida.
 */
export async function GET() {
  try {
    return NextResponse.json({ bootstrap: !(await hasCredentials()) });
  } catch (erro) {
    return NextResponse.json(
      { error: erro instanceof Error ? erro.message : "banco indisponivel" },
      { status: 503 },
    );
  }
}
