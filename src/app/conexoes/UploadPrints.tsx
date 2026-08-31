"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ACCEPT, MAXIMO_DE_IMAGENS } from "@/lib/importacao/limites";

/**
 * Envio de prints do saldo compartilhado do Nubank.
 *
 * Fica na aba de conexoes porque e disso que se trata: uma fonte de dados que a
 * Pluggy nao entrega. O saldo compartilhado nao aparece no Open Finance — a
 * conta corrente so mostra a transferencia mensal — e esses gastos sao do
 * usuario, entao precisam de um caminho de entrada ate que o arquivo
 * categorizado do Poupa.ai substitua a leitura por foto.
 *
 * O envio nao grava nada: leva para a tela de conferencia.
 */
export function UploadPrints() {
  const router = useRouter();
  const campo = useRef<HTMLInputElement>(null);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    if (arquivos.length === 0) return;

    setOcupado(true);
    setErro(null);

    try {
      const corpo = new FormData();
      for (const arquivo of arquivos) corpo.append("prints", arquivo);

      const resposta = await fetch("/api/importar/print", { method: "POST", body: corpo });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.error ?? "nao foi possivel ler os prints");

      router.push(`/importar/${dados.id}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "nao foi possivel ler os prints");
      setOcupado(false);
    }
  }

  return (
    <div className="upload-prints">
      <input
        ref={campo}
        type="file"
        accept={ACCEPT}
        multiple
        disabled={ocupado}
        onChange={(evento) => {
          const escolhidos = Array.from(evento.target.files ?? []);
          setErro(
            escolhidos.length > MAXIMO_DE_IMAGENS ? `Envie no maximo ${MAXIMO_DE_IMAGENS} imagens por vez.` : null,
          );
          setArquivos(escolhidos.slice(0, MAXIMO_DE_IMAGENS));
        }}
      />

      <div className="filtros">
        <button type="button" onClick={enviar} disabled={ocupado || arquivos.length === 0}>
          {ocupado ? "Lendo…" : "Ler prints"}
        </button>
        {arquivos.length > 0 && !ocupado ? (
          <button
            type="button"
            className="danger"
            onClick={() => {
              setArquivos([]);
              setErro(null);
              if (campo.current) campo.current.value = "";
            }}
          >
            Limpar
          </button>
        ) : null}
      </div>

      {arquivos.length > 0 ? (
        <p className="account-meta">
          {arquivos.length} {arquivos.length === 1 ? "imagem selecionada" : "imagens selecionadas"}
        </p>
      ) : null}

      {ocupado ? (
        <p className="account-meta">
          A leitura leva alguns segundos por imagem. Nao feche esta aba.
        </p>
      ) : null}

      {erro ? (
        <p className="form-message negative" role="alert">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
