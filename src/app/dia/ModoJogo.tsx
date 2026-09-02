"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconeDeCategoria } from "@/components/IconeDeCategoria";
import { formatBRL } from "@/lib/finance/money";
import type {
  CategoriaParaClassificar,
  LancamentoParaClassificar,
} from "@/lib/finance/service";
import { PREENCHIMENTO, POR_VOLTA, SETA, direcaoDasTeclas, type Direcao } from "./bussola";

/**
 * Classificar no teclado, uma despesa por vez.
 *
 * A lista da aba Dia e boa para conferir e ruim para despachar: cada gasto exige
 * mirar o cursor num bloco. Aqui a despesa fica no centro e as categorias em
 * volta, sempre nos mesmos lugares — depois de algumas, a mao sabe onde fica
 * cada uma e a tela vira so confirmacao.
 *
 * As oito direcoes saem de quatro teclas. Seta sozinha aponta para o lado;
 * duas juntas apontam para a diagonal, como em jogo. Nao ha tecla de diagonal
 * num teclado, e inventar atalho de letra para elas perderia justamente o que
 * faz isto funcionar: a posicao na tela ser a posicao na mao.
 */

interface Props {
  lancamentos: LancamentoParaClassificar[];
  categorias: CategoriaParaClassificar[];
  onClassificar: (lancamento: LancamentoParaClassificar, categoriaId: string) => void;
  onFechar: () => void;
}

export function ModoJogo({ lancamentos, categorias, onClassificar, onFechar }: Props) {
  const [indice, setIndice] = useState(0);
  const [direcao, setDirecao] = useState<Direcao | null>(null);
  const [pagina, setPagina] = useState(0);
  /**
   * Ja despachados nesta sessao.
   *
   * A gravacao e uma transicao no servidor: esperar a lista encolher deixaria a
   * mesma despesa na tela por um instante depois do enter, e um enter repetido
   * nesse instante classificaria a mesma coisa duas vezes. Guardar aqui faz a
   * proxima aparecer no mesmo quadro.
   */
  const [despachados, setDespachados] = useState<ReadonlySet<string>>(new Set());
  /** Setas pressionadas neste instante, para reconhecer a diagonal. */
  const teclas = useRef(new Set<string>());
  const caixa = useRef<HTMLDivElement>(null);

  /**
   * A bussola e fixa durante a sessao inteira.
   *
   * A ordem sai do quanto cada categoria ja foi usada no mes, calculada UMA vez:
   * reordenar a cada despesa jogaria fora a memoria muscular, que e a unica
   * razao de isto ser mais rapido que arrastar.
   */
  const bussola = useMemo(
    () => [...categorias].sort((a, b) => b.noMes - a.noMes || a.name.localeCompare(b.name, "pt-BR")),
    [categorias],
  );

  const paginas = Math.max(1, Math.ceil(bussola.length / POR_VOLTA));
  const daVolta = bussola.slice(pagina * POR_VOLTA, pagina * POR_VOLTA + POR_VOLTA);

  const porDirecao = new Map<Direcao, CategoriaParaClassificar>();
  daVolta.forEach((categoria, i) => porDirecao.set(PREENCHIMENTO[i], categoria));

  const fila = lancamentos.filter((l) => !despachados.has(l.id));
  // O indice da a volta: quem foi pulado reaparece no fim, em vez de sumir.
  const atual = fila.length ? fila[indice % fila.length] : undefined;
  const escolhida = direcao ? porDirecao.get(direcao) : undefined;

  // Foco na caixa: sem ele as setas rolariam a pagina de fundo em vez de mirar.
  useEffect(() => {
    caixa.current?.focus();
  }, []);

  function limparMira() {
    setDirecao(null);
    teclas.current.clear();
  }

  /** Pular: a despesa continua na fila e volta depois de todas as outras. */
  function avancar() {
    limparMira();
    setIndice((i) => i + 1);
  }

  function classificar() {
    if (!atual || !escolhida) return;

    onClassificar(atual, escolhida.id);
    setDespachados((atuais) => new Set(atuais).add(atual.id));
    limparMira();
    // Sem mexer no indice: a despesa sai da fila e a seguinte assume o lugar.
    // Avancar tambem pularia uma.
  }

  useEffect(() => {
    function baixou(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        onFechar();
        return;
      }

      if (evento.key.startsWith("Arrow")) {
        evento.preventDefault();
        if (evento.repeat) return;
        teclas.current.add(evento.key);
        const apontada = direcaoDasTeclas(teclas.current);
        if (apontada) setDirecao(apontada);
        return;
      }

      if (evento.key === "Enter") {
        evento.preventDefault();
        classificar();
        return;
      }

      if (evento.key === " ") {
        evento.preventDefault();
        avancar();
        return;
      }

      if (evento.key === "Tab" && paginas > 1) {
        evento.preventDefault();
        setDirecao(null);
        setPagina((p) => (p + 1) % paginas);
      }
    }

    function soltou(evento: KeyboardEvent) {
      teclas.current.delete(evento.key);
    }

    // Sem lista de dependencias de proposito: os ouvintes sao trocados a cada
    // render para enxergarem o estado atual. Registrar uma vez exigiria refs
    // para tudo que eles leem, o que e mais codigo para o mesmo efeito.
    //
    // Na janela inteira, e nao na caixa: uma tecla solta fora dela deixaria a
    // seta presa no conjunto e travaria a diagonal para sempre.
    window.addEventListener("keydown", baixou);
    window.addEventListener("keyup", soltou);
    return () => {
      window.removeEventListener("keydown", baixou);
      window.removeEventListener("keyup", soltou);
    };
  });

  const restam = fila.length;

  return (
    <div className="jogo-fundo" role="dialog" aria-modal="true" aria-label="Classificar no teclado">
      <div className="jogo" ref={caixa} tabIndex={-1}>
        <div className="jogo-topo">
          <span className="jogo-contador">
            {restam} {restam === 1 ? "despesa" : "despesas"} sem categoria
          </span>
          <button type="button" className="jogo-sair" onClick={onFechar}>
            sair (esc)
          </button>
        </div>

        {!atual ? (
          <div className="jogo-fim">
            <strong>Acabou.</strong>
            <span className="account-meta">Nenhuma despesa deste dia esta sem categoria.</span>
            <button type="button" onClick={onFechar}>
              Fechar
            </button>
          </div>
        ) : (
          <>
            <div className="jogo-grade">
              {PREENCHIMENTO.map((posicao) => {
                const categoria = porDirecao.get(posicao);
                if (!categoria) return <span key={posicao} className={`jogo-vazio jogo-${posicao}`} />;

                const acesa = direcao === posicao;

                return (
                  <button
                    type="button"
                    key={posicao}
                    className={`jogo-alvo jogo-${posicao}${acesa ? " aceso" : ""}`}
                    style={{ "--cat-h": categoria.hue } as React.CSSProperties}
                    aria-pressed={acesa}
                    onClick={() => setDirecao(posicao)}
                  >
                    <IconeDeCategoria nome={categoria.name} tamanho={26} animar={acesa} />
                    <span className="jogo-nome">{categoria.name}</span>
                    <span className="jogo-seta" aria-hidden>
                      {SETA[posicao]}
                    </span>
                  </button>
                );
              })}

              <div
                className="jogo-centro"
                style={
                  escolhida ? ({ "--cat-h": escolhida.hue } as React.CSSProperties) : undefined
                }
              >
                <span className="jogo-hora">{atual.hora}</span>
                <span className="jogo-desc">{atual.descricao}</span>
                <span className="jogo-valor">{formatBRL(atual.valor)}</span>
                <span className="account-meta">
                  {[atual.contraparte, atual.conta].filter(Boolean).join(" · ")}
                </span>

                <button
                  type="button"
                  className="jogo-confirmar"
                  disabled={!escolhida}
                  onClick={classificar}
                >
                  {escolhida ? `${escolhida.name} · enter` : "escolha uma direcao"}
                </button>
              </div>
            </div>

            <div className="jogo-rodape">
              <span className="account-meta">
                setas miram · duas setas juntas fazem a diagonal · enter classifica · espaco pula
                {paginas > 1 ? ` · tab troca de volta (${pagina + 1}/${paginas})` : ""}
              </span>
              <button type="button" className="jogo-pular" onClick={avancar}>
                pular
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
