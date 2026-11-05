// Сквозной сценарий справочника формул (этап 8.1b): панель справочника
// (поиск, «На доску» — формула у ученика, тема «Оптика»), формула из
// справочника через Ctrl+K, справочник у ученика (без вставки — режим лекции).
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/reference.cjs <classId> (его печатает e2e/setup.mts)');

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
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/reference-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Справочник 8.1b', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const formulas = (page) => page.evaluate(() => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'core.formula').map((o) => o.get('props').latex));

  // 1. Панель справочника: поиск и вставка.
  await teacher.getByRole('button', { name: 'Справочник формул', exact: true }).click();
  const panel = teacher.getByRole('dialog', { name: 'Справочник формул' });
  await panel.getByLabel('Поиск формулы').fill('трапеции');
  await panel.getByRole('button', { name: 'На доску: Площадь трапеции' }).click();
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === 'core.formula' && o.get('props').latex.includes('\\frac{a+b}{2}')), 'площадь трапеции у ученика');
  ok('справочник: «площадь трапеции» найдена и вставлена — формула у ученика');

  // 2. Тема «Оптика».
  await panel.getByLabel('Поиск формулы').fill('');
  await panel.getByRole('combobox', { name: 'Тема' }).selectOption('optics');
  const n = await panel.locator('.ref-panel__item').count();
  if (n !== 5) throw new Error('в теме «Оптика» формул: ' + n);
  await teacher.waitForTimeout(300);
  await teacher.screenshot({ path: OUT + '/reference-1-teacher.png' });
  ok('тема «Оптика»: 5 формул с пояснениями обозначений');
  await panel.getByRole('button', { name: 'Закрыть справочник' }).click();

  // 3. Ctrl+K: формула Томсона.
  await teacher.evaluate(() => document.activeElement?.blur());
  await teacher.keyboard.press('Control+k');
  await teacher.locator('dialog[open] input').first().fill('формула томсона');
  await teacher.getByRole('option', { name: /Формула Томсона/ }).click();
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === 'core.formula' && o.get('props').latex.includes('\\sqrt{LC}')), 'формула Томсона у ученика');
  ok('Ctrl+K «формула томсона» вставил T = 2π√(LC)');

  // 4. Ученик: справочник открывается, вставки нет (лекция — писать нельзя).
  await student.getByRole('button', { name: 'Справочник формул', exact: true }).click();
  const sp = student.getByRole('dialog', { name: 'Справочник формул' });
  await sp.getByLabel('Поиск формулы').fill('пифагор');
  await sp.getByText('Теорема Пифагора').waitFor();
  if (await sp.getByRole('button', { name: /На доску/ }).count()) throw new Error('у ученика в лекции есть «На доску»');
  ok('ученик читает справочник, вставить на доску в режиме лекции не может');
  if ((await formulas(teacher)).length !== 2) throw new Error('формул на доске не 2');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
