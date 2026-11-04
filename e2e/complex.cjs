// Сквозной сценарий комплексных чисел (этап 6.5c): комплексная плоскость
// (z₁ перетаскиванием, произведение, корни 5-й степени — у ученика),
// множество точек по условию на z.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/complex.cjs <classId> (его печатает e2e/setup.mts)');

async function login(browser, login) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    console.log(`[${login}] pageerror`, e.message);
    globalThis.__errors = (globalThis.__errors ?? 0) + 1;
  });
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
const W = 'math.complex.';
const one = async (page, type) => (await page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type))[0];

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/complex-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Комплексные числа 6.5c', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  const Z = 0.5;
  await teacher.evaluate(([w, h, z]) => window.__doska.store.getState().setCamera({ cx: w / 2 / z, cy: h / 2 / z, zoom: z }), [box.width, box.height, Z]);
  const at = (x, y) => [box.x + x * Z, box.y + y * Z];
  const pick = async (title) => {
    await teacher.keyboard.press('Escape');
    await teacher.getByRole('button', { name: 'Комплексные числа: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Комплексные числа' }).getByRole('button', { name: title, exact: true }).click();
  };
  const place = async (title, x, y, type) => {
    await pick(title);
    await teacher.mouse.click(...at(x, y));
    await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), title + ' у ученика', type);
    return one(teacher, type);
  };
  const button = (name) => teacher.getByRole('button', { name, exact: true });

  const drag = async (from, to) => {
    await teacher.keyboard.press('Escape');
    await teacher.evaluate(() => document.activeElement?.blur());
    await teacher.keyboard.press('v');
    await teacher.mouse.move(...at(...from));
    await teacher.mouse.down();
    await teacher.mouse.move(...at(...to), { steps: 8 });
    await teacher.mouse.up();
  };

  const setRange = (label, value) =>
    teacher.getByRole('slider', { name: new RegExp('^' + label) }).evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);

  // 1. Комплексная плоскость: z₁ = 2 + 3i перетаскиванием, произведение, корни.
  const pl = await place('Комплексная плоскость', 100, 170, W + 'plane');
  await drag([100 + 304, 170 + 114], [100 + 266, 170 + 76]);
  await waitStore(student, (i) => { const z = window.__doska.model.getObject(i).props.numbers[0]; return z.re === 2 && z.im === 3; }, 'z₁ = 2 + 3i у ученика', pl.id);
  await teacher.mouse.click(...at(100 + 370, 170 + 370));
  const op = teacher.getByRole('combobox', { name: /^Действие/ });
  await op.selectOption('mul');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.op === 'mul', 'произведение у ученика', pl.id);
  ok('комплексная плоскость: z₁ = 2 + 3i, произведение — поворот и растяжение');
  await op.selectOption('roots');
  await setRange('n ', 5);
  await waitStore(student, (i) => { const p = window.__doska.model.getObject(i).props; return p.op === 'roots' && p.n === 5; }, 'корни 5-й степени у ученика', pl.id);
  ok('корни 5-й степени из z₁ — правильный пятиугольник');

  // 2. Множество: полукруг.
  const rg = await place('Множество на комплексной плоскости', 750, 170, W + 'region');
  await teacher.getByLabel('Условие на z').fill('|z| < 2 и Re z > 0');
  await teacher.getByLabel('Условие на z').press('Enter');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.cond === '|z| < 2 и Re z > 0', 'условие у ученика', rg.id);
  await teacher.waitForTimeout(400);
  await teacher.screenshot({ path: OUT + '/complex-2-teacher.png' });
  ok('множество |z| < 2 и Re z > 0 — правый полукруг');

  await teacher.keyboard.press('Escape');
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(800);
  await student.screenshot({ path: OUT + '/complex-1-student.png' });
  ok('ученик видит оба чертежа');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
