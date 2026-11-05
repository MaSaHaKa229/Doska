// Сквозной сценарий файлов (этап 5.2a): картинка через инструмент и из
// буфера, обрезка, PDF как фон новых страниц, видимость у ученика.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const OUT = process.env.E2E_OUT || os.tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/media.cjs <classId> (его печатает e2e/setup.mts)');

/** PDF из двух страниц A4 с крупным текстом (шрифт Helvetica встроен в любой просмотрщик). */
function makePdf() {
  const page = (n) => `BT /F1 48 Tf 72 700 Td (Task ${n}: 2x + 3 = 11) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    `<< /Length ${page(1).length} >>\nstream\n${page(1)}\nendstream`,
    `<< /Length ${page(2).length} >>\nstream\n${page(2)}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const off = [];
  objs.forEach((o, i) => {
    off.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

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
const objects = (page) => page.evaluate(() => {
  const m = window.__doska.model;
  return m.pageObjects(window.__doska.store.getState().pageId).map((id) => ({ id, ...m.getObject(id) }));
});

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doska-media-'));
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const student = await login(browser, 'e2e.student1');

  // Картинка с метаданными не нужна: браузер всё равно перекодирует. Рисуем PNG в браузере.
  const pngB64 = await teacher.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 400;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 600, 400);
    gr.addColorStop(0, '#2563eb');
    gr.addColorStop(1, '#16a34a');
    g.fillStyle = gr;
    g.fillRect(0, 0, 600, 400);
    g.fillStyle = '#fff';
    g.font = 'bold 64px sans-serif';
    g.fillText('Чертёж', 150, 220);
    return c.toDataURL('image/png').split(',')[1];
  });
  const pngPath = path.join(dir, 'чертёж.png');
  fs.writeFileSync(pngPath, Buffer.from(pngB64, 'base64'));
  const pdfPath = path.join(dir, 'задачи.pdf');
  fs.writeFileSync(pdfPath, makePdf());

  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Файлы 5.2a', classIds: [classId], mode: 'COLLABORATIVE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  // Постоянный обработчик: без него Playwright между выборами файлов выключает
  // перехват окна асинхронно и может не успеть включить его к следующему щелчку.
  teacher.on('filechooser', () => undefined);

  // 1. Инструмент «Картинка или PDF»: щелчок по доске → выбор файла.
  await teacher.keyboard.press('i');
  let chooser = teacher.waitForEvent('filechooser');
  await teacher.mouse.click(box.x + 400, box.y + 250);
  // Файл передаётся содержимым: путь с кириллицей Chromium под Playwright не принимает.
  await (await chooser).setFiles({ name: 'чертёж.png', mimeType: 'image/png', buffer: fs.readFileSync(pngPath) });
  await waitStore(teacher, () => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === 'core.image'), 'картинка на доске');
  let img = (await objects(teacher)).find((o) => o.type === 'core.image');
  if (img.props.naturalW !== 600 || img.props.naturalH !== 400) throw new Error('размер картинки: ' + JSON.stringify(img.props));
  ok('картинка вставлена инструментом, размер 600×400');

  // У ученика картинка загружается (cookie, тот же сайт).
  const status = await student.evaluate(async (url) => (await fetch(url)).status, `/api/assets/${img.props.assetId}`);
  if (status !== 200) throw new Error('ученик не получил файл: ' + status);
  ok('ученик получает файл картинки');

  // 2. Вставка из буфера обмена (снимок экрана).
  await teacher.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, pngB64);
  await waitStore(teacher, () => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'core.image').length === 2, 'вторая картинка из буфера');
  ok('картинка вставлена из буфера (Ctrl+V)');

  // Перетаскивание файла на доску.
  await teacher.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'схема.png', { type: 'image/png' }));
    const wrap = document.querySelector('.board-canvas-wrap');
    const r = wrap.getBoundingClientRect();
    const opts = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 200, clientY: r.top + 150 };
    wrap.dispatchEvent(new DragEvent('dragover', opts));
    wrap.dispatchEvent(new DragEvent('drop', opts));
  }, pngB64);
  await waitStore(teacher, () => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'core.image').length === 3, 'картинка перетаскиванием');
  ok('картинка вставлена перетаскиванием файла на доску');

  // 3. Обрезка.
  await teacher.keyboard.press('v');
  await teacher.evaluate((id) => window.__doska.store.getState().setSelection([id]), img.id);
  await teacher.getByRole('button', { name: 'Обрезать' }).click();
  const frame = teacher.getByTestId('crop-frame');
  const fb = await frame.boundingBox();
  await teacher.mouse.move(fb.x + fb.width - 6, fb.y + fb.height - 6);
  await teacher.mouse.down();
  await teacher.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2, { steps: 5 });
  await teacher.mouse.up();
  await teacher.screenshot({ path: OUT + '/m1-crop.png' });
  await teacher.locator('dialog[open]').getByRole('button', { name: 'Применить' }).click();
  const scaleBefore = img.props.w / img.props.naturalW;
  img = (await objects(teacher)).find((o) => o.id === img.id);
  if (!img.props.crop || img.props.crop.w > 320 || Math.abs(img.props.w / img.props.crop.w - scaleBefore) > 0.01) throw new Error('обрезка: ' + JSON.stringify(img.props));
  ok(`обрезка: видимая часть ${Math.round(img.props.crop.w)}×${Math.round(img.props.crop.h)}, масштаб сохранён`);

  // 4. PDF как фон новых страниц.
  await teacher.keyboard.press('i');
  chooser = teacher.waitForEvent('filechooser');
  await teacher.mouse.click(box.x + 600, box.y + 500);
  await (await chooser).setFiles({ name: 'задачи.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(pdfPath) });
  const dlg = teacher.locator('dialog[open]');
  await dlg.getByText('страниц — 2').waitFor({ timeout: 15000 });
  await dlg.getByRole('button', { name: /Добавить 2 стр/ }).click();
  await waitStore(teacher, () => window.__doska.model.pages().length === 3, 'три страницы');
  const pages = await teacher.evaluate(() => window.__doska.model.pages().map((p) => ({ t: p.title, pdf: p.background.pdf, locked: p.backgroundLocked })));
  if (!pages[1].pdf || pages[1].pdf.page !== 1 || pages[2].pdf.page !== 2 || !pages[1].locked) throw new Error('страницы PDF: ' + JSON.stringify(pages));
  ok(`PDF: добавлены страницы «${pages[1].t}» и «${pages[2].t}», фон закреплён`);
  await teacher.waitForTimeout(1500);
  await teacher.screenshot({ path: OUT + '/m2-pdf-page.png' });

  // Ученик видит страницу PDF и пишет поверх.
  await student.evaluate((id) => window.__doska.store.getState().setPage(id), (await teacher.evaluate(() => window.__doska.model.pages()[1].id)));
  await student.waitForTimeout(1500);
  await student.keyboard.press('p');
  const sb = await student.getByTestId('board-canvas').boundingBox();
  await student.mouse.move(sb.x + 300, sb.y + 300);
  await student.mouse.down();
  await student.mouse.move(sb.x + 600, sb.y + 320, { steps: 10 });
  await student.mouse.up();
  await student.waitForTimeout(500);
  await student.screenshot({ path: OUT + '/m3-student-pdf.png' });
  const onPdf = await teacher.evaluate(() => {
    const m = window.__doska.model;
    return m.pageObjects(m.pages()[1].id).length;
  });
  if (onPdf !== 1) throw new Error('штрих ученика на странице PDF не дошёл');
  ok('ученик видит страницу PDF и пишет поверх неё');

  await browser.close();
  console.log('ВСЁ ПРОШЛО');
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
