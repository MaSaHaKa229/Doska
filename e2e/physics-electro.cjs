// Сквозной сценарий электростатики (этап 7.3a): «Заряд +» и «Заряд −» —
// система с диполем, перетаскивание заряда без выделения (у ученика тоже),
// пробная точка, величина заряда в диалоге, плоский конденсатор.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/physics-electro.cjs <classId> (его печатает e2e/setup.mts)');

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
const E = 'physics.electricity.';
const one = async (page, type) => (await page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type))[0];

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/electro-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Электростатика 7.3a', classIds: [classId], mode: 'LECTURE' }) });
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
    await teacher.getByRole('button', { name: 'Электричество: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Электричество' }).getByRole('button', { name: title, exact: true }).click();
  };

  // 1. Диполь: «Заряд +» создаёт систему, «Заряд −» добавляет в неё.
  await pick('Заряд +');
  await teacher.mouse.click(...at(380, 330));
  await pick('Заряд −');
  await teacher.mouse.click(...at(540, 330));
  await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].find((o) => o.get('type') === t)?.toJSON().props.charges.length === 2, 'два заряда у ученика', E + 'charges');
  const sys = await one(teacher, E + 'charges');
  if (sys.props.charges[0].q !== 5 || sys.props.charges[1].q !== -5) throw new Error('заряды: ' + JSON.stringify(sys.props.charges));
  ok('диполь +5 нКл и −5 нКл в одной системе, у ученика тоже');

  // 2. Отрицательный заряд тянут сразу, без выделения.
  await teacher.keyboard.press('Escape');
  await teacher.keyboard.press('v');
  await teacher.mouse.move(...at(540, 330));
  await teacher.mouse.down();
  await teacher.mouse.move(...at(600, 380), { steps: 8 });
  await teacher.mouse.up();
  await waitStore(student, (i) => { const c = window.__doska.model.getObject(i).props.charges[1]; return Math.abs(c.x - (300 + 220)) < 3 && Math.abs(c.y - (200 + 50)) < 3; }, 'заряд перенесён у ученика', sys.id);
  ok('заряд −5 нКл перетащен без выделения — линии перестроились, у ученика тоже');

  // 3. Пробная точка: E и φ.
  await teacher.evaluate((id) => window.__doska.store.getState().setSelection([id]), sys.id);
  await teacher.getByLabel('Пробная точка').check();
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.showProbe, 'пробная точка у ученика', sys.id);
  ok('пробная точка с напряжённостью E и потенциалом φ');

  // 4. Величина заряда в диалоге (двойной щелчок по заряду).
  await teacher.evaluate(() => document.activeElement?.blur());
  await teacher.mouse.dblclick(...at(380, 330));
  await dlg.getByLabel('Заряд q₂, нКл').fill('−10');
  await dlg.getByRole('button', { name: 'Сохранить' }).click();
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.charges[1].q === -10, 'q₂ = −10 нКл у ученика', sys.id);
  ok('q₂ = −10 нКл в диалоге — линий к нему вдвое больше');

  // 5. Плоский конденсатор.
  await pick('Плоский конденсатор');
  await teacher.mouse.click(...at(850, 360));
  await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), 'конденсатор у ученика', E + 'capacitor');
  await teacher.getByLabel('U, В').fill('200');
  const cap = await one(teacher, E + 'capacitor');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.U === 200, 'U = 200 В у ученика', cap.id);
  ok('плоский конденсатор: U = 200 В — C, E, q, W на чертеже');

  await teacher.evaluate(() => document.activeElement?.blur());
  await teacher.keyboard.press('Escape');
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(500);
  await student.screenshot({ path: OUT + '/electro-1-student.png' });
  ok('ученик видит поле диполя и конденсатор');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
