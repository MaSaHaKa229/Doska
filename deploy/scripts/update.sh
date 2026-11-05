#!/usr/bin/env bash
# Обновление: резервная копия, новая версия из git, сборка, перезапуск.
# Миграции базы сервер применяет сам при запуске.
#   ./deploy/scripts/update.sh
#   ./deploy/scripts/update.sh --no-backup --no-pull --no-build
set -euo pipefail
. "$(dirname "$0")/common.sh"
BACKUP=1 PULL=1 BUILD=1
for a in "$@"; do
  case "$a" in
    --no-backup) BACKUP=0 ;;
    --no-pull) PULL=0 ;;
    --no-build) BUILD=0 ;;
    *) die "Неизвестный ключ: $a" ;;
  esac
done
require_docker
require_env

[ $BACKUP -eq 1 ] && "$(dirname "$0")/backup.sh"
if [ $PULL -eq 1 ]; then
  if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    say "Новая версия из git…"
    before=$(git -C "$ROOT" rev-parse --short HEAD)
    git -C "$ROOT" pull --ff-only
    say "Версия: $before → $(git -C "$ROOT" rev-parse --short HEAD)"
  else
    warn "Проект установлен не из git — новую версию положите в $ROOT сами (или --no-pull)."
  fi
fi
[ $BUILD -eq 1 ] && { say "Сборка…"; compose build; }
say "Перезапуск…"
compose up -d --remove-orphans
wait_healthy
docker image prune -f >/dev/null
say "Обновление завершено."
