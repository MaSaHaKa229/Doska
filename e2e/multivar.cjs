// Сквозной сценарий функций нескольких переменных (этап 6.5a): поверхность
// (поворот ползунком на рисунке, новая функция — у ученика), линии уровня
// (точка M перетаскиванием), векторное поле (источник: P = x, Q = y).
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/multivar.cjs <classId> (его печатает e2e/setup.mts)');

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
const W = 'math.multivar.';
const one = async (page, type) => (await page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type))[0];

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/multivar-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Многие переменные 6.5a', classIds: [classId], mode: 'LECTURE' }) });
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
    await teacher.getByRole('button', { name: 'Функции нескольких переменных: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Функции нескольких переменных' }).getByRole('button', { name: title, exact: true }).click();
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

  // 1. Поверхность: поворот ползунком на рисунке, затем другая функция.
  const sf = await place('Поверхность z = f(x, y)', 350, 450, W + 'surface');
  await drag([350 + sf.props.yaw, 450 + 330], [350 + 100, 450 + 330]);
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.yaw === 100, 'поворот 100° у ученика', sf.id);
  await teacher.mouse.click(...at(350, 450));
  await teacher.getByLabel('z = f(x, y) =').fill('sin(x)·cos(y)');
  await teacher.getByLabel('z = f(x, y) =').press('Enter');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.f === 'sin(x)·cos(y)', 'новая функция у ученика', sf.id);
  ok('поверхность: поворот ползунком, z = sin(x)·cos(y) у ученика');

  // 2. Линии уровня: точка M перетаскивается без выделения.
  const ct = await place('Линии уровня и градиент', 850, 150, W + 'contours');
  await drag([850 + 285, 150 + 142.5], [850 + 95, 150 + 95]);
  await waitStore(student, (i) => { const p = window.__doska.model.getObject(i).props; return Math.abs(p.x0 + 2) < 0.15 && Math.abs(p.y0 - 2) < 0.15; }, 'M(−2; 2) у ученика', ct.id);
  ok('линии уровня: точка M перенесена, градиент перпендикулярен линии уровня');

  // 3. Векторное поле: источник.
  const fd = await place('Векторное поле', 1450, 150, W + 'field');
  await teacher.getByLabel('P(x, y) =').fill('x');
  await teacher.getByLabel('P(x, y) =').press('Enter');
  await teacher.getByLabel('Q(x, y) =').fill('y');
  await teacher.getByLabel('Q(x, y) =').press('Enter');
  await waitStore(student, (i) => { const p = window.__doska.model.getObject(i).props; return p.P === 'x' && p.Q === 'y'; }, 'поле (x; y) у ученика', fd.id);
  await teacher.waitForTimeout(400);
  await teacher.screenshot({ path: OUT + '/multivar-2-teacher.png' });
  ok('векторное поле (x; y): div = 2 — источник, rot = 0');

  await teacher.keyboard.press('Escape');
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(800);
  await student.screenshot({ path: OUT + '/multivar-1-student.png' });
  ok('ученик видит все три чертежа');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
