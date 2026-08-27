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
 * Despesas do dia distribuidas ao longo de 24 horas, com a posicao proporcional
 * ao horario real — diferente da lista abaixo, que so preserva a ordem.
 *
 * Serie unica: a cor nao codifica identidade aqui, a posicao e o tamanho e que
 * carregam a informacao. O tamanho usa raiz quadrada do valor porque o olho le
 * area, nao raio: escalar o raio direto exageraria as diferencas.
 *
 * A lista logo abaixo e a visao acessivel destes mesmos dados — quem nao alcanca
 * o hover, ou nao distingue os tamanhos, le os valores la.
 */
export function DayStrip({ transactions }: { transactions: Transaction[] }) {
  const despesas = transactions.filter((t) => t.amount < 0);

  if (despesas.length === 0) return null;

  const maior = Math.max(...despesas.map((t) => -t.amount));

  // Rotulo direto apenas na maior despesa: serve de ancora de escala sem virar
  // um numero em cima de cada ponto.
  const idMaior = despesas.find((t) => -t.amount === maior)?.id;

  return (
    <figure className="strip">
      <figcaption className="strip-titulo">
        Despesas ao longo do dia · {despesas.length}{" "}
        {despesas.length === 1 ? "lancamento" : "lancamentos"}
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

        {despesas.map((t) => {
          const valor = -t.amount;
          const posicao = (minutesOfDay(t.date) / MINUTOS_NO_DIA) * 100;
          const tamanho = MENOR + (MAIOR - MENOR) * Math.sqrt(maior > 0 ? valor / maior : 0);
          const rotulo = `${localTime(t.date)} · ${t.description} · ${formatBRL(t.amount)}${
            t.category ? ` · ${translateCategory(t.category)}` : ""
          }`;

          return (
            <span key={t.id} className="strip-marca-envelope" style={{ left: `${posicao}%` }}>
              <span
                className="strip-marca"
                style={{ width: tamanho, height: tamanho }}
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
