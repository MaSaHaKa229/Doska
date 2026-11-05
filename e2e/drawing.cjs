// Сквозной сценарий рисования (этап 5.1): перо (живой штрих у другого
// участника), маркер под рисунком, распознавание фигуры, ластики, права.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/drawing.cjs <classId> (его печатает e2e/setup.mts)');

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
const waitStore = (page, fn, what, arg) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(() => { throw new Error('Не дождались: ' + what); });
const ok = (msg) => console.log('✓', msg);
const objects = (page) => page.evaluate(() => {
  const m = window.__doska.model;
  const pid = window.__doska.store.getState().pageId;
  return m.pageObjects(pid).map((id) => { const o = m.getObject(id); return { id, type: o.type, by: o.createdBy, kind: o.props.kind, x: o.x, y: o.y }; });
});

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Рисование 5.1', classIds: [classId], mode: 'COLLABORATIVE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  const at = (x, y) => [box.x + x, box.y + y];

  // Перо: другой участник видит штрих, пока он рисуется.
  await teacher.keyboard.press('p');
  await teacher.mouse.move(...at(150, 200));
  await teacher.mouse.down();
  for (let i = 1; i <= 30; i++) await teacher.mouse.move(...at(150 + i * 15, 200 + Math.sin(i / 3) * 40));
  await waitStore(student, () => window.__doska.presence.peers().some((p) => p.drawing && p.drawing.points.length > 30), 'живой штрих у ученика');
  await student.screenshot({ path: OUT + '/d1-live-stroke.png' });
  await teacher.mouse.up();
  await waitStore(student, () => window.__doska.model.doc.getMap('objects').size === 1 && window.__doska.presence.peers().every((p) => !p.drawing), 'штрих сохранён');
  ok('перо: ученик видит штрих во время рисования, потом — сохранённый объект');

  // Маркер ложится под рисунок.
  await teacher.keyboard.press('m');
  await teacher.mouse.move(...at(150, 210));
  await teacher.mouse.down();
  await teacher.mouse.move(...at(600, 210), { steps: 20 });
  await teacher.mouse.up();
  let objs = await objects(teacher);
  if (objs.length !== 2 || objs[0].kind !== 'marker') throw new Error('маркер не под штрихом: ' + JSON.stringify(objs));
  ok('маркер — под штрихом пера');

  // Распознавание: прямоугольник от руки с задержкой в конце.
  await teacher.keyboard.press('p');
  const rect = [[150, 400], [450, 403], [452, 600], [148, 598], [150, 402]];
  await teacher.mouse.move(...at(...rect[0]));
  await teacher.mouse.down();
  for (let i = 1; i < rect.length; i++) await teacher.mouse.move(...at(...rect[i]), { steps: 15 });
  await teacher.waitForTimeout(800);
  await teacher.mouse.up();
  objs = await objects(teacher);
  if (!objs.some((o) => o.type === 'core.shape' && o.kind === 'rect')) throw new Error('прямоугольник не распознан: ' + JSON.stringify(objs));
  await teacher.screenshot({ path: OUT + '/d2-teacher.png' });
  ok('задержка пера превратила штрих в прямоугольник');

  // Ученик не может стереть учительское.
  await student.keyboard.press('e');
  const sb = await student.getByTestId('board-canvas').boundingBox();
  await student.mouse.move(sb.x + 300, sb.y + 150);
  await student.mouse.down();
  await student.mouse.move(sb.x + 300, sb.y + 260, { steps: 10 });
  await student.mouse.up();
  await teacher.waitForTimeout(300);
  if ((await objects(teacher)).length !== 3) throw new Error('ученик стёр учительское');
  ok('ученик не стирает объекты учителя');

  // Попиксельный ластик разрезает штрих пера.
  await teacher.keyboard.press('e');
  await teacher.getByLabel('Стирать').selectOption('pixel');
  const penBefore = (await objects(teacher)).filter((o) => o.kind === 'pen' && o.type === 'core.stroke').length;
  await teacher.mouse.move(...at(375, 120));
  await teacher.mouse.down();
  await teacher.mouse.move(...at(375, 300), { steps: 15 });
  await teacher.mouse.up();
  const strokesAfter = (await objects(teacher)).filter((o) => o.type === 'core.stroke');
  if (strokesAfter.filter((o) => o.kind === 'pen').length !== penBefore + 1 || strokesAfter.filter((o) => o.kind === 'marker').length !== 2) {
    throw new Error('попиксельный ластик: ' + JSON.stringify(strokesAfter));
  }
  ok('попиксельный ластик разрезал и штрих, и маркер');

  // Ластик по объектам — одним жестом, отмена возвращает всё.
  await teacher.getByLabel('Стирать').selectOption('stroke');
  const before = (await objects(teacher)).length;
  await teacher.mouse.move(...at(160, 120));
  await teacher.mouse.down();
  await teacher.mouse.move(...at(160, 650), { steps: 25 });
  await teacher.mouse.up();
  const erased = before - (await objects(teacher)).length;
  if (erased < 3) throw new Error('ластик по объектам стёр только ' + erased);
  await teacher.keyboard.press('Control+z');
  await waitStore(teacher, (n) => { const m = window.__doska.model; return m.pageObjects(window.__doska.store.getState().pageId).length === n; }, 'отмена одним шагом', before);
  ok(`ластик по объектам стёр ${erased} объекта одним жестом, Ctrl+Z вернул всё`);
  await waitStore(student, (n) => window.__doska.model.doc.getMap('objects').size === n, 'у ученика тот же документ', before);
  await student.screenshot({ path: OUT + '/d3-student.png' });

  await browser.close();
  console.log('ВСЁ ПРОШЛО');
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
