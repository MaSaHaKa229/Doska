#!/usr/bin/env bash
# Автозапуск после перезагрузки и ежедневная резервная копия (systemd).
#   sudo ./deploy/scripts/systemd.sh             установить
#   sudo ./deploy/scripts/systemd.sh --remove    убрать
#   BACKUP_TIME=02:15 sudo ./deploy/scripts/systemd.sh   время копии (по умолчанию 03:30)
# Контейнеры и так перезапускаются Docker (restart: unless-stopped); служба
# поднимает и остановленные вручную, а таймер делает копию (хранятся 14 последних).
set -euo pipefail
. "$(dirname "$0")/common.sh"
[ "$(id -u)" -eq 0 ] || die "Запустите через sudo."
UNIT_DIR=${UNIT_DIR:-/etc/systemd/system}

if [ "${1:-}" = "--remove" ]; then
  systemctl disable --now doska-backup.timer doska.service 2>/dev/null || true
  rm -f "$UNIT_DIR/doska.service" "$UNIT_DIR/doska-backup.service" "$UNIT_DIR/doska-backup.timer"
  systemctl daemon-reload
  say "Службы doska убраны (контейнеры не остановлены)."
  exit 0
fi
require_env
DOCKER=$(command -v docker)

cat > "$UNIT_DIR/doska.service" <<UNIT
[Unit]
Description=Учебная доска (Docker Compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$ROOT
ExecStart=$DOCKER compose --project-directory $ROOT --env-file $ENV_FILE up -d
ExecStop=$DOCKER compose --project-directory $ROOT --env-file $ENV_FILE stop
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
UNIT

cat > "$UNIT_DIR/doska-backup.service" <<UNIT
[Unit]
Description=Учебная доска: резервная копия
Requires=docker.service
After=docker.service doska.service

[Service]
Type=oneshot
Environment=DOSKA_ENV_FILE=$ENV_FILE
ExecStart=$ROOT/deploy/scripts/backup.sh
UNIT

cat > "$UNIT_DIR/doska-backup.timer" <<UNIT
[Unit]
Description=Учебная доска: ежедневная резервная копия

[Timer]
OnCalendar=*-*-* ${BACKUP_TIME:-03:30}:00
Persistent=true
RandomizedDelaySec=5min

[Install]
WantedBy=timers.target
UNIT

if [ "${UNIT_DIR}" = /etc/systemd/system ]; then
  systemctl daemon-reload
  systemctl enable doska.service doska-backup.timer
  systemctl start doska-backup.timer
  say "Готово: автозапуск включён, копия — ежедневно в ${BACKUP_TIME:-03:30} (каталог backups, журнал: journalctl -u doska-backup)."
else
  say "Файлы служб записаны в $UNIT_DIR."
fi
