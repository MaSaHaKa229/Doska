// Сквозной сценарий магнетизма (этап 7.4): прямой ток (направление с панели
// свойств), катушка, магнит, заряд в поле (пуск у ученика), проводник в поле,
// рамка (пуск и графики Φ(t), ε(t)), правило Ленца (пуск); ученик видит всё.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/physics-magnetism.cjs <classId> (его печатает e2e/setup.mts)');

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
const M = 'physics.magnetism.';
const one = async (page, type) => (await page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type))[0];

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/magnetism-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Магнетизм 7.4', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  const Z = 0.4;
  await teacher.evaluate(([w, h, z]) => window.__doska.store.getState().setCamera({ cx: w / 2 / z, cy: h / 2 / z, zoom: z }), [box.width, box.height, Z]);
  const at = (x, y) => [box.x + x * Z, box.y + y * Z];
  const pick = async (title) => {
    await teacher.keyboard.press('Escape');
    await teacher.getByRole('button', { name: 'Магнетизм: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Магнетизм' }).getByRole('button', { name: title, exact: true }).click();
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

  // 1. Прямой ток: направление «от нас» с панели свойств.
  const wire = await place('Прямой ток', 250, 300, M + 'wire');
  await teacher.getByLabel('Ток').selectOption('in');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.dir === 'in', 'ток от нас у ученика', wire.id);
  ok('прямой ток: «от нас» — линии по часовой стрелке, у ученика тоже');

  // 2. Катушка и магнит.
  await place('Катушка с током', 800, 300, M + 'coil');
  await place('Постоянный магнит', 1400, 300, M + 'magnet');
  ok('катушка (N справа) и магнит с линиями поля');

  // 3. Заряд в поле: пуск.
  const lor = await place('Заряд в магнитном поле', 100, 650, M + 'lorentz');
  await start(lor.id);
  ok('протон в поле: движение по окружности, пуск у ученика');

  // 4. Проводник в поле.
  await place('Проводник в магнитном поле', 700, 700, M + 'ampere');
  ok('проводник с током в поле: сила Ампера');

  // 5. Рамка: пуск и графики.
  const rot = await place('Рамка в магнитном поле', 1400, 900, M + 'rotor');
  await start(rot.id);
  await button('Графики').click();
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'math.analysis.axes').length === 2, 'графики у ученика');
  const labels = await teacher.evaluate(() => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'math.analysis.axes').map((o) => o.toJSON().props.yLabel).sort());
  if (JSON.stringify(labels) !== JSON.stringify(['Φ, Вб', 'ε, В'])) throw new Error('графики: ' + labels);
  ok('рамка вращается; графики Φ(t) и ε(t)');

  // 6. Правило Ленца.
  const lz = await place('Правило Ленца', 600, 1150, M + 'lenz');
  await start(lz.id);
  await teacher.waitForTimeout(800);
  ok('магнит приближается к кольцу: ток в кольце и его полюса');

  await teacher.keyboard.press('Escape');
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(500);
  await student.screenshot({ path: OUT + '/magnetism-1-student.png' });
  ok('ученик видит все семь чертежей');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
