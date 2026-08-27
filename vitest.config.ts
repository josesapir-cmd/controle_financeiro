import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Os testes de banco sobem um Postgres em WASM por arquivo, e a
    // inicializacao passa dos 5s padrao quando varios rodam em paralelo — o
    // sintoma era falha intermitente que sumia ao rodar o arquivo sozinho.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
