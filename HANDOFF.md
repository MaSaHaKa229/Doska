# HANDOFF — «Учебная доска»

## 1. Цель

Веб-приложение «Учебная доска»: бесконечная доска для совместных занятий учителя и учеников по математике и физике, от 5–11 классов до вуза. Полное ТЗ пользователь прислал в первом сообщении; пересказ по блокам — в `docs/ROADMAP.md`. Работа строго поэтапная (этапы 1–9).

**Правила работы, заданные пользователем:**
- один этап или подэтап за ответ; этапы 6 и 7 — по одному подразделу;
- в начале ответа — пункты ТЗ этапа;
- без заглушек и TODO; всё, что откладывается, явно называется с номером этапа;
- после каждого этапа приложение собирается и запускается;
- в конце ответа — чек-лист, команды, план следующего этапа;
- затем ждать «Продолжай».
- Весь текст — на русском: интерфейс, комментарии в коде, коммиты.

**Как начать новую сессию (по порядку):**
1. Прочитать этот файл целиком, затем `docs/ROADMAP.md` (что сделано и что дальше) и `docs/PLUGINS.md` (как устроены разделы-плагины).
2. Поднять окружение и убедиться, что всё зелёное (раздел 6): `service postgresql start`, `npm install && npm run build:shared`, `npm run check`.
3. Следующий шаг — по просьбе пользователя: план (этапы 1–9) выполнен. Этап 9 завершён, математика 6.1–6.5 завершена. Физика закончена: этапы 7.1–7.5 и 7.8 завершены, 7.6 и 7.7 пользователь пропустил (см. «Решено пользователем», п. 0). Этап 6.5 пользователь отложил до окончания физики. Текста ТЗ по физике в репозитории нет (только краткий пересказ): план каждого раздела физики предлагать пользователю и начинать после «Продолжай».
4. Работать по правилам выше; в конце каждого подэтапа обновлять этот файл (таблица коммитов, «Что вошло», «Где остановились», «Что осталось»), коммит кода, затем коммит `HANDOFF.md` с хешем.

## 2. Что сделано

Ветка `stage-1-architecture`; последний коммит кода — `ef4d64b` (этап 9b), затем коммит с `HANDOFF.md`. Ветка `main` указывает на коммит этапа 1 (`21e5b4a`). Открыт пулл-реквест #1 `stage-1-architecture` → `main` — в нём все этапы со 2.1 по 7.8b, 6.5a–6.5e, 8 и 9 (описание PR на GitHub не обновлялось с этапа 3.3; обновлять — только по просьбе пользователя).

| Этап | Коммит | Основные файлы |
|---|---|---|
| 1. Архитектура, схема БД, модель объектов, плагины, протокол | 21e5b4a | `docs/*.md`, `backend/prisma/schema.prisma`, `packages/shared/src/{board,permissions,protocol,plugins}` |
| 2.1. Авторизация, безопасность, сид | 0c09fc8 | `backend/src/{app,main}.ts`, `backend/src/{config,common,auth,health}/`, `backend/prisma/{migrations,seed.ts}`, `packages/shared/src/api/{auth,errors}.ts` |
| 2.2. API панели администратора | d0a0559 | `backend/src/{users,classes,admin}/`, `packages/shared/src/api/{admin,csv,translit}.ts` |
| 2.3. Фронтенд: вход, смена пароля, админка | 7ebd548 | `frontend/src/{api,app,store,ui,lib,styles}/`, `frontend/src/pages/{LoginPage,ChangePasswordPage,HomePage}.tsx`, `frontend/src/pages/admin/*` |
| 3.1. Доски, папки, сервер реального времени | 01efee1 | `backend/src/boards/`, `backend/src/realtime/{guard,room,server,persistence,connection,doc,rate-limit}.ts`, `frontend/src/pages/boards/` |
| 3.2. Ядро холста | f268dd7 | `frontend/src/{collab,canvas,objects,tools,plugins}/`, `frontend/src/pages/board/` |
| 3.3. Присутствие, офлайн, привязки, Ctrl+K, справка | 505e9f3 | `frontend/src/collab/{presence,people}.ts`, `frontend/src/canvas/snapping.ts`, `frontend/src/pages/board/{PresenceUi,ViewMenu,Palette,boardCommands}.tsx`, эндпоинт `GET /api/boards/:id/people` |
| 4.1. Уроки и права учителя | 5c1abc8 | `backend/src/realtime/lesson.ts`, `room.ts`; `GET /api/directory/users`, `mode` в `PATCH /api/boards/:id`; `frontend/src/pages/board/{LessonUi,LaserLayer,useFollow}.tsx`, `frontend/src/pages/boards/AccessDialog.tsx`, `frontend/src/collab/{laser,follow}.ts`, `frontend/src/tools/availability.ts`, `e2e/` |
| 4.2. Задания, главная ученика, миниатюры | 1079aab | `backend/src/assignments/`, `backend/src/boards/work-info.ts`, `backend/src/realtime/state.ts`, `?lite=1` в `realtime/{server,room}.ts`; `frontend/src/pages/assignments/`, `frontend/src/pages/board/WorkBar.tsx`, `frontend/src/canvas/BoardThumbnail.tsx`, `frontend/src/ui/Thumbs.tsx`, `e2e/assignments.cjs` |
| 5.1. Рисование: перо, маркер, ластик, распознавание фигур | a8b7309 | `frontend/src/objects/stroke/{geometry,stroke}.ts(x)`, `frontend/src/tools/draw-tools.tsx`; расширен `ToolContext` (`packages/shared/src/plugins/types.ts`); `e2e/drawing.cjs` |
| 5.2a. Файлы: хранилище, картинки, PDF как фон | 0748405 | `backend/src/assets/{storage,sniff,assets.service,assets.routes}.ts`; `frontend/src/media/{prepareImage,imageCache,insert,pdf}.ts`, `frontend/src/objects/image.tsx`, `frontend/src/canvas/PdfBackground.tsx`, `frontend/src/pages/board/MediaUi.tsx`, `frontend/src/tools/media-tool.tsx`; `e2e/media.cjs` |
| 5.2b. Текст: форматирование, формулы, таблицы | c8961a3 | `frontend/src/text/{schema,render}.ts`, `frontend/src/objects/text.tsx`, `frontend/src/pages/board/TextEditor.tsx`, `frontend/src/tools/text-tool.tsx`; `ObjectModule.applyResize`; `e2e/text.cjs` |
| 5.3a. Формулы: MathLive, палитра, «Решение» | 88f4e93 | `frontend/src/formula/{palette,mathlive,FormulaDialog,latex-to-mathjs,check}.ts(x)`, `frontend/src/objects/{formula,solution}.tsx`, `frontend/src/tools/formula-tools.tsx`, `frontend/src/pages/board/FormulaEditors.tsx`; плагин шрифтов MathLive в `frontend/vite.config.ts`; `e2e/formula.cjs` |
| 5.3b. Калькулятор, распознавание рукописных формул | ac1476a | `frontend/src/formula/{calc,handwriting}.ts`, `frontend/src/objects/calc.tsx`, `frontend/src/pages/board/{CalcPanel,recognize,useOcrEnabled}.ts(x)`, `frontend/src/api/formula.ts`; `backend/src/formula/ocr.{service,routes}.ts`; `services/formula-ocr/`, `docker-compose.yml` (профиль `ocr`); `e2e/calc.cjs` |
| 6.1a. Планиметрия: точки, фигуры, динамическая геометрия | 6b27afd | `frontend/src/math/planimetry/{plugin.ts,objects.tsx,tools.tsx,geometry.ts}`; граф зависимостей в `frontend/src/collab/model.ts`; `derived`/`hitPriority`/`unbounded`, `ToolContext.listObjects` в `packages/shared/src/plugins/types.ts`; раздел-кнопка в `pages/board/Panels.tsx`; `e2e/planimetry.cjs` |
| 6.1b. Построения, преобразования, отметки | 1371cc6 | `frontend/src/math/planimetry/{eval.ts,constructions.tsx}`, расширены `objects.tsx`, `geometry.ts`; `BoardPlugin.sections`, `ToolContext.getSelection`; ручки объектов с приоритетом без выделения (`BoardStage.handleAt`); `e2e/constructions.cjs` |
| 6.1c. Линейка, транспортир, циркуль | cc9abef | `frontend/src/math/planimetry/drafting.tsx`; `ObjectModule.guides`/`finishHandle`, `ToolContext.guides` (`packages/shared/src/plugins/types.ts`); перо вдоль края (`tools/draw-tools.tsx`); `e2e/drafting.cjs` |
| 6.2a. Графики: оси, кривые, слайдеры, таблица, числовая прямая, тригокружность | e011d8f | `frontend/src/math/analysis/{plugin.ts,expr.ts,plot.ts,objects.tsx,editor.tsx,tools.tsx}`; `BoardPlugin.editors`, `EditorContext`, `ObjectModule.moveDeps`; `pages/board/PluginEditors.tsx`; `e2e/graphs.cjs` |
| 6.2b. Анализ на графике | d607676 | `frontend/src/math/analysis/{calculus.ts,features.tsx,calculus-tools.tsx}`, `derivatives` в `expr.ts`; `e2e/calculus.cjs` |
| 6.3a. Аналитическая геометрия | 184383e | `frontend/src/math/analytic/{plugin.ts,eqs.ts,objects.tsx,editor.tsx,tools.tsx}`; `e2e/analytic.cjs` |
| 6.3b. Линейная алгебра | 9e20eb7 | `frontend/src/math/linalg/{plugin.ts,rational.ts,linalg.ts,objects.tsx,editor.tsx,tools.tsx}`; `e2e/linalg.cjs` |
| 6.4a. Стереометрия: сцена и тела | c8fb81b | `frontend/src/math/stereo/{plugin.ts,solids.ts,objects.tsx,editor.tsx,three-view.tsx,tools.tsx}`; `BoardPlugin.viewers`, `PluginEditorProps.readOnly/subscribeObject` (`packages/shared/src/plugins/types.ts`, `pages/board/PluginEditors.tsx`); `three@0.184.0`; `e2e/stereo.cjs` |
| 6.4b. Стереометрия: построения в пространстве | a661e3c | `frontend/src/math/stereo/{space.ts,space-panel.tsx,net.ts,nets.tsx,flat.ts}`, правки `solids.ts` (`ExtraLayer`, `convexPolyhedron`, `keyPoints`), `editor.tsx`, `tools.tsx`; запись `v` при миграции (`collab/model.ts`); `e2e/stereo-space.cjs` |
| 7.1a. Физика: векторы, тела, опоры, оси, масштаб | 4843e63 | `frontend/src/physics/common/{plugin.ts,quantities.ts,vectors.tsx,bodies.tsx,axes.tsx,editor.tsx,tools.tsx}`; `e2e/physics-common.cjs` |
| 7.1b. Физика: «Дано / СИ / Решение», постоянные, графики | 09e8a45 | `frontend/src/physics/common/{si.ts,constants.ts,given.tsx,given-editor.tsx,graph.tsx}`; `frontend/src/formula/units.ts` (вынесено из `calc.ts`); подписи осей `xLabel`/`yLabel` в `math/analysis`; `getMath` в `math/analysis/expr.ts`; `e2e/physics-given.cjs` |
| 7.2a. Механика: кинематика и анимации | 9e3f073 | `frontend/src/physics/mechanics/{plugin.ts,playback.ts,kinematics.ts,objects.tsx,editor.tsx,tools.tsx}`; кнопки панели свойств (`InspectorField` `action`, `ObjectModule.runAction`, `ActionContext` в `packages/shared/src/plugins/types.ts`; `pages/board/{InspectorFields,Panels,PluginEditors}.tsx` — `makeEditorContext`); `differentiate` в `math/analysis/expr.ts`; `e2e/physics-motion.cjs` |
| 7.2b. Механика: динамика, сохранение, статика | 8f2a885 | `frontend/src/physics/mechanics/{dynamics.ts,machines.tsx}`, `tools.tsx`; `placeGraphs` догружает math.js сам (`objects.tsx`); `e2e/physics-dynamics.cjs` |
| 7.3a. Электростатика | 441955c | `frontend/src/physics/electricity/{plugin.ts,field.ts,objects.tsx,editor.tsx,tools.tsx}`; `e2e/physics-electro.cjs` |
| 7.3b. Цепи постоянного тока | 6149a95 | `frontend/src/physics/electricity/{circuit.ts,circuits.tsx}`, `tools.tsx`, `plugin.ts` (подраздел «Электрические цепи»); `e2e/physics-circuit.cjs` |
| 7.4. Магнетизм и индукция | 4fd8f78 | `frontend/src/physics/magnetism/{plugin.ts,magnet.ts,objects.tsx,tools.tsx}`; `e2e/physics-magnetism.cjs` |
| 7.5a. Колебания | a4f3075 | `frontend/src/physics/waves/{plugin.ts,osc.ts,objects.tsx,tools.tsx}`; `e2e/physics-oscillations.cjs` |
| 7.5b. Волны | 22f75e0 | `frontend/src/physics/waves/{wave.ts,wavemodules.tsx}`, `tools.tsx`, `plugin.ts`; `e2e/physics-waves.cjs` |
| 7.8a. Современная физика: относительность и кванты | 7dded39 | `frontend/src/physics/modern/{plugin.ts,quantum.ts,objects.tsx,tools.tsx}`; `frontend/src/physics/common/plot.tsx` и `sci`/`sup`/`seeded` в `common/quantities.ts` (вынесены из черновика `physics/thermo`); `e2e/physics-modern.cjs` |
| 7.8b. Атом и ядро | 1ebc8d3 | `frontend/src/physics/modern/{nuclear.ts,atoms.tsx}`, `tools.tsx`, `plugin.ts`; `e2e/physics-atom.cjs` |
| 6.5a. Функции нескольких переменных и векторный анализ | 352bcbc | `frontend/src/math/multivar/{plugin.ts,multivar.ts,objects.tsx,tools.tsx}`; `e2e/multivar.cjs` |
| 6.5b. Дифференциальные уравнения | 210c833 | `frontend/src/math/diffeq/{plugin.ts,diffeq.ts,objects.tsx,tools.tsx}`; экспорт общих частей `math/multivar/objects.tsx` (`PlaneFrame` с подписями осей, `map2`, `useCompiled`, `Lines`, `Status`, `boxed`, `rangeSchema`, `RANGE_FIELDS`); `e2e/diffeq.cjs` |
| 6.5c. Комплексные числа | 60729b4 | `frontend/src/math/complex/{plugin.ts,complex.ts,objects.tsx,tools.tsx}`; `e2e/complex.cjs` |
| 6.5d. Вероятность и статистика | bfa346e | `frontend/src/math/prob/{plugin.ts,prob.ts,objects.tsx,tools.tsx}`; `e2e/prob.cjs` |
| 6.5e. Дискретная математика | 17d5984 | `frontend/src/math/discrete/{plugin.ts,discrete.ts,objects.tsx,tools.tsx}`; `e2e/discrete.cjs` |
| 8.1a. Библиотека шаблонов | d8dc5ea | `packages/shared/src/api/templates.ts`, `packages/shared/src/templates/builtin.ts`; `backend/src/templates/{builtin,templates.service,templates.routes}.ts`, правки `boards.service.ts`, `assignments.service.ts`, `main.ts`, `prisma/seed.ts`; `frontend/src/api/templates.ts`, `frontend/src/pages/library/{LibraryPage,TemplateDialog}.tsx`, `frontend/src/templates/builtin.test.ts`; `e2e/library.cjs` |
| 8.1b. Справочник формул | 7c5cc5d | `frontend/src/formula/reference.ts`, `frontend/src/pages/board/ReferencePanel.tsx`, `referenceTool` в `tools/formula-tools.tsx`, команды справочника в `plugins/registry.ts`, обработка в `pages/board/FormulaEditors.tsx`; `e2e/reference.cjs` |
| 8.2a. Экспорт PNG, SVG, PDF | 1d32622 | `frontend/src/export/render.tsx`, `frontend/src/svgcanvas.d.ts`, `frontend/src/pages/board/ExportDialog.tsx`; команда в `boardCommands.ts`, Ctrl+Shift+E в `shortcuts.ts`, пункт в `ViewMenu.tsx`; зависимости `svgcanvas@2.6.0`, `jspdf@4.2.1`; `e2e/export.cjs` |
| 8.2b. История версий и восстановление | 9559f50 | `packages/shared/src/api/versions.ts`; `backend/src/realtime/restore.ts`, `backend/src/boards/{versions.service,versions.routes}.ts`; `frontend/src/api/versions.ts`, `fetchVersionSnapshot` в `api/assignments.ts`, `frontend/src/pages/board/VersionsPanel.tsx`, пункт в `ViewMenu.tsx`, команда в `boardCommands.ts`; `backend/test/versions.test.ts`, `e2e/versions.cjs` |
| 9a. Docker Compose, Nginx, HTTPS | 5b31264 | `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, `deploy/backend-entrypoint.sh`, `deploy/nginx/{doska-locations.conf,http.conf.template,https.conf.template,40-doska-config.sh}`, `deploy/scripts/https.sh`; `prisma` — в рабочих зависимостях бэкенда; `e2e/stack-smoke.cjs` |
| 9b. Скрипты развёртывания, README | ef4d64b | `deploy/scripts/{common,install,update,backup,restore,https,systemd}.sh`; `.env.example`; gzip в `deploy/nginx/doska-locations.conf`; `README.md` (переписан), `docs/USAGE.md` (описания разделов и API из старого README), `docs/WINDOWS.md`, правки `docs/ARCHITECTURE.md` |

Тесты: 76 в `packages/shared`, 124 в `backend`, 385 в `frontend`, 4 в `services/formula-ocr` (`npm run test:ocr`). Все проходят. Сквозные сценарии `e2e/lesson.cjs`, `e2e/assignments.cjs`, `e2e/drawing.cjs`, `e2e/media.cjs`, `e2e/text.cjs`, `e2e/formula.cjs`, `e2e/calc.cjs`, `e2e/planimetry.cjs`, `e2e/constructions.cjs`, `e2e/drafting.cjs`, `e2e/graphs.cjs`, `e2e/calculus.cjs`, `e2e/analytic.cjs`, `e2e/linalg.cjs`, `e2e/stereo.cjs`, `e2e/stereo-space.cjs`, `e2e/physics-common.cjs`, `e2e/physics-given.cjs`, `e2e/physics-motion.cjs`, `e2e/physics-dynamics.cjs`, `e2e/physics-electro.cjs`, `e2e/physics-circuit.cjs`, `e2e/physics-magnetism.cjs`, `e2e/physics-oscillations.cjs`, `e2e/physics-waves.cjs`, `e2e/physics-modern.cjs`, `e2e/physics-atom.cjs`, `e2e/multivar.cjs`, `e2e/diffeq.cjs`, `e2e/complex.cjs`, `e2e/prob.cjs`, `e2e/discrete.cjs`, `e2e/library.cjs`, `e2e/reference.cjs`, `e2e/export.cjs` и `e2e/versions.cjs` прошли в браузере (см. `e2e/README.md`; подряд все упираются в ограничение частоты входов — см. там же). После изменения ядра в 6.4b (`collab/model.ts`) прежние сценарии прогоняются повторно — все 14 (кроме `calc`, ему нужен подставной сервис распознавания) прошли.

**Что вошло в 9b (этап 9 завершён — весь план, кроме пропущенных пользователем 7.6 и 7.7, выполнен):**
- **Скрипты** (`deploy/scripts`, bash): `common.sh` — корень проекта, файл настроек `DOSKA_ENV_FILE` (по умолчанию `.env`), `compose()` с `--project-directory`, `--env-file` и `DOSKA_COMPOSE_ARGS` (проверка рядом с рабочей установкой: `-p doskatest`), `require_docker`, `require_env`, `wait_healthy` (до 3 мин, при неудаче — журнал сервера); `install.sh` (вопросы или ключи `--domain/--email` | `--ip`, `--admin-login/--admin-password` (иначе случайный по политике паролей), порты, `--ocr`, `--no-build`, `--force`; `.env` из `.env.example` через `set_kv`, права 600, случайные `POSTGRES_PASSWORD` и `JWT_ACCESS_SECRET`, `COMPOSE_PROFILES` (`tls` при домене, `ocr`), `S3_ENDPOINT` пуст; сборка, запуск, ожидание; при домене `https.sh`; итог с паролем) — **поправка:** генератор `tr < /dev/urandom | head` при `pipefail` завершал скрипт SIGPIPE (код 141) молча — `set +o pipefail` в подоболочке; `update.sh` (копия, `git pull --ff-only`, сборка, `up -d --remove-orphans`, ожидание, `image prune`; ключи `--no-backup/--no-pull/--no-build`); `backup.sh` (`pg_dump -Fc` из контейнера `db`, архив `/data/uploads` из контейнера сервера, копия `.env`, `info` с коммитом; `umask 077`; хранение `KEEP` последних, по умолчанию 14; каталог `BACKUP_DIR`); `restore.sh` (подтверждение «да» или `--yes`, сначала копия текущего, остановка `web`/`backend`, `pg_restore --clean --if-exists --single-transaction`, замена файлов через `compose run` сервера, запуск, ожидание; `.env` не трогает — для переноса); `https.sh` переведён на общий файл; `systemd.sh` (root; `doska.service` — `compose up -d`/`stop`, `doska-backup.service` и `.timer` ежедневно в `BACKUP_TIME`, по умолчанию 03:30, `Persistent`; `--remove`; `UNIT_DIR` для проверки).
- **`.env.example`:** `S3_ENDPOINT` по умолчанию пуст (было `http://localhost:9000` — сервер в контейнере искал бы несуществующий MinIO), `COMPOSE_PROFILES` (Compose читает его из `--env-file`: обычный `up -d` поднимает certbot/ocr).
- **Nginx:** gzip (основной скрипт 397 → 117 КБ), убран `expires` (давал второй `Cache-Control`).
- **Документация:** README переписан (возможности, установка на сервер, автозапуск, HTTPS позже, обслуживание — таблица команд, перенос, секреты в копиях, распознавание формул, хранилище, ссылки, разработка); прежние подробные разделы README (API, разделы досок, горячие клавиши, WebSocket) — без изменений в `docs/USAGE.md`; `docs/WINDOWS.md` — инструкция, отправленная пользователю (вариант B, без Docker) и вариант A — Docker Desktop + `install.sh --ip` (не проверялось на Windows); `ARCHITECTURE.md` — состав Compose и хранилище на диске.
- **Проверено** (Docker в этом окружении): `install.sh --ip … --no-build` в чистой копии проекта (`.env` 600, вход администратора по напечатанному паролю → «Придумайте свой пароль»), `update.sh --no-pull --no-build` (копия, `COMPOSE_PROFILES=tls` поднял certbot), `backup.sh`/`restore.sh` (имя пользователя и файлы возвращаются, лишние удаляются, копия перед восстановлением, `KEEP=2`), `systemd.sh` с `UNIT_DIR` (`systemd-analyze verify` без замечаний; сам systemd здесь не запущен), `stack-smoke` через Nginx с gzip. Тестовые установки и их тома удалены. `shellcheck` не запускался (загрузка внешних пакетов через npx запрещена правилами окружения) — только `bash -n`.

**Что вошло в 9a (9 разделён: 9a — контейнеры, Nginx, HTTPS; 9b — скрипты, автозапуск, README):**
- **Dockerfile** (многоэтапный): `build` — `npm ci` всего монорепо и `npm run build` на `node:22.21-bookworm-slim`; `backend` — на **полном** `node:22.21-bookworm` (в урезанном нет libssl, нужного движку Prisma; `apt` не нужен — в этом окружении прокси закрывает `deb.debian.org`, на обычном сервере это тоже лишняя зависимость), `npm ci --omit=dev` только для бэкенда и общего пакета, пользователь `node`, healthcheck `/api/health`, вход `deploy/backend-entrypoint.sh`: `prisma migrate deploy` → сид (`dist/prisma/seed.js`: первый администратор и встроенные шаблоны; при ошибке — понятное сообщение и выход) → сервер; `web` — `nginx:1.28.0-alpine` с `frontend/dist`. Образы: сервер ~2,1 ГБ (522 МБ сжато), сайт ~110 МБ. Необязательный секрет сборки `npm_ca` (сертификат прокси для npm) — только для окружений вроде этого.
- **docker-compose.yml** (проект `doska`): `db` (postgres:16.10-alpine, том `pgdata`, healthcheck), `backend` (`env_file: ${DOSKA_ENV_FILE:-.env}`, переопределены `DATABASE_URL` на `db`, `UPLOADS_DIR=/data/uploads` — том `uploads`, `TRUST_PROXY`, `HOST`/`PORT`; `init: true` — сигналы и зомби; ждёт здоровую базу), `web` (порты `HTTP_PORT`/`HTTPS_PORT`, тома certbot только чтение, ждёт здоровый сервер), `certbot` (профиль `tls`, `certbot/certbot:v4.2.0`, `renew` дважды в сутки), `formula-ocr` (профиль `ocr`, теперь только `expose` во внутреннюю сеть: `FORMULA_OCR_URL=http://formula-ocr:8502/predict`); ротация журналов json-file 10 МБ × 5. **Файлы — на диске (том), не MinIO:** сервер это умел («установка на один сервер»), меньше сервисов и проще резервные копии; S3 включается `S3_ENDPOINT` в `.env`.
- **Nginx** (`deploy/nginx`): общие правила `doska-locations.conf` — `/api/` и `/ws/` (WebSocket, таймаут 1 ч) к `backend:3000`, `/assets/` с долгим кешем, SPA с `no-cache`, заголовки (nosniff, SAMEORIGIN, Referrer-Policy, Permissions-Policy), `client_max_body_size 60m`; `http.conf.template` (HTTP + путь certbot) и `https.conf.template` (HTTP → 301 на HTTPS, 443 с HTTP/2, TLS 1.2/1.3); `40-doska-config.sh` выбирает HTTPS при `DOMAIN` и готовом сертификате, иначе HTTP, и раз в 6 ч перевыбирает и перечитывает (первый и продлённые сертификаты). Только IPv4-прослушивание: в контейнерах Docker IPv6 по умолчанию нет — `listen [::]` ронял Nginx. HSTS — переменной `$hsts` (свои `add_header` в location отменяют заголовки уровня server; для `/api` и `/ws` HSTS ставит сам сервер).
- **deploy/scripts/https.sh** — первый сертификат: сайт по HTTP, `certbot certonly --webroot` для `DOMAIN` и `LETSENCRYPT_EMAIL` из `.env`, перезапуск `web`, запуск продления.
- **.env.example** дополнен: `DOMAIN`, `LETSENCRYPT_EMAIL`, `HTTP_PORT`, `HTTPS_PORT`, пояснение про вход по IP (`PUBLIC_ORIGIN=http://IP`, `COOKIE_SECURE=false`).
- **Проверено здесь** (Docker-демон в этом окружении запускается: `dockerd &`; образы тянутся с Docker Hub через прокси): сборка обоих образов (`docker build --network host` с прокси-аргументами и `--secret id=npm_ca,src=/root/.ccr/ca-bundle.crt`), стек на порту 8080 с отдельным файлом настроек (`DOSKA_ENV_FILE`, `--env-file`, проект `-p doskatest`), миграции и сид в контейнере (12 шаблонов), `e2e/stack-smoke.cjs` (вход через Nginx, WebSocket за прокси, прямоугольник мышью сохранён на сервере и виден ученику, библиотека), HTTPS с самоподписанным сертификатом в томе letsencrypt (HTTP/2, 301 с HTTP, один HSTS), certbot стартует и останавливается, сервер останавливается по SIGTERM сразу. Пользователи для проверки — `e2e/setup.mts` с `DATABASE_URL` на IP контейнера базы. Обычные e2e-сценарии к рабочей сборке не применимы (нет `window.__doska`).
- Не проверено: настоящий выпуск сертификата Let's Encrypt (нужен домен), образ `formula-ocr`.

**Что вошло в 8.2b (этап 8 завершён):**
- **Схема БД не менялась:** `BoardVersion` (причины AUTO, MANUAL, BEFORE_RESTORE, BEFORE_CLEAR) с этапа 1; автоверсии и `BEFORE_CLEAR` уже писал сервер.
- **Восстановление** (`realtime/restore.ts`, `restoreFromState`): по `docs/SYNC_PROTOCOL.md`, раздел 12 — документ не заменяется; страницы, затем объекты: лишние удаляются, недостающие создаются, у совпадающих пишутся только различающиеся поля, поля, которых нет в версии, удаляются; `meta` не трогается; транзакция с `SERVER_ORIGIN` (без проверок охраны). Повторное восстановление той же версии ничего не меняет.
- **Сервис** `VersionsService` (право `restoreVersions`: владелец, соведущий, ученик в своём конспекте; иначе 403, чужая доска — 404): список (200 новых), документ версии, ручная версия (через комнату — свежайшее состояние, `persistence.createVersion('MANUAL')`), восстановление (комната берётся `realtime.acquire` и отпускается `release` — работает и для неоткрытой доски; `BEFORE_RESTORE` с подписью «Перед восстановлением: «…»», `Room.applyServerChange` — рассылка и запись; уведомление `notice`/`VERSION_RESTORED` всем; журнал `BOARD_VERSION_RESTORED` с числом изменённых страниц и объектов). Маршруты — `boards/versions.routes.ts`.
- **Клиент:** панель «История версий» (справа, как калькулятор): подпись и «Сохранить версию», список (дата, подпись или причина, причина, автор, число объектов), раскрытие — предпросмотр первой страницы по снимку версии (`BoardThumbnail` на отдельной модели) и «Восстановить эту версию» с подтверждением (текущее сохранится — можно отменить). Вход: меню «Вид» (только с правом) и Ctrl+K «История версий…». У ученика пункта нет.
- Тесты сервера: семантика восстановления, полный цикл с двумя участниками по WebSocket (уведомление, `BEFORE_RESTORE`, отмена восстановления), права, восстановление без открытой доски.

**Что вошло в 8.2a (8.2 разделён: 8.2a — экспорт, 8.2b — история версий):**
- **Отрисовка** (`export/render.tsx`): область — выделенные объекты или всё содержимое страницы с полями 24; рисуется вне экрана (`createRoot` в скрытом узле, `Stage` масштаба 1, слой: фон-бумага, сетка `drawBackground`, `ObjectView` объектов) на **снимке документа** (`snapshotModel`: копия Y.Doc и модель только для чтения — живая модель и её `resolve.zoom` не трогаются); ожидание: шрифты, несколько кадров и 700 мс (формулы растеризуются, картинки грузятся). Растр — `stage.toCanvas({ pixelRatio })` (сторона не больше 8000). Размеры, зависящие от зума камеры (наконечники стрелок `…/zoom`), берутся по текущему зуму доски — при сильно уменьшенном виде наконечники в файле крупнее.
- **SVG:** слой перерисовывается с подменой нативного контекста Konva на `svgcanvas.Context` (`setPixelRatio(1)`). Линии, фигуры, текст — векторно; формулы и картинки — встроенными изображениями. Поправка: svgcanvas в `save()`/`restore()` переключает текущий элемент на группу и теряет начатый контур (Konva вызывает `save()` перед обводкой с `strokeScaleEnabled: false` и `restore()` перед заливкой наконечника стрелки) — обёртки сохраняют текущий `path`. Сквозной тест проверяет число обводок в SVG.
- **PDF:** jsPDF, страницы JPEG (2×) на листах A4 (ориентация по содержимому, поля 10 мм, по центру) или по размеру содержимого (96 точек на дюйм); «Всю доску» — все страницы (пустые пропускаются).
- **Окно «Экспорт»**: формат, что сохранить (выделение / страница / вся доска для PDF), разрешение PNG 1×–3×, фон и сетка (PNG, SVG), лист PDF; ход работы для многостраничного PDF. Вход: меню «Вид» → «Экспорт…», Ctrl+Shift+E, Ctrl+K «экспорт». Доступно всем, кто видит доску. Имя файла: название доски — «стр. N» / «фрагмент стр. N».
- **Заметка для e2e:** безголовый Chromium заменяет кириллические имена blob-загрузок на «download» — сценарий проверяет содержимое файлов (сигнатуры, размеры PNG, обводки и `<image>` в SVG, число страниц PDF), имя проверяет юнит-тест `fileName`.
- `npm audit` после установки: предупреждения относятся к прежним зависимостям (decode-uri-component, deepmerge-ts, react-router, stream-json), не к svgcanvas и jspdf.

**Что вошло в 8.1b (этап 8.1 завершён):**
- **Данные** (`formula/reference.ts`): 14 тем (7 математики, 7 физики, включая оптику и термодинамику — как справку, хотя разделы 7.6 и 7.7 пропущены), около 130 формул: название, LaTeX, пояснение обозначений, ключевые слова; `searchReference` — все слова запроса, без различия ё/е, фильтр по теме. Кириллица в индексах — через `\text{}`. Тест разбирает каждую формулу KaTeX с `throwOnError`.
- **Панель** `ReferencePanel` (как калькулятор — справа, Esc закрывает, клавиши не уходят доске): поиск, тема (группы «Математика» и «Физика»), список с заголовками тем, формула в выключном режиме, пояснение, «На доску» — объект `core.formula` кеглем 28 цветом текущего пера в центре экрана (только с правом записи). Открывается инструментом «Справочник формул» (`core.reference`, группа «Формулы», иконка BookOpenText, без горячей клавиши, `requiresWrite: false`) через событие редактора `reference`.
- **Ctrl+K:** каждая формула справочника — команда вставки (раздел «Справочник · тема»), в базовом плагине рядом с палитрой формул.

**Что вошло в 8.1a (8.1 разделён: 8.1a — библиотека шаблонов, 8.1b — справочник формул):**
- **Схема БД не менялась:** модели `Template`, `TemplateShare`, вид доски `TEMPLATE` и правила прав (`resolveBoardRole`: автор — владелец, видимый шаблон учителю — viewer) были с этапа 1. Журнал: создание — `BOARD_CREATED` (kind TEMPLATE), открытие доступа — `TEMPLATE_SHARED`, удаление — `BOARD_DELETED`.
- **Общий пакет:** `api/templates.ts` — схемы создания, правки, списка, «использовать»; уровни (школа, олимпиада, вуз), видимость (встроенный, только мне, всем учителям, выбранным), `TEMPLATE_SECTIONS` — статический список разделов (страница библиотеки не грузит код разделов; тест сверяет названия с плагинами). `templates/builtin.ts` — 12 встроенных досок-задач (механика ×2, маятник, фотоэффект, атом Бора, графики с точками пересечения, сечение куба, седло, задача Коши, комплексные числа, полная вероятность и Байес, кратчайший путь): условие, объекты с props инструментов, зависимости номерами.
- **Сервер:** `templates/builtin.ts` — документ шаблона (страница, текст условия жирным заголовком, объекты; номера зависимостей → id) и `ensureBuiltinTemplates` (по `builtinKey`, владелец — первый администратор, который только смотрит; вызывается при запуске сервера и в сиде; без администратора — ничего). `TemplatesService`: список видимых (ученику — 403, администратору — все), раздел с подразделами («physics» → physics.*), поиск по названию, описанию и тегу; создание из любой видимой доски (кроме чужого конспекта) — копия текущего состояния (из комнаты), «выбранным» — только учителям; правка и удаление — автор (встроенные — 403), удаление уносит доску в корзину; «Создать доску» — копия в доску LESSON учителя, счётчик использований. Доски TEMPLATE не показываются в «Моих досках» (только с `kind=TEMPLATE`). Задание можно выдать из любого видимого шаблона (раньше требовалось право управлять доской).
- **Клиент:** ссылка «Библиотека» в шапке (учитель, администратор), страница `/library`: вкладки «Все / Встроенные / Мои / От коллег», поиск, раздел (группы и разделы), уровень, карточки с миниатюрой, бейджами, описанием, автором, числом использований и тегами; «Создать доску» (сразу открывает новую доску), «Открыть» / «Изменить доску», меню «Выдать заданием… / Описание и доступ… / Удалить». Окно `TemplateDialog` (сохранение и правка: название, описание, раздел, уровень, теги, кому виден, поиск учителей) — в меню доски в списке и в меню «Урок» на доске. У всех окон `Dialog` теперь `aria-labelledby` по заголовку.

**Что вошло в 6.5e (этап 6.5 и вся математика 6 завершены):**
- **Плагин `math.discrete`** («Дискретная математика», `dependsOn: math.multivar` — `Lines`, `boxed`; пошаговый показ — `physics/mechanics/playback.ts`), 4 инструмента щелчком.
- **Вычисления** (`discrete.ts`): рёбра текстом («AB 3, B-C, C D:2»; запятая перед цифрой — десятичная), списки смежности (соседи по алфавиту — обходы детерминированы), степени, компоненты, BFS, DFS, Дейкстра (расстояния, путь), Краскал, эйлеров путь/цикл (Хирхольцер, причины отсутствия); Pₙ, Aₙᵏ, Cₙᵏ, перечисление вариантов (с пределом), треугольник Паскаля; разбор логических формул (¬ ∧ ∨ ⊕ → ↔ и школьные «и/или/не», and/or/not/xor, &, |, !, ->, <->; приоритеты, ошибки скобок), таблица истинности, СДНФ, СКНФ, вид формулы; системы счисления 2–36 (развёрнутая запись, деление уголком, дробная часть умножением).
- **Объекты:** «Граф» (вершины A…Z тянутся без выделения, «＋ Вершина» / «− Вершина» — с удалением её рёбер, рёбра и веса, ориентированный; алгоритм: до первого пуска виден весь результат, «▶ По шагам» — по 0,9 с на шаг у всех; порядок посещения номерами, расстояния над вершинами, кратчайший путь красным, номера рёбер эйлерова пути), «Комбинаторика» (перестановки, размещения, сочетания из своих элементов с формулой и списком до 120 вариантов; треугольник Паскаля с выделенным Cₙᵏ), «Логика: таблица истинности» (таблица, F = 1 выделено, СДНФ, СКНФ, круги Эйлера — Венна для 1–3 переменных с закраской областей, где F = 1), «Системы счисления» (число, из какой, в какую; запись решения, таблица деления с остатками и стрелкой «читаем снизу вверх», дробная часть).

**Что вошло в 6.5d:**
- **Плагин `math.prob`** («Вероятность и статистика», `dependsOn: math.analysis`; анимация опытов — общим `physics/mechanics/playback.ts`, это просто модуль без регистрации плагина), 4 инструмента щелчком.
- **Вычисления** (`prob.ts`): генератор от зерна (серия опытов одинакова у всех), опыты монета / кубик / урна с возвращением и события, классическая вероятность; полная вероятность и Байес; Cₙᵏ, биномиальное, Пуассона, нормальное (erf по Абрамовицу — Стигану), равномерное — E, D, P(интервал), пределы рисунка; разбор данных (с «;» запятая — десятичная, «, » — разделитель, «5,7,8» — три числа), среднее, медиана, моды (нет моды, если все частоты равны), размах, дисперсия Σ(xᵢ − x̄)²/n, квартили (медианы половин), гистограмма.
- **Объекты:** «Опыт: частота и вероятность» (монета, кубик с точками или урна с шарами; серия N опытов за 10 с показа; последний исход, столбики частот исходов — благоприятные оранжевым, вероятности пунктиром; график частоты k/n события и линия P; кнопки пуск / сначала / «Новая серия» — новое зерно и сразу пуск), «Дерево вероятностей» (2–4 гипотезы, на ветвях P(Hᵢ) и P(A|Hᵢ), листья с произведениями, выделение пути гипотезы для формулы Байеса, предупреждение, если гипотезы не полная группа), «Распределение случайной величины» (столбики или кривая плотности, закраска интервала [от; до], линия E; по умолчанию μ = 5, σ = 1,5, a = 2, b = 8, чтобы интервал 4…6 был осмыслен для всех видов), «Статистика по данным» (данные текстом; гистограмма с числом интервалов, столбчатая — моды оранжевым, круговая с легендой до 12 значений, ящик с усами — min, Q₁, медиана, Q₃, max и среднее).

**Что вошло в 6.5c:**
- **Плагин `math.complex`** («Комплексные числа», `dependsOn: math.analysis, math.multivar` — общая координатная область с осями Re, Im), 2 инструмента щелчком.
- **Вычисления** (`complex.ts`): сумма, разность, произведение, частное (null при делении на ноль), сопряжение, модуль, аргумент в (−π; π], степень по Муавру, корни n-й степени; алгебраическая форма («3 + 2i», «−i»), углы долями π при кратности π/12 («−2π/3»), тригонометрическая и показательная формы; разбор условия на z через math.js с комплексными числами: |…| → abs, Re/Im/arg (и «Re z» без скобок), «и»/«или», двойные неравенства, ошибки (непарный модуль, неизвестное обозначение, не сравнение).
- **Объекты:** «Комплексная плоскость» (до 4 чисел z₁…z₄ векторами, тянутся без выделения с «круглым» шагом, «＋ Число» / «− Число»; действие на выбор: сумма и разность — параллелограмм и −z₂, произведение и частное — дуги аргументов z₁, z₂ и w, сопряжение — отражение, степень zⁿ, корни ⁿ√z₁ — окружность и правильный n-угольник; над рисунком три формы z₁, модуль и аргумент, результат и правило), «Множество на комплексной плоскости» (условие текстом, закраска по сетке 160 × 160 одной заливкой, граница — изолиния с уточнением точек делением пополам, цвет, подсказки записи).

**Что вошло в 6.5b:**
- **Плагин `math.diffeq`** («Дифференциальные уравнения», `dependsOn: math.analysis, math.multivar`), 3 инструмента щелчком.
- **Вычисления** (`diffeq.ts`): шаг Эйлера и Рунге — Кутты 4, интегральная кривая через точку в обе стороны (обрыв при уходе решения в бесконечность), значение решения задачи Коши в точке; особые точки системы методом Ньютона из узлов сетки и их тип по следу и определителю якобиана (седло, узлы, фокусы, центр, вырожденная), собственные числа; фазовые траектории Рунге — Куттой во времени вперёд и назад; y″ + py′ + qy = 0 — три случая корней, C₁ и C₂ из y(0), y′(0), общее решение записью и поведение.
- **Объекты** (на общей координатной области 6.5a): «Поле направлений» (штрихи наклона, интегральные кривые через до 8 перетаскиваемых точек A…H, кнопки «＋ Точка» / «− Точка», метод: Рунге — Кутта, Эйлер или «Сравнить оба» — Эйлер пунктиром, шаг h; y(x₀ + 1) обоими методами), «Фазовая плоскость» (поле направлений стрелками, траектории с начальными точками и стрелкой направления движения, особые точки значками ✕/●/○, список с типом и λ; по умолчанию — маятник с трением), «Уравнение y″ + py′ + qy = 0» (график y(t), начальная точка и касательная по y′(0), огибающая при затухающих колебаниях, характеристическое уравнение, корни, общее решение, C₁, C₂, поведение; p и q ползунками).

**Что вошло в 6.5a (6.5 разделён: 6.5a — многие переменные, 6.5b–6.5e — остальное):**
- **Плагин `math.multivar`** («Функции нескольких переменных», `dependsOn: math.analysis` — math.js, `prepare`, `differentiate`, `marchingSquares`, `niceStep`), 3 инструмента щелчком.
- **Вычисления** (`multivar.ts`): разбор f(x, y) («z =», «f(x, y) =», школьная запись; неизвестные обозначения — ошибка, «xy» — подсказка «пишите x·y»), частные производные символьно (численно — если не вышло), сетка значений, «круглые» уровни, линии уровня (marching squares), поле: div = ∂P/∂x + ∂Q/∂y, rot = ∂Q/∂x − ∂P/∂y и их смысл, линии тока (Рунге — Кутта 4 по длине дуги, в обе стороны), ортогональная проекция с глубиной, пределы z без выбросов (2 %), цвет по высоте.
- **Объекты:** «Поверхность z = f(x, y)» (свой рисунок без three.js: клетки сетки с освещением по нормали, от дальних к ближним — видимость без отдельного алгоритма; оси, «пол» с линиями уровня; поворот и наклон — ползунки прямо на рисунке, тянутся без выделения; точка M, касательная плоскость z = z₀ + fx(x − x₀) + fy(y − y₀) и градиент на полу; плоскость рисуется поверх поверхности), «Линии уровня и градиент» (область 380 × 380 с сеткой и делениями, заливка по высоте, подписи уровней по диагонали, поле градиентов, точка M тянется без выделения с округлением: градиент, касательная к линии уровня, частные производные записью и числом), «Векторное поле» (стрелки окраской по модулю, линии тока из 25 точек, точка M: вектор поля, контур с вращением — ротор, стрелки наружу/внутрь — дивергенция).

**Что вошло в 7.8b (этап 7.8 завершён, физика закончена — 7.6 и 7.7 пропущены пользователем):**
- **Формулы** (`nuclear.ts`): уровни водорода Eₙ = −13,6/n² эВ, переходы (λ, ν, серии Лаймана — Хамфри), rₙ = 0,053n² нм; опыт Резерфорда (наибольшее сближение d = k·2Ze²/E, угол tg(θ/2) = d/(2b), траектории численно скоростным Верле — совпадают с формулой); массы 36 нуклидов (атомные, а. е. м.), дефект масс Δm = Z·m(¹H) + N·mₙ − M, энергия связи (931,5 МэВ на а. е. м.); 9 радиоактивных изотопов (α и β⁻, периоды полураспада), N = N₀·2^(−t/T), продукты распада; разбор записи реакций («Li7 + p -> 2 He4», частицы p, n, a/α, d, t, e, e+, g/γ, неизвестное X): суммы зарядовых и массовых чисел, поиск X, выход Q по массам атомов.
- **Объекты** (`atoms.tsx`, в плагине `physics.modern`, ещё 5 инструментов — всего 9): «Атом водорода (модель Бора)» (орбиты не в масштабе, электрон на орбите, скачок и фотон цветом линии — излучение или «Поглощение»; диаграмма уровней со стрелкой перехода; линейчатый спектр видимой части с линиями Бальмера и отметкой), «Опыт Резерфорда» (21 траектория в окне 800 × 400 фм, частицы летят, ядро и окружность наибольшего сближения d, сколько отражено назад), «Ядро и энергия связи» (нуклоны спиралью — протоны и нейтроны, обозначение ᴬ_Z X, расчёт Δm и E_св, кривая удельной энергии связи по всем нуклидам с отметкой), «Радиоактивный распад» (ядра на рисунке распадаются в своё «случайное» время — одинаково у всех, кривая N(t) с текущей точкой, уравнение распада), «Ядерная реакция» (уравнение с числами A и Z, X подсвечен, проверки ✓/✗, Q; кнопки готовых реакций: литий + протон, открытие протона и нейтрона, деление урана, синтез d + t).
- Обозначение нуклида `NuclideLabel` и уравнение `Equation` — в `atoms.tsx` (понадобятся, например, для справочника формул 8.1).

**Что вошло в 7.8a (7.8 разделён: 7.8a — относительность и кванты, 7.8b — атом и ядро; 7.6 и 7.7 пропущены пользователем):**
- **Плагин `physics.modern`** («Современная физика», `dependsOn: physics.common, physics.mechanics, physics.waves`), 4 инструмента щелчком.
- **Формулы** (`quantum.ts`): γ = 1/√(1 − v²/c²), Δt = γΔt₀, l = l₀/γ, E₀ = mc², E = γmc², Eₖ = (γ − 1)mc², сложение скоростей; фотоэффект (hν = A + Eₖ, работы выхода 9 металлов, U₃, красная граница, качественная ВАХ с насыщением ∝ интенсивности); фотон (ν, E, p, m = E/c²), диапазоны шкалы ЭМ-волн, цвет по длине волны; де Бройль (λ = h/p, релятивистский импульс при v > 0,1c, скорость после разгона qU).
- **Объекты:** «Теория относительности» (ракета летит по дорожке и укорочена в γ раз, рядом пунктиром — она же в покое; часы Земли и часы в ракете, отстающие в γ раз; график γ(v/c) с курсором), «Фотоэффект» (колба с катодом и анодом, свет цветом длины волны, фотоэлектроны с анимацией — разгоняются или тормозятся напряжением и возвращаются при eU > Eₖ; графики Eₖ(ν) с красной границей и продолжением до −A и ВАХ I(U) с точкой −U₃), «Фотон и шкала электромагнитных волн» (логарифмическая шкала 10⁻¹⁴…10⁴ м, видимая часть крупно; отметка тянется без выделения), «Волны де Бройля» (частица с волновым пакетом, шкала размеров ядро — атом — свет — клетка с отметкой λ, вывод о заметности дифракции).
- **Общее:** компонент диаграмм по точкам `Plot` (`physics/common/plot.tsx`: оси через ноль, закраски, точки с проекциями и подписями значений) и запись чисел `sci` («6,21·10⁻²¹»), `sup`, `seeded` перенесены в `physics/common` из черновика термодинамики.

**Что вошло в 7.5b (этап 7.5 завершён):**
- **Формулы** (`wave.ts`): бегущая s(x, t) = A sin(ωt − kx), ν = v/λ; стоячая на струне (λ = 2L/n, ν = nv/(2L), узлы и пучности, y = 2A sin kx cos ωt); интерференция (разность хода Δ, интенсивность cos²(πΔ/λ), условие максимума Δ = kλ и минимума Δ = (k + ½)λ, число максимумов на линии источников); звук (λ = v/ν при v = 340 м/с, инфра- и ультразвук, высота тона).
- **Объекты** (`wavemodules.tsx`, в том же плагине `physics.waves`, ещё 4 инструмента): «Бегущая волна» (частицы среды, выделенная частица колеблется на месте; переключатель «Продольная» — сгущения и разрежения и график s(x); λ, v; быстрые волны показываются замедленно), «Стоячая волна» (струна, огибающая, узлы, гармоника n ползунком), «Звук» (громкоговоритель, график давления на 3 периода, кнопка «🔊 Послушать» — тон через Web Audio звучит только у нажавшего; вне 20 Гц — 20 кГц — сообщение), «Интерференция волн» (картина интенсивности клетками 6 пикс., гребни волн окружностями с анимацией, источники S₁ и S₂, точка M тянется без выделения, Δ в долях λ и вывод «максимум/минимум»).

**Что вошло в 7.5a (7.5 разделён: 7.5a — колебания, 7.5b — волны):**
- **Плагин `physics.waves`** («Колебания и волны», `dependsOn: physics.common, physics.mechanics, physics.electricity`), 4 инструмента щелчком.
- **Формулы** (`osc.ts`): маятник (малые колебания, T = 2π√(l/g), натяжение m(g cos θ + v²/l)), затухающие (β = b/2m, ω_d = √(ω₀² − β²), апериодический режим), вынужденные (A(ω) = F₀/m / √((ω₀² − ω²)² + 4β²ω²), фаза, резонанс при √(ω₀² − 2β²)), биения (|ν₁ − ν₂|), контур (T = 2π√(LC), q, i, энергии W_C + W_L = const).
- **Объекты:** «Математический маятник» (нить, дуга размаха, силы mg и T, скорость; «Графики» x(t), v(t)), «Затухающие и вынужденные колебания» (груз на пружине; переключатель «Вынужденные»: график x(t) с огибающей или резонансная кривая A(ω) с отметкой текущей частоты; ω/ω₀ ползунком), «Сложение колебаний» (три графика x₁, x₂, x₁ + x₂ с курсором времени), «Колебательный контур» (схема C и L, знаки заряда на пластинах по q, ток стрелкой по i, столбики энергий Wэл, Wмаг, W, график q(t) и i(t); быстрые колебания показываются замедленно — 4 с на период; «Графики» q(t), i(t)).
- **Общее:** встроенный график `MiniPlot` (оси, кривые, курсор) — для объектов, где обычные графики 6.2 не нужны.

**Что вошло в 7.4 (этап выполнен одним подэтапом):**
- **Плагин `physics.magnetism`** (`dependsOn: physics.common, physics.mechanics, physics.electricity` — воспроизведение и «Графики» механики, расчёт силовых линий электростатики), подраздел «Магнетизм», 7 инструментов щелчком.
- **Направления** (`magnet.ts`): координаты доски x вправо, y вниз, z — от зрителя; «на нас» (точка) — B = −z, «от нас» (крестик) — +z; сила q·v × B и I·L × B (`crossZ`) — это и есть правило левой руки; касательная к линиям прямого тока по правилу буравчика (`wireTangent`).
- **Объекты:** «Прямой ток» (точка/крестик, концентрические линии со стрелками, число линий), «Катушка с током» (витки точками и крестиками, линии поля внутри и снаружи, полюса N/S по направлению тока), «Постоянный магнит» (полюса цветом, линии поля из N в S — двумя «магнитными зарядами» в полюсах через `fieldLines` 7.3a), «Заряд в магнитном поле» (электрон, протон, α-частица; поле точками/крестиками; движение по окружности с анимацией — один оборот показывается за 4 с, сведения — настоящие r = mv/(|q|B), T = 2πm/(|q|B), F = |q|vB; v и Fл в каждый момент), «Проводник в магнитном поле» (F_A = BIL, направление тока, сила), «Рамка в магнитном поле» (вращение, ширина рамки ∝ |cos ωt|, Φ = BS cos ωt, ε = NBSω sin ωt, направление тока; при частоте больше 1 об/с показ замедлен; «Графики» Φ(t) и ε(t)), «Правило Ленца» (магнит приближается к кольцу и удаляется; ток в кольце и полюса кольца: при приближении — одноимённый, отталкивает; при удалении — разноимённый, притягивает).

**Что вошло в 7.3b (этап 7.3 завершён):**
- **«Электрическая цепь»** (`physics.electricity.circuit`): до 60 элементов внутри одного объекта (как система зарядов). Элемент соединяет два узла сетки (клетки, начало — в узле сетки): провод, источник ЭДС (плюс — у конца b, внутреннее сопротивление r), резистор, реостат, лампа (номинальная мощность Pном), ключ, амперметр, вольтметр. Подраздел «Электрические цепи» (`BoardPlugin.sections`), 8 инструментов: протяжка от узла к узлу по горизонтали или вертикали, щелчок — 3 клетки вправо; начатый в области схемы элемент добавляется в неё, иначе — новая схема.
- **Расчёт** (`circuit.ts`, метод узловых потенциалов): провода и замкнутые ключи сливают узлы (union-find); резисторы, лампы, реостаты — проводимости; амперметр — 10⁻⁴ Ом; вольтметр и разомкнутый ключ — без тока; источник — эквивалент «ток E/r + проводимость 1/r» (идеальный — r = 10⁻⁴ Ом); утечка 10⁻⁹ См на каждый узел — изолированные части не делают систему вырожденной; метод Гаусса с выбором главного элемента. Короткое замыкание идеального источника (ток > 1000 А) — сообщение красным; разрыв — «Цепь разомкнута — тока нет»; для одного источника — I и внешнее сопротивление.
- **На схеме:** условные обозначения (резистор — прямоугольник, реостат — со стрелкой, лампа — круг с крестом и свечением по P/Pном, источник — длинная и короткая пластины с «+», ключ — разомкнутый/замкнутый, приборы — круги A и V с показаниями), имена R₁, L₁, ε₁, K₁, A₁, V₁ с номиналами, ток на элементе (зелёная стрелка и «I, U»), точки соединения в узлах с тремя элементами и больше; подписи вертикальных элементов — слева и справа, без наложения.
- **Ключ — щелчком:** ручка ключа (`hitPriority`, без выделения схемы), переключение в `finishHandle` — жест ручки начинается с `stopCapturing`, поэтому щелчок без перетаскивания — свой шаг отмены. Двойной щелчок по схеме — диалог элементов (ЭДС, r, R, Pном, ключи, удаление; «Удалить все провода»).
- **Попутно:** конфликт имён `x.ts` / `x.tsx` в одной папке (импорт `./x` берёт `.ts`) — интерфейсные части называются иначе (`machines.tsx`, `circuits.tsx`).

**Что вошло в 7.3a (7.3 разделён: 7.3a — электростатика, 7.3b — цепи):**
- **Плагин `physics.electricity`** (`dependsOn: ['physics.common']`, подраздел «Электричество»).
- **«Система зарядов»** (`physics.electricity.charges`): до 12 точечных зарядов (нКл) внутри одного объекта — как 3D-сцена: иначе удаление заряда удаляло бы зависящее от него поле. Масштаб «1 клетка = `cell` см», ε среды. Заряды и пробная точка — ручки, тянутся без выделения (`hitPriority`), объект «берётся» за заряды, край рамки и строку сведений (пустое поле внутри рамки прозрачно для щелчков). Рамка растягивается.
- **Расчёт** (`field.ts`, чистые функции): E и φ в точке (сумма полей), силы Кулона (третий закон Ньютона), силовые линии (метод средней точки, шаг 4 пикс., из зарядов знака, которого суммарно больше; линии из отрицательных разворачиваются, чтобы стрелки шли по полю; число линий ∝ |q|), эквипотенциали (marching squares, уровни — потенциалы на 1,5; 2,5; 4; 6 клетках от самого сильного заряда каждого знака), плоский конденсатор (C = εε₀S/d, E = U/d, q, W), запись с приставками («90 мкН», «17,7 пФ»).
- **На чертеже:** линии со стрелками, эквипотенциали (зелёные), силы F₁, F₂… (длина ∝ модулю), подписи q₁ = +5 нКл, пробная точка с E и φ, сведения: для двух зарядов — r, F = k|q₁q₂|/r² и «притягиваются/отталкиваются», иначе силы на каждый заряд.
- **Инструменты:** «Заряд +», «Заряд −» (|q| — на панели инструмента; щелчок в рамке системы добавляет заряд в неё, вне — создаёт новую систему; инструмент остаётся активным), «Плоский конденсатор» (S, d, U, ε на панели свойств; расстояние d — ручкой правой пластины, шаг 0,5 мм). Двойной щелчок по системе — диалог зарядов (величины, удаление, добавление, масштаб, ε).
- **Расчёт — в отрисовке с кэшем по props, без Web Worker:** для 12 зарядов линии и эквипотенциали считаются за миллисекунды (тест ограничивает 1,5 с с большим запасом). Инфраструктура `ObjectModule.compute` в ядре по-прежнему не реализована (`getComputed` возвращает undefined) — понадобится, если появятся по-настоящему тяжёлые расчёты.

**Что вошло в 7.2b (этап 7.2 завершён):**
- **Формулы** (`dynamics.ts`, чистые функции): наклонная плоскость (N = mg cos α; скольжение при tg α > μ, a = g(sin α − μ cos α), Fтр = μN, иначе трение покоя = mg sin α), блок с двумя грузами (a = (m₂ − m₁)g/(m₁ + m₂), T = 2m₁m₂g/(m₁ + m₂)), пружинный маятник (T = 2π√(m/k), x = A cos ωt, энергии Eк, Eп, E), столкновение шаров на прямой (упругое и неупругое, момент удара по касанию, импульс и энергия до и после), рычаг (M = mgl, равновесие или перевес).
- **Объекты** (`machines.tsx`, инструменты щелчком в подразделе «Механика»): «Наклонная плоскость» (брусок соскальзывает с анимацией, силы mg, N, Fтр, скорость, угол α, «Графики» s(t), v(t)), «Блок с грузами» (нить, натяжение T, силы тяжести, анимация), «Пружинный маятник» (пружина-зигзаг, положение равновесия, F = −kx и скорость, диаграмма энергий, «Графики» x(t), v(t)), «Столкновение шаров» (упругий/неупругий переключателем, скорости до и после, «в тепло …»), «Рычаг» (наклон к перевешивающему плечу, грузы, силы, плечи l₁, l₂ — ручками на концах с шагом 0,05 м). Параметры — на панели свойств; анимации — тем же воспроизведением 7.2a.
- **Попутно:** «Графики» у объектов без записей (пружина, плоскость) раньше требовали второго нажатия, пока грузится math.js; теперь графики появляются сами после загрузки — тоже одним шагом отмены.

**Что вошло в 7.2a (7.2 разделён: 7.2a — кинематика, 7.2b — динамика, законы сохранения, статика, вращение):**
- **Плагин `physics.mechanics`** (`dependsOn: ['physics.common']`, подраздел «Механика»).
- **Ядро — кнопки панели свойств:** `InspectorField` вида `action` и `ObjectModule.runAction(obj, key, ctx: ActionContext)`; панель вызывает действие для всех выделенных объектов типа одной транзакцией. Контекст записи для редакторов и действий — общий `makeEditorContext` (`pages/board/PluginEditors.tsx`).
- **Воспроизведение** (`playback.ts`): в props — `play: { running, t0, at }` (at — Date.now() нажавшего); текущее время `timeAt` считает каждый участник сам, `usePlayTime` перерисовывает каждый кадр, пока идёт. «▶ Пуск / пауза» (в конце — заново), «⟲ Сначала», «Скорость показа».
- **«Движение по закону»** (`physics.mechanics.motion`, диалог `physics.motion` с примерами: равномерное, равноускоренное, торможение, горизонтальный бросок, по окружности, колебания): x(t), y(t) по школьной записи (math.js — ленивый экземпляр 6.2), свои оси с делениями в метрах (шаг 1, 2, 5…), траектория пунктиром, пройденный путь, тело с подписью, скорость (перемещение за 0,5 с), строка «t, x, y, v».
- **«Бросок под углом»** (`physics.mechanics.throw`): v₀, α (ползунок), h₀, g, масштаб — на панели свойств; T, H, L по формулам; земля со штриховкой, отметки H и L, скорость и её проекции vx, vy в каждый момент.
- **«Графики»** (кнопка): движение — x(t) и vₓ(t) (символьная производная `differentiate`) или x(t) и y(t); бросок — y(t) и v_y(t); на осях 6.2 справа от чертежа, через `insertGraph` 7.1b, одним шагом отмены.
- **Решение — время по часам участников, а не через сервер:** в документ во время анимации ничего не пишется; расхождение у участников — на разницу их часов (обычно доли секунды). Синхронизацию часов с сервером можно добавить, если понадобится.

**Что вошло в 7.1b (этап 7.1 завершён):**
- **«Дано / Найти / Решение»** (`physics.common.given`, диалог `physics.given`, инструмент): величины (обозначение, значение, единица по-русски), столбец «СИ» (`si.ts`: кратные и внесистемные → основные единицы СИ того же рода: 500 г → 0,5 кг, 72 км/ч → 20 м/с, 1,5 атм → 152000 Па; уже в СИ — пусто), «Найти» (обозначение и ожидаемая единица), строки решения, формула ответа через обозначения «Дано». Значения подставляются в СИ (math.js с единицами), ответ переводится в ожидаемую единицу, размерность проверяется (`equalBase`): «a = 4 м/с² ✓» или «Размерность не сходится: получилось [кг²·м/с²], ожидалось [м/с²]». Постоянные (g, G, k, e, c, h…) в формуле подставляются сами, в «Дано» добавляются из списка.
- **Числа по-школьному:** «0,5», «1,6·10⁻¹⁹», «6,02·10^23»; вывод — 4 значащие цифры, очень большие и малые — со степенью десяти.
- **Физические постоянные** (`constants.ts`, 13 штук) — команды Ctrl+K раздела «Физические постоянные»: вставка формулой в центр экрана.
- **График зависимости** (`graph.tsx`, диалог `physics.graph`, инструмент): величина, её единица, аргумент, единица аргумента, зависимость «2 + 3t», промежуток; примеры (v(t), x(t), изотерма p(V), колебания). Создаёт оси 6.2 с подписями «t, с» и «v, м/с» (новые необязательные поля `xLabel`/`yLabel` у `math.analysis.axes`, на панели свойств — «Подпись x/y»), график (переменная заменяется на x целым словом, «3t» → «3x») и подпись-формулу — одной транзакцией.
- **Попутно:** русские единицы вынесены из калькулятора в `formula/units.ts` (без math.js — можно подключать в основной код); `ruUnitToEn`/`enUnitToRu` понимают «м/с²», «Н·м²/кг²», «Дж/(моль·К)», «моль⁻¹». Подпись оси x у нижнего края поднимается над подписями делений.
- **math.js — тот же ленивый экземпляр, что у графиков 6.2** (`getMath`, `useMathReady`): основной бандл не вырос; до загрузки блок «Дано» рисуется без столбца СИ и ответа (ширина столбца СИ зарезервирована, чтобы габарит не прыгал).
- **Ограничение:** обозначения в формулах — латиница и греческие буквы (math.js не разбирает кириллицу): «F_tr», а не «F_тр»; в векторах 7.1a кириллический индекс по-прежнему можно.

**Что вошло в 7.1a (7.1 разделён: 7.1a — векторы, тела, оси, масштаб; 7.1b — «Дано / Найти / Решение», константы, графики):**
- **Плагин `physics.common`** (подраздел «Физика: общее», 16 инструментов) — основа разделов 7.2–7.8: они будут объявлять `dependsOn: ['physics.common']`.
- **Вектор величины** (`physics.common.vector`): сила, скорость, ускорение, импульс, перемещение, напряжённость и «другая» величина — у каждой обозначение, единица и цвет по умолчанию (`quantities.ts`). Протяжка от точки приложения; начало привязывается к точкам тел (центр, середины граней, углы), опор и осей; привязка к сетке даёт целые клетки от точки приложения; Shift — угол кратен 15°, Alt — без привязки. Ручки: конец и точка приложения. Обозначение с индексом («F_тр»), стрелка над буквой. Значение «F = 6 Н» по масштабу (`perCell`).
- **Проекции на оси** (инструмент — щелчок по вектору): составляющие по осям ближайших на странице осей (повёрнутые оси — вдоль наклонной плоскости), пунктир от конца, подписи Fx, Fy и значения со знаком.
- **Сумма векторов** (`physics.common.sum`, производный объект): общая точка приложения у двух векторов — параллелограмм, иначе правило многоугольника (перенесённые копии пунктиром). Слагаемые — выделенные заранее или щелчками, Enter или щелчок мимо — готово.
- **Тела** (`physics.common.body`): брусок, шар, материальная точка; щелчок по опоре ставит тело на неё нижней гранью; растяжение меняет размеры. **Опоры** (`physics.common.support`): поверхность со штриховкой (поворотом — пол, стена, потолок, наклонная) и подвес; линия опоры — кривая привязки.
- **Оси координат** (`physics.common.axes`, поворачиваются) и **масштаб** (`physics.common.scale`, «F: 1 клетка — 2 Н»): диалог масштаба (`applyScale`) одной транзакцией меняет масштаб и значения всех векторов этой величины на странице; на странице один масштаб на величину.
- **Масштаб — без зависимостей (`deps`):** если бы векторы ссылались на масштаб, удаление масштаба удаляло бы и векторы (опора с построениями), а копия вектора тянула бы за собой масштаб. Поэтому масштаб хранится в каждом векторе, а диалог масштаба переписывает его у всех векторов величины.

**Что вошло в 6.4b (этап 6.4 завершён):**
- **Построения в props сцены** (схема версии 2, `migrate` для сцен 6.4a): до 64 точек и 64 построений (`space.ts`). Точка опирается на характерную точку тела (вершина, центр основания, вершина конуса, центр шара), на ребро (доля t), на грань (аффинные координаты — точка едет вместе с телом при его правке) или задаётся координатами. Построения: отрезок, прямая (продолжается за габарит сцены), плоскость (параллелограмм вокруг трёх точек), сечение тела плоскостью через три точки (многоугольник с заливкой; тела вращения — по многограннику из 72 граней с допуском видимости для хорд, шар — точный круг), расстояние (общий перпендикуляр рисуется толще) и угол — между точками, прямыми и плоскостями.
- **Значения «по-школьному»** (`surd`): 4√3/3 ≈ 2,31, √3/2, 60°, ≈ 35,3°. Подписи значений не налезают друг на друга.
- **Чертёж**: слой построений (`ExtraLayer`) идёт через тот же `drawScene` — видимость линий, пунктир, подписи; точка на вершине тела называется, как вершина, и не подписывается второй раз.
- **3D-редактор**: вкладки «Тела» и «Построения»; режимы «Вращать / Точка / Отрезок / Прямая / Плоскость / Сечение / Расстояние / Угол». В режиме построения щелчок выбирает (точка построения → вершина → отрезок или прямая → плоскость или сечение → ребро → видимая грань), протяжка по-прежнему вращает. Подсказка говорит, что выбрать дальше. Список точек (имя, опора, доля ребра t), точка по координатам, список построений (цвет, удаление вместе с зависящими). Удаление тела уносит его точки и построения на них.
- **Развёртка** (`math.stereo.net`, инструмент «Развёртка» — щелчок по телу в сцене): многогранники — вокруг основания (куб — «крест»), в том числе наклонные и со своим основанием (площадь развёртки равна площади поверхности); цилиндр, конус, усечённый конус — прямоугольник/сектор/кольцевой сектор и круги; у шара развёртки нет. Связана со сценой (`deps`): правка тела перестраивает развёртку.
- **«Плоский чертёж»** (инструмент; `flat.ts`): сцена в текущем виде — точки и отрезки планиметрии под сценой (невидимые — пунктиром, вершины и точки построений подписаны, концы кусков — невидимые опоры), кривые — ломаные/многоугольники до 40 опор. Всё одной транзакцией: Ctrl+Z убирает чертёж целиком.
- **Ядро, исправление:** при записи `props` объекта старой версии (после `migrate`) `BoardModel.updateObjects` теперь пишет и новую `v`. Раньше `v` оставалась старой и `migrate` вызывался при каждом чтении.

**Что вошло в 6.4a (6.4 разделён: 6.4a — сцена и тела, 6.4b — построения в пространстве):**
- **Плагин `math.stereo`**, объект `math.stereo.scene`: рамка `w × h`, вид (`yaw`, `pitch`, `scale`), режим невидимых линий (пунктир / скрыть / сплошные), рамка, размер подписей, до 12 тел в `props` (схема `bodySchema`, сцена из 12 тел — меньше 40 КБ).
- **Тела** (`solids.ts`): куб, прямоугольный параллелепипед, призма и пирамида (правильное n-угольное основание по стороне или своё выпуклое основание по вершинам, наклон сдвигом верха или вершины), усечённая пирамида (отношение оснований k), цилиндр, конус, усечённый конус, шар; положение, цвет граней и рёбер, непрозрачность, свои подписи, ось и центры оснований (O, O₁; у шара — центр).
- **Чертёж «как в учебнике»** (`drawScene`): параллельная проекция; видимость каждой точки линии — луч к зрителю через все тела (выпуклый многогранник — полупространства, тело вращения — квадрика с отрезком оси, шар — аналитически; тело «сжато» на eps, чтобы своя поверхность не закрывала); граница видимости уточняется делением пополам, кривые (окружности оснований, экватор, очертание шара) параметризованы точно; очертания цилиндра и конуса — образующие с n·d = 0; заливка видимых граней; подписи A, B, C…, A₁…, S, O. Тела закрывают друг друга.
- **3D-редактор** (`editor.tsx`, двойной щелчок; инструмент «3D-сцена» открывает его сразу): объёмный вид three.js (`three-view.tsx`, отдельный чанк ~127 КБ gzip; ортогональная камера совпадает с проекцией чертежа), чертёж поверх, вращение протяжкой (мышь, перо, палец), масштаб колесом и щипком, виды «Как в учебнике / Спереди / Сбоку / Сверху», «Вписать»; тела — выбор, параметры, добавление (справа от остальных), удаление. Правки и поворот пишутся на доску по ходу (не чаще 80 мс), весь сеанс редактора — один шаг отмены; «Отмена» возвращает сцену. Без WebGL — только чертёж и подсказка.
- **Просмотр без права изменения:** ученик открывает сцену учителя двойным щелчком только для просмотра (поля заблокированы, вращает у себя, в документ не пишет). Новое в ядре: `BoardPlugin.viewers` и `PluginEditorProps.readOnly`, `subscribeObject` (редактор подхватывает правки других участников).
- **«Следуйте за мной»:** открытый редактор регистрирует камеру сцены (`registerSceneCamera`), поворот сообщает `notifySceneCamera`; у ученика с открытой сценой вид следует за учителем. Остальные видят поворот и так — вид хранится в документе.
- **Инструменты** (подраздел «Стереометрия», 10 штук): «3D-сцена» и по одному на каждое тело — щелчок ставит сцену с телом, вписанным в рамку 360 × 300.
- **На доске:** растяжение рамкой меняет рамку и масштаб чертежа; панель свойств — невидимые линии, рамка, размер подписей; SVG-экспорт (`toSVG`) из того же чертежа.

**Что вошло в 6.3b (этап 6.3 завершён):**
- **Плагин `math.linalg`** (`dependsOn: ['math.analysis']` — оси для преобразования).
- **Точная арифметика** (`rational.ts`): дроби на BigInt, разбор ячеек (целые, дроби, десятичные с запятой), вывод «−2/3».
- **Алгоритмы** (`linalg.ts`): сумма, разность, произведение (ошибки размеров по-русски), умножение на число, транспонирование, определитель (ступенчатый вид), ранг, обратная (Гаусс — Жордан), шаги метода Гаусса с подписями преобразований (`gaussSteps`), ответ для системы (`solveText`: единственное, параметрическое, несовместна), собственные значения и векторы 2×2 (`eigen2`).
- **Объекты:** `matrix` (диалог с сеткой ячеек, редактор `linalg.matrix`; неверная ячейка — красным), `op` (обычный объект со своим положением и опорами — пересчёт через граф зависимостей; цепочки результатов), `gauss` (цепочка с переносом по ширине, черта расширенной матрицы, ответ), `transform` (на осях: сетка, квадрат, базисные векторы с ручками, det, собственные векторы).
- **Инструменты:** 11 в подразделе «Линейная алгебра»; результат одного операнда — под матрицей, двух — справа от второй; Гаусс — под матрицей.

**Что вошло в 6.3a (6.3 разделён: 6.3a — аналитическая геометрия, 6.3b — линейная алгебра):**
- **Плагин `math.analytic`** (`dependsOn: ['math.analysis']`, использует оси, слайдеры, `axesAt`/`sliderIds` раздела графиков).
- **Математика** (`eqs.ts`): F(x, y) по записи (`equationFn`), коэффициенты прямой и кривой второго порядка подстановкой точек с проверкой в «случайных» точках, `lineText` (целые коэффициенты), расстояние, основание перпендикуляра, угол и пересечение прямых; `analyzeConic` — поворот (убирает xy), перенос, классификация (эллипс, окружность, гипербола, парабола, вырожденная, мнимая), a, b, c, e, p, угол осей (у центральных — в (−90°; 90°]); ветви кривой параметрически, фокусы, директрисы, асимптоты, `conicText`.
- **Объекты:** прямая и кривая по уравнению (диалог с проверкой и каноническим видом по ходу набора, редакторы `analytic.line`/`analytic.conic`), точка и вектор с координатами (привязка к половинам клетки, Alt — без; ручки без выделения), действия с векторами, расстояние от точки до прямой и угол между прямыми.
- **Инструменты:** 10 штук в подразделе «Аналитическая геометрия»: диалоговые, точка щелчком, вектор протяжкой, остальные — выбор объектов по шагам с подсказкой.

**Что вошло в 6.2b (этап 6.2 завершён):**
- **Вычисления** (`calculus.ts`): `graphOf` (функция графика с параметрами слайдеров и кадр осей; только вид «функция»), нули (смена знака + деление пополам, касания через экстремумы |f|, разрывы отсекаются), экстремумы (смена знака производной), производная (символьная `derivatives` из `expr.ts` — внутренняя ссылка на `math.derivative`, недоступная записям; иначе разностная), интеграл Симпсона, суммы Римана (4 способа), Тейлор (коэффициенты по символьным производным), Фурье (коэффициенты Симпсоном по периоду).
- **Объекты** (`features.tsx`, общий `featureModule`): точка на графике (тянется без выделения), нули, экстремумы, пересечения двух графиков, касательная, секущая, площадь под графиком и между графиками, суммы Римана, ε-δ, Тейлор, Фурье. Все — производные от графика(ов), рисуются с обрезкой по осям, подписи-плашки сдвигаются внутрь области (`FrameContext`), параметры меняются ручками и на панели свойств; `moveDeps: () => []`.
- **Инструменты** (`calculus-tools.tsx`, подраздел «Анализ на графике»): щелчок по графику функции, для пересечений и площади между графиками — по двум; начальные значения от точки щелчка.

**Что вошло в 6.2a (6.2 разделён: 6.2a — графики, 6.2b — анализ на графике):**
- **Плагин `math.analysis`** (`src/math/analysis/`): `expr.ts` — math.js отдельным чанком (`loadMath`, `useMathReady`; опасные функции отключены), школьная запись, разбор вида кривой (`parseCurve`: функция, параметрическая «(x; y)», полярная «r = …», неявная, неравенство) и параметров; `plot.ts` — кадр осей (`frameOf`), значения параметров из слайдеров-опор, построение (`buildPlot`: функция с разрывами на асимптотах, параметрическая/полярная, неявная и граница неравенства — marching squares, закраска неравенства ячейками) с кэшем.
- **Объекты:** `axes`, `curve` (производный, обрезка по области осей, попадание — только внутри неё), `slider`, `table`, `numberline` (`parseSet`), `trig` (прилипание к отметкам).
- **Инструменты:** система координат (протяжка или щелчок), график G (диалог), слайдер (первое свободное имя, подключение к ждущим графикам), таблица значений, числовая прямая, тригонометрическая окружность. Диалог графика — редактор плагина: вид кривой и параметры по ходу набора, примеры; недостающие слайдеры создаются под осями.
- **Ядро:** редакторы плагинов (`BoardPlugin.editors`, `PluginEditorsHost`, `EditorContext`), двойной щелчок открывает любой редактор по имени; `ObjectModule.moveDeps`.

**Что вошло в 6.1c (этап 6.1 завершён):**
- **Линейка** (`ruler`): деления в клетках, поворот своей ручкой (Shift — 15°), привязка нуля и конца, края — направляющие пера.
- **Транспортир** (`protractor`): шкалы 0–180 в обе стороны, деления по 1°, центр привязывается к точкам, поворот ручкой, луч-указатель с величиной.
- **Циркуль** (`compass`): игла (`x`, `y`), грифель — ручка раствора с привязкой к точкам, ручка вращения чертит дугу (след виден всем по ходу жеста), при отпускании — `arc` или `circle` планиметрии с центром в точке под иглой (или новой точке) и невидимыми концами (`ghost`).
- **Ядро:** `ObjectModule.guides` + `ToolContext.guides()` (перо и маркер проецируются на край, распознавание фигур при этом выключено); `ObjectModule.finishHandle` (вызывается при отпускании ручки в том же шаге отмены); ручка с `snap: false` не привязывается.
- Инструменты ставятся щелчком; на странице по одному каждого вида (повторный выбор переносит). Убрать — Delete, закрепить — Ctrl+L.

**Что вошло в 6.1b:**
- **Вычислитель** (`eval.ts`): геометрия любого объекта планиметрии — точка или форма — считается рекурсивно по опорам (`evaluate`, реестр `registerEvaluator`, глубина ≤ 64); удалённая опора — запасные координаты `fb` или последняя известная геометрия, «нет опоры»; неопределённое (параллельные не пересекаются) — объект не рисуется, но остаётся.
- **Геометрия** (`geometry.ts`): пересечения отрезков/лучей/прямых/окружностей/дуг (эллипс — ломаной), параметр точки на кривой и обратно, преобразования-подобия (`Xform`: отражения, поворот, перенос, гомотетия; отражение меняет обход дуг), замечательные точки треугольника, основание перпендикуляра, угол.
- **Объекты:** зависимая точка `cpoint` (8 видов; точку на объекте тянут ручкой — параметр `t`); 10 построений и «образ» как фигуры (`FigureDef.evaluate` по геометрии опор); отметки `angle` и `ticks`; `measure` у фигур (клетки сетки по 20).
- **Инструменты** (`constructions.tsx`): общий пошаговый инструмент — шаги «точка / прямая / окружность / линия / объект», подсказка у курсора, короткие пути (щелчок по отрезку, по треугольнику, прямо в пересечение), новые точки — автоточки; преобразования берут источники из выделения; образы фигур по точкам строятся из образов вершин (A′…), у правильного многоугольника и дуг при отражении меняется порядок опор; «Размер».
- **Панель:** подразделы «Планиметрия», «Построения», «Преобразования», «Отметки и измерения» — названия из `BoardPlugin.sections`.
- **Ядро:** `ToolContext.getSelection()`; ручку объекта с `hitPriority` можно тянуть без выделения.

**Что вошло в 6.1a (6.1 разделён по согласию пользователя: 6.1a — объекты и динамическая геометрия, 6.1b — построения, преобразования, отметки, 6.1c — линейка, транспортир, циркуль):**
- **Плагин `math.planimetry`** (`src/math/planimetry/`): точка и 12 фигур на точках через общий конструктор `figureModule(FigureDef)` — габарит, попадание, привязки (середины, центры, квадранты, кривые для пересечений), отрисовка Konva, SVG, панель свойств. Точки — в `deps`; фигура хранит только стиль и `fb` (координаты опор при создании).
- **Инструменты:** щелчки по точкам, протяжка для фигур из двух точек, привязка к существующим точкам (`snap.refId` или попадание), подписи A…Z, A₁…; ломаная — Enter/щелчок по последней, многоугольник — щелчок по первой; Backspace, Esc; создание точек и фигуры — одна транзакция.
- **Ядро:**
  - граф зависимостей в `BoardModel`: пересчёт построений после транзакции в топологическом порядке, `dependentsOf`, `movableSet`, `hasDependents`; копирование захватывает опоры; при вставке производные объекты не сдвигаются (сдвигаются опоры); автоточки (`auto`) удаляются вместе с последним построением;
  - `ObjectModule.derived` (рисуется в мировых координатах, двигается опорами, перемещение пишется по ходу жеста одним шагом отмены), `hitPriority`, `unbounded` (прямая и луч видны при любой области);
  - удаление опоры с построениями — подтверждение «Удалить вместе с построениями?»; ластик удаляет их сразу;
  - кнопка раздела на панели инструментов (инструменты с `section` — одной кнопкой с раскрывающимся списком);
  - `ToolModule.onKeyDown` теперь вызывается (раньше был объявлен, но не вызывался); `ToolContext.listObjects`.
- **Попутно исправлено:** объекты, созданные в одной транзакции, получали одинаковый ключ порядка слоя (`z`) — теперь ключи выдаются по порядку (`issueTopZ`).

**Что вошло в 5.3b:**
- **Калькулятор** (`formula/calc.ts`, math.js отдельным чанком): школьная запись (запятая, «;», tg/ctg/lg/ln, √, °, ×, ÷, :), русские единицы и перевод «в», переменные и функции пользователя, понятные ошибки по-русски. Опасные функции math.js (`import`, `createUnit`, `evaluate`, `parse`…) отключены. Результат — текст и LaTeX «запись = результат» (у перевода единиц показывается только левая часть).
- **Панель** `CalcPanel` (немодальная, справа): расчёт по мере набора, Enter — в историю, «На доску» и вставка из истории (следующий результат ниже предыдущего), «Обновить на доске» при пересчёте. Инструмент C сразу открывает панель (`onActivate`) и возвращает выделение; без права записи — только считать.
- **Объект `core.calc`** (`expr`, `latex`, `size`, `color`) — модуль формулы с другим типом и редактором `calc`.
- **Распознавание:** выделенные штрихи → SVG (всё чёрным на белом, высота строки ~96 px) → PNG → `POST /api/formula-ocr` → бэкенд пересылает на `FORMULA_OCR_URL` (таймаут, ключ, проверка PNG, 2 МБ, 20/мин на пользователя, ошибки сервиса — 503 без подробностей) → редактор формулы «Распознанная формула» → формула на месте рукописи, штрихи удаляются той же транзакцией.
- **Контейнер** `services/formula-ocr`: обёртка на стандартной библиотеке Python над pix2tex 0.1.4 (PyTorch 2.4.1 для процессора), веса скачиваются при сборке, `/predict` и `/health`, ключ `OCR_API_KEY`, вызовы модели по одному. `docker-compose.yml` пока содержит только этот сервис (профиль `ocr`, порт 127.0.0.1:8502, только чтение).
- **Попутно:** `ToolModule.onActivate`/`onDeactivate` теперь вызываются при смене инструмента (раньше были объявлены, но не вызывались); у `FormulaRequest` появилось `insert` (кнопка «Вставить» для новой формулы с готовой записью).

**Что вошло в 5.3a (5.3 разделён по согласию пользователя: 5.3a — редактор и «Решение», 5.3b — калькулятор и распознавание):**
- **Редактор формул** (`FormulaDialog`): MathLive 0.111.1 (визуальный ввод, быстрые сочетания `sqrt`, `frac`, `alpha`, `->`, `<=>`, `+-`, `deg`, `RR` и др., экранная клавиатура внутри `<dialog>`), режим «Код LaTeX», Enter — сохранить. Палитра (`formula/palette.ts`): 8 разделов, у шаблона `template` (с `#?`/`#0`), `example` (кнопка и вставка из Ctrl+K) и ключевые слова. Тот же диалог открывает кнопка Σ в текстовом редакторе (старый `MathDialog` удалён).
- **Объект `core.formula`** (`latex`, `size`, `color`): картинка через `foreignObject` (KaTeX → MathML), растяжение меняет кегль. Инструмент F, двойной щелчок — правка.
- **Объект `core.solution`** (`title`, `steps[{latex, note}]`, `w`, `size`, `check`): таблица шагов, отметки ✓/✗/? между шагами. Инструмент Shift+F, редактор `SolutionDialog` (шаги, комментарии, порядок, удаление; новый шаг начинается с копии предыдущего).
- **Проверка переходов** (`formula/check.ts`, math.js 15.2.0 отдельным чанком): LaTeX → math.js (`latex-to-mathjs.ts`, школьное подмножество, иначе `null`); выражения сравниваются в 8 случайных точках; уравнения — `ok`, если `lhs−rhs` пропорциональны с ненулевым коэффициентом, иначе `unknown` (`bad` только для выражений).
- **Ctrl+K:** все шаблоны палитры ищутся по названию и ключевым словам, готовая формула ставится в центр экрана.
- **Общее:** `text/render.ts` получил `measureElement`, `elementSvg`, `rasterize` для любой разметки; `EDIT_OBJECT_EVENT` открывает редактор объекта по его `editor`.

**Что вошло в 5.2b:**
- **Объект `core.text`:** `doc` (ProseMirror JSON), `w` (ширина переноса), `h` (измеренная высота), `fill` (подложка). Схема `text/schema.ts` (TipTap 3.32.0): StarterKit без ссылок, кода и линии; цвет и размер шрифта; выравнивание; таблицы; формула `mathInline` (атом с LaTeX; ввод `$…$` своим `InputRule`). `normalizeDoc` отклоняет чужие узлы и метки и вычищает цвета и размеры вне набора.
- **Отрисовка** (`text/render.ts`): XHTML из сериализатора схемы → SVG `foreignObject` → картинка в Konva (кэш, масштаб — степени двойки по зуму). Общий `TEXT_CSS` для редактора, измерения высоты и картинки; цвета — CSS-переменные `--c-*` по теме холста. Формулы — KaTeX → MathML.
- **Редактор** (`TextEditor.tsx`): TipTap поверх холста в масштабе и повороте блока. Панель: стиль абзаца, размер, B/I/U/S, цвета, списки, выравнивание, формула (диалог с предпросмотром), таблица. Сохраняет по ходу набора раз в 0,7 с — вся правка один шаг отмены (`merge`). Закрывается по Esc, щелчку мимо, смене страницы; пустой новый блок удаляется. Мягкая блокировка через `awareness.editing` и отметка «Редактирует …» на холсте.
- **Открытие:** инструмент «Текст» (T), двойной щелчок по блоку; обычный текст из буфера → новый блок (`BoardCommands.insertText`).
- **`ObjectModule.applyResize`:** растяжение рамкой меняет ширину текста (перенос), а не масштаб букв.


**Что вошло в 5.2a (5.2 разделён по согласию пользователя: 5.2a — файлы, 5.2b — текст):**
- **Хранилище** (`backend/src/assets/storage.ts`): MinIO/S3 (клиент `minio@8.0.7`) при заданном `S3_ENDPOINT`, иначе каталог `UPLOADS_DIR` (атомарная запись, защита от выхода за каталог). Бакет создаётся при запуске. Тесты используют временный каталог (`TEST_UPLOADS_DIR`).
- **Проверка загрузок** (`sniff.ts`): тип по сигнатуре (PNG, JPEG, GIF, WebP, PDF; SVG и прочее — 415), разбор структуры, размеры, удаление метаданных без перекодирования (PNG: tEXt/zTXt/iTXt/eXIf/tIME; JPEG: APP1, APP3–13, APP15, COM; GIF: комментарии и расширения приложений, кроме NETSCAPE2.0; WebP: EXIF/XMP и флаги VP8X), пределы 12 000 пикселей по стороне и 100 Мп. Пределы размера — `UPLOAD_MAX_IMAGE_MB` (15) и `UPLOAD_MAX_PDF_MB` (50). Тот же файл на той же доске не дублируется (sha256).
- **API:** `POST /api/boards/:id/assets` (тело — файл, `X-File-Name`; право записи на доске; CSRF), `GET /api/assets/:id` (вход; `nosniff`, `CSP: sandbox`, `private, immutable`), `GET /api/assets/:id/info`. Код ошибки `FILE_REJECTED` добавлен в общий список.
- **Картинки** (`core.image`): вставка из буфера, перетаскиванием на холст, инструментом «Картинка или PDF» (I) и командой в Ctrl+K. Браузер готовит файл (`prepareImage`: поворот по EXIF, не больше 4096 пикселей по стороне, перекодирование; SVG → PNG; GIF как есть). Кэш картинок общий на вкладку (`imageCache.ts`). Кнопка «Обрезать» на панели свойств открывает `CropDialog`: масштаб на доске сохраняется, файл не меняется.
- **PDF:** загрузка → `PdfImportDialog` (диапазон страниц, не больше 100 за раз и в пределах 300 страниц доски, «Закрепить фон» для учителя) → новые страницы после текущей одним шагом отмены (`BoardModel.addPages`). `background.pdf` — новое необязательное поле схемы фона. `PdfBackground` рисует обзор всей страницы и чёткую видимую часть через 150 мс после остановки камеры. pdf.js — отдельные чанки (`media/pdf.ts`), основной бандл не вырос.
- **Попутно исправлено:** новая страница копировала фон соседней вместе с PDF; несколько страниц в одной транзакции вставали не по порядку и теряли фон (модель не видела только что созданные страницы) — отсюда `addPages`. В `ARCHITECTURE.md` исправлена устаревшая строка про `@fastify/websocket`.

**Что вошло в 5.1:**
- **Объект `core.stroke`:** точки `[x, y, нажатие, …]` в локальных координатах, толщина в мировых единицах, `pressure`, `opacity`, `closed`, `kind` (`pen` / `marker`). С нажатием рисуется залитым контуром переменной толщины, без нажатия — линией. Пути кэшируются (`WeakMap` по массиву точек) и сглаживаются квадратичными кривыми. Есть SVG-экспорт, точки привязки, попадание.
- **Геометрия** (`objects/stroke/geometry.ts`, чистые функции): прореживание и сглаживание ввода (`StrokeBuilder`), упрощение (RDP с учётом нажатия), контур, габарит, попадание, разрезание кругом (попиксельный ластик), распознавание фигур, сжатие штриха для присутствия.
- **Инструменты:**
  - перо (P) с промежуточными событиями указателя (`getCoalescedEvents`) и распознаванием фигуры по задержке 0,6 с;
  - маркер (M) ложится под рисунок;
  - ластик (E): «Объекты целиком» или «Части штрихов»; соблюдает права, весь жест — один шаг отмены (`transact({ merge })`).
  - Распознанные отрезок, прямоугольник и эллипс становятся `core.shape` (с поворотом); треугольник и произвольный четырёхугольник — замкнутым `core.stroke`.
- **Живой штрих у других:** `ToolContext.publishDrawing` → `Presence.setDrawing` → `awareness.drawing`; `BoardStage` рисует чужие недорисованные штрихи.
- **Расширен `ToolContext`:** `transact(fn, { merge })`, `canModify`, `canDelete`, `publishDrawing`; в `createObject` — `placement`, `layer`, `rotation`, `scaleX`, `scaleY`. Новые опции инструментов в `ToolOptions`.
- **Попутно исправлено:**
  - `BoardModel`, созданная поверх уже заполненного документа, не включала его объекты в состав страниц;
  - плавающий сбой тестов бэкенда (deadlock `TRUNCATE`). Перед очисткой БД тесты выгружают комнаты (`RoomManager.unloadAll`), выгруженная комната больше не выгружается повторно (`Room.destroyed`), `TRUNCATE` повторяется при `40P01`.

**Что вошло в 4.2:**
- **Задания** (`AssignmentsService`): раздача копий доски (LESSON или TEMPLATE, где учитель — владелец или соведущий) классу и/или ученикам. Копия — доска `ASSIGNMENT_WORK`, владелец — учитель; документ копируется из комнаты (свежий) или из БД. Статусы: «Не начата» → «В работе» (первое принятое изменение ученика, `Room.markWorkStarted`) → «Сдана» → «Проверена» (с отметкой); «Отменить сдачу» (ученик), «Вернуть на доработку» (учитель), закрыть/открыть приём, выдать новым ученикам класса, удалить задание вместе с работами. Журнал `ASSIGNMENT_CREATED`.
- **Права:** сданная или проверенная работа ученику только для чтения (`assignment.submitted` в фактах, `noWriteReason: 'assignment-submitted'`). Смена статуса пересчитывает права на лету и рассылает `work.changed`.
- **Сетка работ** (`/assignments/:id`): живые миниатюры по облегчённым подпискам `?lite=1` (только для карточек на экране), фильтр по статусу, опрос статусов раз в 10 с.
- **Проверка:** учитель в работе пишет в слой `review` красным (`ModelOptions.defaultLayer`, `setToolOptions(…, false)` — не сохраняется), полоса `WorkBar`: отметка, «Проверено», «Вернуть», соседние работы.
- **Ученик:** раздел «Задания» на главной, полоса работы с «Сдать работу»; конспект можно открыть/скрыть от учителей (меню карточки). Работы по заданиям убраны из общего списка досок.
- **Миниатюры досок в списках:** браузер рисует первую страницу по снимку `GET /api/boards/:id/snapshot` (ленивая загрузка, не больше 4 одновременно, кэш по `lastActivityAt`). Поле `thumbnailUrl` из API убрано; колонки `thumbnailKey` в БД не используются.

**Что вошло в 4.1:**
- **Сервер** (`lesson.ts`): `mode.set`, `chalk.set`, `chalk.revokeAll`, `hand.raise`, `hand.lower`, `hand.dismiss`, `follow.start`, `follow.update`, `follow.stop`, `objects.clearByAuthors`, `settings.set`. Права проверяются по `capabilities`, команды комнаты выполняются по очереди, `session.init` заполняет `chalkHolders`, `hands`, `follow`. Адресная рассылка присутствия при `showStudentCursors = false`. Журнал: `BOARD_MODE_CHANGED`, `BOARD_CLEARED`. IP в журнале за прокси берётся из `X-Forwarded-For` (если `TRUST_PROXY`).
- **Клиент:** кнопка «Урок» (режим, показ, очистка, настройки, доступ), «Поднять руку», счётчик рук со звуком, мел и удаление записей ученика в списке участников, баннер показа и «Вернуться к учителю», лазерная указка (K), диалог доступа (и из списка досок).
- **Попутно исправлено:** подсказка над холстом растягивалась на треть экрана (сетка страницы была на 4 строки при 5 детях); выделение оставалось на удалённом другими объекте.
- Блокировка объектов и фона была сделана ещё в 3.2.

## 3. Текущее состояние

- **Где остановились.** Этап 9b закрыт и запушен — **все этапы плана выполнены** (7.6 и 7.7 пропущены по решению пользователя). Новых этапов в плане нет: дальнейшие работы — по просьбе пользователя (см. раздел 5). После 8.1a прогнан `e2e/assignments.cjs` (изменён общий `Dialog`) — прошёл; после 8.1b — часть `e2e/calc.cjs` до распознавания рукописи (дальше нужен подставной сервис распознавания) — прошла. С 7.3a ядро не менялось — полная регрессия не прогонялась (последняя полная — после 7.2a); в 7.8a из общего кода физики только добавлены `plot.tsx` и функции в `quantities.ts`. После 7.2a (изменение ядра — кнопки панели свойств) прошли все 18 сценариев (кроме `calc`, ему нужен подставной сервис распознавания). Пользователь получил инструкцию запуска на Windows 10 в локальной сети (файл не в репозитории; суть — Git Bash, `npm config set script-shell`, `.env` с `PUBLIC_ORIGIN` по IP, `vite preview --host`); если он попросит — добавить её в README или сделать вариант для Windows на этапе 9. Рабочая копия чистая, всё запушено в `origin/stage-1-architecture`.
- **Не проверено здесь:** образ `services/formula-ocr` не собирался — Docker-демон здесь запускается (`dockerd &`, см. 9a), но индекс PyTorch закрыт прокси (не перепроверялось после 9a), а индекс PyTorch закрыт прокси. Обёртка проверена тестами с подставной моделью, бэкенд — с подставным сервисом, браузерный сценарий — с подставным сервисом. Первую настоящую сборку сделать на сервере (этап 9) и проверить распознавание на живой рукописи.
- **Сломанного не известно.** Плавающий сбой тестов бэкенда найден и исправлен в 5.1 (см. выше).
- **Точки расширения, которые заполнят следующие этапы (не заглушки):**
  - выбор точек щелчком по поверхности тел вращения (сейчас — их характерные точки и координаты; точки на рёбрах и гранях — у многогранников) и подписи вершин сечения — при необходимости, по просьбе пользователя;
- **Прочие отложенные вещи:**
  - шаблоны и справочник в Ctrl+K показываются неактивными — этап 8.1 (там же — раздача задания из шаблона библиотеки: бэкенд уже принимает доску kind = TEMPLATE);
  - одновременная правка одного текстового блока двумя людьми не сливается: блок пишется целиком (`props`), поэтому второй редактор блокируется мягко («Редактирует …»). Посимвольное слияние (Y.XmlFragment) отвергнуто: документ доски намеренно плоский (глубина 2);
  - чтение `toDataURL` холста с текстом может быть запрещено браузером (картинки из `foreignObject`) — решать при экспорте PNG, этап 8.2 (там же — отрисовка вне холста).
  - удаление неиспользуемых файлов из хранилища (файл остаётся, даже если его объект удалён: на него могут ссылаться копии заданий, история версий и буфер) — этап 9, вместе со скриптами обслуживания и резервного копирования;
  - миниатюры досок не показывают фон из PDF (рисуются только объекты) — этап 8.2, вместе с экспортом, где страницы PDF всё равно нужно рисовать вне холста;
  - вид `PDF_PAGE` и колонки `pageCount`/`parentId`/`pageNumber` в `Asset` остались с этапа 1 и не используются: страницы PDF рисует браузер.

## 4. Ключевые решения (и что отвергнуто)

**Стек:**
- **Fastify, а не NestJS.** Меньше накладных расходов на WebSocket, zod-схемы общие с клиентом.
- **WebSocket на `ws` напрямую, без `@fastify/websocket`.** Origin проверяется до upgrade (отказ — HTTP 403). Вход, права и удалённая доска проверяются после upgrade и сообщаются кодами закрытия 44xx: браузер не показывает скрипту HTTP-статус неудачного upgrade.
- **Prisma 6.19.3.** Версия 8 в npm — release candidate, у Prisma 7 другая схема настройки (`prisma.config.ts`). zod 3.25.76.
- **React 18.3 и React Router 6, а не 19 и 7** — ради совместимости с react-konva 18 и будущим react-three-fiber 8.
- **Vite 6.4.5 закреплён через `overrides` в корневом `package.json`.** Vitest подтягивал в корень Vite 7.

**Синхронизация и данные:**
- **Сервер применяет обновление Yjs, проверяет права и отменяет запрещённое своей правкой** (`backend/src/realtime/guard.ts`). Вариант «отклонить обновление» отвергнут: он создаёт дыру в последовательности clock клиента, и все его следующие правки перестают применяться.
- **Обновления Yjs при превышении частоты не отбрасываются** по той же причине: предупреждение, а при повторе — разрыв соединения.
- **Документ плоский, глубина 2:** `objects` → объект → поле. Поля содержат только JSON, `props` записывается целиком.
- **Недорисованный штрих и лазер идут через awareness**, а не через документ.
- **История версий — полные снимки `BoardVersion`**, а не `Y.snapshot`; документ на сервере создаётся с `gc: true`.

**Клиент:**
- **Каждое действие — отдельный шаг отмены** (`model.transact` вызывает `undo.stopCapturing()`). Одним шагом склеивается только перетаскивание ручки (`{ merge: true }`). Иначе быстрые действия склеивались по `captureTimeout`.
- **Объекты Konva не слушают события** (`listening={false}`); попадания считает `module.hitTest`. Transformer лежит в том же слое и цепляется только к «листьям» выделения.
- **У группы нет геометрии.** Если у объекта есть свои ручки (концы отрезка), Transformer к нему не подключается.
- **Перемещение:** во время перетаскивания узлы Konva двигаются напрямую, а в документ при отпускании пишется одна транзакция.
- **Горячие клавиши определяются по `e.code`** (физической клавише), поэтому работают в русской раскладке. Пока открыт `dialog[open]`, клавиши доски не обрабатываются.
- **Буфер обмена** — через события `copy`/`cut`/`paste` (без запроса разрешений). Формат: префикс `doska-objects:v1:` + JSON.
- **Офлайн:**
  - документ хранится в IndexedDB, база `doska:<boardId>:<userId>`, при выходе удаляется;
  - при событии `offline` провайдер сам закрывает сокет;
  - свойства доски кэшируются в `localStorage` (`doska.boardCache.<id>`).
- **Страница доски — отдельный чанк** (`React.lazy` в `App.tsx`).
- **Полосы над холстом** (отключение, показ, подсказка) лежат в одном контейнере `.board-notices` — это одна строка сетки `.board-page`.

**Урок (4.1):**
- **Права при смене режима, мела и настроек пересчитываются в памяти** (`Lesson.recompute` → `computeCapabilities`), без чтения БД на каждого участника. Полный пересчёт из БД (`Room.refreshAccess`) — только при смене доступа и REST-изменениях.
- **Руки и «Следуйте за мной» — только в памяти комнаты;** режим, мел и настройки — в БД.
- **«Скрыть курсоры учеников» не прячет ученика целиком:** остальным ученикам его состояние уходит без `cursor`, `selection`, `viewport`. Вариант «не слать вовсе» отвергнут: ученик пропадал бы из списка участников.
- **Кто следует за показом:** только участники без `leadFollow` (ученики, наблюдатели). Блокировка вида — в `useBoard.setCamera/setPage(…, source)`: `'user'` при строгом показе игнорируется, при нестрогом означает «отошёл»; приложение пишет с `'system'`.
- **Вид ученика вписывает мировую область учителя** (`viewport.w/h`, необязательные поля протокола), а не копирует зум.
- **Лазер** — только awareness (`laser.points` = `[x, y, t…]`, t от начала следа); угасание считается от времени получения последней точки, часы не синхронизируются. Инструмент `core.laser` проверяет право `laser` через `ToolModule.requiresCapability`; общая проверка — `frontend/src/tools/availability.ts`.
- **Режим и настройки у учителя меняются оптимистично**, сервер подтверждает рассылкой.
- **Задания (4.2):** копия — обычная доска с полным документом (`encodeStateAsUpdate`), а не ссылка на шаблон: работы независимы, а сервер проверяет их теми же правилами. Доски, документы и работы создаются пакетно (`createMany`) в одной транзакции.
- **Миниатюры рисует браузер** (те же модули объектов, `BoardThumbnail`), а не сервер: на сервере нет canvas, а хранилище файлов появится только в 5.2. Компоненты миниатюр грузятся отдельным чанком (`ui/Thumbs.tsx` → `React.lazy`), чтобы Konva не попал в основной бандл.
- **`BoardModel` можно создавать поверх готового документа:** конструктор индексирует существующие объекты (`applyChanges` по всем ключам).
- **Попиксельный ластик разрезает штрих, а не закрашивает фоном:** работает на любом фоне и в совместной работе. Первый кусок остаётся тем же объектом (автор сохраняется), остальные создаёт стирающий. Фигуры этот режим не трогает.
- **Толщина пера — в мировых единицах** (экранные пункты ÷ масштаб на момент рисования), фигуры по-прежнему в экранных пунктах (`strokeScaleEnabled = false`). Распознанная фигура получает толщину пера в пунктах.
- **Нажатие:** множитель радиуса `0,3 + 1,4·p`, мышь (p = 0,5) даёт номинальную толщину; скорость не имитируется.

**Текст (5.2b):**
- **Текст на доске — картинка из SVG `foreignObject`, а не HTML поверх холста:** сохраняется общий порядок слоёв (перо поверх текста), текст попадает в миниатюры и экспорт, в картинке не выполняются скрипты. Отвергнуто: HTML-слой поверх холста (ломает порядок слоёв) и своя вёрстка на canvas (таблицы и формулы — слишком много работы).
- **Формулы — MathML (KaTeX `output: 'mathml'`):** браузер рисует сам, без шрифтов KaTeX. В картинке-SVG внешние шрифты не загрузились бы.
- **Хранение — ProseMirror JSON + схема** (TipTap), а не HTML: очищать нечего, неизвестное отклоняется.
- **Подводный камень:** `<React.StrictMode>` в разработке размонтирует и снова монтирует компоненты. Действия при размонтировании (закрыть редактор, удалить пустой блок) откладываются и отменяются при повторном монтаже (`TextEditor.tsx`).
- **Подводный камень:** в картинке-SVG нет глобальных стилей приложения — поэтому `box-sizing` и всё прочее задано в `TEXT_CSS` явно, иначе таблицы на холсте шире, чем в редакторе.
- **Размер:** TipTap и KaTeX — в чанке доски (вместе с Konva около 365 КБ в gzip), основной бандл не вырос.

**Формулы (5.3a):**
- **MathLive и math.js — отдельные чанки** (динамический `import`): доска без формул их не грузит. Шрифты MathLive отдаёт свой плагин Vite (`/mathlive-fonts/`, в сборке — файлы в `dist/mathlive-fonts`), `MathfieldElement.fontsDirectory` указывает туда; CDN не используется.
- **На холсте формулы рисует KaTeX (MathML), а не MathLive:** не нужны шрифты внутри `foreignObject`, тот же путь, что у текста.
- **Проверка шагов — числовая подсказка, не символьная система:** без CAS (nerdamer/sympy отвергнуты — вес и неполнота). Неравносильность уравнений не утверждается (`?`, а не `✗`): численно отличить потерю корня от ошибки нельзя.
- Отметки считаются у каждого клиента, в документ не пишутся.

**Стереометрия (6.4b):**
- **Построения — внутри сцены, а не отдельными объектами доски:** их положения считаются из тел сцены, и это та же схема «одна сцена — один объект» (`BOARD_MODEL.md`, глубина документа 2). Развёртка — отдельный объект: её двигают и раскрашивают отдельно от сцены.
- **Точка на грани — аффинные координаты** (от первой вершины по двум сторонам), а не мировые: при правке тела точка остаётся «в той же доле» грани.
- **Плоский чертёж — объекты планиметрии**, а не картинка: его дорисовывают инструментами 6.1 (медианы, отметки). Кривые — ломаные на невидимых опорах (`ghost`), а не штрихи пера: у штриха нет пунктира.
- **Сечение тела вращения — по многограннику из 72 граней:** одна процедура для всех тел; хорды контура лежат чуть внутри поверхности, поэтому у линий слоя есть допуск видимости `tol`.

**Стереометрия (6.4a):**
- **На доске — векторный чертёж, а не WebGL-снимок** (как предполагал этап 1): контекстов WebGL мало, снимок пришлось бы перерисовывать у каждого клиента, а чертёж с пунктиром невидимых линий и подписями — то, что рисуют в учебнике; он попадает в миниатюры и SVG. three.js нужен только в редакторе.
- **three.js без react-three-fiber и drei:** объёмный вид — один компонент без интерактива внутри сцены (вращение — свои обработчики, общие с чертежом), обёртка добавила бы вес и зависимость от версии React.
- **Проекция ортогональная, без кабинетной (фронтальной диметрии):** сцену вращают, а кабинетная проекция имеет смысл только при фиксированном виде. Вид «Как в учебнике» — азимут −65°, наклон 22°.
- **Видимость — лучом к зрителю по выборке, а не точным алгоритмом скрытых линий:** работает одинаково для рёбер, окружностей и очертаний и для взаимного закрытия тел; тела выпуклые (своё основание проверяется на выпуклость).
- **Вид сцены — в документе:** поворот видят все без «Следуйте за мной»; реестр камер нужен для открытых у учеников редакторов. Ученик без права записи вращает у себя (`viewers`), ничего не записывая.

**Планиметрия (6.1a):**
- **Фигура ссылается на объекты-точки (`deps`), а не хранит координаты:** так работает динамическая геометрия (GeoGebra-подобно), точки общие у нескольких фигур. Отвергнуто: координаты в `props` фигуры с «привязкой» — пришлось бы синхронизировать копии.
- **Пересчёт построений — локально у каждого клиента** (как в `BOARD_MODEL.md`): в документ пишутся только точки. При перетаскивании точки пишутся по ходу жеста (склеиваются в один шаг отмены), иначе построения у других участников не двигались бы до отпускания.
- **Толщина линий и радиус точек — на экране** (как у фигур ядра), подписи — в мировых единицах (масштабируются с доской, как текст).
- **Прямая и луч рисуются отрезком длиной 200 000** и помечены `unbounded`; габарит — опорная часть (иначе «Показать всё» уводило бы в бесконечность).
- **Привязка к пересечению или середине в инструментах 6.1a ставит свободную точку**; зависимую — инструменты «Точка пересечения» и «Середина» (6.1b).
- **6.1b: построение — фигура с `evaluate` по геометрии опор, а не отдельный механизм:** одна система габаритов, привязок, отрисовки и пересчёта для всего. Отвергнуто: хранить вычисленные координаты построений в документе — двойной источник истины и запись при каждом движении.
- **6.3b: результат действия — объект со своим положением и опорами, а не копия чисел:** правка исходной матрицы сразу меняет результат у всех; `deps` у обычного (не производного) объекта дают пересчёт и каскадное удаление без перемещения опор. Вычисления точные (дроби), чтобы ответы совпадали с тетрадью.
- **6.3a: коэффициенты уравнения — подстановкой точек, без символьной алгебры:** любая запись, которую понимает разбор графиков, работает и здесь; проверка в нескольких «случайных» точках отсекает не прямые и не кривые второго порядка. Кривая рисуется параметрически по каноническому виду (точно), а не marching squares.
- **6.2a: график хранит запись, а не точки:** строится у каждого клиента (math.js), в документе — только текст и ссылки на оси и слайдеры. Параметры — объекты-слайдеры в `deps` (перестроение через граф зависимостей ядра). Вид кривой определяется по записи, а не выбирается отдельно.
- **6.2a: math.js для графиков — тоже отдельный чанк:** доска без графиков его не грузит; до загрузки график не рисуется (компонент перерисуется по `useMathReady`).
- **6.1c: чертёжные инструменты — объекты доски, а не личные оверлеи:** учитель показывает классу, как приложить транспортир; линейка общая для всех. Дуга циркуля — обычная фигура планиметрии (динамическая, на точке-центре), а не штрих.
- **Образ фигуры по точкам — из образов вершин** (как в GeoGebra): подписи A′B′C′ и привязка к вершинам образа; построения без точек-вершин — общий тип `image`.

**Калькулятор и распознавание (5.3b):**
- **Калькулятор в браузере, а не на сервере:** math.js уже грузится для проверки шагов, сервер не нагружается, работает и без связи.
- **Свой протокол распознавания (PNG → `{latex}`), а не API pix2tex:** у pix2tex API на FastAPI с multipart и Streamlit — лишние зависимости; простой протокол легко повторить внешним сервисом. Ответ строкой JSON тоже принимается.
- **Рукопись рендерится в браузере из векторных штрихов** (`toSVG`), а не снимком холста: нет сетки, фона и чужих объектов, масштаб подобран под модель.
- **Распознанная формула заменяет штрихи**, а не встаёт рядом: так ведут себя похожие доски; отмена одним шагом.

**Файлы (5.2a):**
- **Файлы отдаёт бэкенд, а не presigned-ссылки MinIO:** нужен вход, MinIO не торчит наружу, хранилище на диске работает так же. Читать файл может любой вошедший пользователь, знающий его случайный UUID. id есть только в документах досок, которые он видит; копии заданий, шаблоны и вставка между досками ссылаются на тот же файл, поэтому привязка «файл — одна доска» не подходит. Загружать можно только на доску с правом записи.
- **Метаданные удаляются разбором структуры, без `sharp` и перекодирования:** нет нативной зависимости, качество не теряется. Перекодирование делает браузер перед загрузкой — это и поворот по EXIF, и защита на случай загрузки в обход интерфейса.
- **PDF рисует браузер (pdf.js), а не сервер:** чёткость при любом масштабе, на сервере не нужен poppler. Отвергнутый вариант этапа 1 — растеризация в `core.pdf-page`.
- **PDF — фон страницы (`background.pdf`), а не объект:** страница PDF ведёт себя как лист задания, учитель закрепляет её как фон.
- **Поиск людей** `GET /api/directory/users` — только учителям: ученики — все действующие (решение 3), учителя — для соведущих; заблокированные и удалённые не показываются.

**Безопасность и учётные записи:**
- **Защита от CSRF:** заголовок равен cookie (double submit) плюс проверка Origin. Refresh-токены случайные; `JWT_REFRESH_SECRET` убран. Признак обязательной смены пароля в токене — `pwd`.
- **Удаление пользователя мягкое:** логин заменяется на `deleted.<id>`.
- **Администратор:** доски не создаёт и видит все только на просмотр. Учитель выдаёт доски только классам, где он назначен учителем.

## 5. Что осталось

Плановых этапов не осталось. Возможные работы (только по просьбе пользователя):
1. **Пропущенные разделы физики:** 7.6 (гидростатика, молекулярная физика и термодинамика — есть неподключённый черновик `frontend/src/physics/thermo`: расчёты, газ, изопроцесс, цикл) и 7.7 (оптика).
2. **Проверить на настоящем сервере:** выпуск сертификата Let's Encrypt (`install.sh --domain`), образ распознавания формул (`--ocr`), автозапуск через systemd, вариант для Windows (`docs/WINDOWS.md`).
3. **Предложения из прошлых этапов:** щелчок новым инструментом не должен попадать в ручку выделенного объекта (ядро); описание PR #1 на GitHub устарело (про этапы 2.1–3.3); ветка `main` отстаёт — слить `stage-1-architecture` по решению пользователя.
4. **Мелочи:** наконечники стрелок в экспорте зависят от текущего масштаба доски; фон из PDF не попадает в экспорт.

## 6. Важные детали

**Подготовка окружения.** PostgreSQL 16 установлен локально, но после перезапуска контейнера остановлен (признак — вход отвечает 500, в журнале бэкенда «Can't reach database server»).
```bash
service postgresql start
cd /home/user/Doska
npm install && npm run build:shared
npm run db:migrate && npm run db:seed
npm run check     # типы, тесты всех пакетов, сборка, схема Prisma
```
- В базе есть пользователь `doska` (пароль `doska`) и базы `doska` и `doska_test`. Если контейнер новый, их нужно создать заново — команды в `README.md` (в этой сессии так и было: контейнер был новый).
- `npm run build:shared` обязателен перед проверкой типов и тестами `backend` и `frontend`: они импортируют `@doska/shared` из `dist`.

**Локальный `.env`** (в корне, не коммитится):
```
NODE_ENV=development
DATABASE_URL=postgresql://doska:doska@localhost:5432/doska?schema=public
JWT_ACCESS_SECRET=dev-secret-dev-secret-dev-secret-dev-secret
PUBLIC_ORIGIN=http://localhost:5173,http://localhost:3000
COOKIE_SECURE=false
SEED_ADMIN_LOGIN=admin
SEED_ADMIN_PASSWORD=Start2026doska
```
- В dev-базе этой сессии у администратора `admin` исходный пароль из `SEED_ADMIN_PASSWORD` (при первом входе потребуется сменить). Там же пользователи `e2e.*` из `e2e/setup.mts`.
- Тесты бэкенда используют базу `TEST_DATABASE_URL`, по умолчанию `doska_test`.
- Загруженные файлы в разработке лежат в `backend/data/uploads` (`UPLOADS_DIR` по умолчанию `./data/uploads` относительно каталога запуска; в `.gitignore`). MinIO локально не установлен — для проверки драйвера S3 задайте `S3_ENDPOINT` и ключи.
- После перезапуска контейнера PostgreSQL снова остановлен: `service postgresql start`.

**Запуск серверов для ручной и браузерной проверки** — каждой командой отдельно, в фоне:
```bash
cd backend && set -a && . ../.env && set +a && NODE_ENV=production COOKIE_SECURE=false node dist/src/main.js
node /home/user/Doska/node_modules/vite/bin/vite.js /home/user/Doska/frontend --port 5173 --strictPort
```
Перед первым запуском бэкенда — `npm run build -w @doska/backend`. Для `e2e/calc.cjs` бэкенд запускать с `FORMULA_OCR_URL=http://127.0.0.1:8599/predict`.

**Подводные камни окружения:**
- `cd` внутри фоновых команд игнорируется. `npx vite` из корня запускает Vite не для того каталога — фронтенд обслуживает корень репозитория и отдаёт 404.
- `pkill -f <шаблон>` убивает и собственную оболочку, потому что шаблон есть в её командной строке. Останавливать процессы скриптом, который читает `/proc/*/cmdline`; шаблон должен лежать в файле скрипта, а не в командной строке.
- В python-heredoc строка `'﻿'` превращалась в настоящий символ BOM в исходнике. Писать `\\uFEFF` или проверять результат.
- Пароль в `SEED_ADMIN_PASSWORD` не должен содержать логин: сид отклоняет такой пароль.

**Сквозные проверки:**
- Playwright предустановлен: `require('playwright')`, `chromium.launch()`.
- В режиме разработки страница доски выставляет `window.__doska = { model, store, commands }`.
- Сценарии сквозных проверок лежат в `e2e/` — 25 штук: `lesson`, `assignments`, `drawing`, `media`, `text`, `formula`, `calc`, `planimetry`, `constructions`, `drafting`, `graphs`, `calculus`, `analytic`, `linalg`, `stereo`, `stereo-space`, `physics-common`, `physics-given`, `physics-motion`, `physics-dynamics`, `physics-electro`, `physics-circuit`, `physics-magnetism`, `physics-oscillations`, `physics-waves` (`.cjs`; что проверяет каждый — `e2e/README.md`). Пользователей и класс для них создаёт `e2e/setup.mts` (`cd backend && sh scripts/with-env.sh npx tsx ../e2e/setup.mts`, пароль `Kot12345e2e`); он печатает `classId` — его передают сценарию: `node e2e/<имя>.cjs <classId>`. В dev-базе этой сессии `classId` = `e7dd4d1b-0ac1-41aa-909c-c6759490b354`; в новом контейнере база новая — запустить `setup.mts` заново.
- Подряд сценарии упираются в ограничение входов (10 в минуту с IP): между ними пауза ~60 с, например `for s in drawing text; do sleep 62; node e2e/$s.cjs <classId>; done`. Снимки экрана — в `$E2E_OUT`.
- Регрессия после изменений ядра (`collab/model.ts`, `canvas/BoardStage.tsx`, `packages/shared/src/plugins/types.ts`) — прогонять все сценарии, а не только новый: так ловились ошибки в предыдущих этапах.
- Кнопка участников находится по `locator('button.participants')`: её доступное имя складывается из аватаров.
- **Выбор файла в Playwright:** путь с кириллицей Chromium не принимает (поле получает `cancel`) — передавайте файл содержимым `{ name, mimeType, buffer }`. Держите постоянный обработчик `page.on('filechooser', …)`: иначе между выборами перехват окна выключается асинхронно, и следующий выбор может не перехватиться.
- **Не правьте файлы фронтенда во время сценария:** Vite перезагрузит страницу, и сценарий упадёт.
- Флажки, состояние которых приходит с сервера, Playwright может не «переключить» (`check()` ждёт смены сразу) — у настроек урока это решено оптимистичным обновлением.
- Селекторы `getByLabel` неоднозначны, когда открыт диалог: использовать `locator('dialog').getByLabel(...)`.

**Подводные камни кода:**
- В тестах подключается браузерная сборка Konva: alias `konva → konva/lib/index.js` в `frontend/vite.config.ts`, иначе нужен нативный пакет `canvas`.
- В `sceneFunc` Konva рисовать через `ctx._context`: на обёртке Konva присваивание `strokeStyle` не работает.
- Конкурентные правки одного поля Yjs выигрывает больший clientID. В тестах с несколькими клиентами синхронизировать их перед правками, иначе тест плавает.
- Разделы-плагины подключаются автоматически: файлы `frontend/src/{math,physics}/**/plugin.ts`. Тип объекта обязан начинаться с id плагина. Иконки инструментов регистрировать через `registerIcons` (`frontend/src/ui/icons.ts`).

- MathLive: настраивать поле (`inlineShortcuts` и т. п.) только после события `mount`, иначе «Mathfield not mounted»; начальное значение — атрибутами и `textContent`. В Playwright вводить в поле `math-field` через `keyboard`, а в «Код LaTeX» — `fill`.
- `latex-to-mathjs`: аргумент без скобок — один символ, как в LaTeX (`x^23` = x²·3, `\log_2 8`). Десятичная запятая — `2{,}5` и `2,5` между цифрами.

- Инструменты, создающие несколько объектов в одной транзакции, видят их через `ctx.resolve.getObject` только после конца транзакции: модель разбирает изменения в `observeDeep`. Поэтому `createObject` для зависимого объекта в той же транзакции, что и его точки, работает (габарит пересчитывается после транзакции), а читать только что созданные объекты внутри `transact` нельзя.
- Объект, созданный в текущей транзакции, через `ctx.resolve.getObject` ещё не виден — нужные данные (прямоугольник новых осей) передавать явно (`axesAt` возвращает `rect`).
- В Konva `Line` с массивом точек рисует ломаную: отдельные отрезки (сетка, таблица) — через `Shape` со `sceneFunc` (`Segments`), иначе появляются соединительные диагонали.
- `ObjectNode` подписан на запись `model.get(id)`: чтобы перерисовать построение, модель заменяет его запись новым объектом (`{ ...entry }`).
- WebGL в безголовом Chromium Playwright работает (программный рендер): `e2e/stereo.cjs` проверяет `<canvas>` объёмного вида. Если WebGL нет, редактор сцены показывает только чертёж — сценарий принимает и это.
- Чертёж сцены кэшируется по объекту `props` (`WeakMap`): `props` сцены всегда заменяется целиком, иначе чертёж не обновится.
- Инструменты векторов физики остаются активными после вставки (несколько сил подряд): в сценариях перед двойным щелчком — `v` (выделение), а перед горячими клавишами — снять фокус с поля панели свойств (`document.activeElement.blur()`), иначе буква уйдёт в поле.
- Только что вставленный объект выделен: щелчок следующим инструментом по нему может попасть в ручку рамки — в сценариях перед щелчком `Escape`.
- В 3D-редакторе подсказка режима меняет высоту диалога, и он смещается: в сценариях измерять окно просмотра перед каждым щелчком (`e2e/stereo-space.cjs`, `screenOf`).
- В одной папке нельзя держать `x.ts` и `x.tsx`: импорт `./x` берёт `.ts` (так ломались `dynamics`, `circuit`).
- Prettier в проекте не настроен; по умолчанию (80 колонок) он переформатирует весь файл. Если нужен — `npx prettier --single-quote --print-width 200 --trailing-comma all --object-wrap collapse` и только для своих файлов.

**Git:**
- Коммитить в ветку `stage-1-architecture`, отправлять `git push origin stage-1-architecture`.
- Сообщение коммита на русском, в конце две строки атрибуции из системного напоминания (`Co-Authored-By: …` и `Claude-Session: …`).
- Изменения идут через пулл-реквест в `main` (см. раздел 7). Новые PR без просьбы пользователя не создавать.

## 7. Открытые вопросы

- **Домен и почта для certbot (этап 9)** — пользователь решит позже. В `deploy/` и README их нужно сделать параметрами (`DOMAIN`, `CERTBOT_EMAIL`), а не зашивать.

### Решено пользователем (не переспрашивать)

0. **Порядок этапов:** 6.5 (многие переменные, ДУ, комплексные числа, вероятность, дискретная математика) отложен до окончания физики (этапы 7.1–7.8); после физики вернуться к 6.5a.
   **Этапы 7.6 (гидростатика, молекулярная физика, термодинамика) и 7.7 (оптика) пропущены** по решению пользователя; сразу 7.8. Черновик термодинамики (коммит `a282ccb`: `frontend/src/physics/thermo/{thermo.ts,plot.tsx,gas.tsx}` — расчёты, диаграммы, объекты «Газ в цилиндре», «Изопроцесс», «Цикл») к доске не подключён (нет `plugin.ts`); вернуться к нему, только если пользователь попросит.

1. **Ветка и PR.** Ветка `main` нужна, работа идёт через пулл-реквесты. `main` создана на коммите этапа 1 (`21e5b4a`); PR #1 из `stage-1-architecture` в `main` содержит этапы 2.1–7.1a (описание на GitHub устарело — оно про 2.1–3.3). Новые этапы коммитить в `stage-1-architecture` (этот PR) или по договорённости в отдельные ветки от `main`.
2. **Распознавание рукописных формул (этап 5.3)** — выбор оставлен за нами, выбрана своя установка pix2tex (LaTeX-OCR): отдельный необязательный контейнер с HTTP-обёрткой в Docker Compose (профиль `ocr`). Причины: рукописи школьников не уходят во внешний сервис, нет ключа API и оплаты. Интерфейс через `FORMULA_OCR_URL` оставить совместимым и с внешними сервисами; пустая переменная выключает функцию.
3. **Выдача досок отдельным ученикам — без ограничений:** учитель может выдать доску любому ученику, не только из своих классов. Классы — по-прежнему только свои. Текущее поведение верное, менять не нужно.
4. **Ученик в режиме «Совместная работа» по умолчанию не меняет чужие ученические объекты;** разрешает это настройка доски `allowStudentsEditOthers`. Подтверждено.
