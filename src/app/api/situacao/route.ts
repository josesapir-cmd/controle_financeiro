import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { parseAccountIds } from "@/lib/finance/account-selection";
import { shiftDay } from "@/lib/finance/dates";
import { loadSituacaoDaFita } from "@/lib/finance/service";

export const dynamic = "force-dynamic";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Teto por chamada: a fita cresce de mes em mes, nao de ano em ano. */
const MAXIMO_DE_DIAS = 120;

/**
 * Situacao dos dias de um trecho da fita.
 *
 * A fita cresce para o passado conforme se anda, e as bolinhas do trecho novo
 * precisam vir de algum lugar. Carregar tudo de uma vez na pagina resolveria
 * hoje e ficaria caro no dia em que o historico tiver dois anos; carregar sob
 * demanda mantem a primeira pintura barata.
 */
export async function GET(request: Request): Promise<Response> {
  await requireSession();

  const url = new URL(request.url);
  const de = url.searchParams.get("de") ?? "";
  const ate = url.searchParams.get("ate") ?? "";

  if (!DATA_ISO.test(de) || !DATA_ISO.test(ate) || de > ate) {
    return NextResponse.json({ error: "Periodo invalido." }, { status: 400 });
  }

  // Recorta em vez de recusar: um pedido largo demais e erro de quem chamou, e
  // devolver o que cabe e mais util do que devolver nada.
  const teto = shiftDay(de, MAXIMO_DE_DIAS - 1);
  const fim = ate > teto ? teto : ate;

  const accountIds = parseAccountIds(url.searchParams.getAll("contas"));
  const { dias } = await loadSituacaoDaFita(de, fim, { accountIds });

  return NextResponse.json({ dias });
}
