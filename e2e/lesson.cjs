const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/lesson.cjs <classId> (его печатает e2e/setup.mts)');

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
const store = (page, fn) => page.evaluate(fn);
const waitStore = (page, fn, what) => page.waitForFunction(fn, null, { timeout: 8000 }).catch(() => { throw new Error('Не дождались: ' + what); });
const ok = (msg) => console.log('✓', msg);

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const s1 = await login(browser, 'e2e.student1');
  const s2 = await login(browser, 'e2e.student2');

  // Доска урока в режиме «Лекция», выдана классу.
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Урок 4.1 — проверка', classIds: [classId], mode: 'LECTURE' }) });
    if (!r.ok) throw new Error('create ' + r.status + (await r.text()));
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, s1, s2]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  ok('три участника открыли доску');
  await s1.getByText('Сейчас режим «Лекция»').waitFor();

  // Режим одной кнопкой.
  await teacher.getByRole('button', { name: 'Урок' }).click();
  await teacher.screenshot({ path: OUT + '/1-lesson-menu.png' });
  await teacher.getByRole('group', { name: 'Режим доски' }).getByRole('button', { name: /Совместн/ }).click();
  await waitStore(s1, () => window.__doska.store.getState().caps.write === true, 'право записи после «Совместная»');
  ok('режим «Совместная» — ученик может писать');
  await teacher.getByRole('group', { name: 'Режим доски' }).getByRole('button', { name: /Выбороч/ }).click();
  await waitStore(s1, () => window.__doska.store.getState().caps.noWriteReason === 'no-chalk', 'выборочный режим');
  await teacher.keyboard.press('Escape');
  ok('режим «Выборочно» — без мела писать нельзя');

  // Рука и мел.
  await s1.getByRole('button', { name: 'Поднять руку' }).click();
  await teacher.getByTestId('hands-count').waitFor();
  ok('учитель видит поднятую руку');
  await teacher.locator('button.participants').click();
  await teacher.screenshot({ path: OUT + '/2-participants.png' });
  await teacher.getByRole('button', { name: 'Дать мел: Иванов Иван' }).click();
  await waitStore(s1, () => window.__doska.store.getState().caps.write === true, 'мел у ученика');
  await waitStore(teacher, () => window.__doska.store.getState().hands.length === 0, 'рука опущена');
  ok('мел выдан, рука опущена');
  await teacher.keyboard.press('Escape');

  // Ученик рисует прямоугольник.
  await s1.keyboard.press('r');
  const box = await s1.getByTestId('board-canvas').boundingBox();
  await s1.mouse.move(box.x + 300, box.y + 200);
  await s1.mouse.down();
  await s1.mouse.move(box.x + 450, box.y + 300, { steps: 5 });
  await s1.mouse.up();
  await waitStore(teacher, () => window.__doska.model.doc.getMap('objects').size === 1, 'объект ученика у учителя');
  ok('ученик с мелом нарисовал фигуру');

  // Удаление записей ученика.
  await teacher.locator('button.participants').click();
  await teacher.getByRole('button', { name: 'Удалить записи: Иванов Иван' }).click();
  await teacher.locator('dialog[open]').getByRole('button', { name: 'Удалить' }).click();
  await waitStore(s1, () => window.__doska.model.doc.getMap('objects').size === 0, 'очистка у ученика');
  ok('записи ученика удалены у всех');

  // «Следуйте за мной», строго.
  await teacher.getByRole('button', { name: 'Урок' }).click();
  await teacher.getByLabel('Строго: ученики не могут отойти').check();
  await teacher.getByRole('button', { name: 'Следуйте за мной' }).click();
  await s1.getByTestId('follow-banner').waitFor();
  await teacher.evaluate(() => window.__doska.store.getState().setCamera({ cx: 400, cy: 300, zoom: 2 }));
  await waitStore(s1, () => { const s = window.__doska.store.getState(); const c = s.cameras[s.pageId]; return c && Math.abs(c.cx - 400) < 0.01 && Math.abs(c.cy - 300) < 0.01; }, 'вид ученика за учителем');
  const before = await s1.evaluate(() => { const s = window.__doska.store.getState(); return s.cameras[s.pageId]; });
  const b1 = await s1.getByTestId('board-canvas').boundingBox();
  await s1.mouse.move(b1.x + 400, b1.y + 300);
  await s1.mouse.wheel(0, 300);
  await s1.waitForTimeout(200);
  const after = await s1.evaluate(() => { const s = window.__doska.store.getState(); return s.cameras[s.pageId]; });
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('строгий показ: ученик сдвинул вид');
  await s1.screenshot({ path: OUT + '/3-student-follow.png' });
  ok('строгий показ: вид ученика следует за учителем, сам ученик вид не меняет');
  await teacher.getByRole('button', { name: 'Урок' }).click();
  await teacher.getByRole('button', { name: 'Закончить показ' }).click();
  await s1.getByTestId('follow-banner').waitFor({ state: 'detached' });
  ok('показ закончен');

  // Лазер учителя.
  await teacher.keyboard.press('k');
  const tb = await teacher.getByTestId('board-canvas').boundingBox();
  await teacher.mouse.move(tb.x + 300, tb.y + 300);
  await teacher.mouse.down();
  for (let i = 0; i < 12; i++) await teacher.mouse.move(tb.x + 300 + i * 20, tb.y + 300 + Math.sin(i) * 40);
  await waitStore(s2, () => window.__doska.store && document.querySelector('.laser-layer') && true, 'слой лазера');
  await s2.waitForTimeout(150);
  await s2.screenshot({ path: OUT + '/4-student-sees-laser.png' });
  await teacher.mouse.up();
  ok('лазер учителя виден ученику (снимок 4)');

  // Курсоры учеников скрыты от учеников.
  await teacher.getByRole('button', { name: 'Урок' }).click();
  await teacher.getByLabel('Ученики видят курсоры друг друга').uncheck();
  await teacher.keyboard.press('Escape');
  await waitStore(s2, () => window.__doska.store.getState().board.settings.showStudentCursors === false, 'настройка');
  const sb = await s1.getByTestId('board-canvas').boundingBox();
  await s1.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await s1.mouse.move(sb.x + sb.width / 2 + 20, sb.y + sb.height / 2 + 30, { steps: 4 });
  await s1.waitForTimeout(300);
  await teacher.waitForSelector('.cursor__label:has-text("Иванов")', { timeout: 5000 });
  const leaked = await s2.locator('.cursor__label:has-text("Иванов")').count();
  if (leaked) throw new Error('курсор ученика виден другому ученику');
  ok('курсор ученика видит учитель и не видит другой ученик');

  // Доступ к доске.
  await teacher.getByRole('button', { name: 'Урок' }).click();
  await teacher.getByRole('button', { name: 'Доступ к доске…' }).click();
  const dlg = teacher.locator('dialog[open]');
  await dlg.getByLabel('Поиск по ФИО или логину').fill('Сидор');
  await dlg.getByRole('button', { name: 'Добавить: Сидоров Олег' }).click();
  await teacher.screenshot({ path: OUT + '/5-access.png' });
  await dlg.getByRole('button', { name: 'Сохранить' }).click();
  await dlg.waitFor({ state: 'detached' }).catch(() => {});
  await teacher.getByText('Доступ к доске сохранён').waitFor();
  const access = await teacher.evaluate(async (id) => (await (await fetch('/api/boards/' + id)).json()).board.access, boardId);
  if (!access.members.some((m) => m.fullName === 'Сидоров Олег')) throw new Error('доступ не сохранён');
  ok('ученик добавлен через диалог доступа');

  await browser.close();
  console.log('ВСЁ ПРОШЛО');
})().catch(async (e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
