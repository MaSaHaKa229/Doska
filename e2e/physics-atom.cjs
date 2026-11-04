// Сквозной сценарий атома и ядра (этап 7.8b): атом Бора (пуск у ученика,
// переход с n = 4), опыт Резерфорда (пуск), ядро урана-238, радиоактивный
// распад (пуск), ядерная реакция (кнопка «Деление урана» — X = 3 нейтрона).
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/physics-atom.cjs <classId> (его печатает e2e/setup.mts)');

async function login(browser, login) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    console.log(`[${login}] pageerror`, e.message);
    globalThis.__errors = (globalThis.__errors ?? 0) + 1;
  });
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('401') && console.log(`[${login}] console`, m.text()));
  await page.goto(BASE + '/login');
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill('Kot12345e2e');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return page;
}
const waitStore = (page, fn, what, arg) => page.waitForFunction(fn, arg, { timeout: 15000 }).catch(() => { throw new Error('Не дождались: ' + what); });
const ok = (msg) => console.log('✓', msg);
const W = 'physics.modern.';
const one = async (page, type) => (await page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type))[0];

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/atom-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Атом и ядро 7.8b', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  const Z = 0.5;
  await teacher.evaluate(([w, h, z]) => window.__doska.store.getState().setCamera({ cx: w / 2 / z, cy: h / 2 / z, zoom: z }), [box.width, box.height, Z]);
  const at = (x, y) => [box.x + x * Z, box.y + y * Z];
  const pick = async (title) => {
    await teacher.keyboard.press('Escape');
    await teacher.getByRole('button', { name: 'Современная физика: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Современная физика' }).getByRole('button', { name: title, exact: true }).click();
  };
  const place = async (title, x, y, type) => {
    await pick(title);
    await teacher.mouse.click(...at(x, y));
    await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), title + ' у ученика', type);
    return one(teacher, type);
  };
  const button = (name) => teacher.getByRole('button', { name, exact: true });

  // Ползунок панели свойств: значение через «родной» сеттер, чтобы React увидел событие.
  const setRange = (label, value) =>
    teacher.getByRole('slider', { name: new RegExp('^' + label.replace(/[/()]/g, '\\$&')) }).evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  const start = async (id) => {
    await teacher.evaluate(() => document.activeElement?.blur());
    await button('▶ Пуск / пауза').click();
    await waitStore(student, (i) => window.__doska.model.getObject(i).props.play.running, 'пуск у ученика', id);
  };

  // 1. Атом Бора: пуск, верхний уровень n = 4.
  const bohr = await place('Атом водорода (модель Бора)', 300, 330, W + 'bohr');
  await start(bohr.id);
  await setRange('Верхний уровень n', 4);
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.n === 4, 'n = 4 у ученика', bohr.id);
  ok('атом Бора: переход 4 → 2 — голубая линия 486 нм серии Бальмера');

  // 2. Опыт Резерфорда: пуск.
  const ru = await place('Опыт Резерфорда', 1450, 330, W + 'rutherford');
  await start(ru.id);
  await teacher.waitForTimeout(1500);
  await teacher.screenshot({ path: OUT + '/atom-2-teacher.png' });
  ok('опыт Резерфорда: α-частицы летят у ученика');

  // 3. Ядро урана-238.
  const nu = await place('Ядро и энергия связи', 100, 1000, W + 'nucleus');
  await teacher.getByRole('combobox', { name: /^Ядро/ }).selectOption('U-238');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.iso === 'U-238', 'уран-238 у ученика', nu.id);
  ok('ядро урана-238: 92 протона, 146 нейтронов, энергия связи 7,57 МэВ на нуклон');

  // 4. Радиоактивный распад: пуск.
  const de = await place('Радиоактивный распад', 1000, 1000, W + 'decay');
  await start(de.id);
  ok('распад радона-222: ядра распадаются у ученика');

  // 5. Ядерная реакция: деление урана.
  const re = await place('Ядерная реакция', 1750, 1000, W + 'reaction');
  await button('Деление урана').click();
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.eq.startsWith('U235'), 'деление урана у ученика', re.id);
  ok('ядерная реакция: деление урана, X = 3 нейтрона');

  await teacher.keyboard.press('Escape');
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(800);
  await student.screenshot({ path: OUT + '/atom-1-student.png' });
  ok('ученик видит все пять чертежей');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
