// Сквозной сценарий колебаний (этап 7.5a): маятник (пуск у ученика, графики
// x(t) и v(t)), затухающие колебания и переключение на вынужденные
// (резонансная кривая), сложение колебаний (пуск), колебательный контур (пуск).
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/physics-oscillations.cjs <classId> (его печатает e2e/setup.mts)');

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
const W = 'physics.waves.';
const one = async (page, type) => (await page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type))[0];

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/osc-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Колебания 7.5a', classIds: [classId], mode: 'LECTURE' }) });
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
    await teacher.getByRole('button', { name: 'Колебания и волны: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Колебания и волны' }).getByRole('button', { name: title, exact: true }).click();
  };
  const place = async (title, x, y, type) => {
    await pick(title);
    await teacher.mouse.click(...at(x, y));
    await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), title + ' у ученика', type);
    return one(teacher, type);
  };
  const button = (name) => teacher.getByRole('button', { name, exact: true });
  const start = async (id) => {
    await teacher.evaluate(() => document.activeElement?.blur());
    await button('▶ Пуск / пауза').click();
    await waitStore(student, (i) => window.__doska.model.getObject(i).props.play.running, 'пуск у ученика', id);
  };

  // 1. Маятник: пуск, графики x(t) и v(t).
  const pend = await place('Математический маятник', 300, 200, W + 'pendulum');
  await start(pend.id);
  await button('Графики').click();
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'math.analysis.curve').length === 2, 'графики маятника у ученика');
  ok('маятник: качается у ученика, графики x(t) и v(t)');

  // 2. Затухающие → вынужденные.
  const osc = await place('Затухающие и вынужденные колебания', 100, 750, W + 'oscillator');
  await start(osc.id);
  await teacher.getByLabel('Вынужденные').check();
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.forced, 'вынужденные у ученика', osc.id);
  ok('затухающие колебания, затем вынужденные с резонансной кривой');

  // 3. Сложение колебаний.
  const bt = await place('Сложение колебаний', 750, 750, W + 'beats');
  await start(bt.id);
  ok('сложение колебаний 10 Гц и 11 Гц: биения');

  // 4. Колебательный контур.
  const lc = await place('Колебательный контур', 1450, 750, W + 'lc');
  await start(lc.id);
  await teacher.waitForTimeout(700);
  ok('колебательный контур: заряд, ток и энергии меняются');

  await teacher.keyboard.press('Escape');
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(500);
  await student.screenshot({ path: OUT + '/osc-1-student.png' });
  ok('ученик видит все чертежи колебаний');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
