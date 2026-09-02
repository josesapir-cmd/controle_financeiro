/**
 * Traduz falha de conexao com o banco para uma frase acionavel.
 *
 * O rastro cru do postgres.js aponta para a linha da consulta, que e o lugar
 * onde o erro apareceu e nao o lugar onde ele esta: `CONNECT_TIMEOUT` num
 * script de leitura nao tem nada a ver com a consulta, e ler o rastro faz
 * procurar no lugar errado.
 */

export function explicarErroDeBanco(erro) {
  const codigo = erro?.code;
  const onde = erro?.address ? `${erro.address}:${erro.port ?? 5432}` : "o banco";

  if (codigo === "CONNECT_TIMEOUT" || codigo === "ETIMEDOUT") {
    return [
      `Nao consegui abrir conexao com ${onde} — a tentativa expirou.`,
      "",
      "O banco pode estar de pe e a saida na porta 5432 bloqueada: e o caso mais",
      "comum em wifi de hotel, escritorio ou VPN. Para separar as duas coisas:",
      "",
      `  nc -vz ${erro?.address ?? "SEU-HOST.neon.tech"} 5432`,
      "",
      "Se o nc tambem travar, o problema e a rede, nao o banco — teste na rede do",
      "celular. Se o nc conectar, confira no painel da Neon se o projeto nao foi",
      "suspenso e se a DATABASE_URL do .env.local ainda e a atual.",
    ].join("\n");
  }

  if (codigo === "ENOTFOUND" || codigo === "EAI_AGAIN") {
    return [
      `O endereco ${onde} nao resolveu.`,
      "Confira o host da DATABASE_URL: endpoint da Neon muda quando o projeto e",
      "recriado, e a URL antiga fica apontando para um nome que nao existe mais.",
    ].join("\n");
  }

  if (codigo === "ECONNREFUSED") {
    return `${onde} recusou a conexao. Ha algo escutando nessa porta? Se for um banco local, ele esta rodando?`;
  }

  if (codigo === "28P01" || codigo === "28000") {
    return "Usuario ou senha recusados. A DATABASE_URL do .env.local esta desatualizada em relacao a senha do banco.";
  }

  if (codigo === "3D000") {
    return "O banco informado na DATABASE_URL nao existe.";
  }

  return null;
}

/**
 * Encerra o script com a explicacao, quando houver. Sem explicacao, deixa o
 * erro subir inteiro: inventar mensagem para o que nao se reconhece esconde a
 * unica pista que havia.
 */
export function morrerComExplicacao(erro) {
  const explicacao = explicarErroDeBanco(erro);
  if (!explicacao) throw erro;

  console.error(`\n${explicacao}\n`);
  process.exit(1);
}
