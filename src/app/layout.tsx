import type { Metadata } from "next";
import "./globals.css";

/** O app e claro por decisao de projeto; nao segue o tema do sistema. */
export const viewport = { colorScheme: "light" as const };

export const metadata: Metadata = {
  title: "Controle Financeiro",
  description: "Gestao financeira pessoal com dados de Open Finance via Pluggy",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
