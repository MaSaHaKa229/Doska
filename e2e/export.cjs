// Сквозной сценарий экспорта (этап 8.2a): доска из двух страниц (фигура,
// формула, чертёж раздела); PNG страницы 2× (размер и сигнатура), PNG
// выделения, SVG (векторные элементы и встроенная формула), PDF всей
// доски — две страницы.
const { chromium } = require('playwright');
const fs = require('node:fs');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/export.cjs <classId> (его печатает e2e/setup.mts)');
const ok = (msg) => console.log('✓', msg);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const t = await ctx.newPage();
  t.on('pageerror', (e) => console.log('pageerror', e.message));
  t.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('console', m.text()));
  globalThis.__shot = () => t.screenshot({ path: OUT + '/export-fail.png' });
  await t.goto(BASE + '/login');
  await t.getByLabel('Логин').fill('e2e.teacher');
  await t.getByLabel('Пароль', { exact: true }).fill('Kot12345e2e');
  await t.getByRole('button', { name: 'Войти' }).click();
  await t.waitForURL((u) => !u.pathname.startsWith('/login'));
  const boardId = await t.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Экспорт: дроби/проценты', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  await t.goto(`${BASE}/boards/${boardId}`);
  await t.waitForFunction(() => window.__doska?.store.getState().synced, null, { timeout: 15000 });
  // Содержимое: страница 1 — прямоугольник, формула, график раздела; страница 2 — эллипс.
  await t.evaluate(() => {
    const { model, store } = window.__doska;
    const pageId = store.getState().pageId;
    model.createObject('core.shape', { pageId, x: 0, y: 0, props: { kind: 'rect', w: 300, h: 160, stroke: 'accent-1', fill: 'none', strokeWidth: 3, dash: 'solid' } });
    model.createObject('core.formula', { pageId, x: 40, y: 200, props: { latex: 'S=\\frac{a+b}{2}\\cdot h', size: 32, color: 'ink' } });
    model.createObject('math.complex.plane', { pageId, x: 380, y: 140, props: { R: 5, numbers: [{ re: 3, im: 2 }], op: 'none', n: 3 } });
    const p2 = model.addPage(undefined, pageId);
    model.createObject('core.shape', { pageId: p2, x: 0, y: 0, props: { kind: 'ellipse', w: 200, h: 120, stroke: 'accent-3', fill: 'none', strokeWidth: 3, dash: 'solid' } });
  });
  await t.waitForTimeout(800);
  const types = await t.evaluate(() => [...window.__doska.model.doc.getMap('objects').values()].length);
  if (types !== 4) throw new Error('объектов: ' + types);

  // Имя файла (кириллица) проверяет юнит-тест fileName: безголовый Chromium
  // заменяет не-ASCII имена blob-загрузок на «download», поэтому здесь — содержимое.
  let n = 0;
  const save = async (fill, ext) => {
    await t.evaluate(() => document.activeElement?.blur());
    await t.keyboard.press('Control+Shift+E');
    const dlg = t.getByRole('dialog', { name: 'Экспорт' });
    await fill(dlg);
    const [dl] = await Promise.all([t.waitForEvent('download', { timeout: 60000 }), dlg.getByRole('button', { name: 'Скачать' }).click()]);
    const path = `${OUT}/export-${++n}.${ext}`;
    await dl.saveAs(path);
    await dlg.waitFor({ state: 'hidden' });
    return { name: dl.suggestedFilename(), buf: fs.readFileSync(path) };
  };
  const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

  // 1. PNG страницы, 2×.
  const png = await save(async (d) => {
    await d.getByLabel('Формат').selectOption('png');
    await d.getByLabel('Что сохранить').selectOption('page');
    await d.getByLabel('Разрешение').selectOption('2');
  }, 'png');
  if (png.buf.subarray(1, 4).toString() !== 'PNG') throw new Error('не PNG');
  const s1 = pngSize(png.buf);
  if (s1.w < 1500 || s1.h < 600) throw new Error('размер PNG ' + JSON.stringify(s1));
  ok(`PNG страницы 2×: ${s1.w} × ${s1.h}`);

  // 2. PNG выделения: только прямоугольник.
  await t.evaluate(() => {
    const { model, store } = window.__doska;
    const id = [...model.doc.getMap('objects').values()].find((o) => o.get('type') === 'core.shape' && o.get('pageId') === store.getState().pageId).get('id');
    store.getState().setSelection([id]);
  });
  const sel = await save(async (d) => {
    await d.getByLabel('Формат').selectOption('png');
    await d.getByLabel('Что сохранить').selectOption('selection');
    await d.getByLabel('Разрешение').selectOption('1');
  }, 'png');
  const s2 = pngSize(sel.buf);
  if (Math.abs(s2.w - 348) > 8 || Math.abs(s2.h - 208) > 8) throw new Error('размер выделения ' + JSON.stringify(s2));
  ok(`PNG выделения 1×: ${s2.w} × ${s2.h} — прямоугольник 300 × 160 с полями`);
  await t.evaluate(() => window.__doska.store.getState().setSelection([]));

  // 3. SVG страницы.
  const svg = await save(async (d) => {
    await d.getByLabel('Формат').selectOption('svg');
    await d.getByLabel('Что сохранить').selectOption('page');
  }, 'svg');
  const text = svg.buf.toString();
  if (!text.startsWith('<svg') || !/<path|<rect/.test(text) || !text.includes('<image') || !text.includes('<text')) throw new Error('SVG без векторов, текста или формулы');
  // Обводки (рамка, оси, вектор): контуры с цветом обводки, а не «none» (svgcanvas теряет их при save/restore без поправки).
  const stroked = (text.match(/<path[^>]*stroke="#[0-9a-f]{6}"[^>]* d="/g) || []).length;
  if (stroked < 5 || !text.includes('stroke="#d92d2d"')) throw new Error('в SVG мало обводок: ' + stroked);
  ok(`SVG: векторные фигуры и подписи, формула — встроенным изображением (${Math.round(svg.buf.length / 1024)} КБ)`);

  // 4. PDF всей доски.
  const pdf = await save(async (d) => {
    await d.getByLabel('Формат').selectOption('pdf');
    await d.getByLabel('Что сохранить').selectOption('board');
    await d.getByLabel('Лист').selectOption('a4');
  }, 'pdf');
  const ptxt = pdf.buf.toString('latin1');
  const pagesN = (ptxt.match(/\/Type \/Page[^s]/g) || []).length;
  if (!ptxt.startsWith('%PDF') || pagesN !== 2) throw new Error('PDF: страниц ' + pagesN);
  ok('PDF всей доски: 2 страницы A4');

  await browser.close();
  console.log('Готово. Файлы:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
