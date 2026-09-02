/**
 * Apagar a classificacao feita a mao, e devolve-la.
 *
 * Fora do script porque e a parte destrutiva: aqui ela roda contra um Postgres
 * de verdade no teste, e nao so na primeira vez que alguem apertar `--aplicar`
 * no banco que importa.
 *
 * Duas tabelas guardam classificacao, por caminhos diferentes:
 *
 * - `transaction_labels`: a categoria daquele lancamento, gravada ao arrastar
 *   um cartao ou no modo jogo.
 * - `counterparty_labels`: a categoria da contraparte, que vale para todo
 *   lancamento dela — o "aplicar a todos".
 *
 * O que NAO e apagado, porque nao e categoria: o comentario do lancamento, o
 * apelido e o nome oficial da contraparte, os centros de custo (taxonomia, nao
 * atribuicao — apaga-los levaria junto "Bariloche 2026" e o orcamento dele) e
 * as decisoes de uniao de contraparte.
 */

/**
 * As linhas saem CRUAS, com as colunas cifradas como estao.
 *
 * Restaurar assim e byte a byte: sem decifrar nada, sem depender de a chave de
 * hoje ser a de amanha, e sem chance de o backup guardar em claro o que o banco
 * guarda cifrado.
 */
export async function coletarClassificacao(db) {
  const transacoes = await db.query(
    `SELECT transaction_id, category_id, cost_center_id, note_enc, updated_at
       FROM transaction_labels
      WHERE category_id IS NOT NULL OR cost_center_id IS NOT NULL
      ORDER BY transaction_id`,
  );

  const contrapartes = await db.query(
    `SELECT fingerprint, category, subcategory, cost_center_id, alias_enc,
            official_name_enc, updated_at
       FROM counterparty_labels
      WHERE category IS NOT NULL OR subcategory IS NOT NULL OR cost_center_id IS NOT NULL
      ORDER BY fingerprint`,
  );

  return { transacoes, contrapartes };
}

/**
 * Zera a classificacao. A linha que fica sem nada e removida; a que ainda
 * carrega comentario ou apelido continua, so que sem categoria.
 */
export async function zerarClassificacao(db) {
  await db.query(`UPDATE transaction_labels SET category_id = NULL, cost_center_id = NULL`);
  await db.query(
    `DELETE FROM transaction_labels
      WHERE category_id IS NULL AND cost_center_id IS NULL AND note_enc IS NULL`,
  );

  await db.query(
    `UPDATE counterparty_labels SET category = NULL, subcategory = NULL, cost_center_id = NULL`,
  );
  await db.query(
    `DELETE FROM counterparty_labels
      WHERE category IS NULL AND subcategory IS NULL AND cost_center_id IS NULL
        AND alias_enc IS NULL AND official_name_enc IS NULL`,
  );
}

/**
 * Devolve o que o backup guardava.
 *
 * Comentario e apelido do banco vencem os do backup: a limpeza nao os apagou,
 * entao os do arquivo sao os mais velhos dos dois e escreve-los por cima
 * desfaria o que foi escrito depois.
 */
export async function restaurarClassificacao(db, backup) {
  for (const linha of backup.transacoes ?? []) {
    await db.query(
      `INSERT INTO transaction_labels
         (transaction_id, category_id, cost_center_id, note_enc, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (transaction_id) DO UPDATE
         SET category_id = EXCLUDED.category_id,
             cost_center_id = EXCLUDED.cost_center_id,
             note_enc = coalesce(transaction_labels.note_enc, EXCLUDED.note_enc)`,
      [
        linha.transaction_id,
        linha.category_id ?? null,
        linha.cost_center_id ?? null,
        linha.note_enc ?? null,
        linha.updated_at ?? new Date().toISOString(),
      ],
    );
  }

  for (const linha of backup.contrapartes ?? []) {
    await db.query(
      `INSERT INTO counterparty_labels
         (fingerprint, category, subcategory, cost_center_id, alias_enc,
          official_name_enc, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (fingerprint) DO UPDATE
         SET category = EXCLUDED.category,
             subcategory = EXCLUDED.subcategory,
             cost_center_id = EXCLUDED.cost_center_id,
             alias_enc = coalesce(counterparty_labels.alias_enc, EXCLUDED.alias_enc),
             official_name_enc = coalesce(
               counterparty_labels.official_name_enc, EXCLUDED.official_name_enc)`,
      [
        linha.fingerprint,
        linha.category ?? null,
        linha.subcategory ?? null,
        linha.cost_center_id ?? null,
        linha.alias_enc ?? null,
        linha.official_name_enc ?? null,
        linha.updated_at ?? new Date().toISOString(),
      ],
    );
  }
}
