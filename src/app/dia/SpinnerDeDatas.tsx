"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { localDay, shiftDay } from "@/lib/finance/dates";

/**
 * Seletor de dia em fita deslizante.
 *
 * Substitui os tres botoes de navegacao. A diferenca nao e estetica: com os
 * botoes, so dava para andar um dia por vez e nao se via onde se estava na
 * semana. A fita mostra os vizinhos e deixa pular direto.
 *
 * A fita desliza no clique ANTES da navegacao terminar. Sem isso, o movimento
 * so aconteceria depois do servidor responder — e o que se veria seria um salto,
 * nao um deslize.
 */

const JANELA = 21;
const LARGURA = 70;

const DIA_MES = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const SEMANA = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });

/** Meio-dia UTC: longe das duas viradas, entao o rotulo nunca cai no dia errado. */
function comoData(dia: string): Date {
  return new Date(`${dia}T12:00:00Z`);
}

export function SpinnerDeDatas({
  dia,
  queryExtra,
}: {
  dia: string;
  /** `f=tudo`, contas — o que precisa sobreviver a troca de dia. */
  queryExtra: string;
}) {
  const router = useRouter();
  const [, iniciar] = useTransition();

  // Indice visual proprio: e ele que desliza na hora do clique. O dia do
  // servidor volta a mandar assim que a navegacao termina.
  const [selecionado, setSelecionado] = useState(dia);
  useEffect(() => setSelecionado(dia), [dia]);

  const hoje = localDay(new Date());
  const dias = Array.from({ length: JANELA * 2 + 1 }, (_, i) => shiftDay(dia, i - JANELA));
  const indice = Math.max(0, dias.indexOf(selecionado));

  function irPara(destino: string) {
    if (destino === selecionado) return;
    setSelecionado(destino);
    iniciar(() => {
      router.push(`/dia?${[`d=${destino}`, queryExtra].filter(Boolean).join("&")}`);
    });
  }

  return (
    <div className="spinner">
      <button
        type="button"
        className="spinner-seta"
        onClick={() => irPara(shiftDay(selecionado, -1))}
        aria-label="Dia anterior"
      >
        ‹
      </button>

      <div className="spinner-trilho">
        <div
          className="spinner-fita"
          style={{ transform: `translateX(-${indice * LARGURA + LARGURA / 2}px)` }}
        >
          {dias.map((valor, i) => {
            const distancia = Math.abs(i - indice);
            const atual = valor === selecionado;
            const futuro = valor > hoje;
            const data = comoData(valor);

            return (
              <button
                type="button"
                key={valor}
                onClick={() => irPara(valor)}
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
                <span className="spinner-data">{DIA_MES.format(data).replace(".", "")}</span>
                <span className="spinner-semana">
                  {SEMANA.format(data).replace(".", "").slice(0, 3)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className="spinner-seta"
        onClick={() => irPara(shiftDay(selecionado, 1))}
        aria-label="Proximo dia"
      >
        ›
      </button>

      <button
        type="button"
        className="spinner-hoje"
        onClick={() => irPara(hoje)}
        disabled={selecionado === hoje}
      >
        Hoje
      </button>
    </div>
  );
}
