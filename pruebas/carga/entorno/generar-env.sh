#!/usr/bin/env bash
# Genera los .env del entorno de carga en ./env/ a partir de los .env.example de cada repo.
#
# Los secretos (secretos internos, clave JWT) se generan al azar en cada corrida y nunca salen de
# esta maquina: ./env/ esta en .gitignore. Las integraciones externas (R2, Brevo, Grafana Cloud)
# quedan vacias: la prueba no sube archivos ni manda mails.
#
# Uso: REPOS_DIR=/ruta/a/los/repos ./generar-env.sh
set -euo pipefail

: "${REPOS_DIR:?definir REPOS_DIR (carpeta con gateway/, microservicio-autenticacion/, ...)}"
cd "$(dirname "$0")"
mkdir -p env

secreto() { openssl rand -hex 32; }

# set_var ARCHIVO CLAVE VALOR: reemplaza la linea CLAVE=... (comentada o no) o la agrega al final.
set_var() {
  local file=$1 key=$2 value=$3 tmp
  tmp=$(mktemp)
  # Por ENVIRON y no con -v: awk -v interpreta los "\n" del PEM como saltos de linea reales.
  K="$key" V="$value" awk '
    BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"]; done = 0 }
    $0 ~ "^#? *" k "=" { if (!done) { print k "=" v; done = 1 }; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

SECRET_AUTH=$(secreto)
SECRET_SERVIDORES=$(secreto)
SECRET_MENSAJES=$(secreto)
SERVICE_SECRET_MENSAJES=$(secreto)

# Clave RS256 para firmar los JWT, en el formato JSON {kid: pem} que espera autenticacion.
PEM=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null)
KID="carga-$(date +%Y%m%d)"
JWT_SIGNING_KEYS=$(printf '{"%s":"%s"}' "$KID" "$(printf '%s\n' "$PEM" | awk '{printf "%s\\n", $0}')")

# R2 de relleno: la prueba no sube archivos, pero autenticacion y servidores arman el cliente S3
# al atender requests y vacio falla con "Invalid endpoint". Nunca se llega a conectar.
set_r2() {
  set_var "$1" R2_ACCOUNT_ID carga
  set_var "$1" R2_ACCESS_KEY_ID carga
  set_var "$1" R2_SECRET_ACCESS_KEY carga
  set_var "$1" R2_BUCKET_NAME carga
  set_var "$1" R2_PUBLIC_BASE_URL "http://localhost/r2"
}

# --- autenticacion ---
f=env/autenticacion.env
cp "$REPOS_DIR/microservicio-autenticacion/.env.example" "$f"
set_var "$f" DATABASE_URL "postgresql+asyncpg://discordia:carga@auth-db:5432/discordia_auth"
set_var "$f" JWT_SIGNING_KEYS "$JWT_SIGNING_KEYS"
set_var "$f" JWT_ACTIVE_KID "$KID"
# La corrida mas larga dura menos de una hora; asi no hace falta refrescar tokens a mitad.
set_var "$f" JWT_EXPIRE_MINUTES 120
set_var "$f" INTERNAL_SECRET "$SECRET_AUTH"
set_var "$f" REDIS_URL "redis://redis:6379/0"
set_var "$f" REGISTRATION_EMAIL_VERIFICATION false
set_r2 "$f"
set_var "$f" LOG_LEVEL WARNING

# --- servidores ---
f=env/servidores.env
cp "$REPOS_DIR/microservicio-servidores/.env.example" "$f"
set_var "$f" DATABASE_URL "postgresql+asyncpg://discordia:carga@servidores-db:5432/discordia_servidores"
set_var "$f" INTERNAL_SECRET "$SECRET_SERVIDORES"
set_var "$f" SERVICE_SECRET_VOZ "$(secreto)"
set_var "$f" SERVICE_SECRET_MENSAJES "$SERVICE_SECRET_MENSAJES"
set_var "$f" REDIS_URL "redis://redis:6379/0"
set_r2 "$f"
set_var "$f" LOG_LEVEL WARNING

# --- mensajes (REALTIME_PUBLIC_URL y EVENTS_CONSUMER_NAME van por instancia en el compose) ---
f=env/mensajes.env
cp "$REPOS_DIR/microservicio-mensajes/.env.example" "$f"
set_var "$f" MONGODB_URL "mongodb://mongo:27017"
set_var "$f" INTERNAL_SECRET "$SECRET_MENSAJES"
set_var "$f" SERVIDORES_URL "http://servidores:8081"
set_var "$f" SERVIDORES_SERVICE_SECRET "$SERVICE_SECRET_MENSAJES"
set_var "$f" REDIS_URL "redis://redis:6379/0"
set_var "$f" REALTIME_PUBLIC_URL "ws://localhost:18083"
set_var "$f" ALLOWED_ORIGINS "http://localhost:3000"
set_var "$f" LOG_LEVEL WARNING

# --- gateway ---
f=env/gateway.env
cp "$REPOS_DIR/gateway/.env.example" "$f"
set_var "$f" GATEWAY_PORT 8080
set_var "$f" ENVIRONMENT development
set_var "$f" INTERNAL_SECRET_AUTENTICACION "$SECRET_AUTH"
set_var "$f" INTERNAL_SECRET_SERVIDORES "$SECRET_SERVIDORES"
set_var "$f" INTERNAL_SECRET_MENSAJES "$SECRET_MENSAJES"
set_var "$f" INTERNAL_SECRET_VOZ "$(secreto)"
# Todo el trafico de k6 sale de una sola IP: con los limites de produccion (10 escrituras/s,
# 10 logins/min por IP) se mediria el limitador y no el sistema.
set_var "$f" GLOBAL_RATE_LIMIT 100000
set_var "$f" PUBLIC_RATE_LIMIT 100000
set_var "$f" AUTH_RATE_LIMIT_PER_MINUTE 100000
set_var "$f" WRITE_RATE_LIMIT 100000
set_var "$f" LOG_LEVEL WARNING

chmod 600 env/*.env
echo "Listo: $(ls env/*.env | tr '\n' ' ')"
