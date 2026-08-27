import { NextResponse } from "next/server";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { authConfig } from "@/lib/auth/config";
import {
  checkRecoveryCode,
  createDeviceCode,
  createRecoveryCode,
  hasCredentials,
  listCredentials,
  saveChallenge,
  saveCredential,
  takeChallenge,
  useDeviceCode,
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
async function podeRegistrar(codigo?: string): Promise<boolean> {
  if (!(await hasCredentials())) return true;
  if (await currentSession()) return true;
  if (!codigo) return false;

  // Codigo de dispositivo primeiro: e o caminho esperado para adicionar o
  // celular, e consumi-lo evita gastar o de recuperacao.
  if (await useDeviceCode(codigo)) return true;
  return checkRecoveryCode(codigo);
}

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

  if (!(await podeRegistrar(codigo))) {
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
