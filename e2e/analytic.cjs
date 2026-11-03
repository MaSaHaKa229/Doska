// Сквозной сценарий аналитической геометрии (этап 6.3a): гипербола по
// уравнению (асимптоты, фокусы, каноническое уравнение), прямая, точка и
// расстояние до прямой, векторы протяжкой и их сумма; ученик видит всё.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/analytic.cjs <classId> (его печатает e2e/setup.mts)');

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
const T = 'math.analytic.';
const first = (page, type) => page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].find((o) => o.get('type') === t)?.toJSON() ?? null, type);
const count = (page, type, n) => waitStore(page, ([t, k]) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).length === k, `${type}: ${n}`, [type, n]);

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Аналитическая геометрия 6.3a', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  const cam = await teacher.evaluate(() => { const s = window.__doska.store.getState(); return s.cameras[s.pageId]; });
  const sx = (x) => box.x + box.width / 2 + (x - cam.cx) * cam.zoom;
  const sy = (y) => box.y + box.height / 2 + (y - cam.cy) * cam.zoom;
  const dlg = teacher.locator('dialog[open]');
  const pick = async (title) => {
    await teacher.getByRole('button', { name: 'Аналитическая геометрия: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Аналитическая геометрия' }).getByRole('button', { name: title, exact: true }).click();
  };

  // 1. Гипербола по уравнению: оси создаются вокруг щелчка.
  await pick('Кривая второго порядка');
  await teacher.mouse.click(box.x + 520, box.y + 330);
  await dlg.getByLabel('Уравнение').fill('x^2/9 - y^2/4 = 1');
  await dlg.getByTestId('equation-status').getByText('Гипербола: x²/9 − y²/4 = 1').waitFor();
  await dlg.getByRole('button', { name: 'Построить' }).click();
  await count(teacher, T + 'conic', 1);
  ok('гипербола x²/9 − y²/4 = 1: каноническое уравнение, a = 3, b = 2 — в диалоге и на доске');

  const axes = await first(teacher, 'math.analysis.axes');
  const P = axes.props;
  const S = (X, Y) => ({ x: sx(axes.x + ((X - P.xMin) / (P.xMax - P.xMin)) * P.w), y: sy(axes.y + ((P.yMax - Y) / (P.yMax - P.yMin)) * P.h) });

  // 2. Прямая и точка; расстояние от точки до прямой.
  await pick('Прямая по уравнению');
  await teacher.mouse.click(S(-6, 4).x, S(-6, 4).y);
  await dlg.getByLabel('Уравнение').fill('3x + 4y - 12 = 0');
  await dlg.getByRole('button', { name: 'Построить' }).click();
  await count(teacher, T + 'line', 1);
  await pick('Точка по координатам');
  await teacher.mouse.click(S(-2, -3).x, S(-2, -3).y);
  await count(teacher, T + 'point', 1);
  await pick('Расстояние от точки до прямой');
  await teacher.mouse.click(S(-2, -3).x, S(-2, -3).y);
  // Точка прямой 3x + 4y = 12 при x = 0: y = 3.
  await teacher.mouse.click(S(0, 3).x, S(0, 3).y);
  await count(teacher, T + 'measure', 1);
  const dist = await teacher.evaluate(async () => {
    const { measureOf } = await import('/src/math/analytic/objects.tsx');
    const m = [...window.__doska.model.doc.getMap('objects').values()].find((o) => o.get('type') === 'math.analytic.measure').get('id');
    return measureOf(window.__doska.model.getObject(m), window.__doska.model.resolve).text;
  });
  if (!dist.endsWith('= 6')) throw new Error('расстояние: ' + dist);
  ok(`расстояние от M(−2; −3) до 3x + 4y − 12 = 0: ${dist}`);

  // 3. Векторы протяжкой и их сумма.
  await pick('Вектор с координатами');
  const drag = async (a, b) => {
    await teacher.mouse.move(a.x, a.y);
    await teacher.mouse.down();
    for (let i = 1; i <= 6; i++) await teacher.mouse.move(a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6);
    await teacher.mouse.up();
  };
  await drag(S(-6, -4), S(-3, -3));
  await pick('Вектор с координатами');
  await drag(S(-6, -4), S(-5, -2));
  await count(teacher, T + 'vector', 2);
  await pick('Сумма векторов');
  await teacher.mouse.click(S(-4.5, -3.5).x, S(-4.5, -3.5).y);
  await teacher.mouse.click(S(-5.5, -3).x, S(-5.5, -3).y);
  await count(student, T + 'vecop', 1);
  const vs = await teacher.evaluate(() => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'math.analytic.vector').map((o) => o.get('props')));
  if (vs.map((v) => `${v.name}(${v.X};${v.Y})`).join() !== 'a(3;1),b(1;2)') throw new Error('векторы: ' + JSON.stringify(vs));
  ok('векторы a(3; 1) и b(1; 2) протяжкой, сумма по правилу параллелограмма — у ученика');

  await teacher.waitForTimeout(700);
  await teacher.screenshot({ path: OUT + '/a1-analytic.png' });
  await student.screenshot({ path: OUT + '/a2-student.png' });
  await browser.close();
  console.log('ВСЁ ПРОШЛО');
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
