import { beforeEach, describe, expect, it } from "vitest";
import { decrypt, decryptOptional, encrypt, encryptOptional, resetKeyCache, safeEqual } from "../crypto";

const CHAVE = Buffer.alloc(32, 7).toString("base64");
const OUTRA_CHAVE = Buffer.alloc(32, 9).toString("base64");

beforeEach(() => {
  process.env.APP_ENCRYPTION_KEY = CHAVE;
  resetKeyCache();
});

describe("encrypt e decrypt", () => {
  it("recupera o texto original", () => {
    expect(decrypt(encrypt("Hotel Fazenda Cascatinha"))).toBe("Hotel Fazenda Cascatinha");
  });

  it("preserva acentos e simbolos", () => {
    const texto = "Pix enviado — José da Silva & Cia. Ltda. R$ 1.234,56";
    expect(decrypt(encrypt(texto))).toBe(texto);
  });

  it("preserva string vazia", () => {
    expect(decrypt(encrypt(""))).toBe("");
  });

  // Nonce aleatorio por valor: sem isso, valores iguais teriam cifra igual e o
  // banco revelaria quais lancamentos sao do mesmo estabelecimento.
  it("produz cifras diferentes para o mesmo texto", () => {
    expect(encrypt("Supermercado")).not.toBe(encrypt("Supermercado"));
  });

  it("carrega o prefixo de versao", () => {
    expect(encrypt("x").startsWith("v1.")).toBe(true);
  });

  it("recusa texto adulterado em vez de devolver lixo", () => {
    const cifrado = encrypt("Aluguel");
    const partes = cifrado.split(".");
    const corpo = Buffer.from(partes[2], "base64url");
    corpo[0] ^= 0xff;
    const adulterado = `${partes[0]}.${partes[1]}.${corpo.toString("base64url")}`;

    expect(() => decrypt(adulterado)).toThrow();
  });

  it("recusa decifrar com outra chave", () => {
    const cifrado = encrypt("Aluguel");
    process.env.APP_ENCRYPTION_KEY = OUTRA_CHAVE;
    resetKeyCache();
    expect(() => decrypt(cifrado)).toThrow();
  });

  it("recusa formato desconhecido", () => {
    expect(() => decrypt("v2.abc.def")).toThrow(/formato desconhecido/i);
    expect(() => decrypt("texto puro")).toThrow(/formato desconhecido/i);
  });

  it("exige chave de 32 bytes", () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    resetKeyCache();
    expect(() => encrypt("x")).toThrow(/32 bytes/);
  });

  it("exige que a chave exista", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    resetKeyCache();
    expect(() => encrypt("x")).toThrow(/APP_ENCRYPTION_KEY/);
  });
});

describe("encryptOptional", () => {
  it("deixa nulo como nulo, sem cifrar vazio", () => {
    expect(encryptOptional(null)).toBeNull();
    expect(encryptOptional(undefined)).toBeNull();
    expect(encryptOptional("")).toBeNull();
  });

  it("faz a volta completa", () => {
    expect(decryptOptional(encryptOptional("Maria"))).toBe("Maria");
    expect(decryptOptional(null)).toBeNull();
  });
});

describe("safeEqual", () => {
  it("reconhece iguais e diferentes", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
    expect(safeEqual("abc123", "abc124")).toBe(false);
  });

  it("lida com tamanhos diferentes sem lancar", () => {
    expect(safeEqual("abc", "abcdef")).toBe(false);
  });
});
