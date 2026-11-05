#!/bin/sh
# Загружает переменные из корневого .env (если он есть) и запускает команду.
# Используется только для разработки; в Docker переменные задаёт compose.
set -e
ENV_FILE="${ENV_FILE:-$(dirname "$0")/../../.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
exec "$@"
