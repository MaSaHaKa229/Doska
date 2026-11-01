// Сквозной сценарий заданий (этап 4.2): раздача копий, главная ученика,
// сдача, сетка работ, пометки учителя, отметка, миниатюры в списке досок.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/assignments.cjs <classId> (его печатает e2e/setup.mts)');

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
const waitStore = (page, fn, what, arg) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(() => { throw new Error('Не дождались: ' + what); });
const ok = (msg) => console.log('✓', msg);
async function drawRect(page, dx = 0) {
  await page.keyboard.press('r');
  const box = await page.getByTestId('board-canvas').boundingBox();
  await page.mouse.move(box.x + 250 + dx, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 420 + dx, box.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('v');
}

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const s1 = await login(browser, 'e2e.student1');

  const title = 'Задача ' + Date.now().toString(36);
  const boardId = await teacher.evaluate(async ({ title }) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title }) });
    return (await r.json()).board.id;
  }, { title });
  await teacher.goto(`${BASE}/boards/${boardId}`);
  await waitStore(teacher, () => window.__doska?.store.getState().synced, 'доска учителя');
  await drawRect(teacher);
  await waitStore(teacher, () => window.__doska.model.doc.getMap('objects').size === 1, 'фигура учителя');
  ok('учитель подготовил доску');

  // Раздать как задание.
  await teacher.getByRole('button', { name: 'Урок' }).click();
  await teacher.getByRole('button', { name: 'Раздать как задание…' }).click();
  const dlg = teacher.locator('dialog[open]');
  await dlg.getByLabel('Класс').selectOption(CLASS_ID);
  await dlg.getByLabel('Что сделать (видят ученики)').fill('Достройте фигуру');
  await dlg.getByRole('button', { name: 'Раздать' }).click();
  await teacher.waitForURL(/\/assignments\//);
  await teacher.getByTestId('work-card').first().waitFor();
  const cards = await teacher.getByTestId('work-card').count();
  if (cards !== 2) throw new Error('ожидалось 2 работы, а их ' + cards);
  ok('задание выдано классу: 2 работы в сетке');

  // Ученик: главная → задание → работа.
  await s1.goto(BASE + '/');
  const row = s1.getByTestId('student-assignment').filter({ hasText: title });
  await row.waitFor();
  await row.getByText('Не начата').waitFor();
  await s1.screenshot({ path: OUT + '/a1-student-home.png' });
  await row.click();
  await s1.getByTestId('work-bar').waitFor();
  await waitStore(s1, () => window.__doska?.store.getState().synced && window.__doska.model.doc.getMap('objects').size === 1, 'копия доски у ученика');
  ok('ученик открыл свою копию с фигурой учителя');
  await drawRect(s1, 250);
  await waitStore(s1, () => window.__doska.model.doc.getMap('objects').size === 2, 'фигура ученика');
  await s1.getByTestId('work-bar').getByText('В работе').waitFor();
  ok('статус «В работе» после первого изменения');

  // Живая миниатюра у учителя: канвас в карточке.
  await teacher.locator('.work-card canvas').first().waitFor({ timeout: 10000 });
  await teacher.waitForTimeout(500);
  await teacher.screenshot({ path: OUT + '/a2-works-grid.png' });
  ok('сетка работ с живыми миниатюрами');

  await s1.getByRole('button', { name: 'Сдать работу' }).click();
  await s1.getByText('Работа сдана на проверку').waitFor();
  await waitStore(s1, () => window.__doska.store.getState().caps.write === false, 'запрет записи после сдачи');
  ok('работа сдана, ученик больше не пишет');

  // Учитель открывает сданную работу.
  await teacher.reload();
  await teacher.getByRole('tab', { name: /Сдана \(1\)/ }).click();
  await teacher.getByTestId('work-card').first().click();
  await teacher.getByTestId('work-bar').waitFor();
  await waitStore(teacher, () => window.__doska?.store.getState().synced, 'работа у учителя');
  await drawRect(teacher, -150);
  await waitStore(teacher, () => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('layer') === 'review' && o.get('props').stroke === 'accent-1'), 'красная пометка в слое review');
  ok('пометка учителя — красная, в слое review');
  await teacher.getByLabel('Отметка').fill('5');
  await teacher.getByRole('button', { name: 'Проверено' }).click();
  await s1.getByText('Учитель проверил работу: 5').waitFor();
  await waitStore(s1, () => [...window.__doska.model.doc.getMap('objects').entries()].some(([id, o]) => o.get('layer') === 'review' && !window.__doska.model.canDelete(id)), 'пометка у ученика, удалить нельзя');
  await s1.screenshot({ path: OUT + '/a3-student-reviewed.png' });
  ok('ученик видит отметку и пометки, изменить их не может');

  await teacher.getByRole('button', { name: 'Вернуть на доработку' }).click();
  await s1.getByText('Учитель вернул работу на доработку').waitFor();
  await waitStore(s1, () => window.__doska.store.getState().caps.write === true, 'снова можно писать');
  ok('возврат на доработку');

  // Миниатюры в списке досок.
  await teacher.goto(BASE + '/');
  const card = teacher.locator('.board-card').filter({ hasText: title });
  await card.locator('canvas').waitFor({ timeout: 10000 });
  await teacher.screenshot({ path: OUT + '/a4-boards-thumbs.png' });
  ok('миниатюра доски в списке');

  await browser.close();
  console.log('ВСЁ ПРОШЛО');
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
