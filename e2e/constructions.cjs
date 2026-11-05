// Сквозной сценарий построений (этап 6.1b): центр тяжести и описанная
// окружность щелчком по треугольнику, отметка угла, перестроение при
// перетаскивании вершины (у ученика тоже), осевая симметрия выделенного
// треугольника, точка на окружности тянется вдоль неё без выделения.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/constructions.cjs <classId> (его печатает e2e/setup.mts)');

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
const P = 'math.planimetry.';
const objs = (page, type) =>
  page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => ({ id: o.get('id'), deps: o.get('deps'), props: o.get('props') })), type);
/** Геометрия объекта у этого участника (мировые координаты). */
const geomOf = (page, id) => page.evaluate(async (i) => (await import('/src/math/planimetry/eval.ts')).geomOfId(i, window.__doska.model.resolve), id);
const hasType = (page, t) => waitStore(page, (x) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === x), t, t);

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Построения 6.1b', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  const pick = async (section, title) => {
    await teacher.getByRole('button', { name: `${section}: инструменты` }).click();
    await teacher.getByRole('menu', { name: section }).getByRole('button', { name: title, exact: true }).click();
  };
  const at = (x, y) => [box.x + x, box.y + y];
  const click = (p) => teacher.mouse.click(p[0], p[1]);

  // Треугольник ABC и прямая-ось.
  const A = at(250, 450);
  const B = at(550, 450);
  const C = at(300, 200);
  await pick('Планиметрия', 'Многоугольник');
  for (const p of [A, B, C, A]) await click(p);
  await hasType(teacher, P + 'polygon');
  await pick('Планиметрия', 'Прямая');
  await click(at(700, 150));
  await click(at(700, 500));
  await hasType(teacher, P + 'line');
  ok('треугольник ABC и прямая DE');

  // 1. Центр тяжести и описанная окружность — щелчком по стороне треугольника.
  await pick('Построения', 'Точка пересечения медиан');
  await click(at(400, 451));
  await hasType(teacher, P + 'cpoint');
  await pick('Построения', 'Описанная окружность');
  await click(at(400, 451));
  await hasType(teacher, P + 'circumcircle');
  const [m] = await objs(teacher, P + 'cpoint');
  const mg = await geomOf(teacher, m.id);
  if (m.props.label !== 'M' || !mg) throw new Error('центр тяжести: ' + JSON.stringify(m.props));
  ok(`центр тяжести M (${Math.round(mg.p.x)}, ${Math.round(mg.p.y)}) и описанная окружность щелчком по треугольнику`);

  // 2. Отметка угла BAC.
  await pick('Отметки и измерения', 'Отметка угла');
  for (const p of [B, A, C]) await click(p);
  await hasType(teacher, P + 'angle');
  ok('отметка угла BAC с величиной в градусах');
  await teacher.screenshot({ path: OUT + '/k1-constructions.png' });

  // 3. Перетаскивание вершины C: окружность и центр тяжести перестраиваются у ученика.
  const [circ] = await objs(teacher, P + 'circumcircle');
  const before = await geomOf(student, circ.id);
  await teacher.keyboard.press('v');
  await teacher.mouse.move(C[0], C[1]);
  await teacher.mouse.down();
  for (let i = 1; i <= 8; i++) await teacher.mouse.move(C[0] - 10 * i, C[1] - 5 * i);
  await teacher.mouse.up();
  await waitStore(student, ([id, r]) => {
    const m = window.__doska.model.getObject(id);
    return m && window.__doska.model.boundsOf([id]) && Math.abs(window.__doska.model.boundsOf([id]).width / 2 - r) > 5;
  }, 'ученик видит новую окружность', [circ.id, before.r + 4]);
  ok('вершина C перетащена: описанная окружность перестроилась у ученика');

  // 4. Осевая симметрия выделенного треугольника относительно прямой.
  await click(at(400, 451));
  await waitStore(teacher, (t) => window.__doska.store.getState().selection.some((id) => window.__doska.model.getObject(id)?.type === t), 'выделен треугольник', P + 'polygon');
  await pick('Преобразования', 'Осевая симметрия');
  await click(at(700, 300));
  await waitStore(teacher, (t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).length === 2, 'образ треугольника', P + 'polygon');
  const imgLabels = (await objs(teacher, P + 'cpoint')).map((p) => p.props.label).filter((l) => l.endsWith('′')).sort().join();
  if (imgLabels !== 'A′,B′,C′') throw new Error('вершины образа: ' + imgLabels);
  ok('осевая симметрия: образ A′B′C′');

  // 5. Точка на окружности: щелчок по окружности, затем тянем её сразу (без выделения).
  const cg = await geomOf(teacher, circ.id);
  const cam = await teacher.evaluate(() => { const s = window.__doska.store.getState(); return s.cameras[s.pageId]; });
  const sx = (x) => box.x + box.width / 2 + (x - cam.cx) * cam.zoom;
  const sy = (y) => box.y + box.height / 2 + (y - cam.cy) * cam.zoom;
  await pick('Построения', 'Точка на объекте');
  const top = [sx(cg.c.x), sy(cg.c.y - cg.r)];
  await click(top);
  await waitStore(teacher, () => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('props')?.kind === 'on'), 'точка на окружности');
  const on = (await objs(teacher, P + 'cpoint')).find((p) => p.props.kind === 'on');
  await teacher.keyboard.press('v');
  await teacher.evaluate(() => window.__doska.store.getState().setSelection([]));
  await teacher.mouse.move(top[0], top[1]);
  await teacher.mouse.down();
  for (let i = 1; i <= 8; i++) await teacher.mouse.move(top[0] + cg.r * cam.zoom * (i / 8) + 20, top[1] + cg.r * cam.zoom * (i / 8));
  await teacher.mouse.up();
  const g2 = await geomOf(teacher, on.id);
  const onCircle = Math.abs(Math.hypot(g2.p.x - cg.c.x, g2.p.y - cg.c.y) - cg.r) < 1;
  if (!onCircle || Math.abs(g2.p.y - (cg.c.y - cg.r)) < 10) throw new Error('точка на окружности: ' + JSON.stringify(g2));
  ok('точку на окружности тянут сразу — она скользит по окружности');
  await teacher.screenshot({ path: OUT + '/k2-after.png' });
  await student.screenshot({ path: OUT + '/k3-student.png' });

  await browser.close();
  console.log('ВСЁ ПРОШЛО');
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
