import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * Inter servida pelo proprio app.
 *
 * `next/font` baixa a fonte no build e a serve do nosso dominio: nenhuma
 * requisicao a terceiros em runtime, que e a invariante de privacidade do
 * projeto (ver docs/arquitetura.md). Um <link> para o Google Fonts entregaria o
 * IP e o horario de cada acesso a um terceiro.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

/** O app e claro por decisao de projeto; nao segue o tema do sistema. */
export const viewport = { colorScheme: "light" as const };

export const metadata: Metadata = {
  title: "Controle Financeiro",
  description: "Gestao financeira pessoal com dados de Open Finance via Pluggy",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
