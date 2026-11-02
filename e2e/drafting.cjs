// Сквозной сценарий чертёжных инструментов (этап 6.1c): линейка (поворот
// ручкой, ровная линия пером вдоль края), транспортир (луч-указатель),
// циркуль (раствор по точке, полный оборот — окружность у ученика).
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/drafting.cjs <classId> (его печатает e2e/setup.mts)');

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
const P = 'math.planimetry.';
const obj = (page, type) => page.evaluate((t) => { const o = [...window.__doska.model.doc.getMap('objects').values()].find((x) => x.get('type') === t); return o ? o.toJSON() : null; }, type);
const handles = (page, id) => page.evaluate((i) => { const e = window.__doska.model.get(i); return e.module.getHandles(e.obj, window.__doska.model.resolve); }, id);

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Чертёжные инструменты 6.1c', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  const cam = await teacher.evaluate(() => { const s = window.__doska.store.getState(); return s.cameras[s.pageId]; });
  const sx = (x) => box.x + box.width / 2 + (x - cam.cx) * cam.zoom;
  const sy = (y) => box.y + box.height / 2 + (y - cam.cy) * cam.zoom;
  const W = (px, py) => ({ x: cam.cx + (px - box.x - box.width / 2) / cam.zoom, y: cam.cy + (py - box.y - box.height / 2) / cam.zoom });
  const pick = async (title) => {
    await teacher.getByRole('button', { name: 'Чертёжные инструменты: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Чертёжные инструменты' }).getByRole('button', { name: title, exact: true }).click();
  };
  const drag = async (from, to, steps = 12) => {
    await teacher.mouse.move(from.x, from.y);
    await teacher.mouse.down();
    for (let i = 1; i <= steps; i++) await teacher.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await teacher.mouse.up();
  };

  // 1. Линейка: поставить, повернуть ручкой с Shift (шаг 15°).
  await pick('Линейка');
  await teacher.mouse.click(box.x + 150, box.y + 120);
  await waitStore(teacher, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), 'линейка', P + 'ruler');
  let ruler = await obj(teacher, P + 'ruler');
  const [rot] = await handles(teacher, ruler.id);
  await teacher.keyboard.down('Shift');
  // Тянем ручку по дуге вокруг нуля линейки на ~30°.
  const r0 = Math.hypot(rot.position.x - ruler.x, rot.position.y - ruler.y);
  const a1 = Math.atan2(rot.position.y - ruler.y, rot.position.x - ruler.x) + Math.PI / 6;
  await drag({ x: sx(rot.position.x), y: sy(rot.position.y) }, { x: sx(ruler.x + r0 * Math.cos(a1)), y: sy(ruler.y + r0 * Math.sin(a1)) });
  await teacher.keyboard.up('Shift');
  await waitStore(teacher, (id) => Math.abs(window.__doska.model.getObject(id).rotation - Math.PI / 6) < 0.01, 'поворот линейки на 30°', ruler.id);
  ok('линейка поставлена и повёрнута ручкой на 30° (Shift — шаг 15°)');

  // 2. Перо вдоль края: неровная рука — ровная линия на 30°.
  await teacher.keyboard.press('p');
  const along = (t, wobble) => ({ x: sx(ruler.x + t * Math.cos(Math.PI / 6) + wobble * Math.sin(Math.PI / 6)), y: sy(ruler.y + t * Math.sin(Math.PI / 6) - wobble * Math.cos(Math.PI / 6)) });
  await teacher.mouse.move(along(40, -4).x, along(40, -4).y);
  await teacher.mouse.down();
  for (let i = 1; i <= 15; i++) await teacher.mouse.move(along(40 + i * 18, (i % 3) * 3 - 6).x, along(40 + i * 18, (i % 3) * 3 - 6).y);
  await teacher.mouse.up();
  await waitStore(teacher, () => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === 'core.stroke'), 'штрих');
  const dev = await teacher.evaluate((r) => {
    const s = [...window.__doska.model.doc.getMap('objects').values()].find((o) => o.get('type') === 'core.stroke').toJSON();
    let worst = 0;
    for (let i = 0; i < s.props.points.length; i += 3) {
      const x = s.x + s.props.points[i] - r.x;
      const y = s.y + s.props.points[i + 1] - r.y;
      worst = Math.max(worst, Math.abs(-x * Math.sin(Math.PI / 6) + y * Math.cos(Math.PI / 6)));
    }
    return worst;
  }, ruler);
  if (dev > 1) throw new Error('штрих отклоняется от края линейки на ' + dev);
  ok(`перо вдоль края линейки: ровная линия (отклонение ${dev.toFixed(2)})`);

  // 3. Транспортир: луч-указатель на 60°.
  await pick('Транспортир');
  await teacher.mouse.click(box.x + 700, box.y + 600);
  await waitStore(teacher, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), 'транспортир', P + 'protractor');
  const pr = await obj(teacher, P + 'protractor');
  const ray = (await handles(teacher, pr.id)).find((h) => h.id === 'ray');
  await drag({ x: sx(ray.position.x), y: sy(ray.position.y) }, { x: sx(pr.x + 100 * Math.cos(Math.PI / 3)), y: sy(pr.y - 100 * Math.sin(Math.PI / 3)) });
  await waitStore(teacher, (id) => window.__doska.model.getObject(id).props.ray === 60, 'луч транспортира на 60°', pr.id);
  ok('транспортир: луч-указатель показывает 60°');

  // 4. Циркуль: точка-центр, раствор грифелем, оборот ручкой — окружность.
  await teacher.keyboard.press('Shift+P');
  const C = { x: box.x + 950, y: box.y + 300 };
  await teacher.mouse.click(C.x, C.y);
  await pick('Циркуль');
  await teacher.mouse.click(C.x, C.y);
  await waitStore(teacher, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), 'циркуль', P + 'compass');
  const comp = await obj(teacher, P + 'compass');
  let hs = await handles(teacher, comp.id);
  const pencil = hs.find((h) => h.id === 'pencil');
  await drag({ x: sx(pencil.position.x), y: sy(pencil.position.y) }, { x: sx(comp.x + 120), y: sy(comp.y) });
  await waitStore(teacher, (id) => Math.abs(window.__doska.model.getObject(id).props.r - 120) < 3, 'раствор 120', comp.id);
  hs = await handles(teacher, comp.id);
  const k = hs.find((h) => h.id === 'knob').position;
  const rk = Math.hypot(k.x - comp.x, k.y - comp.y);
  const ak = Math.atan2(k.y - comp.y, k.x - comp.x);
  await teacher.mouse.move(sx(k.x), sy(k.y));
  await teacher.mouse.down();
  for (let i = 1; i <= 40; i++) {
    const a = ak - (i * Math.PI * 2) / 38;
    await teacher.mouse.move(sx(comp.x + rk * Math.cos(a)), sy(comp.y + rk * Math.sin(a)));
  }
  await teacher.mouse.up();
  await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), 'ученик видит окружность циркуля', P + 'circle');
  const circle = await obj(student, P + 'circle');
  const centerType = await student.evaluate((id) => window.__doska.model.getObject(id).props.label, circle.deps[0]);
  if (centerType !== 'A') throw new Error('центр окружности — не точка A: ' + centerType);
  ok('циркуль: раствор 120, полный оборот — окружность с центром в точке A, её видит ученик');
  await teacher.screenshot({ path: OUT + '/d1-drafting.png' });
  await student.screenshot({ path: OUT + '/d2-student.png' });

  await browser.close();
  console.log('ВСЁ ПРОШЛО');
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
