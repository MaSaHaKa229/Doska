// Сквозной сценарий библиотеки шаблонов (этап 8.1a): встроенные шаблоны
// (фильтр по разделу, «Создать доску» — копия с задачей), «Сохранить как
// шаблон» из меню доски, «Мои» шаблоны, выдача встроенного шаблона заданием.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/library.cjs <classId> (его печатает e2e/setup.mts)');

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
const ok = (msg) => console.log('✓', msg);
const waitStore = (page, fn, what, arg) => page.waitForFunction(fn, arg, { timeout: 15000 }).catch(() => { throw new Error('Не дождались: ' + what); });

(async () => {
  const browser = await chromium.launch();
  const t = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => t.screenshot({ path: OUT + '/library-fail.png' });
  const mine = `Наклонная плоскость — мой вариант ${Date.now() % 100000}`;
  const card = (title) => t.getByRole('article', { name: `Шаблон ${title}` });

  // 1. Встроенные шаблоны и фильтр по разделу.
  await t.getByRole('link', { name: 'Библиотека', exact: true }).click();
  await t.waitForURL('**/library');
  await t.getByRole('tab', { name: 'Встроенные' }).click();
  await card('Брусок на наклонной плоскости').waitFor();
  const all = await t.getByRole('article').count();
  if (all < 12) throw new Error('встроенных шаблонов меньше 12: ' + all);
  await t.getByLabel('Раздел', { exact: true }).selectOption('physics.mechanics');
  await t.waitForFunction(() => document.querySelectorAll('article').length === 2, null, { timeout: 10000 });
  await t.waitForTimeout(800);
  await t.screenshot({ path: OUT + '/library-1.png' });
  ok(`встроенные шаблоны: ${all}, раздел «Механика» — 2`);

  // 2. Доска из шаблона.
  await card('Брусок на наклонной плоскости').getByRole('button', { name: 'Создать доску' }).click();
  await t.waitForURL(/\/boards\/[0-9a-f-]+$/);
  await waitStore(t, () => window.__doska?.store.getState().synced, 'синхронизация');
  const types = await t.evaluate(() => [...window.__doska.model.doc.getMap('objects').values()].map((o) => o.get('type')).sort());
  if (types.join() !== 'core.text,physics.mechanics.incline') throw new Error('в доске из шаблона: ' + types.join());
  ok('«Создать доску»: новая доска урока с условием задачи и наклонной плоскостью');

  await t.evaluate(() => window.__doska.commands.fit(false));
  await t.waitForTimeout(500);
  await t.screenshot({ path: OUT + '/library-2-board.png' });

  // 3. Сохранить эту доску как свой шаблон.
  await t.getByRole('button', { name: /Урок/ }).click();
  await t.getByRole('button', { name: 'Сохранить как шаблон…' }).click();
  const dlg = t.getByRole('dialog', { name: 'Сохранить как шаблон' });
  await dlg.getByLabel('Название').fill(mine);
  await dlg.getByLabel('Раздел').selectOption('physics.mechanics');
  await dlg.getByLabel('Кому виден').selectOption('TEACHERS');
  await dlg.getByRole('button', { name: 'Сохранить' }).click();
  await dlg.waitFor({ state: 'hidden' });
  await t.goto(BASE + '/library');
  await t.getByRole('tab', { name: 'Мои' }).click();
  await card(mine).waitFor();
  ok('«Сохранить как шаблон» из меню доски — шаблон в «Моих», виден всем учителям');

  // 4. Встроенный шаблон — заданием классу.
  await t.getByRole('tab', { name: 'Встроенные' }).click();
  await card('Кратчайший путь в графе').getByRole('button', { name: /Действия с шаблоном/ }).click();
  await t.getByRole('menuitem', { name: 'Выдать заданием…' }).click();
  const ad = t.locator('dialog[open]');
  await ad.getByRole('button', { name: 'Раздать' }).click();
  await t.waitForURL(/\/assignments\/[0-9a-f-]+$/, { timeout: 15000 });
  ok('встроенный шаблон «Кратчайший путь в графе» выдан заданием классу');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
