#!/usr/bin/env bash
# Резервная копия: база данных (pg_dump), загруженные файлы и настройки (.env).
#   ./deploy/scripts/backup.sh            копия в backups/ГГГГ-ММ-ДД_ЧЧММСС
#   KEEP=30 ./deploy/scripts/backup.sh    хранить 30 последних копий (по умолчанию 14)
# Копия содержит секреты из .env — храните её как пароли (каталог доступен только владельцу).
set -euo pipefail
. "$(dirname "$0")/common.sh"
require_docker
require_env
KEEP=${KEEP:-14}
DIR=${BACKUP_DIR:-$ROOT/backups}
TS=$(date +%Y-%m-%d_%H%M%S)
OUT="$DIR/$TS"
umask 077
mkdir -p "$OUT"

say "База данных…"
compose exec -T db pg_dump -U "${POSTGRES_USER:-doska}" -d "${POSTGRES_DB:-doska}" -Fc > "$OUT/db.dump"
say "Загруженные файлы…"
compose exec -T backend tar czf - -C /data/uploads . > "$OUT/uploads.tgz"
cp "$ENV_FILE" "$OUT/env"
{
  echo "created=$(date -Iseconds)"
  echo "commit=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
} > "$OUT/info"
[ -s "$OUT/db.dump" ] || die "Пустой дамп базы — копия не сделана."

# Старые копии: оставить KEEP последних.
ls -1d "$DIR"/20??-??-??_?????? 2>/dev/null | sort | head -n -"$KEEP" | while read -r old; do rm -rf -- "$old"; done
say "Готово: $OUT ($(du -sh "$OUT" | cut -f1))"
