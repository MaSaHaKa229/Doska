# Общее для скриптов развёртывания (подключается через «. common.sh»).
#   DOSKA_ENV_FILE      файл настроек (по умолчанию .env в корне проекта)
#   DOSKA_COMPOSE_ARGS  доп. аргументы docker compose (например, «-p doskatest» для проверки)
#   BACKUP_DIR          каталог резервных копий (по умолчанию backups в корне проекта)

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENV_FILE=${DOSKA_ENV_FILE:-$ROOT/.env}
export DOSKA_ENV_FILE="$ENV_FILE"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die() { printf '\033[31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

compose() {
  local files=()
  # Сертификат прокси для npm при сборке (необязательно): DOSKA_NPM_CA=/путь/ca.pem.
  if [ -n "${DOSKA_NPM_CA:-}" ]; then
    [ -r "$DOSKA_NPM_CA" ] || die "Не читается DOSKA_NPM_CA: $DOSKA_NPM_CA"
    DOSKA_NPM_CA_PEM=$(cat "$DOSKA_NPM_CA"); export DOSKA_NPM_CA_PEM
    files=(-f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.npm-ca.yml")
  fi
  # shellcheck disable=SC2086
  docker compose --project-directory "$ROOT" "${files[@]}" --env-file "$ENV_FILE" ${DOSKA_COMPOSE_ARGS:-} "$@"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker не установлен. Ubuntu: https://docs.docker.com/engine/install/ubuntu/"
  docker compose version >/dev/null 2>&1 || die "Нет Docker Compose v2 (команда «docker compose»)."
  docker info >/dev/null 2>&1 || die "Docker не запущен или нет прав (sudo или группа docker)."
}

require_env() {
  [ -f "$ENV_FILE" ] || die "Нет файла настроек $ENV_FILE — сначала ./deploy/scripts/install.sh"
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
}

# Дождаться, пока сервер станет здоровым (миграции и сид при запуске — до пары минут).
wait_healthy() {
  say "Ждём запуска сервера…"
  i=0
  while [ $i -lt 90 ]; do
    id=$(compose ps -q backend 2>/dev/null)
    st=$( [ -n "$id" ] && docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo none)
    [ "$st" = healthy ] && { say "Сервер запущен."; return 0; }
    i=$((i + 1)); sleep 2
  done
  compose logs --tail 40 backend >&2 || true
  die "Сервер не запустился за 3 минуты — журнал выше (docker compose logs backend)."
}
