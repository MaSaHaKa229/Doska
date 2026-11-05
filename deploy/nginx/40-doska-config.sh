#!/bin/sh
# Выбор конфигурации Nginx при запуске контейнера:
#   задан DOMAIN и уже есть сертификат — HTTPS (и перенаправление с HTTP);
#   иначе — HTTP (локальная сеть по IP или до выпуска сертификата).
# Раз в 6 часов конфигурация выбирается заново и Nginx перечитывает её:
# так подхватываются и первый сертификат, и продлённые certbot.
set -e

choose() {
  if [ -n "${DOMAIN:-}" ] && [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    envsubst '${DOMAIN}' < /etc/nginx/doska/https.conf.template > /etc/nginx/conf.d/doska.conf
    echo "doska: HTTPS для ${DOMAIN}"
  else
    cp /etc/nginx/doska/http.conf.template /etc/nginx/conf.d/doska.conf
    if [ -n "${DOMAIN:-}" ]; then
      echo "doska: сертификата для ${DOMAIN} пока нет — работаем по HTTP (выпуск: ./deploy/scripts/https.sh)"
    else
      echo "doska: работаем по HTTP (DOMAIN не задан)"
    fi
  fi
}

choose
(
  while sleep 6h; do
    choose >/dev/null && nginx -s reload 2>/dev/null || true
  done
) &
