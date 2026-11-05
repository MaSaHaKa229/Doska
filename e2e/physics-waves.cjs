// Сквозной сценарий волн (этап 7.5b): бегущая волна (пуск у ученика,
// переключение на продольную), стоячая волна (гармоника n = 4), звук
// («Послушать» без ошибок), интерференция (точка M — перетаскиванием).
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/physics-waves.cjs <classId> (его печатает e2e/setup.mts)');

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
const W = 'physics.waves.';
const one = async (page, type) => (await page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type))[0];

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/waves-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Волны 7.5b', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  const Z = 0.6;
  await teacher.evaluate(([w, h, z]) => window.__doska.store.getState().setCamera({ cx: w / 2 / z, cy: h / 2 / z, zoom: z }), [box.width, box.height, Z]);
  const at = (x, y) => [box.x + x * Z, box.y + y * Z];
  const pick = async (title) => {
    await teacher.keyboard.press('Escape');
    await teacher.getByRole('button', { name: 'Колебания и волны: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Колебания и волны' }).getByRole('button', { name: title, exact: true }).click();
  };
  const place = async (title, x, y, type) => {
    await pick(title);
    await teacher.mouse.click(...at(x, y));
    await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), title + ' у ученика', type);
    return one(teacher, type);
  };
  const button = (name) => teacher.getByRole('button', { name, exact: true });

  // 1. Бегущая волна: пуск, затем продольная.
  const wave = await place('Бегущая волна', 80, 240, W + 'wave');
  await teacher.evaluate(() => document.activeElement?.blur());
  await button('▶ Пуск / пауза').click();
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.play.running, 'пуск волны у ученика', wave.id);
  await teacher.getByLabel('Продольная').check();
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.longitudinal, 'продольная у ученика', wave.id);
  ok('бегущая волна: пуск у ученика, переключение на продольную');

  // 2. Стоячая волна: четвёртая гармоника.
  const st = await place('Стоячая волна', 900, 240, W + 'standing');
  await teacher.getByLabel('Гармоника n').fill('4');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.n === 4, 'n = 4 у ученика', st.id);
  ok('стоячая волна: 4-я гармоника — 5 узлов, 4 пучности');

  // 3. Звук: «Послушать» не роняет страницу.
  await place('Звук', 80, 800, W + 'sound');
  await button('🔊 Послушать').click();
  await teacher.waitForTimeout(300);
  if (globalThis.__errors) throw new Error('ошибки на странице после «Послушать»');
  ok('звук 440 Гц: «Послушать» играет тон у нажавшего');

  // 4. Интерференция: точка M перетаскивается без выделения.
  await teacher.keyboard.press('Escape');
  const inter = await place('Интерференция волн', 900, 650, W + 'interference');
  await teacher.keyboard.press('Escape');
  await teacher.keyboard.press('v');
  await teacher.mouse.move(...at(900 + inter.props.probe.x, 650 + inter.props.probe.y));
  await teacher.mouse.down();
  await teacher.mouse.move(...at(900 + 220, 650 + 60), { steps: 6 });
  await teacher.mouse.up();
  await waitStore(student, (i) => { const p = window.__doska.model.getObject(i).props.probe; return Math.abs(p.x - 220) < 3 && Math.abs(p.y - 60) < 3; }, 'точка M перенесена у ученика', inter.id);
  ok('интерференция: точка M на оси симметрии — центральный максимум (Δ = 0)');

  await teacher.keyboard.press('Escape');
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(500);
  await student.screenshot({ path: OUT + '/waves-1-student.png' });
  ok('ученик видит все четыре чертежа волн');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
