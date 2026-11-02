// Сквозной сценарий графиков (этап 6.2a): график из диалога (G) с осями,
// параметры со слайдерами (ученик видит изменение), неравенство, таблица
// значений, числовая прямая, тригонометрическая окружность.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/graphs.cjs <classId> (его печатает e2e/setup.mts)');

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
const list = (page, type) => page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type);
const count = (page, type, n) => waitStore(page, ([t, k]) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).length === k, `${type}: ${n}`, [type, n]);

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Графики 6.2a', classIds: [classId], mode: 'LECTURE' }) });
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
    await teacher.getByRole('button', { name: 'Графики и анализ: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Графики и анализ' }).getByRole('button', { name: title, exact: true }).click();
  };

  // 1. G и щелчок по пустому месту: оси с центром в точке и график с параметрами.
  await teacher.keyboard.press('g');
  await teacher.mouse.click(box.x + 400, box.y + 330);
  await dlg.getByLabel('Запись графика').fill('y = a·x^2 + b');
  await dlg.getByTestId('curve-kind').getByText('параметры: a, b').waitFor();
  await dlg.getByRole('button', { name: 'Построить' }).click();
  await count(teacher, A + 'curve', 1);
  await count(teacher, A + 'slider', 2);
  ok('G: оси, график y = a·x² + b и слайдеры a, b');

  // 2. Слайдер b тянем вправо: график у ученика сдвигается вверх.
  const [, b] = await list(teacher, A + 'slider');
  await teacher.mouse.click(sx(b.x + 100), sy(b.y - 20));
  const hs = await teacher.evaluate((id) => { const e = window.__doska.model.get(id); return e.module.getHandles(e.obj, window.__doska.model.resolve); }, b.id);
  const k = hs[0].position;
  await teacher.mouse.move(sx(k.x), sy(k.y));
  await teacher.mouse.down();
  for (let i = 1; i <= 10; i++) await teacher.mouse.move(sx(k.x + 6 * i), sy(k.y));
  await teacher.mouse.up();
  await waitStore(student, (id) => window.__doska.model.getObject(id).props.value === 4, 'ученик видит b = 4', b.id);
  ok('слайдер b = 4 — ученик видит новое значение');
  await student.waitForTimeout(800);
  await student.screenshot({ path: OUT + '/p1-student.png' });

  // 3. Второй график — неравенство на тех же осях.
  const [axes] = await list(teacher, A + 'axes');
  await teacher.keyboard.press('g');
  await teacher.mouse.click(sx(axes.x + 40), sy(axes.y + 40));
  await dlg.getByLabel('Запись графика').fill('x² + y² ≤ 9');
  await dlg.getByTestId('curve-kind').getByText('Неравенство').waitFor();
  await dlg.getByRole('button', { name: 'Построить' }).click();
  await count(teacher, A + 'curve', 2);
  const curves = await list(teacher, A + 'curve');
  if (curves[1].deps[0] !== axes.id || curves[0].props.color === curves[1].props.color) throw new Error('второй график: ' + JSON.stringify(curves[1]));
  ok('неравенство x² + y² ≤ 9 на тех же осях, другим цветом');

  // 4. Двойной щелчок по графику — правка записи.
  const pt = await teacher.evaluate(async (id) => {
    const { curveState } = await import('/src/math/analysis/plot.ts');
    const st = curveState(window.__doska.model.getObject(id), window.__doska.model.resolve);
    // Точка линии внутри области осей, ближе к её левому краю.
    const r = st.frame.rect;
    return st.plot.lines.flat().find((p) => p.x > r.x + r.width * 0.25 && p.y > r.y + 10 && p.y < r.y + r.height - 10);
  }, curves[0].id);
  await teacher.keyboard.press('v');
  await teacher.mouse.dblclick(sx(pt.x), sy(pt.y));
  await dlg.getByLabel('Запись графика').fill('y = a·sin(x) + b');
  await dlg.getByRole('button', { name: 'Сохранить' }).click();
  await waitStore(student, (id) => window.__doska.model.getObject(id).props.text === 'y = a·sin(x) + b', 'правка графика у ученика', curves[0].id);
  ok('двойной щелчок по графику: запись изменена');

  // 5. Таблица значений, числовая прямая, тригонометрическая окружность.
  await pick('Таблица значений');
  await teacher.mouse.click(sx(axes.x + 10), sy(axes.y + 10));
  await count(teacher, A + 'table', 1);
  await pick('Числовая прямая');
  await teacher.mouse.click(box.x + 120, box.y + 610);
  await count(teacher, A + 'numberline', 1);
  await pick('Тригонометрическая окружность');
  await teacher.mouse.click(box.x + 1050, box.y + 480);
  await count(teacher, A + 'trig', 1);
  ok('таблица значений, числовая прямая и тригонометрическая окружность');
  await teacher.waitForTimeout(800);
  await teacher.screenshot({ path: OUT + '/p2-teacher.png' });

  await browser.close();
  console.log('ВСЁ ПРОШЛО');
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
