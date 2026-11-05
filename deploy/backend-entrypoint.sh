#!/bin/sh
# Запуск сервера в контейнере: миграции базы, сид (первый администратор и
# встроенные шаблоны — повторный запуск безопасен), затем сам сервер.
set -e
cd /app/backend
echo "Миграции базы данных…"
npx --no-install prisma migrate deploy
echo "Первый администратор и встроенные шаблоны…"
if ! node dist/prisma/seed.js; then
  echo "Сид не выполнен — причина выше. Пароль первого администратора: SEED_ADMIN_PASSWORD в .env (нужен, пока в базе нет администратора)." >&2
  exit 1
fi
exec node dist/src/main.js
