// Проверка собранной установки (этап 9): сайт через Nginx, вход, доска урока
// у учителя и ученика по WebSocket за прокси, рисование мышью, сохранение на
// сервере (снимок доски), библиотека со встроенными шаблонами. Работает с
// рабочей сборкой (без отладочного window.__doska).
//   BASE=http://сервер node e2e/stack-smoke.cjs <classId>
const { chromium } = require('playwright');
const Y = require('yjs');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = process.env.BASE || 'http://localhost:8080';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/stack-smoke.cjs <classId> (его печатает e2e/setup.mts)');
const ok = (msg) => console.log('✓', msg);

async function login(browser, login) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${login}] pageerror`, e.message));
  await page.goto(BASE + '/login');
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill('Kot12345e2e');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return page;
}

(async () => {
  const browser = await chromium.launch();
  const t = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => t.screenshot({ path: OUT + '/stack-fail.png' });
  const s = await login(browser, 'e2e.student1');
  ok('вход учителя и ученика через Nginx');

  const boardId = await t.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Проверка установки', classIds: [classId], mode: 'COLLABORATIVE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [t, s]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await p.getByText('В сети').waitFor({ timeout: 15000 });
  }
  ok('доска открыта у обоих, соединение «В сети» (WebSocket за прокси)');

  // Прямоугольник мышью у учителя.
  await t.getByRole('button', { name: 'Прямоугольник', exact: true }).click();
  const box = await t.getByTestId('board-canvas').boundingBox();
  await t.mouse.move(box.x + 300, box.y + 200);
  await t.mouse.down();
  await t.mouse.move(box.x + 600, box.y + 380, { steps: 8 });
  await t.mouse.up();

  // Сервер получил и сохранил объект: снимок доски глазами ученика.
  let types = [];
  for (let i = 0; i < 30 && !types.includes('core.shape'); i++) {
    await s.waitForTimeout(500);
    const bytes = await s.evaluate(async (id) => Array.from(new Uint8Array(await (await fetch(`/api/boards/${id}/snapshot`)).arrayBuffer())), boardId);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Uint8Array.from(bytes));
    types = [...doc.getMap('objects').values()].map((o) => o.get('type'));
  }
  if (!types.includes('core.shape')) throw new Error('прямоугольник не дошёл до сервера: ' + types.join());
  await s.waitForTimeout(500);
  await s.screenshot({ path: OUT + '/stack-1-student.png' });
  ok('прямоугольник учителя сохранён на сервере и виден ученику');

  // Библиотека: встроенные шаблоны созданы сервером при запуске.
  await t.goto(BASE + '/library');
  await t.getByRole('tab', { name: 'Встроенные' }).click();
  await t.getByRole('article', { name: 'Шаблон Брусок на наклонной плоскости' }).waitFor();
  const n = await t.getByRole('article').count();
  if (n !== 12) throw new Error('встроенных шаблонов: ' + n);
  await t.waitForTimeout(1200);
  await t.screenshot({ path: OUT + '/stack-2-library.png' });
  ok('библиотека: 12 встроенных шаблонов');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
