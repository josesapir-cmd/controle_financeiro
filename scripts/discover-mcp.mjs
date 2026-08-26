#!/usr/bin/env node
/**
 * Descobre o que um servidor MCP expoe: faz o handshake, lista as ferramentas
 * e imprime o schema de cada uma.
 *
 * Uso:
 *   PLUGGY_MCP_URL=https://... \
 *   PLUGGY_CLIENT_ID=... PLUGGY_CLIENT_SECRET=... \
 *   node scripts/discover-mcp.mjs
 *
 * Nao imprime credenciais. A saida pode ser colada com seguranca.
 */

const url = process.env.PLUGGY_MCP_URL;
const clientId = process.env.PLUGGY_CLIENT_ID;
const clientSecret = process.env.PLUGGY_CLIENT_SECRET;

if (!url) {
  console.error("Defina PLUGGY_MCP_URL com a URL do servidor MCP.");
  process.exit(1);
}

const baseHeaders = {
  "Content-Type": "application/json",
  // MCP sobre HTTP pode responder JSON puro ou SSE; aceitamos os dois.
  Accept: "application/json, text/event-stream",
};
if (clientId) baseHeaders["X-CLIENT-ID"] = clientId;
if (clientSecret) baseHeaders["X-CLIENT-SECRET"] = clientSecret;

let sessionId = null;

/** Respostas SSE chegam como linhas "data: {...}"; extraimos o ultimo JSON. */
function parsePayload(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("event:") && !trimmed.startsWith("data:")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return { raw: trimmed };
    }
  }
  let last = null;
  for (const line of trimmed.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      last = JSON.parse(line.slice(5).trim());
    } catch {
      /* linha de keepalive, ignora */
    }
  }
  return last;
}

async function call(method, params, id) {
  const headers = { ...baseHeaders };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(id === undefined ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
  });

  const captured = response.headers.get("mcp-session-id");
  if (captured) sessionId = captured;

  const text = await response.text();

  if (!response.ok) {
    console.error(`\n${method} -> HTTP ${response.status}`);
    console.error(text.slice(0, 800));
    if (response.status === 401 || response.status === 403) {
      console.error("\nAutenticacao recusada. Confira a URL e o formato esperado dos headers.");
    }
    process.exit(1);
  }

  return parsePayload(text);
}

const init = await call(
  "initialize",
  {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "pluggy-discovery", version: "1.0.0" },
  },
  1,
);

console.log("=== Servidor ===");
console.log(JSON.stringify(init?.result?.serverInfo ?? init, null, 2));
console.log("\n=== Capacidades ===");
console.log(JSON.stringify(init?.result?.capabilities ?? {}, null, 2));

// O handshake so se completa apos esta notificacao (sem id, sem resposta).
await call("notifications/initialized", {});

const tools = await call("tools/list", {}, 2);
const list = tools?.result?.tools ?? [];

console.log(`\n=== Ferramentas (${list.length}) ===`);
for (const tool of list) {
  console.log(`\n--- ${tool.name} ---`);
  if (tool.description) console.log(tool.description);
  console.log(JSON.stringify(tool.inputSchema ?? {}, null, 2));
}

if (list.length === 0) {
  console.log("Nenhuma ferramenta listada. Talvez o servidor exponha apenas resources:");
  const resources = await call("resources/list", {}, 3);
  console.log(JSON.stringify(resources?.result ?? resources, null, 2));
}
