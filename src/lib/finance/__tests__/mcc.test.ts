import { describe, expect, it } from "vitest";
import { categoriaDoMcc } from "../mcc";

describe("categoriaDoMcc", () => {
  it("reconhece os ramos mais comuns da fatura", () => {
    expect(categoriaDoMcc("5411")).toBe("Alimentacao"); // supermercado
    expect(categoriaDoMcc("5814")).toBe("Alimentacao"); // lanchonete
    expect(categoriaDoMcc("5912")).toBe("Saude"); // farmacia
    expect(categoriaDoMcc("5541")).toBe("Transporte"); // posto
    expect(categoriaDoMcc("5818")).toBe("Compras"); // grande loja digital
    expect(categoriaDoMcc("7832")).toBe("Lazer e Cultura"); // cinema
  });

  it("cobre por faixa o que e faixa", () => {
    // 3000-3999 e a faixa de viagem: aerea, locadora e hotel.
    expect(categoriaDoMcc("3000")).toBe("Viagens");
    expect(categoriaDoMcc("3501")).toBe("Viagens");
    expect(categoriaDoMcc("8011")).toBe("Saude");
    expect(categoriaDoMcc("8299")).toBe("Educacao");
  });

  it("codigo avulso vence a faixa que o contem", () => {
    // 8062 e hospital dentro da faixa 8011-8099, que ja e Saude: o teste existe
    // para a ordem nao mudar em silencio se a faixa for reescrita.
    expect(categoriaDoMcc("8062")).toBe("Saude");
    // 5942 e livraria e cai em Educacao, nao na faixa de restaurante ao lado.
    expect(categoriaDoMcc("5942")).toBe("Educacao");
  });

  it("nao sugere nada para ramo ambiguo", () => {
    // Uma sugestao errada acesa na bussola custa mais que sugestao nenhuma:
    // ela e aceita no automatico por quem confiou nela.
    expect(categoriaDoMcc("8999")).toBeNull(); // servicos profissionais
    expect(categoriaDoMcc("7311")).toBeNull(); // publicidade
    expect(categoriaDoMcc("8641")).toBeNull(); // associacoes
    expect(categoriaDoMcc("5965")).toBeNull(); // marketing direto
    expect(categoriaDoMcc("4816")).toBeNull(); // servicos de rede
  });

  it("aceita entrada faltando ou suja sem estourar", () => {
    expect(categoriaDoMcc(null)).toBeNull();
    expect(categoriaDoMcc(undefined)).toBeNull();
    expect(categoriaDoMcc("")).toBeNull();
    expect(categoriaDoMcc("abc")).toBeNull();
    expect(categoriaDoMcc(" 5411 ")).toBe("Alimentacao");
  });

  it("recusa codigo fora dos quatro digitos", () => {
    expect(categoriaDoMcc("54")).toBeNull();
    expect(categoriaDoMcc("54110")).toBeNull();
    expect(categoriaDoMcc("-5411")).toBeNull();
  });

  it("so devolve nomes que existem no cadastro de categorias", () => {
    // A sugestao e resolvida por nome. Um nome que nao existe viraria uma
    // sugestao que nunca acende, e o erro so apareceria na tela.
    const doCadastro = new Set([
      "Moradia",
      "Servicos domesticos",
      "Alimentacao",
      "Transporte",
      "Lazer e Cultura",
      "Viagens",
      "Compras",
      "Presentes, doacoes e transferencias",
      "Saude",
      "Educacao",
    ]);

    for (let codigo = 1000; codigo <= 9999; codigo += 1) {
      const sugestao = categoriaDoMcc(String(codigo));
      if (sugestao) expect(doCadastro.has(sugestao)).toBe(true);
    }
  });
});
