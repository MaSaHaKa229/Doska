// Сквозной сценарий планиметрии (этап 6.1a): инструменты из раздела на
// панели, отрезок и треугольник на общих точках, перетаскивание точки
// (построения следуют за ней у всех), отмена, окружность протяжкой,
// удаление точки вместе с построениями.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/planimetry.cjs <classId> (его печатает e2e/setup.mts)');

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
const objs = (page, type) =>
  page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => ({ id: o.get('id'), x: o.get('x'), y: o.get('y'), deps: o.get('deps'), props: o.get('props') })), type);
const P = 'math.planimetry.';

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Планиметрия 6.1a', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  // Мировые координаты → экранные (камера учителя не меняется).
  const cam = await teacher.evaluate(() => { const s = window.__doska.store.getState(); return s.cameras[s.pageId]; });
  const sx = (x) => box.x + box.width / 2 + (x - cam.cx) * cam.zoom;
  const sy = (y) => box.y + box.height / 2 + (y - cam.cy) * cam.zoom;
  const W = (sxv, syv) => ({ x: cam.cx + (sxv - box.x - box.width / 2) / cam.zoom, y: cam.cy + (syv - box.y - box.height / 2) / cam.zoom });
  const pick = async (title) => {
    await teacher.getByRole('button', { name: 'Планиметрия: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Планиметрия' }).getByRole('button', { name: title, exact: true }).click();
  };
  const click = (x, y) => teacher.mouse.click(x, y);

  // 1. Отрезок двумя щелчками.
  await pick('Отрезок');
  const A = [box.x + 300, box.y + 400];
  const B = [box.x + 600, box.y + 400];
  await click(...A);
  await click(...B);
  await waitStore(teacher, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), 'отрезок', P + 'segment');
  let pts = await objs(teacher, P + 'point');
  if (pts.map((p) => p.props.label).join() !== 'A,B') throw new Error('точки: ' + JSON.stringify(pts.map((p) => p.props.label)));
  ok('отрезок AB двумя щелчками, точки подписаны A и B');

  // 2. Треугольник на тех же A и B (привязка к точкам) и новой C.
  await pick('Многоугольник');
  const C = [box.x + 450, box.y + 200];
  for (const p of [A, B, C, A]) await click(p[0] + 2, p[1] + 1);
  await waitStore(teacher, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), 'треугольник', P + 'polygon');
  pts = await objs(teacher, P + 'point');
  const [tri] = await objs(teacher, P + 'polygon');
  if (pts.length !== 3 || tri.deps.length !== 3 || !tri.deps.includes(pts[0].id) || !tri.deps.includes(pts[1].id)) throw new Error('треугольник: ' + JSON.stringify({ pts: pts.length, deps: tri.deps }));
  ok('треугольник ABC: вершины A и B общие с отрезком (привязка к точкам)');
  await teacher.screenshot({ path: OUT + '/g1-triangle.png' });

  // 3. Перетаскивание точки C выделением: треугольник перестраивается у ученика.
  await teacher.keyboard.press('v');
  const cId = pts.find((p) => p.props.label === 'C').id;
  await teacher.mouse.move(...C);
  await teacher.mouse.down();
  for (let i = 1; i <= 10; i++) await teacher.mouse.move(C[0] + 15 * i, C[1] - 8 * i);
  await teacher.mouse.up();
  const target = W(C[0] + 150, C[1] - 80);
  await waitStore(student, ([id, x, y]) => {
    const o = window.__doska.model.getObject(id);
    return o && Math.abs(o.x - x) < 15 && Math.abs(o.y - y) < 15;
  }, 'ученик видит новую C', [cId, target.x, target.y]);
  const triB = await student.evaluate((id) => window.__doska.model.boundsOf([id]), tri.id);
  if (triB.y > target.y + 5) throw new Error('треугольник у ученика не перестроился: ' + JSON.stringify(triB));
  ok('точка C перетащена, треугольник перестроился и у ученика');
  await student.screenshot({ path: OUT + '/g2-student.png' });

  // 4. Ctrl+Z — точка возвращается одним шагом.
  await teacher.keyboard.press('Control+z');
  await waitStore(teacher, ([id, x]) => Math.abs(window.__doska.model.getObject(id).x - x) < 3, 'отмена перетаскивания', [cId, W(...C).x]);
  ok('Ctrl+Z вернул точку C одним шагом');

  // 5. Окружность протяжкой из центра.
  await pick('Окружность');
  await teacher.mouse.move(box.x + 850, box.y + 400);
  await teacher.mouse.down();
  for (let i = 1; i <= 8; i++) await teacher.mouse.move(box.x + 850 + 10 * i, box.y + 400);
  await teacher.mouse.up();
  await waitStore(teacher, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), 'окружность', P + 'circle');
  const [circle] = await objs(teacher, P + 'circle');
  const r = await teacher.evaluate((id) => window.__doska.model.boundsOf([id]).width, circle.id);
  if (Math.abs(r - (160 / cam.zoom + 8)) > 12) throw new Error('радиус окружности: ' + r);
  ok('окружность протяжкой: центр D и точка E');

  // 6. Удаление точки A — с подтверждением, вместе с отрезком и треугольником.
  await teacher.keyboard.press('v');
  await click(...A);
  await waitStore(teacher, (id) => window.__doska.store.getState().selection.join() === id, 'выделена точка A', pts[0].id);
  await teacher.keyboard.press('Delete');
  const dlg = teacher.locator('dialog[open]');
  await dlg.getByRole('heading', { name: 'Удалить вместе с построениями?' }).waitFor();
  await dlg.getByText('зависят 2 построения').waitFor();
  await dlg.getByRole('button', { name: 'Удалить вместе с ними' }).click();
  await waitStore(student, (types) => {
    const all = [...window.__doska.model.doc.getMap('objects').values()].map((o) => o.get('type'));
    return !all.includes(types[0]) && !all.includes(types[1]);
  }, 'ученик: построения на A удалены', [P + 'segment', P + 'polygon']);
  const left = (await objs(teacher, P + 'point')).map((p) => p.props.label).sort().join();
  if (left !== 'D,E') throw new Error('после удаления остались точки: ' + left);
  ok('удаление A: отрезок и треугольник ушли вместе с ней, их автоточки B и C — тоже');

  await browser.close();
  console.log('ВСЁ ПРОШЛО');
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
