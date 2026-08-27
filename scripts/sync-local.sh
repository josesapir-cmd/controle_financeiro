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

# --noproxy e essencial: com HTTP_PROXY definido no shell, o curl manda a
# requisicao de localhost para o proxy, que nao a entrega. O sintoma e o pior
# possivel — o script conclui que o servidor esta fora quando ele esta de pe,
# mata a porta e tenta subir outro por cima.
pronto() {
  curl -s -o /dev/null --max-time 2 --noproxy '*' "http://localhost:$PORTA/api/sync"
}

if pronto; then
  echo "servidor ja esta de pe na porta $PORTA"
else
  # Um processo antigo pode estar segurando a porta sem atender — foi o que
  # aconteceu antes. Limpamos antes de tentar subir.
  if lsof -ti:"$PORTA" > /dev/null 2>&1; then
    echo "porta $PORTA ocupada por um processo que nao responde:"
    lsof -nP -iTCP:"$PORTA" -sTCP:LISTEN | tail -n +2
    lsof -ti:"$PORTA" | xargs kill -9 2>/dev/null

    # Esperar a porta liberar de verdade: o kill retorna antes de o sistema
    # devolver o socket, e subir em seguida daria EADDRINUSE.
    for _ in $(seq 1 10); do
      lsof -ti:"$PORTA" > /dev/null 2>&1 || break
      sleep 1
    done
    echo "porta liberada"
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
