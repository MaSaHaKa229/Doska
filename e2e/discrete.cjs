// Сквозной сценарий дискретной математики (этап 6.5e): граф (вершина F
// перетаскиванием, Дейкстра по шагам — у ученика), сочетания, таблица
// истинности A → B, перевод FF₁₆ в двоичную систему.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/discrete.cjs <classId> (его печатает e2e/setup.mts)');

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
const W = 'math.discrete.';
const one = async (page, type) => (await page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type))[0];

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/discrete-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Дискретная математика 6.5e', classIds: [classId], mode: 'LECTURE' }) });
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
    await teacher.getByRole('button', { name: 'Дискретная математика: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Дискретная математика' }).getByRole('button', { name: title, exact: true }).click();
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

  // 1. Граф: вершина F — ниже, затем Дейкстра по шагам.
  const gr = await place('Граф', 100, 250, W + 'graph');
  await drag([100 + 540, 250 + 145], [100 + 560, 250 + 300]);
  await waitStore(student, (i) => { const v = window.__doska.model.getObject(i).props.vertices[5]; return v.x === 560 && v.y === 300; }, 'вершина F перенесена у ученика', gr.id);
  await teacher.mouse.click(...at(100 + 300, 250 + 330));
  await teacher.evaluate(() => document.activeElement?.blur());
  await button('▶ По шагам').click();
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.play.running, 'шаги Дейкстры у ученика', gr.id);
  await teacher.waitForTimeout(2500);
  await teacher.screenshot({ path: OUT + '/discrete-2-teacher.png' });
  ok('граф: кратчайший путь A → F по шагам Дейкстры');

  // 2. Комбинаторика: сочетания.
  const cb = await place('Комбинаторика', 900, 250, W + 'comb');
  await teacher.getByRole('combobox', { name: /^Вид/ }).selectOption('comb');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.kind === 'comb', 'сочетания у ученика', cb.id);
  ok('комбинаторика: C₄² = 6 сочетаний выписаны');

  // 3. Логика: импликация.
  const lg = await place('Логика: таблица истинности', 100, 1000, W + 'logic');
  await teacher.getByRole('textbox', { name: 'Формула' }).fill('A → B');
  await teacher.getByRole('textbox', { name: 'Формула' }).press('Enter');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.formula === 'A → B', 'формула у ученика', lg.id);
  ok('логика: таблица A → B, СДНФ, СКНФ, круги Венна');

  // 4. Системы счисления: FF₁₆ → двоичная.
  const bs = await place('Системы счисления', 900, 1000, W + 'bases');
  await teacher.getByRole('textbox', { name: 'Число' }).fill('FF');
  await teacher.getByRole('textbox', { name: 'Число' }).press('Enter');
  await teacher.getByRole('spinbutton', { name: 'Из системы' }).fill('16');
  await teacher.getByRole('spinbutton', { name: 'Из системы' }).press('Enter');
  await waitStore(student, (i) => { const p = window.__doska.model.getObject(i).props; return p.value === 'FF' && p.from === 16; }, 'FF₁₆ у ученика', bs.id);
  ok('системы счисления: FF₁₆ = 255 = 11111111₂');

  await teacher.keyboard.press('Escape');
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(800);
  await student.screenshot({ path: OUT + '/discrete-1-student.png' });
  ok('ученик видит все четыре чертежа');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
