"use client";

import { useState } from "react";
import { removerCartao, salvarCartao } from "./actions";
import { dataCompleta } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import type { CartaoDaConta as Cartao } from "@/lib/finance/service";

/**
 * Um plastico da fatura, com a regra que manda tudo dele para uma categoria.
 *
 * A lista de subcategorias depende da categoria escolhida, e por isso a linha e
 * de cliente: escolher a categoria tem de trocar as opcoes do segundo campo
 * antes de qualquer ida ao servidor.
 */
export function CartaoDaConta({
  contaId,
  cartao,
  categorias,
  centros,
}: {
  contaId: string;
  cartao: Cartao;
  categorias: { id: string; name: string; hue: number }[];
  centros: { id: string; categoryId: string; name: string }[];
}) {
  const [categoriaId, setCategoriaId] = useState(cartao.categoriaId ?? "");
  const daCategoria = centros.filter((c) => c.categoryId === categoriaId);

  return (
    <div className={cartao.categoriaId ? "ct-cartao com-regra" : "ct-cartao"}>
      <div className="ct-cabeca">
        <span className="ct-numero">•••• {cartao.numero}</span>
        <span className="account-meta">
          {cartao.lancamentos} {cartao.lancamentos === 1 ? "lancamento" : "lancamentos"} ·{" "}
          {formatBRL(cartao.gasto)}
          {cartao.ultimoUso ? ` · ultimo uso em ${dataCompleta(cartao.ultimoUso)}` : ""}
        </span>
      </div>

      <form action={salvarCartao} className="ct-linha">
        <input type="hidden" name="accountId" value={contaId} />
        <input type="hidden" name="cardNumber" value={cartao.numero} />

        <label className="ct-cresce">
          Apelido
          <input
            type="text"
            name="label"
            defaultValue={cartao.apelido ?? ""}
            placeholder="Cartao do pai"
          />
        </label>

        <label>
          Categoria automatica
          <select
            name="categoryId"
            value={categoriaId}
            onChange={(evento) => setCategoriaId(evento.target.value)}
          >
            <option value="">(nenhuma)</option>
            {categorias.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Subcategoria
          <select name="costCenterId" defaultValue={cartao.centroId ?? ""} disabled={!categoriaId}>
            <option value="">(nenhuma)</option>
            {daCategoria.map((centro) => (
              <option key={centro.id} value={centro.id}>
                {centro.name}
              </option>
            ))}
          </select>
        </label>

        <button type="submit">Salvar</button>
      </form>

      {cartao.categoriaId ? (
        <form action={removerCartao} className="ct-linha">
          <input type="hidden" name="accountId" value={contaId} />
          <input type="hidden" name="cardNumber" value={cartao.numero} />
          <button type="submit" className="cp-remover">
            Remover a regra deste cartao
          </button>
          <span className="account-meta">
            As despesas voltam a herdar a categoria da contraparte.
          </span>
        </form>
      ) : null}
    </div>
  );
}
