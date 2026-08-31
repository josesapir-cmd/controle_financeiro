"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ACCEPT, TAMANHO_DO_ENVIO, emBlocos } from "@/lib/importacao/limites";

interface Progresso {
  bloco: number;
  blocos: number;
  imagens: number;
  linhas: number;
  duplicadas: number;
}

/**
 * Envio de prints do saldo compartilhado do Nubank.
 *
 * Fica na aba de conexoes porque e disso que se trata: uma fonte de dados que a
 * Pluggy nao entrega. O saldo compartilhado nao aparece no Open Finance — a
 * conta corrente so mostra a transferencia mensal — e esses gastos sao do
 * usuario, entao precisam de um caminho de entrada ate que o arquivo
 * categorizado do Poupa.ai substitua a leitura por foto.
 *
 * Nao ha teto de imagens. A selecao vira uma fila local: os arquivos sao
 * enviados em blocos, um apos o outro, todos para o mesmo lote no servidor.
 * Assim uma selecao grande nao vira uma unica chamada longa que estoura o tempo
 * da funcao e perde tudo no fim.
 *
 * A fila e retomavel: cada bloco que chega fica guardado no lote, entao uma
 * falha no meio nao descarta o que ja foi lido — o botao passa a oferecer
 * continuar de onde parou.
 */
export function UploadPrints() {
  const router = useRouter();
  const campo = useRef<HTMLInputElement>(null);

  const [arquivos, setArquivos] = useState<File[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** Lote em andamento, para retomar a fila sem perder o que ja subiu. */
  const [lote, setLote] = useState<string | null>(null);
  /** Quantos blocos ja foram aceitos, para retomar do ponto certo. */
  const [concluidos, setConcluidos] = useState(0);

  function limpar() {
    setArquivos([]);
    setErro(null);
    setProgresso(null);
    setLote(null);
    setConcluidos(0);
    if (campo.current) campo.current.value = "";
  }

  async function enviar() {
    if (arquivos.length === 0) return;

    setOcupado(true);
    setErro(null);

    const blocos = emBlocos(arquivos);
    let loteAtual = lote;
    let linhas = progresso?.linhas ?? 0;
    let duplicadas = progresso?.duplicadas ?? 0;
    let imagens = progresso?.imagens ?? 0;

    // Comeca do primeiro bloco ainda nao aceito: retomar nao reenvia o que ja
    // entrou, que so geraria linhas marcadas como repetidas sem necessidade.
    for (let i = concluidos; i < blocos.length; i += 1) {
      setProgresso({ bloco: i + 1, blocos: blocos.length, imagens, linhas, duplicadas });

      const corpo = new FormData();
      for (const arquivo of blocos[i]) corpo.append("prints", arquivo);
      if (loteAtual) corpo.append("lote", loteAtual);

      try {
        const resposta = await fetch("/api/importar/print", { method: "POST", body: corpo });
        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.error ?? "nao foi possivel ler os prints");

        loteAtual = dados.id;
        linhas = dados.linhas;
        duplicadas = dados.duplicadas;
        imagens += blocos[i].length;

        setLote(loteAtual);
        setConcluidos(i + 1);
        setProgresso({ bloco: i + 1, blocos: blocos.length, imagens, linhas, duplicadas });
      } catch (e) {
        setErro(e instanceof Error ? e.message : "nao foi possivel ler os prints");
        setOcupado(false);
        return;
      }
    }

    if (loteAtual) router.push(`/importar/${loteAtual}`);
  }

  const blocos = Math.ceil(arquivos.length / TAMANHO_DO_ENVIO);
  const restantes = arquivos.length - concluidos * TAMANHO_DO_ENVIO;

  return (
    <div className="upload-prints">
      <input
        ref={campo}
        type="file"
        accept={ACCEPT}
        multiple
        disabled={ocupado}
        onChange={(evento) => {
          // Trocar a selecao comeca uma fila nova: o lote anterior continua
          // pendente no servidor e pode ser conferido pela lista abaixo.
          setArquivos(Array.from(evento.target.files ?? []));
          setErro(null);
          setProgresso(null);
          setLote(null);
          setConcluidos(0);
        }}
      />

      <div className="filtros">
        <button type="button" onClick={enviar} disabled={ocupado || restantes <= 0}>
          {ocupado
            ? "Lendo…"
            : concluidos > 0
              ? `Continuar (${restantes} restantes)`
              : "Ler prints"}
        </button>

        {arquivos.length > 0 && !ocupado ? (
          <button type="button" className="danger" onClick={limpar}>
            Limpar
          </button>
        ) : null}

        {lote && !ocupado ? (
          <a className="preset" href={`/importar/${lote}`}>
            Conferir o que ja foi lido
          </a>
        ) : null}
      </div>

      {arquivos.length > 0 && !progresso ? (
        <p className="account-meta">
          {arquivos.length} {arquivos.length === 1 ? "imagem" : "imagens"} · {blocos}{" "}
          {blocos === 1 ? "envio" : "envios"} de ate {TAMANHO_DO_ENVIO}
        </p>
      ) : null}

      {progresso ? (
        <>
          <div
            className="fila-trilho"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progresso.blocos}
            aria-valuenow={concluidos}
          >
            <div
              className="fila-preenchimento"
              style={{ width: `${(concluidos / progresso.blocos) * 100}%` }}
            />
          </div>
          <p className="account-meta">
            Envio {progresso.bloco} de {progresso.blocos} · {progresso.imagens}{" "}
            {progresso.imagens === 1 ? "imagem lida" : "imagens lidas"} · {progresso.linhas}{" "}
            {progresso.linhas === 1 ? "linha" : "linhas"}
            {progresso.duplicadas > 0 ? (
              <>
                {" "}
                · <span className="negative">{progresso.duplicadas} possiveis repeticoes</span>
              </>
            ) : null}
          </p>
        </>
      ) : null}

      {ocupado ? (
        <p className="account-meta">
          A leitura leva alguns segundos por imagem. Nao feche esta aba — o que ja foi lido fica
          guardado, mas a fila para.
        </p>
      ) : null}

      {erro ? (
        <p className="form-message negative" role="alert">
          {erro}
          {lote ? " O que ja foi lido continua guardado: use Continuar ou confira o lote." : ""}
        </p>
      ) : null}
    </div>
  );
}
