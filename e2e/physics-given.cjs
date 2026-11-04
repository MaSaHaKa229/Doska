// Сквозной сценарий 7.1b: блок «Дано / Найти / Решение» (столбец СИ по ходу
// набора, ошибка размерности при неверной формуле, верный ответ, постоянная g
// из списка), физическая постоянная из Ctrl+K, график зависимости v(t) с
// подписями осей; ученик видит всё.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/physics-given.cjs <classId> (его печатает e2e/setup.mts)');

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
const all = (page, type) => page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type);

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/given-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Физика 7.1b', classIds: [classId], mode: 'LECTURE' }) });
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
    await teacher.getByRole('button', { name: 'Физика: общее: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Физика: общее' }).getByRole('button', { name: title, exact: true }).click();
  };

  // 1. «Дано»: столбец СИ считается по ходу набора.
  await pick('Дано / Найти / Решение');
  await teacher.mouse.click(...at(80, 60));
  await dlg.getByLabel('Обозначение 1', { exact: true }).fill('m');
  await dlg.getByLabel('Значение 1', { exact: true }).fill('500');
  await dlg.getByLabel('Единица 1', { exact: true }).fill('г');
  await dlg.getByTestId('given-si').first().filter({ hasText: '= 0,5 кг' }).waitFor();
  await dlg.getByRole('button', { name: '+ Величина' }).click();
  await dlg.getByLabel('Обозначение 2', { exact: true }).fill('F');
  await dlg.getByLabel('Значение 2', { exact: true }).fill('2');
  await dlg.getByLabel('Единица 2', { exact: true }).fill('Н');
  await dlg.getByLabel('Искомая 1', { exact: true }).fill('a');
  await dlg.getByLabel('Единица искомой 1', { exact: true }).fill('м/с²');
  await dlg.getByLabel('Строки решения').fill('Второй закон Ньютона: F = m·a\na = F/m');
  ok('500 г → 0,5 кг в столбце СИ по ходу набора');

  // 2. Неверная формула — ошибка размерности; верная — ответ.
  await dlg.getByLabel('Формула ответа').fill('F·m');
  await dlg.getByTestId('given-answer').filter({ hasText: 'Размерность не сходится' }).waitFor();
  await dlg.getByLabel('Формула ответа').fill('F/m');
  await dlg.getByTestId('given-answer').filter({ hasText: 'a = 4 м/с². ✓ Размерность сходится' }).waitFor();
  await dlg.getByRole('button', { name: 'Вставить' }).click();
  await dlg.waitFor({ state: 'detached' });
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === 'physics.common.given'), 'блок «Дано» у ученика');
  const [given] = await all(teacher, 'physics.common.given');
  if (given.props.formula !== 'F/m' || given.props.rows.length !== 2 || given.props.steps.length !== 2) throw new Error('«Дано»: ' + JSON.stringify(given.props));
  ok('F·m → «Размерность не сходится», F/m → «a = 4 м/с² ✓»; блок на доске у ученика');

  // 3. Постоянная g из списка и вес P = m·g.
  await teacher.keyboard.press('Escape');
  await teacher.keyboard.press('v');
  await teacher.mouse.dblclick(...at(100, 80));
  await dlg.getByLabel('Добавить постоянную').selectOption({ label: 'Ускорение свободного падения (g)' });
  await dlg.getByLabel('Искомая 1', { exact: true }).fill('P');
  await dlg.getByLabel('Единица искомой 1', { exact: true }).fill('Н');
  await dlg.getByLabel('Формула ответа').fill('m·g');
  await dlg.getByTestId('given-answer').filter({ hasText: 'P = 4,9 Н' }).waitFor();
  await dlg.getByRole('button', { name: 'Сохранить' }).click();
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].find((o) => o.get('type') === 'physics.common.given')?.toJSON().props.rows.some((r) => r.sym === 'g' && r.value === '9,8'), 'g = 9,8 в «Дано» у ученика');
  ok('постоянная g = 9,8 м/с² из списка, P = m·g = 4,9 Н');

  // 4. Ctrl+K: постоянная Планка формулой.
  await teacher.keyboard.press('Control+k');
  await teacher.locator('dialog[open] input').first().fill('постоянная планка');
  await teacher.getByRole('option', { name: /Постоянная Планка/ }).click();
  await waitStore(teacher, () => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === 'core.formula' && o.get('props').latex.startsWith('h = 6{,}63')), 'постоянная Планка из Ctrl+K');
  ok('Ctrl+K «постоянная планка» вставил формулу h = 6,63·10⁻³⁴ Дж·с');

  // 5. График зависимости v(t) = 2 + 3t.
  await teacher.keyboard.press('Escape');
  await pick('График зависимости');
  await teacher.mouse.click(...at(820, 520));
  await dlg.getByText('Оси: t, с от 0 до 10').waitFor();
  await dlg.getByRole('button', { name: 'Вставить' }).click();
  await dlg.waitFor({ state: 'detached' });
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === 'math.analysis.curve'), 'график у ученика');
  const [axes] = await all(teacher, 'math.analysis.axes');
  const [curve] = await all(teacher, 'math.analysis.curve');
  if (axes.props.xLabel !== 't, с' || axes.props.yLabel !== 'v, м/с' || curve.props.text !== 'y = 2 + 3x' || curve.deps[0] !== axes.id) throw new Error('график: ' + JSON.stringify([axes.props, curve.props]));
  ok('график v(t) = 2 + 3t на осях «t, с» и «v, м/с», подпись формулой');

  await teacher.keyboard.press('Escape');
  await teacher.evaluate(() => window.__doska.commands.fit(false));
  await teacher.waitForTimeout(600);
  await teacher.screenshot({ path: OUT + '/given-1-board.png' });
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(600);
  await student.screenshot({ path: OUT + '/given-2-student.png' });
  ok('ученик видит блок «Дано», постоянную и график');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
