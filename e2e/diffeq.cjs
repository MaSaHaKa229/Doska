// Сквозной сценарий дифференциальных уравнений (этап 6.5b): поле направлений
// (точка A задачи Коши перетаскиванием, сравнение Эйлера и Рунге — Кутты),
// фазовая плоскость (новая начальная точка кнопкой), уравнение второго
// порядка (p = 0 ползунком — гармонические колебания у ученика).
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/diffeq.cjs <classId> (его печатает e2e/setup.mts)');

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
const W = 'math.diffeq.';
const one = async (page, type) => (await page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type))[0];

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/diffeq-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Дифференциальные уравнения 6.5b', classIds: [classId], mode: 'LECTURE' }) });
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
    await teacher.getByRole('button', { name: 'Дифференциальные уравнения: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Дифференциальные уравнения' }).getByRole('button', { name: title, exact: true }).click();
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

  // 1. Поле направлений: точка A — в начало координат, затем сравнение методов.
  const sl = await place('Поле направлений', 100, 150, W + 'slope');
  await drag([100 + 47.5, 150 + 95], [100 + 190, 150 + 190]);
  await waitStore(student, (i) => { const a = window.__doska.model.getObject(i).props.points[0]; return a.x === 0 && a.y === 0; }, 'A(0; 0) у ученика', sl.id);
  await teacher.mouse.click(...at(100 + 370, 150 + 370));
  await teacher.getByRole('combobox', { name: /^Метод/ }).selectOption('both');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.method === 'both', 'сравнение методов у ученика', sl.id);
  ok('поле направлений y′ = x − y: задача Коши y(0) = 0, Эйлер и Рунге — Кутта');

  // 2. Фазовая плоскость: третья начальная точка.
  const ph = await place('Фазовая плоскость', 700, 150, W + 'phase');
  await button('＋ Точка').click();
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.points.length === 3, 'три траектории у ученика', ph.id);
  ok('фазовая плоскость маятника с трением: устойчивые фокусы и сёдла, три траектории');

  // 3. Второй порядок: без трения.
  const se = await place('Уравнение y″ + py′ + qy = 0', 1300, 170, W + 'second');
  await setRange('p ', 0);
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.p === 0, 'p = 0 у ученика', se.id);
  await teacher.waitForTimeout(400);
  await teacher.screenshot({ path: OUT + '/diffeq-2-teacher.png' });
  ok('y″ + 4y = 0: r = ±2i — гармонические колебания с периодом π');

  await teacher.keyboard.press('Escape');
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(800);
  await student.screenshot({ path: OUT + '/diffeq-1-student.png' });
  ok('ученик видит все три чертежа');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
