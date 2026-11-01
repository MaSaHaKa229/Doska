# Учебная доска

Интерактивная бесконечная доска для совместных занятий учителя и учеников по математике и физике.
Покрывает школьный курс (5–11 классы, ОГЭ/ЕГЭ, олимпиады) и университетский. Интерфейс на русском языке.

> **Статус: этап 2.1 из 9.** Готовы архитектура и общий пакет `@doska/shared`, бэкенд с авторизацией (вход, обновление сессии, выход, смена временного пароля), защита от CSRF, ограничение попыток входа, журнал входов, сид первого администратора.
> Полная инструкция по развёртыванию на Ubuntu 24.04 появится на этапе 9.

## Документация

- [Архитектура](docs/ARCHITECTURE.md)
- [Модель доски и объектов](docs/BOARD_MODEL.md)
- [Система плагинов](docs/PLUGINS.md)
- [Протокол синхронизации](docs/SYNC_PROTOCOL.md)
- [План работ](docs/ROADMAP.md)
- [Схема БД](backend/prisma/schema.prisma)

## Разработка

Нужны Node.js 22 или новее и PostgreSQL 16. Локально подойдёт `apt install postgresql` или контейнер `postgres:16`.

```bash
# 1. База данных (один раз)
sudo -u postgres psql -c "CREATE USER doska WITH PASSWORD 'doska' CREATEDB;"
sudo -u postgres createdb -O doska doska        # основная
sudo -u postgres createdb -O doska doska_test   # для тестов

# 2. Настройки: скопируйте пример и заполните
cp .env.example .env
#   для разработки:
#   NODE_ENV=development
#   DATABASE_URL=postgresql://doska:doska@localhost:5432/doska?schema=public
#   JWT_ACCESS_SECRET=<openssl rand -base64 48>
#   PUBLIC_ORIGIN=http://localhost:5173,http://localhost:3000
#   COOKIE_SECURE=false
#   SEED_ADMIN_PASSWORD=<пароль с буквой и цифрой, без логина внутри>

# 3. Установка, миграции, первый администратор
npm install
npm run build:shared
npm run db:migrate
npm run db:seed

# 4. Запуск бэкенда (http://localhost:3000, проверка: /api/health)
npm run dev:backend

# Проверки
npm run check   # типы + тесты (shared и backend) + сборка + схема Prisma
npm test
```

Тесты бэкенда используют отдельную БД. Адрес задаётся переменной `TEST_DATABASE_URL`, по умолчанию `postgresql://doska:doska@localhost:5432/doska_test`; миграции применяются к ней автоматически.

### API авторизации (`/api/auth`)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/csrf` | выдать CSRF-cookie (перед формой входа) |
| POST | `/login` | вход `{login, password}` |
| POST | `/refresh` | обновить сессию (ротация refresh-токена) |
| POST | `/logout` | выход с текущего устройства |
| POST | `/logout-all` | выход на всех устройствах |
| GET | `/me` | текущий пользователь |
| POST | `/change-password` | смена пароля `{currentPassword, newPassword}` |
| PATCH | `/me/preferences` | настройки интерфейса |

Все изменяющие запросы к `/api` должны передавать заголовок `X-CSRF-Token` со значением cookie `csrf_token`, а их `Origin` должен входить в `PUBLIC_ORIGIN`.
Ошибки возвращаются в формате `{"error": {"code", "message", "details?"}}`.
