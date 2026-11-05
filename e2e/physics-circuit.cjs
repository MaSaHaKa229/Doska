// Сквозной сценарий цепей (этап 7.3b): схема протяжкой по узлам сетки —
// источник, амперметр, ключ (разомкнут), лампа, резистор, вольтметр на
// резисторе; ключ щелчком — ток пошёл (показания у ученика), R₁ в диалоге.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/physics-circuit.cjs <classId> (его печатает e2e/setup.mts)');

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
const C = 'physics.electricity.circuit';
/** Решение схемы у участника: ток источника, показания приборов (по модулю). */
const readings = (page) =>
  page.evaluate(async (t) => {
    const { solutionOf } = await import('/src/physics/electricity/circuits.tsx');
    const o = [...window.__doska.model.doc.getMap('objects').values()].find((x) => x.get('type') === t).toJSON();
    const s = solutionOf(o.props);
    const by = (k) => o.props.parts.filter((p) => p.kind === k).map((p) => s.results.get(p.id));
    return { I: Math.abs(s.summary?.I ?? 0), A: Math.abs(by('ammeter')[0]?.I ?? 0), V: Math.abs(by('voltmeter')[0]?.U ?? 0), lampP: by('lamp')[0]?.P ?? 0, parts: o.props.parts.length, closed: o.props.parts.find((p) => p.kind === 'switch')?.closed };
  }, C);

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/circuit-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Цепи 7.3b', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  // Мир = экран холста: узлы сетки — экранные координаты, кратные 20.
  await teacher.evaluate(([w, h]) => window.__doska.store.getState().setCamera({ cx: w / 2, cy: h / 2, zoom: 1 }), [box.width, box.height]);
  const at = (x, y) => [box.x + x, box.y + y];
  const dlg = teacher.locator('dialog[open]');
  const pick = async (title) => {
    await teacher.keyboard.press('Escape');
    await teacher.getByRole('button', { name: 'Электрические цепи: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Электрические цепи' }).getByRole('button', { name: title, exact: true }).click();
  };
  const draw = async (title, a, b) => {
    await pick(title);
    await teacher.mouse.move(...at(...a));
    await teacher.mouse.down();
    await teacher.mouse.move(...at(...b), { steps: 5 });
    await teacher.mouse.up();
  };

  // 1. Схема: источник слева (плюс сверху), сверху амперметр, ключ, лампа; справа резистор; вольтметр на резисторе.
  await draw('Источник ЭДС', [200, 400], [200, 200]);
  await draw('Амперметр', [200, 200], [320, 200]);
  await draw('Ключ', [320, 200], [400, 200]);
  await draw('Лампа', [400, 200], [520, 200]);
  await draw('Провод', [520, 200], [600, 200]);
  await draw('Резистор', [600, 200], [600, 400]);
  await draw('Провод', [600, 400], [200, 400]);
  await draw('Провод', [600, 200], [700, 200]);
  await draw('Вольтметр', [700, 200], [700, 400]);
  await draw('Провод', [700, 400], [600, 400]);
  await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].find((x) => x.get('type') === t)?.toJSON().props.parts.length === 10, '10 элементов у ученика', C);
  let r = await readings(student);
  if (r.I > 1e-6 || r.closed !== false) throw new Error('ключ разомкнут, а ток есть: ' + JSON.stringify(r));
  ok('схема из 10 элементов в одном объекте; ключ разомкнут — тока нет');

  // 2. Ключ — щелчком (инструмент выделения, без выделения схемы).
  await teacher.keyboard.press('Escape');
  await teacher.keyboard.press('v');
  await teacher.mouse.click(...at(360, 200));
  await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].find((x) => x.get('type') === t)?.toJSON().props.parts.find((p) => p.kind === 'switch').closed, 'ключ замкнут у ученика', C);
  r = await readings(student);
  // E = 12 В, r = 1 Ом, лампа 6 Ом, резистор 4 Ом: I = 12/11 А, U на резисторе — 48/11 В.
  if (Math.abs(r.I - 12 / 11) > 1e-3 || Math.abs(r.A - 12 / 11) > 1e-3 || Math.abs(r.V - 48 / 11) > 1e-3) throw new Error('показания: ' + JSON.stringify(r));
  await teacher.screenshot({ path: OUT + '/circuit-1-closed.png' });
  ok(`ключ замкнут щелчком: амперметр ${r.A.toFixed(3)} А, вольтметр ${r.V.toFixed(3)} В — у ученика тоже`);

  // 3. R₁ = 2 Ом в диалоге (двойной щелчок по резистору).
  await teacher.mouse.dblclick(...at(600, 300));
  await dlg.getByLabel('R R₁').fill('2');
  await dlg.getByRole('button', { name: 'Сохранить' }).click();
  await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].find((x) => x.get('type') === t)?.toJSON().props.parts.find((p) => p.kind === 'resistor').v === 2, 'R₁ = 2 Ом у ученика', C);
  r = await readings(student);
  if (Math.abs(r.A - 12 / 9) > 1e-3) throw new Error('после R₁ = 2: ' + JSON.stringify(r));
  ok(`R₁ = 2 Ом в диалоге: ток ${r.A.toFixed(3)} А (12/9), лампа ярче`);

  await teacher.keyboard.press('Escape');
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(400);
  await student.screenshot({ path: OUT + '/circuit-2-student.png' });
  ok('ученик видит схему с показаниями');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
