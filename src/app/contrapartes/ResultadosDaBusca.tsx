import Link from "next/link";
import { dataCompleta } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import type { BuscaDeContrapartes } from "@/lib/finance/service";

/**
 * O que a busca achou, e o historico da contraparte escolhida.
 *
 * O historico ignora o periodo da tela de proposito: quem procurou uma pessoa
 * quer tudo o que ja passou com ela, e nao o recorte do mes que por acaso
 * estava aberto.
 */
export function ResultadosDaBusca({
  busca,
  rotaBase,
}: {
  busca: BuscaDeContrapartes;
  rotaBase: string;
}) {
  const { escolhida } = busca;

  const linkPara = (key: string) =>
    `${rotaBase}&busca=${encodeURIComponent(busca.termo)}&ver=${encodeURIComponent(key)}`;

  return (
    <section className="gr busca-resultado">
      <figcaption className="gr-titulo">
        {busca.resultados.length === 0 ? (
          <>
            Nenhuma contraparte com <strong>{busca.termo}</strong> no historico
          </>
        ) : (
          <>
            {busca.resultados.length}{" "}
            {busca.resultados.length === 1 ? "contraparte" : "contrapartes"} com{" "}
            <strong>{busca.termo}</strong>
            {busca.alemDoLimite > 0
              ? ` · outras ${busca.alemDoLimite} nao couberam, refine o termo`
              : ""}
          </>
        )}
      </figcaption>

      {busca.resultados.length > 0 ? (
        <div className="gr-rolagem">
          <table className="gr-tabela">
            <thead>
              <tr>
                <th scope="col">Contraparte</th>
                <th scope="col" className="gr-num">
                  Enviado
                </th>
                <th scope="col" className="gr-num">
                  Recebido
                </th>
                <th scope="col" className="gr-num">
                  <span className="gr-so-largo">Lancamentos</span>
                  <span className="gr-so-estreito">N</span>
                </th>
                <th scope="col" className="gr-so-largo">
                  Periodo
                </th>
              </tr>
            </thead>
            <tbody>
              {busca.resultados.map((c) => (
                <tr key={c.key} className={escolhida?.key === c.key ? "busca-atual" : undefined}>
                  <th scope="row">
                    <Link href={linkPara(c.key)} scroll={false}>
                      {c.nome}
                    </Link>
                    {c.categoria ? (
                      <span className="account-meta">
                        {" "}
                        · {c.categoria}
                        {c.subcategoria ? ` ↳ ${c.subcategoria}` : ""}
                      </span>
                    ) : (
                      <span className="account-meta"> · sem categoria</span>
                    )}
                  </th>
                  <td className="gr-num">{c.enviado > 0 ? formatBRL(c.enviado) : "—"}</td>
                  <td className="gr-num">{c.recebido > 0 ? formatBRL(c.recebido) : "—"}</td>
                  <td className="gr-num">{c.contagem}</td>
                  <td className="gr-so-largo account-meta">
                    {c.primeira === c.ultima
                      ? dataCompleta(c.ultima)
                      : `${dataCompleta(c.primeira)} a ${dataCompleta(c.ultima)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {escolhida ? (
        <div className="busca-historico">
          <h3 className="cp-nome">
            {escolhida.nome}
            <span className="gr-badge">{escolhida.lancamentos.length}</span>
          </h3>
          <p className="account-meta" style={{ margin: "0 0 10px" }}>
            {escolhida.nomeOficial && escolhida.nomeOficial !== escolhida.nome
              ? `${escolhida.nomeOficial} · `
              : ""}
            historico completo, fora do periodo da tela
          </p>

          <div className="gr-rolagem">
            <table className="gr-tabela">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Lancamento</th>
                  <th scope="col" className="gr-so-largo">
                    Conta
                  </th>
                  <th scope="col" className="gr-num">
                    Valor
                  </th>
                </tr>
              </thead>
              <tbody>
                {escolhida.lancamentos.map((l) => (
                  <tr key={l.id}>
                    <th scope="row">
                      {dataCompleta(l.dia)}
                      <span className="account-meta"> {l.hora}</span>
                    </th>
                    <td>
                      {l.descricao}
                      {l.parcela ? <span className="gr-badge">{l.parcela}</span> : null}
                    </td>
                    <td className="gr-so-largo account-meta">{l.conta}</td>
                    {/* Sinal preservado: entrada e saida na mesma coluna, porque
                        e assim que se le um historico com as duas. */}
                    <td className={l.valor < 0 ? "gr-num negative" : "gr-num positive"}>
                      {formatBRL(l.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
