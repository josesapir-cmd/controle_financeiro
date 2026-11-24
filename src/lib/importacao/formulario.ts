import { doFormulario, type Linha } from "./linhas";

/**
 * As linhas marcadas no formulario de conferencia de um lote.
 *
 * Dois formularios usam isto — o do dono e o da assistente —, e a leitura
 * precisa ser identica nos dois: a identidade do lancamento sai destes campos,
 * e duas leituras diferentes gravariam a mesma despesa com ids diferentes.
 */
export function linhasMarcadas(formData: FormData): Linha[] {
  const indices = String(formData.get("indices") ?? "")
    .split(",")
    .map((valor) => valor.trim())
    .filter(Boolean);

  const escolhidas: Linha[] = [];
  for (const indice of indices) {
    if (!formData.get(`incluir_${indice}`)) continue;

    const linha = doFormulario({
      dia: String(formData.get(`data_${indice}`) ?? ""),
      descricao: String(formData.get(`descricao_${indice}`) ?? ""),
      // O campo de valor aceita virgula porque e assim que se digita em pt-BR.
      valor: Number(String(formData.get(`valor_${indice}`) ?? "").replace(",", ".")),
      tipo: String(formData.get(`tipo_${indice}`) ?? "despesa"),
      confianca: String(formData.get(`confianca_${indice}`) ?? "baixa"),
      // A ocorrencia vem do formulario, nao e recontada aqui: ela foi fixada
      // quando a linha foi lida e faz parte da identidade do lancamento.
      // Reconta-la mudaria o id de uma linha so porque a irma foi desmarcada.
      ocorrencia: Number(formData.get(`ocorrencia_${indice}`) ?? 1),
    });

    if (linha) escolhidas.push(linha);
  }
  return escolhidas;
}
