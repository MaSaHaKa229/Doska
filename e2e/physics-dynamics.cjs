// Сквозной сценарий динамики (этап 7.2b): наклонная плоскость (μ с панели
// свойств, пуск у ученика), пружинный маятник (пуск, «Графики» x(t) и v(t)),
// неупругое столкновение, блок с грузами, рычаг — плечо ручкой; ученик видит всё.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/physics-dynamics.cjs <classId> (его печатает e2e/setup.mts)');

async function login(browser, login) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${login}] pageerror`, e.message));
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
const M = 'physics.mechanics.';
const one = async (page, type) => (await page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type))[0];

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/dynamics-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Динамика 7.2b', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  // Мелко: все пять чертежей на одном экране, мир = экран / 0,5.
  const Z = 0.5;
  await teacher.evaluate(([w, h, z]) => window.__doska.store.getState().setCamera({ cx: w / 2 / z, cy: h / 2 / z, zoom: z }), [box.width, box.height, Z]);
  const at = (x, y) => [box.x + x * Z, box.y + y * Z];
  const pick = async (title) => {
    await teacher.getByRole('button', { name: 'Механика: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Механика' }).getByRole('button', { name: title, exact: true }).click();
  };
  const button = (name) => teacher.getByRole('button', { name, exact: true });
  const place = async (title, x, y, type) => {
    await teacher.keyboard.press('Escape');
    await pick(title);
    await teacher.mouse.click(...at(x, y));
    await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), title + ' у ученика', type);
    return one(teacher, type);
  };
  const start = async (id) => {
    await teacher.evaluate(() => document.activeElement?.blur());
    await button('▶ Пуск / пауза').click();
    await waitStore(student, (i) => window.__doska.model.getObject(i).props.play.running, 'пуск у ученика', id);
  };

  // 1. Наклонная плоскость: μ = 0,1 на панели свойств, пуск.
  const inc = await place('Наклонная плоскость', 80, 700, M + 'incline');
  await teacher.getByLabel('μ').fill('0.1');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.mu === 0.1, 'μ = 0,1 у ученика', inc.id);
  await start(inc.id);
  ok('наклонная плоскость: μ = 0,1, брусок соскальзывает — у ученика тоже');

  // 2. Пружинный маятник: пуск и графики.
  const spr = await place('Пружинный маятник', 900, 280, M + 'spring');
  await start(spr.id);
  await button('Графики').click();
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'math.analysis.curve').length === 2, 'графики x(t), v(t) у ученика');
  const curves = await teacher.evaluate(() => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'math.analysis.curve').map((o) => o.toJSON().props.text));
  if (!curves[0].includes('cos') || !curves[1].includes('sin')) throw new Error('графики пружины: ' + curves);
  ok('пружинный маятник: колебания и графики x(t) = A cos ωt, v(t)');

  // 3. Неупругое столкновение.
  const col = await place('Столкновение шаров', 300, 1050, M + 'collision');
  await teacher.getByLabel('Упругий').uncheck();
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.elastic === false, 'неупругий у ученика', col.id);
  await start(col.id);
  ok('столкновение: неупругий удар, пуск у ученика');

  // 4. Блок с грузами.
  const pul = await place('Блок с грузами', 1350, 900, M + 'pulley');
  await start(pul.id);
  ok('блок с грузами: пуск у ученика');

  // 5. Рычаг: правое плечо ручкой 1 м → 2 м.
  const lev = await place('Рычаг', 1050, 1250, M + 'lever');
  // Ручка — на конце наклонённого рычага: берём её положение у модуля.
  const handle = await teacher.evaluate(async (id) => {
    const o = window.__doska.model.getObject(id);
    return window.__doska.model.get(id).module.getHandles(o, window.__doska.model.resolve).find((h) => h.id === 'l2').position;
  }, lev.id);
  const end = at(handle.x, handle.y);
  await teacher.mouse.move(...end);
  await teacher.mouse.down();
  await teacher.mouse.move(...at(1050 + 2 * lev.props.scale, 1252), { steps: 6 });
  await teacher.mouse.up();
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.l2 === 2, 'плечо l₂ = 2 м у ученика', lev.id);
  ok('рычаг: плечо l₂ = 2 м ручкой — перевешивает правое плечо, у ученика тоже');

  await teacher.keyboard.press('Escape');
  await teacher.evaluate(() => window.__doska.commands.fit(false));
  await student.evaluate(() => window.__doska.commands.fit(false));
  await teacher.waitForTimeout(700);
  await student.screenshot({ path: OUT + '/dynamics-1-student.png' });
  ok('ученик видит все пять чертежей');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
