import Link from "next/link";
import { currentMonthRange, currentYearRange, lastDaysRange } from "@/lib/finance/dates";

/**
 * Seletor de janela. Feito com formulario GET e links para funcionar sem
 * JavaScript e deixar o periodo na URL — assim a visao e compartilhavel e o
 * botao voltar do navegador se comporta como o usuario espera.
 */
export function PeriodForm({ from, to }: { from: string; to: string }) {
  const atalhos = [
    { rotulo: "Mes atual", range: currentMonthRange() },
    { rotulo: "30 dias", range: lastDaysRange(30) },
    { rotulo: "90 dias", range: lastDaysRange(90) },
    { rotulo: "Ano", range: currentYearRange() },
  ];

  return (
    <div className="period-controls">
      <div className="presets">
        {atalhos.map(({ rotulo, range }) => {
          const ativo = range.from === from && range.to === to;
          return (
            <Link
              key={rotulo}
              href={`/contrapartes?from=${range.from}&to=${range.to}`}
              className={ativo ? "preset ativo" : "preset"}
            >
              {rotulo}
            </Link>
          );
        })}
      </div>

      <form className="range-form" method="get">
        <label>
          De <input type="date" name="from" defaultValue={from} />
        </label>
        <label>
          Ate <input type="date" name="to" defaultValue={to} />
        </label>
        <button type="submit">Aplicar</button>
      </form>
    </div>
  );
}
