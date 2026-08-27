#!/usr/bin/env bash
# Sobe o servidor se necessario, espera ficar pronto e sincroniza.
#
# Existe porque a danca de duas abas — servidor numa, sincronizacao noutra —
# rendeu mais erro que trabalho: porta ocupada, servidor derrubado sem querer,
# sincronizacao disparada antes de o Next terminar de compilar.
set -u

DIAS="${1:-45}"
PORTA=3210

pronto() { curl -s -o /dev/null --max-time 2 "http://localhost:$PORTA/api/sync"; }

if pronto; then
  echo "servidor ja esta de pe na porta $PORTA"
else
  echo "subindo o servidor..."
  # < /dev/null impede que o processo seja suspenso ao tentar ler do terminal.
  nohup npm run dev < /dev/null > /tmp/controle-financeiro-dev.log 2>&1 &

  for _ in $(seq 1 60); do
    sleep 2
    if pronto; then break; fi
  done

  if ! pronto; then
    echo "o servidor nao respondeu em 2 minutos. log:"
    tail -20 /tmp/controle-financeiro-dev.log
    exit 1
  fi
  echo "servidor pronto"
fi

node scripts/sincronizar.mjs "$DIAS"
