import { Nav } from "@/components/Nav";

export default function Loading() {
  return (
    <main className="page">
      <div className="masthead"><h1>Linha do tempo</h1></div>
      <Nav atual="/dia" />
      <p className="empty" style={{ marginTop: 20 }}>
        Consultando a Pluggy…
      </p>
    </main>
  );
}
