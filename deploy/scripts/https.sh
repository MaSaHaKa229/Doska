#!/bin/sh
# Первый сертификат Let's Encrypt для DOMAIN из .env и включение HTTPS.
# Нужно: домен указывает на этот сервер, порты 80 и 443 открыты.
#   ./deploy/scripts/https.sh
set -eu
cd "$(dirname "$0")/../.."
[ -f .env ] || { echo "Нет файла .env — сначала установка (install.sh) или копия .env.example." >&2; exit 1; }
# shellcheck disable=SC1091
. ./.env
[ -n "${DOMAIN:-}" ] || { echo "Задайте DOMAIN в .env (например, doska.school.ru)." >&2; exit 1; }
[ -n "${LETSENCRYPT_EMAIL:-}" ] || { echo "Задайте LETSENCRYPT_EMAIL в .env." >&2; exit 1; }

echo "Сайт по HTTP (для проверки домена)…"
docker compose up -d web
echo "Выпуск сертификата для ${DOMAIN}…"
docker compose --profile tls run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot -d "${DOMAIN}" \
  --email "${LETSENCRYPT_EMAIL}" --agree-tos --no-eff-email --non-interactive
echo "Включение HTTPS и продления…"
docker compose restart web
docker compose --profile tls up -d certbot
echo "Готово: https://${DOMAIN}"
echo "Проверьте, что в .env PUBLIC_ORIGIN=https://${DOMAIN} и COOKIE_SECURE=true (после правки: docker compose up -d backend)."
