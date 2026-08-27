"use client";

import { useEffect, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

/**
 * Entrada por passkey.
 *
 * Em modo bootstrap (nenhuma credencial registrada) a tela oferece criar a
 * primeira. Depois disso, oferece entrar — e recuperacao por codigo, para o
 * caso de perder todos os dispositivos.
 */
export function AuthForm() {
  const [bootstrap, setBootstrap] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [modo, setModo] = useState<"entrar" | "dispositivo" | "recuperar">("entrar");
  const [codigo, setCodigo] = useState("");
  const [codigoNovo, setCodigoNovo] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/registrar")
      .then(async (r) => {
        const dados = await r.json();
        if (!r.ok) throw new Error(dados.error ?? "nao foi possivel consultar o servidor");
        setBootstrap(Boolean(dados.bootstrap));
      })
      .catch((e) => {
        // Sem saber se ha passkey, oferecemos entrar: e o caminho de quem ja
        // registrou, que e o caso comum depois do primeiro acesso.
        setBootstrap(false);
        setErro(e instanceof Error ? e.message : "servidor indisponivel");
      });
  }, []);

  async function registrar(codigoDeAcesso?: string) {
    setOcupado(true);
    setErro(null);

    try {
      const inicio = await fetch("/api/auth/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etapa: "opcoes", codigo: codigoDeAcesso }),
      });
      const dados = await inicio.json();
      if (!inicio.ok) throw new Error(dados.error ?? "nao autorizado");

      const resposta = await startRegistration({ optionsJSON: dados.opcoes });

      const fim = await fetch("/api/auth/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          etapa: "verificar",
          challengeId: dados.challengeId,
          codigo: codigoDeAcesso,
          label: navigator.userAgent.slice(0, 60),
          resposta,
        }),
      });
      const confirmacao = await fim.json();
      if (!fim.ok) throw new Error(confirmacao.error ?? "registro falhou");

      // O codigo de recuperacao aparece uma vez so; guardamos apenas o hash.
      if (confirmacao.recoveryCode) setCodigoNovo(confirmacao.recoveryCode);
      else window.location.href = "/";
    } catch (e) {
      setErro(e instanceof Error ? e.message : "nao foi possivel registrar");
    } finally {
      setOcupado(false);
    }
  }

  async function entrar() {
    setOcupado(true);
    setErro(null);

    try {
      const inicio = await fetch("/api/auth/entrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etapa: "opcoes" }),
      });
      const dados = await inicio.json();
      if (!inicio.ok) throw new Error(dados.error ?? "falhou");

      const resposta = await startAuthentication({ optionsJSON: dados.opcoes });

      const fim = await fetch("/api/auth/entrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etapa: "verificar", challengeId: dados.challengeId, resposta }),
      });
      if (!fim.ok) throw new Error((await fim.json()).error ?? "autenticacao falhou");

      window.location.href = "/";
    } catch (e) {
      setErro(e instanceof Error ? e.message : "nao foi possivel entrar");
    } finally {
      setOcupado(false);
    }
  }

  if (codigoNovo) {
    return (
      <div className="card">
        <h2>Guarde o codigo de recuperacao</h2>
        <p className="empty">
          Ele aparece <strong>uma unica vez</strong>. Guardamos apenas um hash, entao nao ha como
          reexibi-lo. Sem ele, perder todos os dispositivos registrados significa perder o acesso.
        </p>
        <p className="codigo-recuperacao">{codigoNovo}</p>
        <button type="button" onClick={() => (window.location.href = "/")}>
          Guardei — entrar
        </button>
      </div>
    );
  }

  if (bootstrap === null) {
    return <p className="empty">Carregando…</p>;
  }

  return (
    <div className="card">
      {bootstrap ? (
        <>
          <h2>Primeiro acesso</h2>
          <p className="empty">
            Nenhuma passkey registrada ainda. Crie a primeira com a biometria deste dispositivo —
            e registre um segundo dispositivo depois, para nao depender de um so.
          </p>
          <button type="button" onClick={() => registrar()} disabled={ocupado}>
            {ocupado ? "Aguarde…" : "Criar passkey"}
          </button>
        </>
      ) : (
        <>
          <h2>Entrar</h2>
          <p className="empty">Use a biometria de um dispositivo ja registrado.</p>
          <button type="button" onClick={entrar} disabled={ocupado}>
            {ocupado ? "Aguarde…" : "Entrar com passkey"}
          </button>

          <div className="recuperacao">
            {modo === "entrar" ? (
              <div className="filtros">
                <button type="button" className="danger" onClick={() => setModo("dispositivo")}>
                  Adicionar este dispositivo
                </button>
                <button type="button" className="danger" onClick={() => setModo("recuperar")}>
                  Perdi meus dispositivos
                </button>
              </div>
            ) : (
              <>
                <p className="empty">
                  {modo === "dispositivo"
                    ? "Em um dispositivo onde voce ja entra, abra Conexoes e gere um codigo. Ele vale 10 minutos."
                    : "Use o codigo de recuperacao guardado offline. Ele registra uma passkey nova aqui."}
                </p>
                <div className="connection-form">
                  <input
                    type="text"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    placeholder={modo === "dispositivo" ? "Codigo de 6 caracteres" : "Codigo de recuperacao"}
                    aria-label="Codigo"
                    autoComplete="off"
                    autoCapitalize="characters"
                  />
                  <button type="button" onClick={() => registrar(codigo)} disabled={ocupado}>
                    {ocupado ? "Aguarde…" : "Registrar"}
                  </button>
                  <button type="button" className="danger" onClick={() => setModo("entrar")}>
                    Voltar
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {erro ? (
        <p className="form-message negative" role="alert">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
