#!/usr/bin/env bash
# Sobe o servidor se necessario, espera ficar pronto e sincroniza.
#
# Existe porque a danca de duas abas — servidor numa, sincronizacao noutra —
# rendeu mais erro que trabalho: porta ocupada, servidor derrubado sem querer,
# sincronizacao disparada antes de o Next terminar de compilar.
set -u

DIAS="${1:-45}"
PORTA=3210
LOG=/tmp/controle-financeiro-dev.log

pronto() { curl -s -o /dev/null --max-time 2 "http://localhost:$PORTA/api/sync"; }

if pronto; then
  echo "servidor ja esta de pe na porta $PORTA"
else
  # Um processo antigo pode estar segurando a porta sem atender — foi o que
  # aconteceu antes. Limpamos antes de tentar subir.
  if lsof -ti:"$PORTA" > /dev/null 2>&1; then
    echo "liberando a porta $PORTA (processo antigo sem resposta)"
    lsof -ti:"$PORTA" | xargs kill -9 2>/dev/null
    sleep 1
  fi

  echo "subindo o servidor (a primeira compilacao leva ~40s)..."
  : > "$LOG"
  nohup npm run dev < /dev/null > "$LOG" 2>&1 &
  SERVIDOR=$!

  for tentativa in $(seq 1 60); do
    sleep 2

    if pronto; then
      echo ""
      echo "servidor pronto"
      break
    fi

    # Desiste cedo quando o processo morreu: esperar 2 minutos por algo que ja
    # falhou so atrasa o diagnostico.
    if ! kill -0 "$SERVIDOR" 2>/dev/null; then
      echo ""
      echo "o servidor encerrou. ultimas linhas do log:"
      tail -20 "$LOG"
      exit 1
    fi

    printf "."
  done

  if ! pronto; then
    echo ""
    echo "o servidor nao respondeu em 2 minutos. log em $LOG:"
    tail -20 "$LOG"
    exit 1
  fi
fi

node scripts/sincronizar.mjs "$DIAS"
