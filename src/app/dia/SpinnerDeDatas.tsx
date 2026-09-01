"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { localDay, shiftDay } from "@/lib/finance/dates";

/**
 * Seletor de dia em fita.
 *
 * Substitui os tres botoes de navegacao. A diferenca nao e estetica: com eles so
 * dava para andar um dia por vez e nao se via onde se estava na semana.
 *
 * A fita desliza no clique ANTES de a navegacao terminar. Esperando a resposta
 * do servidor, o que se veria seria um salto, nao um deslize.
 */

/** Ate 20 dias atras; dois dias a frente entram so como contexto. */
const PASSADO = 20;
const FUTURO = 2;
const LARGURA = 70;
/** Abaixo disso o ponteiro andou de menos para ser arraste: e clique. */
const LIMIAR = 4;

const DIA_MES = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const SEMANA = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });

/** Meio-dia UTC: longe das duas viradas, entao o rotulo nunca cai no dia errado. */
function comoData(dia: string): Date {
  return new Date(`${dia}T12:00:00Z`);
}

function rotulo(formatador: Intl.DateTimeFormat, data: Date): string {
  return formatador.format(data).replace(".", "");
}

export function SpinnerDeDatas({
  dia,
  queryExtra,
}: {
  dia: string;
  /** `nc=1`, contas — o que precisa sobreviver a troca de dia. */
  queryExtra: string;
}) {
  const router = useRouter();
  const [, iniciar] = useTransition();
  const trilho = useRef<HTMLDivElement>(null);

  const [selecionado, setSelecionado] = useState(dia);
  useEffect(() => setSelecionado(dia), [dia]);

  /** Deslocamento em pixels enquanto a fita esta sendo arrastada. */
  const [puxando, setPuxando] = useState<{ inicioX: number; dx: number } | null>(null);
  /** Onde o ponteiro desceu, antes de sabermos se e clique ou arraste. */
  const origem = useRef<number | null>(null);
  const andou = useRef(0);

  const hoje = localDay(new Date());
  // A lista e ancorada em HOJE, nao no dia selecionado: assim o limite direito e
  // sempre o mesmo lugar e a fita nao se reconstroi a cada navegacao.
  const dias = Array.from({ length: PASSADO + FUTURO + 1 }, (_, i) =>
    shiftDay(hoje, i - PASSADO),
  );
  const indice = Math.max(0, dias.indexOf(selecionado));
  const noLimitePassado = indice <= 0;
  const ehHoje = selecionado === hoje;

  function irPara(destino: string) {
    // Nunca adiante de hoje: dia futuro nao tem lancamento para mostrar.
    if (destino === selecionado || destino > hoje || !dias.includes(destino)) return;

    setSelecionado(destino);
    iniciar(() => {
      router.push(`/dia?${[`d=${destino}`, queryExtra].filter(Boolean).join("&")}`);
    });
  }

  /** Deslocamento aplicado a fita, ja somado ao arraste em curso. */
  const deslocamento = indice * LARGURA + LARGURA / 2 - (puxando?.dx ?? 0);

  return (
    <div className="spinner">
      <button
        type="button"
        className="spinner-seta"
        onClick={() => irPara(shiftDay(selecionado, -1))}
        disabled={noLimitePassado}
        aria-label="Dia anterior"
      >
        ‹
      </button>

      <div
        ref={trilho}
        className={`spinner-trilho ${puxando ? "puxando" : ""}`}
        onPointerDown={(evento) => {
          // A captura NAO acontece aqui. Com o ponteiro capturado, o `click`
          // passa a ser entregue ao elemento que capturou — o trilho — e nunca
          // chega ao botao do dia. Era por isso que clicar numa data nao fazia
          // nada no navegador. So capturamos quando vira arraste de verdade.
          origem.current = evento.clientX;
          andou.current = 0;
        }}
        onPointerMove={(evento) => {
          if (origem.current === null) return;

          const bruto = evento.clientX - origem.current;
          andou.current = Math.max(andou.current, Math.abs(bruto));
          if (!puxando && andou.current < LIMIAR) return;

          if (!puxando) evento.currentTarget.setPointerCapture(evento.pointerId);

          // O arraste e preso ao intervalo disponivel: em hoje so da para puxar
          // para o passado, e nao passa de 20 dias atras.
          const minimo = (indice - (dias.length - 1 - FUTURO)) * LARGURA;
          const maximo = indice * LARGURA;
          setPuxando({
            inicioX: origem.current,
            dx: Math.min(Math.max(bruto, minimo), maximo),
          });
        }}
        onPointerUp={() => {
          origem.current = null;
          if (!puxando) return;

          // Encaixa no dia mais proximo em vez de parar entre dois.
          const passos = Math.round(puxando.dx / LARGURA);
          setPuxando(null);
          irPara(dias[Math.max(0, indice - passos)] ?? selecionado);
        }}
        onPointerCancel={() => {
          origem.current = null;
          setPuxando(null);
        }}
      >
        <div className="spinner-fita" style={{ transform: `translateX(-${deslocamento}px)` }}>
          {dias.map((valor, i) => {
            const distancia = Math.abs(i - indice);
            const atual = valor === selecionado;
            const futuro = valor > hoje;
            const data = comoData(valor);

            return (
              <button
                type="button"
                key={valor}
                // Dia futuro entra so como contexto: da a sensacao de fita
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
                <span className="spinner-data">{rotulo(DIA_MES, data)}</span>
                <span className="spinner-semana">{rotulo(SEMANA, data).slice(0, 3)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        className="spinner-seta"
        onClick={() => irPara(shiftDay(selecionado, 1))}
        disabled={ehHoje}
        aria-label="Proximo dia"
      >
        ›
      </button>

      <button type="button" className="spinner-hoje" onClick={() => irPara(hoje)} disabled={ehHoje}>
        Hoje
      </button>
    </div>
  );
}
