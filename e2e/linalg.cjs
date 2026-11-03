// Сквозной сценарий линейной алгебры (этап 6.3b): матрицы в диалоге,
// произведение щелчками (пересчёт при правке A — у ученика тоже),
// определитель, метод Гаусса для системы, линейное преобразование.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/linalg.cjs <classId> (его печатает e2e/setup.mts)');

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
const L = 'math.linalg.';
const list = (page, type) => page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type);
const count = (page, type, n) => waitStore(page, ([t, k]) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).length === k, `${type}: ${n}`, [type, n]);
const value = (page, id) => page.evaluate(async (i) => {
  const { valueOf } = await import('/src/math/linalg/objects.tsx');
  const v = valueOf(window.__doska.model.getObject(i), window.__doska.model.resolve);
  return { name: v.name, m: v.m ? v.m.map((r) => r.map(String)) : null, q: v.q ? String(v.q) : null, error: v.error ?? null };
}, id);

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Линейная алгебра 6.3b', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  const dlg = teacher.locator('dialog[open]');
  const pick = async (title) => {
    await teacher.getByRole('button', { name: 'Линейная алгебра: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Линейная алгебра' }).getByRole('button', { name: title, exact: true }).click();
  };
  const newMatrix = async (x, y, cells, { rows = 2, cols = 2, augmented = false } = {}) => {
    await pick('Матрица');
    await teacher.mouse.click(box.x + x, box.y + y);
    await dlg.getByLabel('Строк').fill(String(rows));
    await dlg.getByLabel('Столбцов').fill(String(cols));
    if (augmented) await dlg.getByRole('checkbox').check();
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) await dlg.getByLabel(`Ячейка ${i + 1}, ${j + 1}`).fill(String(cells[i * cols + j]));
    await dlg.getByRole('button', { name: 'Вставить' }).click();
    await dlg.waitFor({ state: 'detached' });
  };

  // 1. Матрицы A и B в диалоге (дробь в ячейке).
  await newMatrix(120, 80, [1, 2, 3, 4]);
  await newMatrix(330, 80, ['1/2', 0, 0, 2]);
  await count(teacher, L + 'matrix', 2);
  const [A, B] = await list(teacher, L + 'matrix');
  if (A.props.name !== 'A' || B.props.name !== 'B' || B.props.cells[0] !== '1/2') throw new Error('матрицы: ' + JSON.stringify([A.props, B.props]));
  ok('матрицы A и B (с дробью 1/2) — в диалоге');

  // 2. Произведение A·B щелчками, определитель A.
  await pick('Произведение матриц');
  await teacher.mouse.click(box.x + 150, box.y + 100);
  await teacher.mouse.click(box.x + 360, box.y + 100);
  await count(teacher, L + 'op', 1);
  const [prod] = await list(teacher, L + 'op');
  let v = await value(teacher, prod.id);
  if (JSON.stringify(v.m) !== JSON.stringify([['1/2', '4'], ['3/2', '8']])) throw new Error('A·B: ' + JSON.stringify(v));
  ok('A·B = (1/2 4; 3/2 8) — точно, в дробях');
  await pick('Определитель');
  await teacher.mouse.click(box.x + 150, box.y + 100);
  await count(teacher, L + 'op', 2);

  // 3. Правка A двойным щелчком: результат пересчитывается у ученика.
  await teacher.keyboard.press('v');
  await teacher.mouse.dblclick(box.x + 150, box.y + 100);
  await dlg.getByLabel('Ячейка 1, 1').fill('5');
  await dlg.getByRole('button', { name: 'Сохранить' }).click();
  await waitStore(student, (id) => window.__doska.model.getObject(id).props.cells[0] === '5', 'ученик видит новую A', A.id);
  v = await value(student, prod.id);
  if (v.m[0][0] !== '5/2') throw new Error('пересчёт A·B у ученика: ' + JSON.stringify(v));
  const dets = (await list(teacher, L + 'op')).find((o) => o.props.op === 'det');
  const dv = await value(student, dets.id);
  if (dv.q !== '14') throw new Error('det A: ' + JSON.stringify(dv));
  ok('правка A: у ученика A·B и det A = 14 пересчитались');

  // 4. Система x + 2y − z = 2, 2x − y + z = 3, x + y + z = 6 → (1; 2; 3) методом Гаусса.
  await newMatrix(120, 300, [1, 2, -1, 2, 2, -1, 1, 3, 1, 1, 1, 6], { rows: 3, cols: 4, augmented: true });
  await count(teacher, L + 'matrix', 3);
  await pick('Метод Гаусса');
  await teacher.mouse.click(box.x + 170, box.y + 330);
  await count(teacher, L + 'gauss', 1);
  const [g] = await list(teacher, L + 'gauss');
  const lay = await teacher.evaluate(async (id) => {
    const { gaussLayout } = await import('/src/math/linalg/objects.tsx');
    const l = gaussLayout(window.__doska.model.getObject(id), window.__doska.model.resolve);
    return { steps: l.items.length, answer: l.answer, ops: l.items.flatMap((i) => i.ops) };
  }, g.id);
  if (lay.answer !== 'Единственное решение: x₁ = 1, x₂ = 2, x₃ = 3') throw new Error('Гаусс: ' + JSON.stringify(lay));
  ok(`метод Гаусса: ${lay.steps} матриц, ${lay.ops.length} преобразований строк, ${lay.answer}`);
  await teacher.waitForTimeout(500);
  await teacher.screenshot({ path: OUT + '/l1-linalg.png' });

  // 5. Линейное преобразование на новых осях.
  await pick('Линейное преобразование');
  await teacher.mouse.click(box.x + 980, box.y + 400);
  await count(student, L + 'transform', 1);
  ok('линейное преобразование на осях — у ученика');
  await teacher.waitForTimeout(500);
  await teacher.screenshot({ path: OUT + '/l2-transform.png' });

  await browser.close();
  console.log('ВСЁ ПРОШЛО');
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
