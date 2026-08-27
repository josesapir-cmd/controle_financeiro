import { NextResponse } from "next/server";
import { getSql } from "@/lib/db/client";
import { fromPostgres } from "@/lib/db/adapter";
import * as pluggy from "@/lib/pluggy/client";
import { currentMonthRange, lastDaysRange } from "@/lib/finance/dates";
import { syncAll } from "@/lib/sync/sync";
import { safeEqual } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Janela padrao do cron. Cobre folgadamente o atraso com que bancos liquidam
 * lancamentos, sem refazer trabalho a cada seis horas.
 *
 * Carga historica e outra coisa: passe ?dias=365. Ela demora e nao cabe no
 * limite de tempo da funcao serverless, entao roda pelo script local, contra o
 * app em desenvolvimento.
 */
const DIAS_PADRAO = 45;

/** Teto de sanidade: alem disso e engano de digitacao, nao intencao. */
const DIAS_MAXIMO = 3650;

/**
 * Autoriza tanto o cron da Vercel (cabecalho proprio) quanto uma chamada manual
 * com o segredo. Comparacao em tempo constante: com `===`, o tempo de resposta
 * vazaria quantos caracteres iniciais estao certos.
 */
function autorizado(request: Request): boolean {
  const cabecalho = request.headers.get("authorization") ?? "";
  const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : "";
  if (!token) return false;

  // A Vercel envia "Authorization: Bearer $CRON_SECRET" nas chamadas agendadas.
  // Aceitamos os dois segredos para nao obrigar que sejam o mesmo valor: o do
  // cron e gerenciado pela plataforma, o nosso serve as chamadas manuais.
  const aceitos = [process.env.SYNC_SECRET, process.env.CRON_SECRET].filter(
    (valor): valor is string => Boolean(valor),
  );

  // Compara com todos antes de responder, sem interromper no primeiro acerto:
  // sair mais cedo faria o tempo de resposta revelar qual segredo casou.
  return aceitos.reduce((valido, esperado) => safeEqual(token, esperado) || valido, false);
}

async function itensCadastrados(db: ReturnType<typeof fromPostgres>): Promise<string[]> {
  const linhas = await db.query<{ item_id: string }>("SELECT item_id FROM connections");
  const doBanco = linhas.map((linha) => linha.item_id);

  // No primeiro uso o banco esta vazio; as conexoes vem do ambiente ate serem
  // gravadas pela primeira sincronizacao.
  const doAmbiente = (process.env.PLUGGY_ITEM_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return [...new Set([...doBanco, ...doAmbiente])];
}

export async function POST(request: Request) {
  if (!autorizado(request)) {
    // Sem detalhar o motivo: distinguir "segredo ausente" de "segredo errado"
    // ajudaria mais quem esta tentando adivinhar do que quem esta depurando.
    return NextResponse.json({ error: "nao autorizado" }, { status: 401 });
  }

  const db = fromPostgres(getSql());
  const url = new URL(request.url);

  const pedido = Number(url.searchParams.get("dias") ?? DIAS_PADRAO);
  const dias = Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, DIAS_MAXIMO) : DIAS_PADRAO;
  const periodo = lastDaysRange(dias);

  const itemIds = await itensCadastrados(db);
  if (itemIds.length === 0) {
    return NextResponse.json({ error: "nenhuma conexao cadastrada" }, { status: 400 });
  }

  const inicio = await db.query<{ id: string }>(
    "INSERT INTO sync_runs (status) VALUES ('running') RETURNING id",
  );
  const runId = inicio[0].id;

  try {
    const resultados = await syncAll(db, pluggy, itemIds, periodo);
    const falhas = resultados.filter((r) => r.error);

    await db.query(
      "UPDATE sync_runs SET finished_at = now(), status = $2, detail = $3 WHERE id = $1",
      [runId, falhas.length ? "partial" : "ok", JSON.stringify(resultados)],
    );

    return NextResponse.json({
      periodo,
      conexoes: resultados.length,
      falhas: falhas.length,
      resultados,
    });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "erro desconhecido";
    await db.query(
      "UPDATE sync_runs SET finished_at = now(), status = 'error', detail = $2 WHERE id = $1",
      [runId, mensagem],
    );
    return NextResponse.json({ error: mensagem }, { status: 500 });
  }
}

/**
 * O cron da Vercel dispara com GET. Reaproveitamos o POST em vez de duplicar a
 * logica, mantendo a mesma exigencia de segredo.
 */
export async function GET(request: Request) {
  return POST(request);
}
