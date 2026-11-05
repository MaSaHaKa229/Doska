#!/usr/bin/env bash
# Восстановление из резервной копии (backup.sh): база данных и загруженные файлы.
#   ./deploy/scripts/restore.sh backups/2026-11-05_033000
#   ./deploy/scripts/restore.sh --yes <каталог>     без вопроса
# Текущие данные заменяются. Перед восстановлением делается копия текущего состояния.
# Настройки (.env) не перезаписываются: копия лежит в <каталог>/env — при переносе на
# новый сервер скопируйте её в .env до запуска.
set -euo pipefail
. "$(dirname "$0")/common.sh"
YES=0
if [ "${1:-}" = "--yes" ]; then YES=1; shift; fi
SRC=${1:-}
[ -n "$SRC" ] || die "Укажите каталог копии: ./deploy/scripts/restore.sh backups/<дата>"
[ -f "$SRC/db.dump" ] && [ -f "$SRC/uploads.tgz" ] || die "В $SRC нет db.dump и uploads.tgz."
require_docker
require_env

if [ $YES -ne 1 ]; then
  warn "Все доски, пользователи и файлы будут заменены данными из $SRC."
  read -r -p "Продолжить? Введите «да»: " answer
  [ "$answer" = "да" ] || die "Отменено."
fi

say "Копия текущего состояния (на случай ошибки)…"
"$(dirname "$0")/backup.sh"

say "Остановка сайта и сервера…"
compose stop web backend
compose up -d db
say "База данных…"
compose exec -T db pg_restore -U "${POSTGRES_USER:-doska}" -d "${POSTGRES_DB:-doska}" --clean --if-exists --no-owner --single-transaction < "$SRC/db.dump"
say "Загруженные файлы…"
compose run --rm --no-deps -T --entrypoint sh backend -c 'find /data/uploads -mindepth 1 -delete && tar xzf - -C /data/uploads' < "$SRC/uploads.tgz"
say "Запуск…"
compose up -d backend web
wait_healthy
say "Восстановлено из $SRC."
