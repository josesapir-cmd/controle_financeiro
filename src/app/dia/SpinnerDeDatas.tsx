"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { localDay, shiftDay } from "@/lib/finance/dates";
import type { SituacaoDoDia } from "@/lib/finance/situacao";

/** A bolinha nunca fala sozinha: cada cor tem a frase que ela quer dizer. */
const LEGENDA: Record<SituacaoDoDia, string> = {
  pendente: "despesas sem categoria neste dia",
  pronto: "tudo classificado neste dia",
  "sem-dados": "o banco ainda nao mandou este dia",
};

/**
 * Seletor de dia em fita.
 *
 * Substitui os tres botoes de navegacao. A diferenca nao e estetica: com eles so
 * dava para andar um dia por vez e nao se via onde se estava na semana.
 *
 * A fita desliza no clique ANTES de a navegacao terminar. Esperando a resposta
 * do servidor, o que se veria seria um salto, nao um deslize.
 */

/** Quantos dias a fita monta de saida, e quantos ela ganha ao chegar na ponta. */
const PASSADO_INICIAL = 30;
const CRESCIMENTO = 30;
/** Chegando a esta distancia da ponta esquerda, a fita cresce. */
const MARGEM = 6;
/** Dois dias a frente entram so como contexto. */
const FUTURO = 2;
const LARGURA = 70;
/** Abaixo disso o ponteiro andou de menos para ser arraste: e clique. */
const LIMIAR = 4;

const MES_CURTO = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
const SEMANA = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });

/** As contas selecionadas, tiradas da query que a fita ja carrega. */
function contasDaQuery(query: string): string[] {
  const valor = new URLSearchParams(query).get("contas");
  return valor ? valor.split(",").filter(Boolean) : [];
}

/** Meio-dia UTC: longe das duas viradas, entao o rotulo nunca cai no dia errado. */
function comoData(dia: string): Date {
  return new Date(`${dia}T12:00:00Z`);
}

/**
 * "13/ago", montado a mao.
 *
 * `Intl` com dia e mes juntos devolve "13 de ago." em pt-BR, que nao cabe nos
 * 70px da celula e quebra em duas linhas. So o mes vem do `Intl`, que e o unico
 * pedaco que depende do idioma.
 */
function rotuloDoDia(dia: string): string {
  const data = comoData(dia);
  const mes = MES_CURTO.format(data).replace(".", "");
  return `${String(data.getUTCDate()).padStart(2, "0")}/${mes}`;
}

function rotuloDaSemana(dia: string): string {
  return SEMANA.format(comoData(dia)).replace(".", "").slice(0, 3);
}

export function SpinnerDeDatas({
  dia,
  queryExtra,
  situacoes = {},
  navegacaoPorTeclado = false,
  onIrPara,
}: {
  dia: string;
  /** `nc=1`, contas — o que precisa sobreviver a troca de dia. */
  queryExtra: string;
  /** Bolinha de cada dia: pendente, pronto ou sem dados. */
  situacoes?: Record<string, SituacaoDoDia>;
  /**
   * Setas movem a marca e enter navega. So onde a fita e o assunto da tela —
   * na aba Dia as setas pertencem ao modo jogo e a rolagem da pagina.
   */
  navegacaoPorTeclado?: boolean;
  /** Chamado antes de navegar, para quem precisa preservar estado proprio. */
  onIrPara?: (destino: string) => void;
}) {
  const router = useRouter();
  const [, iniciar] = useTransition();
  const trilho = useRef<HTMLDivElement>(null);
  // Sem bolinha nenhuma na primeira pintura, quem chamou nao quer bolinhas: nao
  // ha por que ir buscar as dos trechos seguintes.
  const temSituacoes = Object.keys(situacoes).length > 0;

  const [selecionado, setSelecionado] = useState(dia);
  useEffect(() => setSelecionado(dia), [dia]);

  /** Dia sob a marca do teclado, ainda sem navegar. */
  const [focado, setFocado] = useState(dia);
  useEffect(() => setFocado(dia), [dia]);

  /** Deslocamento em pixels enquanto a fita esta sendo arrastada. */
  const [puxando, setPuxando] = useState<{ inicioX: number; dx: number } | null>(null);
  /** Onde o ponteiro desceu, antes de sabermos se e clique ou arraste. */
  const origem = useRef<number | null>(null);
  const andou = useRef(0);

  const hoje = localDay(new Date());

  /**
   * Ate onde a fita vai para tras. Cresce ao se chegar perto da ponta, entao
   * andar para o passado nunca esbarra num fim — e o fim, quando existia, nao
   * dizia "acabou o historico", dizia "acabou o que eu montei".
   */
  const [passado, setPassado] = useState(PASSADO_INICIAL);
  /** Bolinhas dos trechos que a fita foi buscar depois da primeira pintura. */
  const [situacoesExtras, setSituacoesExtras] = useState<Record<string, SituacaoDoDia>>({});
  /** Ate onde ja pedimos, para nao pedir o mesmo trecho duas vezes. */
  const carregado = useRef<string | null>(null);

  // A lista e ancorada em HOJE, nao no dia selecionado: assim o limite direito e
  // sempre o mesmo lugar e a fita nao se reconstroi a cada navegacao. Crescer
  // para tras tambem nao desloca nada na tela, porque o deslocamento e contado
  // a partir do indice, que cresce junto.
  const dias = Array.from({ length: passado + FUTURO + 1 }, (_, i) =>
    shiftDay(hoje, i - passado),
  );
  const indice = Math.max(0, dias.indexOf(selecionado));
  const noLimitePassado = indice <= 0;
  const ehHoje = selecionado === hoje;

  function irPara(destino: string) {
    // Nunca adiante de hoje: dia futuro nao tem lancamento para mostrar.
    if (destino > hoje || !dias.includes(destino)) return;
    if (destino === selecionado && !navegacaoPorTeclado) return;

    setSelecionado(destino);
    onIrPara?.(destino);
    iniciar(() => {
      router.push(`/dia?${[`d=${destino}`, queryExtra].filter(Boolean).join("&")}`);
    });
  }

  // Setas movem a marca; enter leva. Separar os dois passos e o que o modo jogo
  // pede: ali a fita e uma escolha, nao um clique que ja aconteceu.
  useEffect(() => {
    if (!navegacaoPorTeclado) return;

    function baixou(evento: KeyboardEvent) {
      if (evento.key === "ArrowLeft" || evento.key === "ArrowRight") {
        evento.preventDefault();
        const passo = evento.key === "ArrowRight" ? 1 : -1;
        setFocado((atual) => {
          const i = dias.indexOf(atual);
          const proximo = dias[Math.min(Math.max(i + passo, 0), dias.length - 1)] ?? atual;
          return proximo > hoje ? atual : proximo;
        });
        return;
      }

      if (evento.key === "Enter") {
        evento.preventDefault();
        irPara(focado);
      }
    }

    window.addEventListener("keydown", baixou);
    return () => window.removeEventListener("keydown", baixou);
  });

  /** Deslocamento aplicado a fita, ja somado ao arraste em curso. */
  const eixo = navegacaoPorTeclado ? Math.max(0, dias.indexOf(focado)) : indice;

  // Perto da ponta, a fita ganha mais um mes. Vale para as tres formas de
  // andar — clique, arraste e teclado — porque todas passam por aqui.
  useEffect(() => {
    if (eixo <= MARGEM) setPassado((atual) => atual + CRESCIMENTO);
  }, [eixo]);

  // As bolinhas do trecho novo vem do servidor. Sem elas o passado distante
  // apareceria todo sem marca, que a fita leria como "ainda nao recebido" — a
  // resposta errada, e justamente para os dias que ja foram fechados.
  useEffect(() => {
    if (!temSituacoes) return;

    const inicio = dias[0];
    if (!inicio || carregado.current === inicio) return;
    carregado.current = inicio;

    const fim = shiftDay(hoje, -PASSADO_INICIAL);
    if (inicio >= fim) return;

    const busca = new URLSearchParams({ de: inicio, ate: fim });
    for (const conta of contasDaQuery(queryExtra)) busca.append("contas", conta);

    let cancelado = false;
    fetch(`/api/situacao?${busca}`)
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((corpo) => {
        if (cancelado || !corpo?.dias) return;
        setSituacoesExtras((atuais) => ({ ...corpo.dias, ...atuais }));
      })
      .catch(() => {
        // Bolinha que nao chegou nao vale um erro na tela: a fita continua
        // navegavel sem ela.
      });

    return () => {
      cancelado = true;
    };
  }, [dias[0], temSituacoes, hoje, queryExtra]);
  const deslocamento = eixo * LARGURA + LARGURA / 2 - (puxando?.dx ?? 0);

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
            const distancia = Math.abs(i - eixo);
            const atual = valor === selecionado;
            const marcado = navegacaoPorTeclado && valor === focado;
            const futuro = valor > hoje;
            const situacao = situacoes[valor] ?? situacoesExtras[valor];

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
                  marcado ? "spinner-dia-marcado" : "",
                  futuro ? "spinner-dia-futuro" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                // Os vizinhos desbotam com a distancia: a fita tem centro sem
                // precisar de outra marca. O desbotado vai numa variavel, e nao
                // no `opacity` do botao, porque a bolinha nao pode desbotar
                // junto — ela e justamente o que se procura nos dias longe.
                style={
                  {
                    "--desbotado": atual ? 1 : Math.max(0.28, 1 - distancia * 0.16),
                  } as React.CSSProperties
                }
              >
                <span className="spinner-data">{rotuloDoDia(valor)}</span>
                <span className="spinner-semana">{rotuloDaSemana(valor)}</span>
                {situacao ? (
                  <span
                    className={`spinner-bolha ${situacao}`}
                    title={LEGENDA[situacao]}
                    aria-label={LEGENDA[situacao]}
                    role="img"
                  />
                ) : null}
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
