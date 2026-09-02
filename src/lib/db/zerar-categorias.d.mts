export interface Consultavel {
  query<T = Record<string, unknown>>(texto: string, parametros?: unknown[]): Promise<T[]>;
}

export interface RotuloDeTransacaoCru {
  transaction_id: string;
  category_id: string | null;
  cost_center_id: string | null;
  note_enc: string | null;
  updated_at: string;
}

export interface RotuloDeContraparteCru {
  fingerprint: string;
  category: string | null;
  subcategory: string | null;
  cost_center_id: string | null;
  alias_enc: string | null;
  official_name_enc: string | null;
  updated_at: string;
}

export interface Classificacao {
  transacoes: RotuloDeTransacaoCru[];
  contrapartes: RotuloDeContraparteCru[];
}

export function coletarClassificacao(db: Consultavel): Promise<Classificacao>;
export function zerarClassificacao(db: Consultavel): Promise<void>;
export function restaurarClassificacao(
  db: Consultavel,
  backup: Partial<Classificacao>,
): Promise<void>;
