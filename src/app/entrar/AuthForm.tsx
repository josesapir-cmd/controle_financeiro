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
  const [recuperando, setRecuperando] = useState(false);
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

  async function registrar(recoveryCode?: string) {
    setOcupado(true);
    setErro(null);

    try {
      const inicio = await fetch("/api/auth/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etapa: "opcoes", recoveryCode }),
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
          recoveryCode,
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
            {recuperando ? (
              <>
                <p className="empty">
                  Perdeu os dispositivos? Use o codigo de recuperacao para registrar uma passkey
                  nova.
                </p>
                <div className="connection-form">
                  <input
                    type="text"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    placeholder="Codigo de recuperacao"
                    aria-label="Codigo de recuperacao"
                    autoComplete="off"
                  />
                  <button type="button" onClick={() => registrar(codigo)} disabled={ocupado}>
                    Recuperar
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="danger" onClick={() => setRecuperando(true)}>
                Perdi meus dispositivos
              </button>
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
