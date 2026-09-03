"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { localMonth, monthRange, shiftMonth } from "@/lib/finance/dates";

/**
 * Seletor de mes em fita, irmao do seletor de dia da aba Dia.
 *
 * Mesma mecanica: a fita desliza no clique ANTES de a navegacao terminar, e
 * arrastar anda vários meses de uma vez. Muda a unidade e o que ela substitui —
 * aqui saiu um formulario de "de/ate" com dois campos de data, que exigia saber
 * o primeiro e o ultimo dia do mes para fazer a pergunta mais comum da tela.
 *
 * O periodo continua sendo um intervalo de dias na URL: o mes vira `from` e
 * `to`, entao nada no servidor precisa saber que existe um seletor de mes.
 */

/** Dois anos para tras; dois meses a frente entram so como contexto, como na
    fita de dias — sem eles a fita termina cedo demais e sobra trilho vazio. */
const PASSADO = 23;
const FUTURO = 2;
const LARGURA = 70;
/** Abaixo disso o ponteiro andou de menos para ser arraste: e clique. */
const LIMIAR = 4;

const MES = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

/** Dia 15 as 12h UTC: longe das viradas, entao o rotulo nunca cai no mes errado. */
function comoData(mes: string): Date {
  return new Date(`${mes}-15T12:00:00Z`);
}

export function SpinnerDeMeses({
  from,
  to,
  queryExtra,
  rota = "/categorias",
}: {
  from: string;
  to: string;
  /** contas — o que precisa sobreviver a troca de mes. */
  queryExtra: string;
  /** Tela que a fita navega. A mesma fita serve o Painel e as Categorias. */
  rota?: string;
}) {
  const router = useRouter();
  const [, iniciar] = useTransition();

  // O periodo da URL pode ser qualquer intervalo, inclusive um que atravessa
  // meses. A fita marca o mes em que ele COMECA e nada mais: fingir que um
  // intervalo de dois meses e um mes so seria mentir na tela.
  const doPeriodo = from.slice(0, 7);
  const cobreUmMesInteiro = (() => {
    const janela = monthRange(doPeriodo);
    return janela.from === from && janela.to === to;
  })();

  const [selecionado, setSelecionado] = useState(doPeriodo);
  useEffect(() => setSelecionado(doPeriodo), [doPeriodo]);

  const [puxando, setPuxando] = useState<{ dx: number } | null>(null);
  /** Onde o ponteiro desceu, antes de sabermos se e clique ou arraste. */
  const origem = useRef<number | null>(null);
  const andou = useRef(0);

  const mesAtual = localMonth(new Date());
  // Ancorada no mes CORRENTE, nao no selecionado: assim o limite direito e
  // sempre o mesmo lugar e a fita nao se reconstroi a cada navegacao.
  const meses = Array.from({ length: PASSADO + FUTURO + 1 }, (_, i) =>
    shiftMonth(mesAtual, i - PASSADO),
  );
  const indice = Math.max(0, meses.indexOf(selecionado));
  const noLimitePassado = indice <= 0;
  const ehMesAtual = selecionado === mesAtual && cobreUmMesInteiro;

  function irPara(destino: string) {
    // Nunca adiante do mes corrente: mes futuro nao tem lancamento.
    if (destino > mesAtual || !meses.includes(destino)) return;
    if (destino === selecionado && cobreUmMesInteiro) return;

    setSelecionado(destino);
    const janela = monthRange(destino);
    iniciar(() => {
      router.push(
        `${rota}?${[`from=${janela.from}`, `to=${janela.to}`, queryExtra]
          .filter(Boolean)
          .join("&")}`,
      );
    });
  }

  const deslocamento = indice * LARGURA + LARGURA / 2 - (puxando?.dx ?? 0);

  return (
    <div className="spinner">
      <button
        type="button"
        className="spinner-seta"
        onClick={() => irPara(shiftMonth(selecionado, -1))}
        disabled={noLimitePassado}
        aria-label="Mes anterior"
      >
        ‹
      </button>

      <div
        className={`spinner-trilho ${puxando ? "puxando" : ""}`}
        onPointerDown={(evento) => {
          // A captura NAO acontece aqui. Com o ponteiro capturado, o `click`
          // vai para o trilho e nunca chega ao botao do mes. So capturamos
          // quando vira arraste de verdade.
          origem.current = evento.clientX;
          andou.current = 0;
        }}
        onPointerMove={(evento) => {
          if (origem.current === null) return;

          const bruto = evento.clientX - origem.current;
          andou.current = Math.max(andou.current, Math.abs(bruto));
          if (!puxando && andou.current < LIMIAR) return;

          if (!puxando) evento.currentTarget.setPointerCapture(evento.pointerId);

          const minimo = (indice - (meses.length - 1 - FUTURO)) * LARGURA;
          const maximo = indice * LARGURA;
          setPuxando({ dx: Math.min(Math.max(bruto, minimo), maximo) });
        }}
        onPointerUp={() => {
          origem.current = null;
          if (!puxando) return;

          // Encaixa no mes mais proximo em vez de parar entre dois.
          const passos = Math.round(puxando.dx / LARGURA);
          setPuxando(null);
          irPara(meses[Math.max(0, indice - passos)] ?? selecionado);
        }}
        onPointerCancel={() => {
          origem.current = null;
          setPuxando(null);
        }}
      >
        <div className="spinner-fita" style={{ transform: `translateX(-${deslocamento}px)` }}>
          {meses.map((valor, i) => {
            const distancia = Math.abs(i - indice);
            const atual = valor === selecionado && cobreUmMesInteiro;
            const futuro = valor > mesAtual;

            return (
              <button
                type="button"
                key={valor}
                // Mes futuro entra so como contexto: da a sensacao de fita
                // continua sem prometer conteudo que nao existe.
                disabled={futuro}
                onClick={() => {
                  if (andou.current < LIMIAR) irPara(valor);
                }}
                aria-current={atual ? "date" : undefined}
                className={[
                  "spinner-dia",
                  atual ? "spinner-dia-atual" : "",
                  futuro ? "spinner-dia-futuro" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                // Os vizinhos desbotam com a distancia: a fita tem centro sem
                // precisar de outra marca.
                style={{ opacity: atual ? 1 : Math.max(0.28, 1 - distancia * 0.16) }}
              >
                <span className="spinner-data">
                  {MES.format(comoData(valor)).replace(".", "")}
                </span>
                <span className="spinner-semana">{valor.slice(0, 4)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className="spinner-seta"
        onClick={() => irPara(shiftMonth(selecionado, 1))}
        disabled={selecionado >= mesAtual}
        aria-label="Proximo mes"
      >
        ›
      </button>

      <button
        type="button"
        className="spinner-hoje"
        onClick={() => irPara(mesAtual)}
        disabled={ehMesAtual}
      >
        Este mes
      </button>
    </div>
  );
}
