// Сквозной сценарий текста (этап 5.2b): блок с заголовком, жирным, цветом,
// формулой ($…$ и диалог), таблицей; ученик видит текст и пишет поверх;
// «Редактирует …»; вставка обычного текста из буфера.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/text.cjs <classId> (его печатает e2e/setup.mts)');

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
const texts = (page) =>
  page.evaluate(() => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'core.text').map((o) => ({ id: o.get('id'), props: o.get('props') })));

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Текст 5.2b', classIds: [classId], mode: 'COLLABORATIVE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();

  // Новый блок: заголовок, жирный красный текст, формула через $…$, таблица.
  await teacher.keyboard.press('t');
  await teacher.mouse.click(box.x + 150, box.y + 120);
  const editor = teacher.getByTestId('text-editor');
  await editor.waitFor();
  const toolbar = teacher.getByRole('toolbar', { name: 'Форматирование текста' });
  await toolbar.getByLabel('Стиль абзаца').selectOption('h2');
  await teacher.keyboard.type('Задача 1');
  await teacher.keyboard.press('Enter');
  await toolbar.getByLabel('Стиль абзаца').selectOption('p');
  await teacher.keyboard.type('Решите уравнение ');
  await toolbar.getByRole('button', { name: 'Жирный (Ctrl+B)' }).click();
  await toolbar.getByRole('radio', { name: 'Цвет accent-1' }).click();
  await teacher.keyboard.type('важно');
  await toolbar.getByRole('button', { name: 'Жирный (Ctrl+B)' }).click();
  await toolbar.getByRole('radio', { name: 'Цвет ink' }).click();
  await teacher.keyboard.type(': $x^2 - 4 = 0$ ');
  // Формула через диалог.
  await toolbar.getByRole('button', { name: /Формула/ }).click();
  const dlg = teacher.locator('dialog[open]');
  await dlg.locator('textarea').fill('\\frac{-b \\pm \\sqrt{D}}{2a}');
  await dlg.getByRole('button', { name: 'Вставить' }).click();
  await teacher.keyboard.press('Enter');
  await toolbar.getByRole('button', { name: 'Вставить таблицу 3×3' }).click();
  await teacher.keyboard.type('x');
  await teacher.keyboard.press('Tab');
  await teacher.keyboard.type('y');
  await teacher.screenshot({ path: OUT + '/t1-editing.png' });
  await teacher.keyboard.press('Escape');
  await editor.waitFor({ state: 'detached' });

  const [t] = await texts(teacher);
  const json = JSON.stringify(t.props.doc);
  for (const [what, needle] of [
    ['заголовок', '"type":"heading"'],
    ['жирный', '"type":"bold"'],
    ['цвет', 'var(--c-accent-1)'],
    ['формула из $…$', '"latex":"x^2 - 4 = 0"'],
    ['формула из диалога', '\\\\frac{-b'],
    ['таблица', '"type":"table"'],
  ]) {
    if (!json.includes(needle)) throw new Error(`нет «${what}» в документе: ${json.slice(0, 400)}`);
  }
  if (!(t.props.h > 120)) throw new Error('высота блока не измерена: ' + t.props.h);
  // Правило $…$ заменяет совпадение целиком: знаков доллара в тексте не остаётся.
  if (json.includes('$')) throw new Error('в тексте остались знаки $: ' + json.slice(0, 600));
  ok('блок: заголовок, жирный, цвет, две формулы, таблица; высота измерена');

  // Ученик видит тот же текст и пишет пером поверх.
  await waitStore(student, (id) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('id') === id && JSON.stringify(o.get('props').doc).includes('table')), 'текст у ученика', t.id);
  await student.keyboard.press('p');
  const sb = await student.getByTestId('board-canvas').boundingBox();
  await student.mouse.move(sb.x + 160, sb.y + 175);
  await student.mouse.down();
  await student.mouse.move(sb.x + 420, sb.y + 190, { steps: 12 });
  await student.mouse.up();
  await student.waitForTimeout(800);
  await student.screenshot({ path: OUT + '/t2-student.png' });
  const order = await student.evaluate(() => {
    const m = window.__doska.model;
    return m.pageObjects(window.__doska.store.getState().pageId).map((id) => m.getObject(id).type);
  });
  if (order.join() !== 'core.text,core.stroke') throw new Error('порядок слоёв: ' + order.join());
  ok('ученик видит текст и пишет поверх (штрих выше текста)');

  // Учитель снова открывает блок двойным щелчком — у ученика «Редактирует …».
  await teacher.keyboard.press('v');
  await teacher.mouse.dblclick(box.x + 200, box.y + 135);
  await editor.waitFor();
  await waitStore(student, (id) => window.__doska.presence.peers().some((p) => p.editing === id), 'ученик видит «Редактирует»', t.id);
  await student.waitForTimeout(300);
  await student.screenshot({ path: OUT + '/t3-editing-label.png' });
  await teacher.keyboard.press('Control+End');
  await teacher.keyboard.type(' ещё');
  await teacher.mouse.click(box.x + 900, box.y + 600);
  await editor.waitFor({ state: 'detached' });
  await waitStore(student, () => window.__doska.presence.peers().every((p) => !p.editing), 'отметка снята');
  ok('двойной щелчок открывает редактор, у ученика — «Редактирует …»');

  // Вставка обычного текста из буфера.
  await teacher.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Первая строка\nВторая строка');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await waitStore(teacher, () => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'core.text').length === 2, 'блок из буфера');
  const pasted = (await texts(teacher)).find((x) => x.id !== t.id);
  if (pasted.props.doc.content.length !== 2) throw new Error('абзацы из буфера: ' + JSON.stringify(pasted.props.doc));
  ok('обычный текст из буфера стал блоком из двух абзацев');

  await teacher.waitForTimeout(500);
  await teacher.screenshot({ path: OUT + '/t4-teacher.png' });
  await browser.close();
  console.log('ВСЁ ПРОШЛО');
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
