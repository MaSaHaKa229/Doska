#!/usr/bin/env bash
# Установка «Учебной доски» на сервер с Docker: настройки (.env со случайными
# секретами), сборка образов, запуск, первый администратор, HTTPS.
#
#   ./deploy/scripts/install.sh                       с вопросами
#   ./deploy/scripts/install.sh --domain doska.school.ru --email it@school.ru
#   ./deploy/scripts/install.sh --ip 192.168.1.10     локальная сеть, без домена
#
# Ключи: --domain ДОМЕН --email ПОЧТА | --ip АДРЕС; --admin-login ЛОГИН;
# --admin-password ПАРОЛЬ (иначе — случайный); --http-port N --https-port N;
# --ocr (распознавание рукописных формул, нужно ~3 ГБ памяти);
# --prisma-mirror АДРЕС (зеркало движков Prisma, если binaries.prisma.sh недоступен);
# --no-build (уже собранные образы); --force (перезаписать существующий .env).
set -euo pipefail
. "$(dirname "$0")/common.sh"

DOMAIN_ARG='' EMAIL_ARG='' IP_ARG='' ADMIN_LOGIN='admin' ADMIN_PASSWORD='' HTTP_PORT_ARG=80 HTTPS_PORT_ARG=443 OCR=0 BUILD=1 FORCE=0 PRISMA_MIRROR=''
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN_ARG=$2; shift 2 ;;
    --email) EMAIL_ARG=$2; shift 2 ;;
    --ip) IP_ARG=$2; shift 2 ;;
    --admin-login) ADMIN_LOGIN=$2; shift 2 ;;
    --admin-password) ADMIN_PASSWORD=$2; shift 2 ;;
    --http-port) HTTP_PORT_ARG=$2; shift 2 ;;
    --https-port) HTTPS_PORT_ARG=$2; shift 2 ;;
    --ocr) OCR=1; shift ;;
    --prisma-mirror) PRISMA_MIRROR=$2; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) die "Неизвестный ключ: $1 (справка: --help)" ;;
  esac
done

require_docker
[ -f "$ROOT/.env.example" ] || die "Нет .env.example — запустите скрипт из скачанного проекта."
if [ -f "$ENV_FILE" ] && [ $FORCE -ne 1 ]; then
  die "Уже есть $ENV_FILE (установка была). Обновление: ./deploy/scripts/update.sh; заново — ключ --force (старые пароли базы перестанут подходить к данным)."
fi

# --- Адрес сайта -------------------------------------------------------
if [ -z "$DOMAIN_ARG" ] && [ -z "$IP_ARG" ]; then
  echo "Как будут открывать сайт?"
  echo "  1) по доменному имени (например, doska.school.ru) — с HTTPS"
  echo "  2) по IP-адресу в локальной сети — без домена, по HTTP"
  read -r -p "Выберите 1 или 2: " mode
  if [ "$mode" = 1 ]; then
    read -r -p "Домен: " DOMAIN_ARG
    read -r -p "Почта для Let's Encrypt (уведомления о сертификате): " EMAIL_ARG
  else
    guess=$(hostname -I 2>/dev/null | awk '{print $1}')
    read -r -p "IP-адрес сервера [${guess}]: " IP_ARG
    IP_ARG=${IP_ARG:-$guess}
  fi
fi
if [ -n "$DOMAIN_ARG" ]; then
  [[ "$DOMAIN_ARG" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Странный домен: $DOMAIN_ARG"
  [ -n "$EMAIL_ARG" ] || die "Для HTTPS нужна почта: --email"
  [ "$HTTP_PORT_ARG" = 80 ] || warn "Let's Encrypt проверяет домен по порту 80 — сертификат может не выпуститься."
  ORIGIN="https://$DOMAIN_ARG"; [ "$HTTPS_PORT_ARG" = 443 ] || ORIGIN="$ORIGIN:$HTTPS_PORT_ARG"
  COOKIE_SECURE=true
else
  [ -n "$IP_ARG" ] || die "Не удалось определить IP — укажите --ip"
  ORIGIN="http://$IP_ARG"; [ "$HTTP_PORT_ARG" = 80 ] || ORIGIN="$ORIGIN:$HTTP_PORT_ARG"
  COOKIE_SECURE=false
fi

# --- Секреты и пароль администратора ------------------------------------
# head закрывает канал раньше tr — его SIGPIPE при pipefail не ошибка.
rand() { (set +o pipefail; LC_ALL=C tr -dc "$1" < /dev/urandom 2>/dev/null | head -c "$2"); }
DB_PASSWORD=$(rand 'A-Za-z0-9' 32)
JWT_SECRET=$(rand 'A-Za-z0-9' 64)
GENERATED=0
if [ -z "$ADMIN_PASSWORD" ]; then
  # Не короче 8 символов, буквы и цифры, без логина внутри (политика паролей приложения).
  ADMIN_PASSWORD="$(rand 'A-HJ-NP-Za-km-z' 6)$(rand '2-9' 3)$(rand 'a-km-z' 3)"
  GENERATED=1
fi
case "$ADMIN_PASSWORD" in *"$ADMIN_LOGIN"*) die "Пароль администратора не должен содержать логин." ;; esac

# --- Файл настроек ------------------------------------------------------
umask 077
cp "$ROOT/.env.example" "$ENV_FILE"
set_kv() {
  local key=$1 value=$2 tmp
  tmp=$(mktemp)
  if grep -q "^$key=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$ENV_FILE" > "$tmp"
  else
    cp "$ENV_FILE" "$tmp"; printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}
PROFILES=''
[ -n "$DOMAIN_ARG" ] && PROFILES='tls'
[ $OCR -eq 1 ] && PROFILES="${PROFILES:+$PROFILES,}ocr"
set_kv NODE_ENV production
set_kv POSTGRES_PASSWORD "$DB_PASSWORD"
set_kv DATABASE_URL "postgresql://doska:$DB_PASSWORD@db:5432/doska?schema=public"
set_kv JWT_ACCESS_SECRET "$JWT_SECRET"
set_kv PUBLIC_ORIGIN "$ORIGIN"
set_kv COOKIE_SECURE "$COOKIE_SECURE"
set_kv TRUST_PROXY true
set_kv DOMAIN "$DOMAIN_ARG"
set_kv LETSENCRYPT_EMAIL "$EMAIL_ARG"
set_kv HTTP_PORT "$HTTP_PORT_ARG"
set_kv HTTPS_PORT "$HTTPS_PORT_ARG"
set_kv COMPOSE_PROFILES "$PROFILES"
set_kv S3_ENDPOINT ''
set_kv PRISMA_ENGINES_MIRROR "$PRISMA_MIRROR"
set_kv SEED_ADMIN_LOGIN "$ADMIN_LOGIN"
set_kv SEED_ADMIN_PASSWORD "$ADMIN_PASSWORD"
if [ $OCR -eq 1 ]; then
  set_kv FORMULA_OCR_URL 'http://formula-ocr:8502/predict'
  set_kv FORMULA_OCR_API_KEY "$(rand 'A-Za-z0-9' 40)"
fi
chmod 600 "$ENV_FILE"
say "Настройки записаны: $ENV_FILE (доступ только владельцу)."

# --- Сборка и запуск ----------------------------------------------------
if [ $BUILD -eq 1 ]; then
  say "Сборка образов (первый раз — 5–15 минут)…"
  compose build
fi
say "Запуск…"
compose up -d
wait_healthy

if [ -n "$DOMAIN_ARG" ]; then
  if ! "$(dirname "$0")/https.sh"; then
    warn "Сертификат не выпущен: проверьте, что домен $DOMAIN_ARG указывает на этот сервер и порты 80 и 443 открыты, затем ./deploy/scripts/https.sh"
    warn "Пока сайт работает по http://$DOMAIN_ARG (вход по HTTP при COOKIE_SECURE=true не сработает)."
  fi
fi

echo
say "Учебная доска установлена: $ORIGIN"
echo "  Администратор: $ADMIN_LOGIN"
if [ $GENERATED -eq 1 ]; then
  echo "  Пароль:        $ADMIN_PASSWORD   (запишите; при первом входе система попросит его сменить)"
else
  echo "  Пароль:        тот, что указан в --admin-password (при первом входе — смена)"
fi
echo
echo "Дальше:"
echo "  • автозапуск и ежедневная резервная копия: sudo ./deploy/scripts/systemd.sh"
echo "  • обновление:          ./deploy/scripts/update.sh"
echo "  • резервная копия:     ./deploy/scripts/backup.sh"
