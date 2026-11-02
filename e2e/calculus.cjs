// Сквозной сценарий анализа на графике (этап 6.2b): касательная с ручкой,
// нули и экстремумы, площадь под графиком, суммы Римана (число отрезков —
// на панели), Тейлор для sin x; ученик видит касательную в новой точке.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/calculus.cjs <classId> (его печатает e2e/setup.mts)');

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
const A = 'math.analysis.';
const first = (page, type) => page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].find((o) => o.get('type') === t)?.toJSON() ?? null, type);
const has = (page, type) => waitStore(page, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), type, type);

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Анализ 6.2b', classIds: [classId], mode: 'LECTURE' }) });
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
    await teacher.getByRole('button', { name: 'Анализ на графике: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Анализ на графике' }).getByRole('button', { name: title, exact: true }).click();
  };

  // Парабола y = x² − 2x − 3 на осях с центром в середине экрана.
  await teacher.keyboard.press('g');
  await teacher.mouse.click(box.x + 520, box.y + 330);
  await dlg.getByLabel('Запись графика').fill('y = x^2 - 2x - 3');
  await dlg.getByRole('button', { name: 'Построить' }).click();
  await has(teacher, A + 'curve');
  const axes = await first(teacher, A + 'axes');
  // Мировые координаты точки графика.
  const W = (X) => {
    const p = axes.props;
    const Y = X * X - 2 * X - 3;
    return { x: sx(axes.x + ((X - p.xMin) / (p.xMax - p.xMin)) * p.w), y: sy(axes.y + ((p.yMax - Y) / (p.yMax - p.yMin)) * p.h) };
  };

  // 1. Нули и экстремумы.
  await pick('Нули функции');
  await teacher.mouse.click(W(2).x, W(2).y);
  await has(teacher, A + 'roots');
  await pick('Экстремумы');
  await teacher.mouse.click(W(-1).x, W(-1).y);
  await has(teacher, A + 'extrema');
  const found = await teacher.evaluate(async () => {
    const { graphOf, roots, extrema } = await import('/src/math/analysis/calculus.ts');
    const c = [...window.__doska.model.doc.getMap('objects').values()].find((o) => o.get('type') === 'math.analysis.curve').get('id');
    const g = graphOf(c, window.__doska.model.resolve);
    return { r: roots(g.f, g.frame.xMin, g.frame.xMax).map((x) => Math.round(x * 1e4) / 1e4), e: extrema(g.f, g.frame.xMin, g.frame.xMax).map((p) => [Math.round(p.x * 1e4) / 1e4, Math.round(p.y * 1e4) / 1e4]) };
  });
  if (found.r.join() !== '-1,3' || found.e.join() !== '1,-4') throw new Error('особые точки: ' + JSON.stringify(found));
  ok('нули x = −1 и x = 3, минимум (1; −4)');

  // 2. Касательная в x = 2, затем ручкой в x ≈ 3; ученик видит новую точку касания.
  await pick('Касательная к графику');
  await teacher.mouse.click(W(2).x, W(2).y);
  await has(teacher, A + 'tangent');
  const tan = await first(teacher, A + 'tangent');
  if (Math.abs(tan.props.x - 2) > 0.1) throw new Error('касательная: ' + tan.props.x);
  const from = W(tan.props.x);
  await teacher.mouse.move(from.x, from.y);
  await teacher.mouse.down();
  const to = W(3);
  for (let i = 1; i <= 8; i++) await teacher.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await teacher.mouse.up();
  await waitStore(student, (id) => Math.abs(window.__doska.model.getObject(id).props.x - 3) < 0.15, 'ученик видит касательную в x ≈ 3', tan.id);
  ok('касательная в x = 2, перетащена ручкой в x ≈ 3 — ученик видит');

  // 3. Площадь под графиком и суммы Римана.
  await pick('Площадь под графиком');
  await teacher.mouse.click(W(-1).x, W(-1).y);
  await has(teacher, A + 'area');
  await pick('Суммы Римана');
  await teacher.mouse.click(W(4).x, W(4).y);
  await has(teacher, A + 'riemann');
  const rie = await first(teacher, A + 'riemann');
  await teacher.evaluate((id) => window.__doska.store.getState().setSelection([id]), rie.id);
  const nField = teacher.getByRole('group', { name: 'Свойства выделения' }).or(teacher.locator('[aria-label="Свойства выделения"]')).getByLabel('Отрезков');
  await nField.fill('20');
  await nField.press('Enter');
  await waitStore(student, (id) => window.__doska.model.getObject(id).props.n === 20, 'n = 20 у ученика', rie.id);
  ok('площадь под графиком и суммы Римана, n = 20 с панели свойств');

  // 4. Второй график 2sin x и многочлен Тейлора (фокус уходит из поля панели свойств).
  await teacher.evaluate(() => document.activeElement?.blur());
  await teacher.keyboard.press('g');
  await teacher.mouse.click(sx(axes.x + 20), sy(axes.y + 20));
  await dlg.getByLabel('Запись графика').fill('y = 2sin(x)');
  await dlg.getByRole('button', { name: 'Построить' }).click();
  await waitStore(teacher, (t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).length === 2, 'второй график', A + 'curve');
  const sinPt = { x: sx(axes.x + ((0 - axes.props.xMin) / (axes.props.xMax - axes.props.xMin)) * axes.props.w), y: sy(axes.y + (axes.props.yMax / (axes.props.yMax - axes.props.yMin)) * axes.props.h) };
  await pick('Многочлен Тейлора');
  await teacher.mouse.click(sinPt.x + 1, sinPt.y);
  await has(teacher, A + 'taylor');
  const tay = await first(teacher, A + 'taylor');
  const coeffs = await teacher.evaluate(async (t) => {
    const { graphOf, taylor } = await import('/src/math/analysis/calculus.ts');
    const g = graphOf(t.deps[0], window.__doska.model.resolve);
    return taylor(g, t.props.x0, t.props.n).coeffs.map((c) => Math.round(c * 1e4) / 1e4);
  }, tay);
  if (Math.abs(coeffs[1] - 2) > 0.05) throw new Error('Тейлор: ' + coeffs);
  ok(`многочлен Тейлора T₃ для 2sin x в x₀ ≈ 0: коэффициенты ${coeffs.join('; ')}`);
  await teacher.waitForTimeout(600);
  await teacher.screenshot({ path: OUT + '/c1-calculus.png' });
  await student.screenshot({ path: OUT + '/c2-student.png' });

  await browser.close();
  console.log('ВСЁ ПРОШЛО');
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
