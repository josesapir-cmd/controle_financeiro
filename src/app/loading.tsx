/**
 * Sem isto, uma chamada lenta a Pluggy aparece como pagina em branco — o
 * usuario nao consegue distinguir "carregando" de "quebrado".
 */
export default function Loading() {
  return (
    <main className="page">
      <h1>Controle Financeiro</h1>
      <p className="empty" style={{ marginTop: 20 }}>
        Consultando a Pluggy…
      </p>
    </main>
  );
}
