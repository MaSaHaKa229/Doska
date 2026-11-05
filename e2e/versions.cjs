// Сквозной сценарий истории версий (этап 8.2b): «Сохранить версию» с
// подписью, изменения на доске, предпросмотр и «Восстановить» — у ученика
// доска возвращается без перезагрузки, приходит уведомление; в списке —
// версия «Перед восстановлением»; ученику история недоступна.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/versions.cjs <classId> (его печатает e2e/setup.mts)');

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
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/versions-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'История версий 8.2b', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const kinds = (page) => page.evaluate(() => [...window.__doska.model.doc.getMap('objects').values()].map((o) => o.get('props').kind).sort().join());
  // На доске прямоугольник.
  await teacher.evaluate(() => {
    const { model, store } = window.__doska;
    model.createObject('core.shape', { pageId: store.getState().pageId, x: 100, y: 100, props: { kind: 'rect', w: 300, h: 160, stroke: 'accent-1', fill: 'none', strokeWidth: 3, dash: 'solid' } });
  });
  await waitStore(student, () => window.__doska.model.doc.getMap('objects').size === 1, 'прямоугольник у ученика');

  // 1. Сохранить версию с подписью.
  await teacher.getByRole('button', { name: 'Вид' }).click();
  await teacher.getByRole('menuitem', { name: 'История версий…' }).click();
  const panel = teacher.getByRole('dialog', { name: 'История версий' });
  await panel.getByLabel('Подпись версии').fill('Начало урока');
  await panel.getByRole('button', { name: 'Сохранить версию' }).click();
  await panel.getByRole('button', { name: /Начало урока/ }).waitFor();
  ok('версия «Начало урока» сохранена и видна в списке');

  // 2. Урок продолжается: прямоугольник удалён, появился эллипс.
  await teacher.evaluate(() => {
    const { model, store } = window.__doska;
    const ids = [...model.doc.getMap('objects').keys()];
    model.deleteObjects(ids);
    model.createObject('core.shape', { pageId: store.getState().pageId, x: 500, y: 100, props: { kind: 'ellipse', w: 200, h: 120, stroke: 'accent-3', fill: 'none', strokeWidth: 3, dash: 'solid' } });
  });
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].map((o) => o.get('props').kind).join() === 'ellipse', 'эллипс у ученика');

  // 3. Предпросмотр и восстановление.
  await panel.getByRole('button', { name: /Начало урока/ }).click();
  await panel.locator('.versions-panel__preview canvas').first().waitFor();
  await teacher.waitForTimeout(400);
  await teacher.screenshot({ path: OUT + '/versions-1-teacher.png' });
  await panel.getByRole('button', { name: 'Восстановить эту версию' }).click();
  await teacher.getByRole('dialog', { name: 'Восстановить версию?' }).getByRole('button', { name: 'Восстановить' }).click();
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].map((o) => o.get('props').kind).join() === 'rect', 'прямоугольник вернулся у ученика');
  await student.getByText(/Доска восстановлена из версии/).waitFor({ timeout: 10000 });
  if ((await kinds(teacher)) !== 'rect') throw new Error('у учителя не восстановилось');
  ok('восстановление: у ученика без перезагрузки вернулся прямоугольник, пришло уведомление');
  await panel.getByRole('button', { name: /Перед восстановлением/ }).waitFor();
  ok('в истории появилась версия «Перед восстановлением: «Начало урока»»');

  // 4. Ученику история недоступна.
  await student.getByRole('button', { name: 'Вид' }).click();
  if (await student.getByRole('menuitem', { name: 'История версий…' }).count()) throw new Error('у ученика есть пункт истории версий');
  ok('у ученика пункта «История версий» нет');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
