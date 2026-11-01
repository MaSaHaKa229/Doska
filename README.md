# Учебная доска

Интерактивная бесконечная доска для совместных занятий учителя и учеников по математике и физике.
Покрывает школьный курс (5–11 классы, ОГЭ/ЕГЭ, олимпиады) и университетский. Интерфейс на русском языке.

> **Статус: этап 3.3 из 9.** Готовы авторизация, панель администратора, доски и папки, сервер реального времени с проверкой прав, ядро холста (фоны, страницы, фигуры, выделение, трансформации, группы, слои, блокировка, копирование, отмена своих действий), курсоры и участники, работа без сети, привязки, поиск Ctrl+K и справка «?». Дальше — режимы урока и права учителя (этап 4).
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

# 4. Запуск (в двух терминалах)
npm run dev:backend    # API: http://localhost:3000, проверка: /api/health
npm run dev:frontend   # интерфейс: http://localhost:5173 (проксирует /api на бэкенд)

# Проверки
npm run check   # типы + тесты (shared и backend) + сборка + схема Prisma
npm test
```

Войдите под администратором из `SEED_ADMIN_LOGIN` и `SEED_ADMIN_PASSWORD`. При первом входе система попросит сменить пароль.

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

### API администратора (`/api/admin`, только роль ADMIN)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/users` | список: `search`, `role`, `classId`, `noClass`, `status` (active/blocked/pending/all), `sort`, `order`, `page`, `pageSize` |
| GET | `/users/suggest-login?fullName=` | свободный логин по ФИО (`ivanov.ps`, `ivanov.ps2`…) |
| POST | `/users` | создать `{fullName, login?, role, classIds?}` → временный пароль |
| POST | `/users/import` | импорт CSV `{csv, defaultRole?, classId?, createMissingClasses?, academicYear?, dryRun?}` |
| GET / PATCH | `/users/:id` | просмотр, изменение (ФИО, логин, роль, классы, цвет) |
| POST | `/users/:id/block`, `/users/:id/unblock` | блокировка (с завершением сессий) и разблокировка |
| POST | `/users/:id/reset-password` | новый временный пароль |
| DELETE | `/users/:id` | удаление, тело `{confirmLogin}` |
| GET / POST | `/classes` | список и создание классов и групп |
| GET / PATCH / DELETE | `/classes/:id` | просмотр, изменение и архив, удаление (тело `{confirmName}`) |
| POST | `/classes/:id/members` | добавить учеников и учителей `{userIds}` |
| DELETE | `/classes/:id/members/:userId` | убрать из класса |
| POST | `/classes/:id/reset-passwords` | временные пароли ученикам класса `{onlyPending?}` |
| GET | `/audit` | журнал: `actions`, `actorId`, `targetId`, `search`, `from`, `to`, пагинация |
| GET | `/stats` | сводка для главной панели |

### Доски и папки

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/boards` | список: `scope` (own/shared/all), `folderId` (uuid или `root`), `search`, `kind`, `sort`, `order`, пагинация |
| POST | `/api/boards` | создать: учитель — урок `{title, mode, classIds, studentIds, folderId}`, ученик — конспект |
| GET | `/api/boards/my-classes` | классы учителя, которым можно выдавать доски |
| GET | `/api/boards/:id/people` | люди доски (подписи «кто нарисовал») |
| GET / PATCH / DELETE | `/api/boards/:id` | свойства и права; название, папка, настройки, открыть конспект учителям; удаление (владелец) |
| PUT | `/api/boards/:id/access` | классы и участники доски (полная замена) |
| GET / POST | `/api/folders` | папки (до 5 уровней) |
| PATCH / DELETE | `/api/folders/:id` | переименовать или переместить; удалить (доски переходят в «Без папки») |

### Горячие клавиши доски

| Клавиши | Действие |
|---|---|
| V, H | выделение, рука |
| R, O, Shift+R, L, A | прямоугольник, эллипс, треугольник, линия, стрелка (Shift при рисовании — правильная фигура / шаг 15°) |
| Пробел + мышь, средняя кнопка, два пальца | перемещение по доске |
| Колесо, щипок, Ctrl+= / Ctrl+− / Ctrl+0 | масштаб |
| Shift+1, Shift+2 | показать всё / выделение |
| Ctrl+Z, Ctrl+Shift+Z (Ctrl+Y) | отменить / повторить свои действия |
| Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+D | копировать, вырезать, вставить, дублировать |
| Ctrl+G, Ctrl+Shift+G | сгруппировать, разгруппировать |
| Ctrl+], Ctrl+[, Ctrl+Shift+], Ctrl+Shift+[ | вперёд, назад, на передний, на задний план |
| Ctrl+L | заблокировать или разблокировать (учитель) |
| Delete, стрелки (Shift — ×10), Ctrl+A, Esc | удалить, сдвинуть, выделить всё, сброс |
| PageUp, PageDown | предыдущая и следующая страница |

| Ctrl+K | поиск инструментов и команд |
| ?, F1 | справка по горячим клавишам |
| Alt (во время рисования и перемещения) | без привязки |

Буквенные клавиши работают и в русской раскладке.

### WebSocket `/ws/boards/:id`

Это протокол Yjs (sync и awareness) с управляющими сообщениями; описание — в [docs/SYNC_PROTOCOL.md](docs/SYNC_PROTOCOL.md).
Сервер применяет каждое изменение, проверяет права и запрещённое сразу отменяет у всех. Документы сохраняются в PostgreSQL: журнал изменений пишется раз в секунду и регулярно сжимается в снимок.

Формат CSV для импорта: колонки «ФИО; Логин; Роль; Класс», разделитель `;`, `,` или табуляция, заголовок необязателен.
Логин и роль можно не указывать: логин сгенерируется из ФИО, роль возьмётся по умолчанию.
Импорт атомарный: при любой ошибке в файле не создаётся никто.
Временные пароли возвращаются только в ответе на создание, импорт или сброс; в базе хранятся лишь хеши.

Все изменяющие запросы к `/api` должны передавать заголовок `X-CSRF-Token` со значением cookie `csrf_token`, а их `Origin` должен входить в `PUBLIC_ORIGIN`.
Ошибки возвращаются в формате `{"error": {"code", "message", "details?"}}`.
