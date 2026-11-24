"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ANEXO_ACCEPT, ANEXO_TAMANHO_MAXIMO, tamanhoLegivel } from "@/lib/anexos";

/**
 * Anexar arquivo a um lancamento.
 *
 * Envia assim que o arquivo e escolhido: um botao "enviar" a mais e um passo
 * que se esquece, e o anexo esquecido e o que faltara na hora de prestar conta.
 * O tamanho e conferido aqui antes de subir, para a mensagem sair na hora e nao
 * depois de esperar o envio inteiro.
 */
export function Anexar({ transactionId, descricao }: { transactionId: string; descricao: string }) {
  const router = useRouter();
  const campo = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(arquivos: FileList | null) {
    if (!arquivos || arquivos.length === 0) return;
    setErro(null);
    setEnviando(true);

    try {
      for (const arquivo of Array.from(arquivos)) {
        if (arquivo.size > ANEXO_TAMANHO_MAXIMO) {
          throw new Error(
            `"${arquivo.name}" tem ${tamanhoLegivel(arquivo.size)}; o limite e ${tamanhoLegivel(ANEXO_TAMANHO_MAXIMO)}.`,
          );
        }
        const corpo = new FormData();
        corpo.append("transactionId", transactionId);
        corpo.append("arquivo", arquivo);
        const resposta = await fetch("/api/anexos", { method: "POST", body: corpo });
        if (!resposta.ok) {
          const dados = await resposta.json().catch(() => ({}));
          throw new Error(dados.error ?? "nao foi possivel anexar");
        }
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "nao foi possivel anexar");
    } finally {
      setEnviando(false);
      if (campo.current) campo.current.value = "";
    }
  }

  return (
    <div className="anexar">
      <label className="preset anexar-botao">
        {enviando ? "Enviando…" : "Anexar arquivo"}
        <input
          ref={campo}
          type="file"
          accept={ANEXO_ACCEPT}
          multiple
          disabled={enviando}
          onChange={(evento) => enviar(evento.target.files)}
          aria-label={`Anexar arquivo a ${descricao}`}
        />
      </label>
      {erro ? (
        <span className="form-message negative" role="alert">
          {erro}
        </span>
      ) : null}
    </div>
  );
}
