import { describe, expect, it } from "vitest";
import { abreNoNavegador, assinaturaConfere, tipoDeAnexoAceito } from "../anexos";

const bytes = (...partes: (string | number[])[]) =>
  new Uint8Array(
    partes.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

describe("tipos de anexo", () => {
  it("aceita PDF e imagem, e mais nada", () => {
    expect(tipoDeAnexoAceito("application/pdf")).toBe(true);
    expect(tipoDeAnexoAceito("image/jpeg")).toBe(true);
    expect(tipoDeAnexoAceito("image/svg+xml")).toBe(false);
    expect(tipoDeAnexoAceito("text/html")).toBe(false);
    expect(tipoDeAnexoAceito("toString")).toBe(false);
  });

  it("confere a assinatura de cada tipo", () => {
    expect(assinaturaConfere("application/pdf", bytes("%PDF-1.7"))).toBe(true);
    expect(assinaturaConfere("image/png", bytes([0x89], "PNG\r\n"))).toBe(true);
    expect(assinaturaConfere("image/jpeg", bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(assinaturaConfere("image/gif", bytes("GIF89a"))).toBe(true);
    expect(assinaturaConfere("image/webp", bytes("RIFF", [0, 0, 0, 0], "WEBPVP8"))).toBe(true);
    expect(assinaturaConfere("image/heic", bytes([0, 0, 0, 24], "ftypheic"))).toBe(true);
  });

  it("recusa HTML renomeado para PDF", () => {
    expect(assinaturaConfere("application/pdf", bytes("<html><script>"))).toBe(false);
    expect(assinaturaConfere("image/png", bytes("<svg"))).toBe(false);
    expect(assinaturaConfere("image/jpeg", bytes())).toBe(false);
  });

  it("HEIC baixa, porque o navegador nao mostra", () => {
    expect(abreNoNavegador("application/pdf")).toBe(true);
    expect(abreNoNavegador("image/png")).toBe(true);
    expect(abreNoNavegador("image/heic")).toBe(false);
  });
});
