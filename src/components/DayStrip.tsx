import { translateCategory } from "@/lib/finance/categories";
import { localTime, minutesOfDay } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import type { Transaction } from "@/lib/pluggy/types";

const MINUTOS_NO_DIA = 24 * 60;
const HORAS_MARCADAS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

/** Diametro minimo e maximo dos pontos, em pixels. */
const MENOR = 10;
const MAIOR = 26;

/**
 * Lancamentos do dia distribuidos ao longo de 24 horas, com a posicao
 * proporcional ao horario real — diferente da lista abaixo, que so preserva a
 * ordem.
 *
 * A cor de cada ponto e a da instituicao, a mesma dos botoes do filtro logo
 * acima: e identidade da conta, nao valor. O tamanho, esse sim, codifica o
 * valor, por raiz quadrada — o olho le area, nao raio, e escalar o raio direto
 * exageraria as diferencas.
 *
 * Entrada e saida nao se separam por cor, que ja esta ocupada: saida e disco
 * cheio, entrada e anel vazado. Quem nao distingue as duas formas le os valores
 * na lista logo abaixo, que e a visao acessivel destes mesmos dados.
 */
export function DayStrip({
  transactions,
  cores = {},
  nomes = {},
}: {
  transactions: Transaction[];
  /** Cor por id de conta. Sem entrada, o ponto usa a cor neutra do tema. */
  cores?: Record<string, string>;
  nomes?: Record<string, string>;
}) {
  if (transactions.length === 0) return null;

  const maior = Math.max(...transactions.map((t) => Math.abs(t.amount)));

  // Rotulo direto apenas no maior lancamento: serve de ancora de escala sem
  // virar um numero em cima de cada ponto.
  const idMaior = transactions.find((t) => Math.abs(t.amount) === maior)?.id;

  return (
    <figure className="strip">
      <figcaption className="strip-titulo">
        Ao longo do dia · {transactions.length}{" "}
        {transactions.length === 1 ? "lancamento" : "lancamentos"}
      </figcaption>

      <div className="strip-plot">
        <div className="strip-eixo" aria-hidden />

        {HORAS_MARCADAS.map((hora) => (
          <span
            key={hora}
            className="strip-grade"
            style={{ left: `${(hora / 24) * 100}%` }}
            aria-hidden
          />
        ))}

        {transactions.map((t) => {
          const valor = Math.abs(t.amount);
          const entrada = t.amount >= 0;
          const posicao = (minutesOfDay(t.date) / MINUTOS_NO_DIA) * 100;
          const tamanho = MENOR + (MAIOR - MENOR) * Math.sqrt(maior > 0 ? valor / maior : 0);
          const rotulo = [
            localTime(t.date),
            t.description,
            formatBRL(t.amount),
            nomes[t.accountId],
            t.category ? translateCategory(t.category) : null,
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <span key={t.id} className="strip-marca-envelope" style={{ left: `${posicao}%` }}>
              <span
                className={`strip-marca${entrada ? " entrada" : ""}`}
                style={{
                  width: tamanho,
                  height: tamanho,
                  ...(cores[t.accountId] ? { "--conta-cor": cores[t.accountId] } : {}),
                } as React.CSSProperties}
                title={rotulo}
                role="img"
                aria-label={rotulo}
              />
              {t.id === idMaior ? (
                <span className="strip-rotulo">{formatBRL(valor)}</span>
              ) : null}
            </span>
          );
        })}
      </div>

      <div className="strip-horas" aria-hidden>
        {HORAS_MARCADAS.map((hora) => (
          <span key={hora} style={{ left: `${(hora / 24) * 100}%` }}>
            {String(hora).padStart(2, "0")}h
          </span>
        ))}
      </div>
    </figure>
  );
}
