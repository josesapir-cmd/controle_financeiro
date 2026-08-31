import { Nav } from "@/components/Nav";

export default function Loading() {
  return (
    <main className="page">
      <div className="masthead"><h1>Conexoes</h1></div>
      <Nav atual="/conexoes" />
      <p className="empty" style={{ marginTop: 20 }}>
        Consultando a Pluggy…
      </p>
    </main>
  );
}
