"use client";

/**
 * Encerrar sessao. Client component porque precisa de POST — um link GET para
 * sair permitiria que qualquer imagem embutida em outra pagina deslogasse o
 * usuario.
 */
export function SairButton() {
  async function sair() {
    await fetch("/api/auth/sair", { method: "POST" });
    window.location.href = "/entrar";
  }

  return (
    <button type="button" className="sair" onClick={sair}>
      Sair
    </button>
  );
}
