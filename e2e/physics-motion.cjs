// Сквозной сценарий кинематики (этап 7.2a): бросок под углом — параметры на
// панели свойств, «▶ Пуск / пауза» (анимация идёт и у ученика), пауза на
// текущем времени, «Сначала»; движение по окружности из примера в диалоге,
// «Графики» — x(t) и y(t) на осях с подписями.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/physics-motion.cjs <classId> (его печатает e2e/setup.mts)');

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
const all = (page, type) => page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type);
const props = (page, id) => page.evaluate((i) => window.__doska.model.getObject(i).props, id);

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/motion-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Кинематика 7.2a', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  await teacher.evaluate(([w, h]) => window.__doska.store.getState().setCamera({ cx: w / 2, cy: h / 2, zoom: 1 }), [box.width, box.height]);
  const at = (x, y) => [box.x + x, box.y + y];
  const dlg = teacher.locator('dialog[open]');
  const pick = async (title) => {
    await teacher.getByRole('button', { name: 'Механика: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Механика' }).getByRole('button', { name: title, exact: true }).click();
  };
  const button = (name) => teacher.getByRole('button', { name, exact: true });

  // 1. Бросок под углом; v₀ = 12 м/с на панели свойств.
  await pick('Бросок под углом');
  await teacher.mouse.click(...at(120, 420));
  await waitStore(teacher, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), 'бросок', M + 'throw');
  const [thr] = await all(teacher, M + 'throw');
  await teacher.getByLabel('v₀, м/с').fill('12');
  await waitStore(student, (id) => window.__doska.model.getObject(id).props.v0 === 12, 'v₀ = 12 у ученика', thr.id);
  ok('бросок под углом 45°, v₀ = 12 м/с — с панели свойств, у ученика тоже');

  // 2. Пуск: момент пуска в документе, ученик видит движение; пауза — на текущем времени.
  await teacher.evaluate(() => document.activeElement?.blur());
  await button('▶ Пуск / пауза').click();
  await waitStore(student, (id) => window.__doska.model.getObject(id).props.play.running === true, 'пуск у ученика', thr.id);
  await teacher.waitForTimeout(700);
  await student.screenshot({ path: OUT + '/motion-1-flight.png' });
  await button('▶ Пуск / пауза').click();
  await waitStore(student, (id) => window.__doska.model.getObject(id).props.play.running === false, 'пауза у ученика', thr.id);
  const paused = (await props(student, thr.id)).play;
  if (!(paused.t0 > 0.4 && paused.t0 < 1.7)) throw new Error('пауза не на текущем времени: ' + JSON.stringify(paused));
  ok(`пуск и пауза — у ученика тоже; пауза на t = ${paused.t0.toFixed(2)} с`);
  await button('⟲ Сначала').click();
  await waitStore(student, (id) => window.__doska.model.getObject(id).props.play.t0 === 0, '«Сначала» у ученика', thr.id);
  ok('«Сначала» возвращает t = 0');

  // 3. Движение по окружности из примера; «Графики» — x(t) и y(t).
  await teacher.keyboard.press('Escape');
  await pick('Движение по закону');
  await teacher.mouse.click(...at(820, 330));
  await dlg.getByLabel('Пример движения').selectOption({ index: 5 });
  await dlg.getByText('Путь по x').waitFor();
  await dlg.getByRole('button', { name: 'Вставить' }).click();
  await dlg.waitFor({ state: 'detached' });
  const [mot] = await all(teacher, M + 'motion');
  if (mot.props.x !== '3cos(t)' || mot.props.y !== '3sin(t)') throw new Error('закон: ' + JSON.stringify(mot.props));
  await button('Графики').click();
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'math.analysis.curve').length === 2, 'два графика у ученика');
  const labels = (await all(teacher, 'math.analysis.axes')).map((a) => a.props.yLabel).sort();
  if (JSON.stringify(labels) !== JSON.stringify(['x, м', 'y, м'])) throw new Error('графики: ' + labels);
  ok('движение по окружности R = 3 м; «Графики» — x(t) и y(t) с подписями осей');
  await button('▶ Пуск / пауза').click();
  await teacher.keyboard.press('Escape');
  await teacher.evaluate(() => window.__doska.commands.fit(false));
  await teacher.waitForTimeout(1200);
  await teacher.screenshot({ path: OUT + '/motion-2-board.png' });
  ok('движение запущено, снимок доски во время анимации');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
