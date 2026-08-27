import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // O Next bloqueia acesso cross-origin aos recursos de desenvolvimento, e
  // considera apenas localhost como origem valida. Abrir o app por 127.0.0.1
  // faz o HTML chegar e o JavaScript ser bloqueado — resultado: tela em branco
  // sem erro no navegador. Liberamos o equivalente numerico de localhost.
  allowedDevOrigins: ["127.0.0.1", "[::1]"],

  // Sem isto, o Turbopack sobe a arvore procurando a raiz do workspace e pode
  // encontrar um package-lock.json solto fora do projeto — o que gera aviso a
  // cada inicializacao. Fixamos a raiz no diretorio do projeto.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
