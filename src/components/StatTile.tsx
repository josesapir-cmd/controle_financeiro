import { formatBRL } from "@/lib/finance/money";

interface Props {
  label: string;
  value: number;
  note?: string;
  tone?: "neutral" | "positive" | "negative";
}

/**
 * Numero unico com rotulo. Nao vira grafico: uma barra sozinha nao comunica
 * nada que o numero ja nao diga.
 */
export function StatTile({ label, value, note, tone = "neutral" }: Props) {
  const toneClass = tone === "positive" ? "positive" : tone === "negative" ? "negative" : "";

  return (
    <div className="card">
      <div className="tile-label">{label}</div>
      <div className={`tile-value ${toneClass}`}>{formatBRL(value)}</div>
      {note ? <div className="tile-note">{note}</div> : null}
    </div>
  );
}
