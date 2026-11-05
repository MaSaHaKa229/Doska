#!/usr/bin/env bash
# Первый сертификат Let's Encrypt для DOMAIN из .env и включение HTTPS.
# Нужно: домен указывает на этот сервер, порты 80 и 443 открыты.
#   ./deploy/scripts/https.sh
# Продление дальше — само (сервис certbot, профиль tls в COMPOSE_PROFILES).
set -euo pipefail
. "$(dirname "$0")/common.sh"
require_docker
require_env
[ -n "${DOMAIN:-}" ] || die "Задайте DOMAIN в .env (например, doska.school.ru)."
[ -n "${LETSENCRYPT_EMAIL:-}" ] || die "Задайте LETSENCRYPT_EMAIL в .env."

say "Сайт по HTTP (для проверки домена)…"
compose up -d web
say "Выпуск сертификата для ${DOMAIN}…"
compose --profile tls run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot -d "${DOMAIN}" \
  --email "${LETSENCRYPT_EMAIL}" --agree-tos --no-eff-email --non-interactive
say "Включение HTTPS и продления…"
compose restart web
compose --profile tls up -d certbot
case ",${COMPOSE_PROFILES:-}," in *,tls,*) ;; *) warn "Добавьте tls в COMPOSE_PROFILES в .env — иначе после перезапуска продление не поднимется." ;; esac
[ "${PUBLIC_ORIGIN:-}" = "https://${DOMAIN}" ] || warn "В .env PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-} — для HTTPS нужен https://${DOMAIN} и COOKIE_SECURE=true (после правки: docker compose up -d backend)."
say "Готово: https://${DOMAIN}"
