# Система плагинов

Интерфейсы: `packages/shared/src/plugins/types.ts`, реестр: `packages/shared/src/plugins/registry.ts`.

## 1. Идея

Ядро доски отвечает за холст, камеру, выделение, трансформации, слои, привязки, undo/redo, синхронизацию, права, экспорт, палитру Ctrl+K и панели.
Оно **ничего не знает** о линзах, зарядах или графиках функций.
Каждый раздел ТЗ («Математика → Планиметрия», «Физика → Оптика» …) оформлен как плагин, который регистрирует:

| Сущность | Интерфейс | Зачем |
|---|---|---|
| Модули объектов | `ObjectModule` | как объект хранится, рисуется, выделяется, редактируется |
| Инструменты | `ToolModule` | как объект создаётся указателем или стилусом; иконка, горячая клавиша, ключевые слова |
| Команды | `CommandDescriptor` | пункты палитры Ctrl+K («Вставить: плоский конденсатор») |
| Шаблоны | `TemplateDescriptor` | готовые доски-задачи для библиотеки |
| Справочник | `ReferenceEntry` | формулы раздела для справочника |
| Воркеры | `workers` | тяжёлые вычисления (силовые линии, RK4, ход лучей) |

Сервер плагинов не знает. Он проверяет базовые поля, размер и JSON-природу `props`, но не их семантику. Поэтому для нового раздела **не нужно менять ни ядро, ни сервер**.

## 2. Модуль объекта

У каждого типа объекта обязательно есть `render`, `hitTest`, `serialize`/`deserialize` и `getHandles`, а также `getLocalBounds`, `propsSchema` и `createProps`.

```ts
export const lensModule: ObjectModule<LensProps, ReactNode> = {
  type: 'physics.optics.lens',
  title: 'Линза',
  version: 1,
  propsSchema: z.object({
    kind: z.enum(['converging', 'diverging']),
    focal: z.number().positive(),
    height: z.number().positive(),
    showFocus: z.boolean(),
    label: z.string().max(20),
  }),
  createProps: () => ({ kind: 'converging', focal: 120, height: 160, showFocus: true, label: '' }),
  serialize: (o) => o,
  deserialize: (raw) => ({ ...raw, props: lensModule.propsSchema.parse(raw.props) }),
  getLocalBounds: (o) => ({ x: -o.props.focal * 2, y: -o.props.height / 2, width: o.props.focal * 4, height: o.props.height }),
  hitTest: (o, p, tol, ctx) => /* расстояние до тела линзы в локальных координатах */,
  getHandles: (o) => [{ id: 'focus', kind: 'param', position: /* F в мировых */, label: 'Фокус F' }],
  dragHandle: (o, id, to) => ({ props: { focal: /* |to - центр| вдоль оси */ } }),
  getSnapPoints: (o) => [/* центр, F, 2F по обе стороны */],
  render: (o, ctx) => <LensShape obj={o} ctx={ctx} />,
  toSVG: (o, ctx) => '<g>…</g>',
  inspector: [
    { kind: 'select', key: 'kind', label: 'Тип', options: [/* … */] },
    { kind: 'number', key: 'focal', label: 'Фокусное расстояние', min: 10, max: 2000, unit: 'ед.', slider: true },
  ],
  transform: { rotatable: true, resize: 'none' },
};
```

Правила:
- Геометрия описывается в **локальных** координатах; `x/y/rotation/scale` применяет ядро.
- `render` — чистая функция объекта и контекста. Она не обращается к Yjs и не пишет в документ.
- Изменения идут только через возвращаемые патчи (`dragHandle`) или через `ToolContext`. Ядро само оборачивает их в транзакции, ставит `updatedBy/updatedAt` и заранее проверяет права.
- Тяжёлые вычисления объявляются в `compute: { job, input }`. Ядро запускает задание в воркере при изменении входа, отменяет устаревшие задания и кэширует результат. `render` получает его через `ctx.getComputed(id)`.
- Зависимые объекты перечисляют опоры в `deps` и читают их через `ctx.getObject`.
- `derived: true` — геометрия задаётся опорами (динамическая геометрия, 6.1a): `x/y/rotation/scale` не используются, `render`, габарит и попадание — в мировых координатах. Перемещение такого объекта двигает его свободные опоры (`BoardModel.movableSet`), а изменения пишутся по ходу жеста, чтобы построения на опорах перестраивались у всех сразу. Построения пересчитываются ядром в топологическом порядке (`refreshOrder`) без записи в документ.
- `hitPriority` — приоритет при выборе под курсором (точка берётся раньше отрезка через неё); ручку такого объекта можно тянуть без предварительного выделения (точка на окружности). `unbounded: true` — объект уходит за габарит (прямая, луч): он виден при любой области, а габарит описывает только опорную часть.
- Опорные точки, созданные инструментом вместе с построением, помечаются `props.auto = true`: ядро удаляет их вместе с последним построением на них. Удаление опоры с построениями спрашивает подтверждение («удалить вместе с ними / отмена»); ластик удаляет построения вместе с опорой. Копирование построения копирует и его опоры.

## 3. Инструмент

```ts
export const lensTool: ToolModule<ReactNode> = {
  id: 'physics.optics.lens',
  title: 'Собирающая линза',
  icon: 'Circle',
  group: 'physics',
  section: 'physics.optics',
  hotkey: 'Shift+L',
  keywords: ['линза', 'собирающая', 'оптика', 'фокус'],
  requiresWrite: true,
  snapping: true,
  onPointerUp: (e, ctx) => {
    const id = ctx.createObject('physics.optics.lens', { x: e.snapped.x, y: e.snapped.y, props: lensModule.createProps() });
    ctx.setSelection([id]);
    ctx.activateTool('core.select');
  },
};
```

Ядро само:
- выключает инструменты с `requiresWrite`, когда нет права записи, и показывает подсказку `noWriteHint`;
- собирает инструменты одного `section` в одну кнопку панели (название подраздела — `BoardPlugin.sections[section]`) с раскрывающимся списком (на кнопке — последний выбранный инструмент раздела, заголовок списка — `title` плагина с этим id);
- передаёт инструменту клавиши (`onKeyDown`) раньше горячих клавиш доски и вызывает `onActivate`/`onDeactivate` при смене инструмента;
- даёт инструменту выделение (`ctx.getSelection()`) и список объектов страницы (`ctx.listObjects(type)`) — например, чтобы выбрать свободную подпись точки;
- предупреждает о конфликтах горячих клавиш (`registry.warnings`);
- включает инструменты в палитру Ctrl+K через `title` и `keywords`.

## 4. Пространства имён

- `id` плагина: `core`, `math.planimetry`, `physics.optics` … (`PLUGIN_ID_RE`).
- Типы объектов и id инструментов **обязаны** начинаться с `<id плагина>.` — это проверяет `PluginRegistry.register`.
- Плагин может объявить `dependsOn` (например, `physics.optics` зависит от `physics.common` с общим инструментом «Вектор»). Реестр требует, чтобы зависимости были зарегистрированы раньше.
- Регистрация атомарна: если хоть одна проверка не прошла, плагин не добавляется вовсе.

## 5. Подключение (фронтенд, этап 3)

Каждый раздел — папка с файлом `plugin.ts`, который по умолчанию экспортирует `BoardPlugin`:

```
frontend/src/physics/optics/
├── plugin.ts            export default { id: 'physics.optics', … } satisfies BoardPlugin<ReactNode>
├── objects/lens.tsx
├── objects/mirror.tsx
├── tools/…
├── templates/…
└── optics.worker.ts     трассировка лучей (если нужна)
```

Реестр (`frontend/src/plugins/registry.ts`) сначала регистрирует базовый плагин `core` (выделение, рука, группа, фигуры), затем находит разделы через `import.meta.glob(['/src/math/**/plugin.ts', '/src/physics/**/plugin.ts'])` и регистрирует их в порядке зависимостей (`orderByDependencies`). Иконки инструментов задаются именем lucide-react; плагин добавляет свои иконки через `registerIcons` (`frontend/src/ui/icons.ts`).
Каждый раздел попадает в отдельный чанк Vite, а тяжёлые разделы (3D) загружаются при первом использовании.
Чтобы добавить раздел, достаточно **создать папку**: правки в ядре и регистрация вручную не нужны.

## 6. Как добавить новый раздел (кратко)

1. Создайте `frontend/src/<math|physics>/<раздел>/plugin.ts` с `id` вида `physics.<раздел>`.
2. Для каждого типа объекта напишите `ObjectModule` с zod-схемой `props`, функциями `render`, `hitTest`, `getHandles`, `getLocalBounds` и `serialize`/`deserialize`.
3. Напишите `ToolModule` с иконкой, ключевыми словами и, при желании, горячей клавишей.
4. Численные методы поместите в `frontend/src/solvers/` (чистые функции и юнит-тесты), а в модуле объекта объявите `compute`.
5. Добавьте шаблоны и статьи справочника по желанию.
6. Запустите `npm test` и `npm run build`: реестр проверит пространства имён и конфликты.

Подробная пошаговая инструкция с примером появится в README на этапе 9.
