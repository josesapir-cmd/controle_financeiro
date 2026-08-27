import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Sem isto, o Turbopack sobe a arvore procurando a raiz do workspace e pode
  // encontrar um package-lock.json solto fora do projeto — o que gera aviso a
  // cada inicializacao. Fixamos a raiz no diretorio do projeto.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
