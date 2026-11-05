# Учебная доска на Windows 10 в локальной сети

Сайт работает на одном компьютере, а ученики и учителя открывают его со своих устройств в той же сети (Wi-Fi класса, домашняя сеть). Для постоянной работы через интернет нужен сервер с HTTPS — см. [README](../README.md#установка-на-сервер).

> На Windows эти шаги не проверялись: проект собирался и проверялся на Linux. Если на каком-то шаге появится ошибка, сохраните её текст.

Есть два способа.

- **A. Docker Desktop.** Устанавливаются те же контейнеры, что и на сервере, одной командой. Понадобятся Docker Desktop (WSL 2), около 8 ГБ памяти и виртуализация в BIOS.
- **B. Без Docker.** Node.js и PostgreSQL ставятся прямо в Windows, сайт запускается в двух окнах.

## A. Docker Desktop

1. Установите [Docker Desktop](https://www.docker.com/products/docker-desktop/) (WSL 2) и [Git for Windows](https://git-scm.com/download/win). В установщике Git на шаге «Configuring the line ending conversions» выберите **Checkout as-is, commit as-is**.
2. Запустите Docker Desktop и дождитесь надписи «Engine running».
3. В **Git Bash** выполните (IP-адрес компьютера покажет `ipconfig`: «IPv4-адрес» у Wi-Fi или Ethernet):

```bash
cd ~
git clone -c core.autocrlf=false https://github.com/masahaka229/doska.git
cd doska
git checkout stage-1-architecture
./deploy/scripts/install.sh --ip 192.168.1.50
```

Скрипт соберёт образы (первый раз — 10–20 минут), запустит сайт на порту 80 и напечатает пароль администратора. Пункты 7–9 части B (брандмауэр, подключение, что учесть) относятся и к этому способу, только порт — 80. Резервные копии и обновление — те же скрипты, что на сервере (`./deploy/scripts/backup.sh`, `update.sh`).

## B. Без Docker

### 1. Установить программы

1. Node.js 22 LTS — <https://nodejs.org> (установщик для Windows, x64).
2. PostgreSQL 16 — <https://www.postgresql.org/download/windows/> (установщик EDB). Запомните пароль пользователя `postgres`, порт оставьте 5432.
3. Git for Windows — <https://git-scm.com/download/win>. На шаге «Configuring the line ending conversions» выберите **Checkout as-is, commit as-is**, иначе скрипты сломаются.

Дальше все команды вводите в **Git Bash** (Пуск → Git Bash), а не в «Командной строке» и не в PowerShell (кроме пункта 7).

### 2. Настроить npm и скачать код (один раз)

```bash
npm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"

cd ~
git clone -c core.autocrlf=false https://github.com/masahaka229/doska.git
cd doska
git checkout stage-1-architecture
```

### 3. Создать базу данных

Замените `придумайте_пароль` своим паролем для базы (латиница и цифры). Обе команды спросят пароль `postgres` из установщика.

```bash
PSQL="/c/Program Files/PostgreSQL/16/bin"
"$PSQL/psql" -U postgres -c "CREATE USER doska WITH PASSWORD 'придумайте_пароль' CREATEDB;"
"$PSQL/createdb" -U postgres -O doska doska
```

### 4. Файл настроек `.env`

1. Узнайте сетевой адрес компьютера командой `ipconfig` («IPv4-адрес», например 192.168.1.50).
2. Получите случайную строку для `JWT_ACCESS_SECRET`: `openssl rand -base64 48`.
3. Создайте `.env` **этой командой** (не Блокнотом — он испортит концы строк), подставив пароль базы, случайную строку, свой IP и пароль администратора (буквы и цифры, без слова `admin` внутри):

```bash
cat > .env <<'END'
NODE_ENV=production
DATABASE_URL=postgresql://doska:придумайте_пароль@localhost:5432/doska?schema=public
JWT_ACCESS_SECRET=ВСТАВЬТЕ_СЛУЧАЙНУЮ_СТРОКУ
PUBLIC_ORIGIN=http://192.168.1.50:5173,http://localhost:5173
COOKIE_SECURE=false
SEED_ADMIN_LOGIN=admin
SEED_ADMIN_PASSWORD=Пароль2026доска
END
```

`PUBLIC_ORIGIN` — адреса, по которым открывают сайт: запросы с других адресов сервер отклоняет. `COOKIE_SECURE=false` нужен, потому что в локальной сети сайт работает по HTTP.

### 5. Установка и сборка

Один раз и после каждого обновления кода:

```bash
npm install
npm run build
npm run db:migrate
npm run db:seed     # создаёт администратора и встроенные шаблоны (повторять безопасно)
```

### 6. Запуск: два окна Git Bash

Окно 1 — сервер:

```bash
cd ~/doska/backend && sh scripts/with-env.sh node dist/src/main.js
```

Окно 2 — сайт для локальной сети:

```bash
cd ~/doska/frontend && npx vite preview --host 0.0.0.0 --port 5173
```

Оба окна должны оставаться открытыми, пока идёт работа. Остановить — Ctrl+C в каждом окне.

### 7. Брандмауэр и сеть

- При первом запуске Windows спросит про доступ для Node.js — разрешите для **частных** сетей.
- Тип сети должен быть «Частная» (Параметры → Сеть и Интернет → свойства подключения). В «Общедоступной» сети другие устройства подключиться не смогут.
- Если окно брандмауэра не появилось, откройте порт вручную — PowerShell от имени администратора:

```powershell
New-NetFirewallRule -DisplayName "Учебная доска" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Private
```

(для способа A — порт 80). На время занятий отключите спящий режим (Параметры → Система → Питание и спящий режим).

### 8. Подключение людей

1. На этом компьютере откройте `http://192.168.1.50:5173` (ваш IP), войдите как `admin` и смените пароль.
2. В панели администратора создайте учителей и учеников — по одному или импортом CSV. Система выдаст логины и временные пароли.
3. Остальные открывают тот же адрес со своих устройств в той же сети и входят под своими логинами.

### 9. Что учесть

- Адрес может меняться: роутер может выдать компьютеру другой IP после перезагрузки. Тогда исправьте его в `PUBLIC_ORIGIN` (`.env`) и перезапустите окно 1. Лучше закрепить адрес за компьютером в настройках роутера.
- Работа идёт без HTTPS: пароли передаются по сети открыто. Для занятий в классе это терпимо; для работы через интернет нужен сервер с HTTPS.
- Кнопка «Скопировать» у временного пароля в админке по HTTP не работает — перепишите пароль вручную.
- Распознавание рукописных формул выключено (нужен отдельный сервис).
- Данные хранятся на этом компьютере: в базе PostgreSQL и в папке `doska\backend\data\uploads` (картинки, PDF). Резервная копия — эта папка и выгрузка базы:

```bash
"/c/Program Files/PostgreSQL/16/bin/pg_dump" -U doska -d doska -f ~/doska-backup.sql
```

### 10. Обновление

Остановите оба окна (Ctrl+C), затем:

```bash
cd ~/doska
git pull
npm install
npm run build
npm run db:migrate
```

и снова запустите оба окна (пункт 6).
