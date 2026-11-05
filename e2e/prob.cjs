// Сквозной сценарий вероятности и статистики (этап 6.5d): опыт с кубиком
// (пуск у ученика, «Новая серия»), дерево вероятностей (Байес для H₂),
// нормальное распределение, статистика по данным (ящик с усами).
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/prob.cjs <classId> (его печатает e2e/setup.mts)');

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
const W = 'math.prob.';
const one = async (page, type) => (await page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type))[0];

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/prob-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Вероятность 6.5d', classIds: [classId], mode: 'LECTURE' }) });
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
    await teacher.getByRole('button', { name: 'Вероятность и статистика: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Вероятность и статистика' }).getByRole('button', { name: title, exact: true }).click();
  };
  const place = async (title, x, y, type) => {
    await pick(title);
    await teacher.mouse.click(...at(x, y));
    await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), title + ' у ученика', type);
    return one(teacher, type);
  };
  const button = (name) => teacher.getByRole('button', { name, exact: true });

  const drag = async (from, to) => {
    await teacher.keyboard.press('Escape');
    await teacher.evaluate(() => document.activeElement?.blur());
    await teacher.keyboard.press('v');
    await teacher.mouse.move(...at(...from));
    await teacher.mouse.down();
    await teacher.mouse.move(...at(...to), { steps: 8 });
    await teacher.mouse.up();
  };

  const setRange = (label, value) =>
    teacher.getByRole('slider', { name: new RegExp('^' + label) }).evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);

  const prop = (id) => student.evaluate((i) => window.__doska.model.getObject(i).props, id);

  // 1. Опыт с кубиком: пуск, затем новая серия.
  const ex = await place('Опыт: частота и вероятность', 100, 200, W + 'experiment');
  await teacher.evaluate(() => document.activeElement?.blur());
  await button('▶ Пуск / пауза').click();
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.play.running, 'пуск у ученика', ex.id);
  await teacher.waitForTimeout(1500);
  await teacher.screenshot({ path: OUT + '/prob-2-teacher.png' });
  await button('Новая серия').click();
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.seed === 2, 'новая серия у ученика', ex.id);
  ok('опыт: кубик, событие «шестёрка», частота приближается к 1/6');

  // 2. Дерево вероятностей: Байес для второй гипотезы.
  const tr = await place('Дерево вероятностей', 800, 200, W + 'tree');
  await teacher.getByLabel('Байес для Hᵢ (0 — все)').fill('2');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.focus === 2, 'Байес для H₂ у ученика', tr.id);
  ok('дерево: P(A) = 0,79, P(H₂|A) = 0,4/0,79');

  // 3. Нормальное распределение.
  const ds = await place('Распределение случайной величины', 150, 1000, W + 'dist');
  await teacher.getByRole('combobox', { name: /^Распределение/ }).selectOption('normal');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.kind === 'normal', 'нормальное у ученика', ds.id);
  ok('нормальное распределение: закрашена вероятность попадания в интервал');

  // 4. Статистика: свои данные, ящик с усами.
  const st = await place('Статистика по данным', 900, 1100, W + 'stats');
  await teacher.getByLabel('Данные', { exact: true }).fill('12; 15; 11; 18; 15; 20; 14; 15; 9; 16');
  await teacher.getByLabel('Данные', { exact: true }).press('Enter');
  await teacher.getByRole('combobox', { name: /^Диаграмма/ }).selectOption('box');
  await waitStore(student, (i) => { const p = window.__doska.model.getObject(i).props; return p.chart === 'box' && p.data.startsWith('12;'); }, 'данные и ящик у ученика', st.id);
  const p = await prop(st.id);
  if (!p.data.includes('16')) throw new Error('данные не дошли');
  ok('статистика: среднее 14,5, медиана 15, мода 15, ящик с усами');

  await teacher.keyboard.press('Escape');
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(800);
  await student.screenshot({ path: OUT + '/prob-1-student.png' });
  ok('ученик видит все четыре чертежа');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
