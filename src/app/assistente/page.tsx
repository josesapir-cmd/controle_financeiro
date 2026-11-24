import Link from "next/link";
import { requireAcessoDaAssistente } from "@/lib/auth/guard";
import { Nav } from "@/components/Nav";
import { SairButton } from "@/components/SairButton";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import {
  listCategorias,
  listCentrosDeCusto,
  listLancamentosCompartilhados,
  type LancamentoCompartilhado,
} from "@/lib/db/repository";
import { tamanhoLegivel } from "@/lib/anexos";
import { formatBRL } from "@/lib/finance/money";
import { loadImportacoes } from "@/lib/finance/service";
import { UploadPrints } from "../conexoes/UploadPrints";
import { Anexar } from "./Anexar";
import { removerAnexo, salvarLancamento } from "./actions";

export const dynamic = "force-dynamic";

/**
 * A tela da assistente.
 *
 * Tudo o que ela faz no app cabe aqui: mandar prints do saldo compartilhado,
 * conferir o que foi lido, e dar a cada gasto categoria, subcategoria, o nome
 * de quem recebeu, um comentario e os comprovantes. Nao ha menu: nao ha outro
 * lugar para ir.
 *
 * O que ela ve sai do banco ja recortado — so a conta virtual do saldo
 * compartilhado, por SQL. Nenhum saldo, nenhuma outra conta, nenhum total do
 * mes: a tela nao tem esses numeros para mostrar.
 *
 * O dono tambem abre esta tela, com o menu dele por cima: e por aqui que ve o
 * que foi anexado.
 */

const PASSO = 50;

const dataCurta = (dia: string) => dia.split("-").reverse().join("/");

function Lancamento({
  l,
  categorias,
  centros,
  papel,
}: {
  l: LancamentoCompartilhado;
  categorias: { id: string; name: string }[];
  centros: { id: string; name: string }[];
  papel: "dono" | "assistente";
}) {
  // A categoria do proprio lancamento vence; sem ela, a que a contraparte ja
  // tem entra pre-escolhida — e avisada como tal, para nao parecer decidida.
  const daContraparte = !l.categoryId && l.categoriaDaContraparte
    ? categorias.find(
        (c) => c.name.toLowerCase() === l.categoriaDaContraparte!.toLowerCase(),
      )
    : undefined;
  const categoriaInicial = l.categoryId ?? daContraparte?.id ?? "";
  const subcategoriaInicial = centros.find((c) => c.id === l.costCenterId)?.name ?? "";

  return (
    <li className="card lanc-assistente">
      <div className="lanc-cabeca">
        <span className="account-meta">{dataCurta(l.dia)}</span>
        <span className="description">{l.descricao}</span>
        <span className={`amount ${l.valor < 0 ? "negative" : "positive"}`}>
          {formatBRL(l.valor)}
        </span>
      </div>

      <form action={salvarLancamento} className="lanc-campos">
        <input type="hidden" name="transactionId" value={l.id} />
        <input type="hidden" name="apelidoAtual" value={l.apelido ?? ""} />

        <label>
          <span>Contraparte</span>
          <input
            type="text"
            name="apelido"
            defaultValue={l.apelido ?? ""}
            placeholder={l.contraparte ?? "Nome de quem recebeu"}
            maxLength={120}
          />
          <small className="account-meta">
            {l.contraparte ? `no print: ${l.contraparte} · ` : ""}vale para todos os gastos dela
          </small>
        </label>

        <label>
          <span>Categoria</span>
          <select name="categoryId" defaultValue={categoriaInicial}>
            <option value="">— sem categoria —</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {daContraparte ? (
            <small className="account-meta">sugerida pela contraparte — salve para confirmar</small>
          ) : null}
        </label>

        <label>
          <span>Subcategoria</span>
          <input
            type="text"
            name="subcategoria"
            list="subcategorias-assistente"
            defaultValue={subcategoriaInicial}
            placeholder="Opcional"
            maxLength={80}
          />
        </label>

        <label className="lanc-comentario">
          <span>Comentario</span>
          <textarea name="note" defaultValue={l.note ?? ""} rows={2} maxLength={2000} />
        </label>

        <div className="lanc-salvar">
          <button type="submit">Salvar</button>
        </div>
      </form>

      <div className="lanc-anexos">
        {l.anexos.length > 0 ? (
          <ul>
            {l.anexos.map((a) => (
              <li key={a.id}>
                <a href={`/api/anexos/${a.id}`} target="_blank" rel="noopener">
                  {a.nome}
                </a>
                <span className="account-meta">
                  {" "}
                  · {tamanhoLegivel(a.tamanho)}
                  {papel === "dono" && a.criadoPor === "assistente" ? " · da assistente" : ""}
                </span>
                {papel === "dono" || a.criadoPor === papel ? (
                  <form action={removerAnexo} className="lanc-remover">
                    <input type="hidden" name="anexoId" value={a.id} />
                    <button type="submit" className="cp-remover" aria-label={`Remover ${a.nome}`}>
                      remover
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <Anexar transactionId={l.id} descricao={l.descricao} />
      </div>
    </li>
  );
}

export default async function Assistente({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string; limite?: string; lancadas?: string }>;
}) {
  const papel = await requireAcessoDaAssistente();
  const params = await searchParams;

  const todos = params.ver === "todos";
  const limite = Math.min(1000, Math.max(PASSO, Number(params.limite) || PASSO));
  const lancadas = Number(params.lancadas);

  const db = fromPostgres(getSql());
  const [{ lancamentos, haMais }, categorias, centros, lotes] = await Promise.all([
    listLancamentosCompartilhados(db, { limite, soPendentes: !todos }),
    listCategorias(db),
    listCentrosDeCusto(db),
    loadImportacoes(20),
  ]);
  const pendentes = lotes.filter((l) => l.status === "pendente");

  const rota = (ver: string, n = PASSO) => `/assistente?ver=${ver}${n > PASSO ? `&limite=${n}` : ""}`;
  const nomesDeSubcategoria = [...new Set(centros.map((c) => c.name))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );

  return (
    <main className={papel === "dono" ? "page" : "page sem-menu"}>
      <div className="masthead">
        <h1>Saldo compartilhado</h1>
        <span className="period">
          {papel === "dono" ? "Tela da assistente, vista pelo dono" : <SairButton />}
        </span>
      </div>

      {papel === "dono" ? <Nav atual="/conexoes" /> : null}

      {Number.isFinite(lancadas) && lancadas > 0 ? (
        <p className="banner">
          <strong>
            {lancadas} {lancadas === 1 ? "gasto lancado" : "gastos lancados"}.
          </strong>{" "}
          Agora e so classificar abaixo.
        </p>
      ) : null}

      <section>
        <h2>Enviar prints</h2>
        <div className="card">
          <p className="empty" style={{ marginTop: 0 }}>
            Prints da tela de saldo compartilhado do Nubank. Da para escolher varios de uma vez; a
            leitura leva alguns segundos por imagem.
          </p>
          <UploadPrints conferirEm="/assistente/lote" listaEm="/assistente" />
        </div>
      </section>

      {pendentes.length > 0 ? (
        <section>
          <h2>Prints lidos, aguardando conferencia ({pendentes.length})</h2>
          <ul className="lotes-assistente">
            {pendentes.map((lote) => (
              <li key={lote.id} className="card">
                <Link href={`/assistente/lote/${lote.id}`}>
                  {lote.linhas} {lote.linhas === 1 ? "linha" : "linhas"} ·{" "}
                  {formatBRL(-lote.saidas)}
                </Link>
                <span className="account-meta">
                  {" "}
                  · enviado em {lote.createdAt.toLocaleDateString("pt-BR")}
                  {lote.decidir + lote.conferir > 0
                    ? ` · ${lote.decidir + lote.conferir} para conferir`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <div className="masthead" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{todos ? "Todos os gastos" : "Gastos sem categoria"}</h2>
          <div className="filtros" style={{ margin: 0 }}>
            <Link className={todos ? "preset" : "preset ativo"} href={rota("pendentes")}>
              Sem categoria
            </Link>
            <Link className={todos ? "preset ativo" : "preset"} href={rota("todos")}>
              Todos
            </Link>
          </div>
        </div>

        {lancamentos.length === 0 ? (
          <div className="card">
            <p className="empty">
              {todos
                ? "Nenhum gasto do saldo compartilhado ainda. Envie os prints acima."
                : "Tudo classificado. Gastos novos aparecem aqui depois de conferidos."}
            </p>
          </div>
        ) : (
          <ul className="lista-assistente">
            {lancamentos.map((l) => (
              <Lancamento key={l.id} l={l} categorias={categorias} centros={centros} papel={papel} />
            ))}
          </ul>
        )}

        {haMais ? (
          <p style={{ marginTop: 12 }}>
            <Link className="preset" href={rota(todos ? "todos" : "pendentes", limite + PASSO)}>
              Mostrar mais
            </Link>
          </p>
        ) : null}
      </section>

      <datalist id="subcategorias-assistente">
        {nomesDeSubcategoria.map((nome) => (
          <option key={nome} value={nome} />
        ))}
      </datalist>
    </main>
  );
}
