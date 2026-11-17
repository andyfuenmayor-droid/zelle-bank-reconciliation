#!/usr/bin/env bash
# Script de despliegue y migración PostgreSQL en DigitalOcean para Conciliación Bancaria Zelle (Citibank / TD Bank)
set -euo pipefail

APP_DIR="/opt/zelle-bank-reconciliation"
PG_CONTAINER="operadora-postgres"
PG_USER="${POSTGRES_USER:-admin_db}"
PG_DB="${POSTGRES_DB:-operadora_production}"
APP_PORT=8550

echo "🚀 Iniciando despliegue de Zelle Bank Reconciliation en DigitalOcean..."

# 1. Recuperar credenciales de PostgreSQL del servidor
PG_PASS=""
if [ -f /opt/operadora-cms-web/.env ]; then
  echo "🔑 Leyendo credenciales de PostgreSQL desde /opt/operadora-cms-web/.env..."
  PG_PASS=$(grep -E '^POSTGRES_PASSWORD=' /opt/operadora-cms-web/.env | cut -d'=' -f2- | tr -d '\r"' || true)
  PG_USER_ENV=$(grep -E '^POSTGRES_USER=' /opt/operadora-cms-web/.env | cut -d'=' -f2- | tr -d '\r"' || true)
  PG_DB_ENV=$(grep -E '^POSTGRES_DB=' /opt/operadora-cms-web/.env | cut -d'=' -f2- | tr -d '\r"' || true)
  [ -n "$PG_USER_ENV" ] && PG_USER="$PG_USER_ENV"
  [ -n "$PG_DB_ENV" ] && PG_DB="$PG_DB_ENV"
fi

cat <<EOF > .env
PORT=${APP_PORT}
NODE_ENV=production
DATABASE_URL=postgresql://${PG_USER}:${PG_PASS:-WZjf5eNhdCX4GJSnsAuF2H1t}@127.0.0.1:5432/${PG_DB}
PG_POOL_MAX=20
PG_SSL_ENABLED=false
CRON_SECRET=mbe_cron_zelle_secret_2026
DEFAULT_FEE_PERCENTAGE=4.00
EOF
chmod 600 .env
echo "✅ Archivo .env configurado en puerto ${APP_PORT}."

# 2. Aplicar esquema SQL (tablas bank_email_alerts, ordenes_pago_pendientes y función fn_conciliar_pago_zelle) en PostgreSQL
echo "🗄️ Creando/actualizando tablas e índices en el contenedor PostgreSQL ($PG_CONTAINER -> $PG_DB)..."
docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" < schema.sql

# Notificar a PostgREST para que recargue el caché de esquema
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "NOTIFY pgrst, 'reload schema';" || true

echo "📋 Verificando tablas creadas en PostgreSQL ($PG_DB):"
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "\dt public.bank_email_alerts" -c "\dt public.ordenes_pago_pendientes" -c "\dt public.clientes_titulares" -c "\dt public.imap_monitored_accounts" -c "\df public.fn_conciliar_pago_zelle"

# 3. Levantar contenedor de la aplicación Next.js
echo "📦 Construyendo y levantando contenedor Docker zelle-bank-reconciliation en puerto $APP_PORT..."
docker compose up -d --build

# 4. Configurar Nginx y SSL para conciliarcuenta.com y www.conciliarcuenta.com
DOMAIN="conciliarcuenta.com"
SITE_NAME="conciliarcuenta.com"
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"

echo "⚙️ Configurando Nginx para $DOMAIN y www.$DOMAIN -> http://127.0.0.1:$APP_PORT ..."

if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
  cat <<EOF > /etc/nginx/sites-available/$SITE_NAME
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $DOMAIN www.$DOMAIN;
    client_max_body_size 20M;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120;
    }
}
EOF
else
  cat <<EOF > /etc/nginx/sites-available/$SITE_NAME
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120;
    }
}
EOF
fi

ln -sf /etc/nginx/sites-available/$SITE_NAME /etc/nginx/sites-enabled/$SITE_NAME
nginx -t
systemctl reload nginx

# Intentar emitir certificado SSL gratuito con Certbot si aún no existe
if [ ! -f "$CERT_DIR/fullchain.pem" ] && command -v certbot >/dev/null 2>&1; then
  echo "🔒 Emitiendo certificado SSL Let's Encrypt para $DOMAIN y www.$DOMAIN..."
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "⚠️ Certbot aún esperando propagación DNS; HTTP en http://$DOMAIN ya está activo."
fi

echo "✅ Despliegue, tablas en PostgreSQL y dominio $DOMAIN configurados con éxito."
