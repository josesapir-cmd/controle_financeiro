/**
 * Normaliza a connection string do Postgres.
 *
 * O Neon inclui `channel_binding=require` por padrao. O driver postgres.js nao
 * conhece esse parametro e o repassa ao servidor como parametro de conexao, o
 * que faz o Postgres recusar com "unrecognized configuration parameter" — um
 * erro que nao diz nada sobre a causa real.
 *
 * O binding de canal e uma protecao do handshake SCRAM contra man-in-the-middle;
 * remove-lo do texto nao desabilita o TLS, que continua exigido por `ssl:
 * "require"` no cliente.
 *
 * @param {string} url
 * @returns {string}
 */
export function normalizeConnectionString(url) {
  try {
    const endereco = new URL(url);
    for (const parametro of ["channel_binding", "options"]) {
      endereco.searchParams.delete(parametro);
    }
    return endereco.toString();
  } catch {
    // String em formato inesperado: devolvemos como veio e deixamos o driver
    // reclamar com a mensagem dele, que sera mais util que uma nossa.
    return url;
  }
}
