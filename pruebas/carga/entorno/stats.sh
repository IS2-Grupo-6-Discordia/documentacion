#!/usr/bin/env bash
# Muestrea CPU y memoria de los contenedores del entorno de carga cada INTERVALO segundos y lo
# escribe como CSV, para cruzarlo con la serie temporal de k6 y ver qué servicio se satura.
#
# Uso (en otra terminal, mientras corre k6):
#   ./stats.sh ../salidas/estres-stats.csv
# Cortar con Ctrl+C. CPU en % de un núcleo (200% = dos núcleos enteros).
set -euo pipefail

SALIDA=${1:?indicar el archivo de salida}
INTERVALO=${INTERVALO:-5}

echo "timestamp,contenedor,cpu_pct,mem_mib" > "$SALIDA"
while true; do
  ts=$(date +%s)
  docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' \
    | grep '^discordia-carga-' \
    | awk -F, -v ts="$ts" '{
        name = $1; sub(/^discordia-carga-/, "", name); sub(/-1$/, "", name)
        cpu = $2; sub(/%/, "", cpu)
        split($3, m, " ");  mem = m[1]
        if (mem ~ /GiB$/) { sub(/GiB/, "", mem); mem = mem * 1024 } else { sub(/MiB/, "", mem) }
        printf "%s,%s,%s,%s\n", ts, name, cpu, mem
      }' >> "$SALIDA"
  sleep "$INTERVALO"
done
