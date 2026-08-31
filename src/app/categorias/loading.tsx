import { Nav } from "@/components/Nav";

export default function Loading() {
  return (
    <main className="page">
      <div className="masthead"><h1>Categorias</h1></div>
      <Nav atual="/categorias" />
      <p className="empty" style={{ marginTop: 20 }}>
        Somando os centros de custo…
      </p>
    </main>
  );
}
