// Сквозной сценарий современной физики (этап 7.8a): теория относительности
// (пуск у ученика, v = 0,6c), фотоэффект (пуск; свет за красной границей —
// у ученика), шкала электромагнитных волн (отметка — перетаскиванием),
// волны де Бройля (протон).
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/physics-modern.cjs <classId> (его печатает e2e/setup.mts)');

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
const W = 'physics.modern.';
const one = async (page, type) => (await page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type))[0];

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/modern-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Современная физика 7.8a', classIds: [classId], mode: 'LECTURE' }) });
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
    await teacher.getByRole('button', { name: 'Современная физика: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Современная физика' }).getByRole('button', { name: title, exact: true }).click();
  };
  const place = async (title, x, y, type) => {
    await pick(title);
    await teacher.mouse.click(...at(x, y));
    await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), title + ' у ученика', type);
    return one(teacher, type);
  };
  const button = (name) => teacher.getByRole('button', { name, exact: true });

  // Ползунок панели свойств: значение через «родной» сеттер, чтобы React увидел событие.
  const setRange = (label, value) =>
    teacher.getByRole('slider', { name: new RegExp('^' + label.replace(/[/()]/g, '\\$&')) }).evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  const start = async (id) => {
    await teacher.evaluate(() => document.activeElement?.blur());
    await button('▶ Пуск / пауза').click();
    await waitStore(student, (i) => window.__doska.model.getObject(i).props.play.running, 'пуск у ученика', id);
  };

  // 1. Теория относительности: пуск, v = 0,6c.
  const rel = await place('Теория относительности', 80, 200, W + 'relativity');
  await start(rel.id);
  await setRange('v/c', 0.6);
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.beta === 0.6, 'v = 0,6c у ученика', rel.id);
  ok('теория относительности: ракета летит у ученика, γ = 1,25');

  // 2. Фотоэффект: пуск, затем свет за красной границей.
  const ph = await place('Фотоэффект', 1050, 330, W + 'photoeffect');
  await start(ph.id);
  await teacher.waitForTimeout(900);
  await teacher.screenshot({ path: OUT + '/modern-2-photo.png' });
  await setRange('λ, нм', 700);
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.lambda === 700, 'λ = 700 нм у ученика', ph.id);
  ok('фотоэффект: калий, 700 нм — за красной границей (565 нм), электронов нет');

  // 3. Шкала ЭМ-волн: отметка тянется без выделения.
  await teacher.keyboard.press('Escape');
  const sp = await place('Фотон и шкала электромагнитных волн', 120, 900, W + 'spectrum');
  await teacher.keyboard.press('Escape');
  await teacher.evaluate(() => document.activeElement?.blur());
  await teacher.keyboard.press('v');
  const sx = (lg) => ((lg + 14) / 18) * 640;
  await teacher.mouse.move(...at(120 + sx(sp.props.lg), 900 - 6));
  await teacher.mouse.down();
  await teacher.mouse.move(...at(120 + sx(-10), 900 - 6), { steps: 6 });
  await teacher.mouse.up();
  await waitStore(student, (i) => Math.abs(window.__doska.model.getObject(i).props.lg + 10) < 0.1, 'отметка 10⁻¹⁰ м у ученика', sp.id);
  ok('шкала ЭМ-волн: отметка перенесена на 10⁻¹⁰ м — рентгеновское излучение');

  // 4. Волны де Бройля: протон.
  const db = await place('Волны де Бройля', 1050, 1050, W + 'debroglie');
  await teacher.getByLabel('Частица').selectOption('proton');
  await waitStore(student, (i) => window.__doska.model.getObject(i).props.particle === 'proton', 'протон у ученика', db.id);
  ok('волны де Бройля: протон после 100 В');

  await teacher.keyboard.press('Escape');
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(500);
  await student.screenshot({ path: OUT + '/modern-1-student.png' });
  ok('ученик видит все четыре чертежа');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
