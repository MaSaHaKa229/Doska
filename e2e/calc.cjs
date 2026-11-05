// Сквозной сценарий калькулятора и распознавания формул (этап 5.3b).
// Бэкенд запускается с FORMULA_OCR_URL=http://127.0.0.1:8599/predict: на этом
// порту сценарий сам поднимает подставной сервис распознавания (настоящая
// модель pix2tex в браузерной проверке не нужна — её обёртку проверяет
// services/formula-ocr/test_server.py).
const http = require('node:http');
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/calc.cjs <classId> (его печатает e2e/setup.mts)');

const ocrRequests = [];
const fakeOcr = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    ocrRequests.push({ type: req.headers['content-type'], png: body.subarray(1, 4).toString() === 'PNG', width: body.readUInt32BE(16), height: body.readUInt32BE(20) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify('$x^{2}+1$'));
  });
});

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
const objs = (page, type) =>
  page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => ({ id: o.get('id'), x: o.get('x'), y: o.get('y'), props: o.get('props') })), type);

(async () => {
  await new Promise((r) => fakeOcr.listen(8599, '127.0.0.1', r));
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Калькулятор 5.3b', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();

  // 1. Калькулятор (C): перевод единиц, результат на доску.
  await teacher.mouse.click(box.x + 600, box.y + 500);
  await teacher.keyboard.press('c');
  const panel = teacher.getByRole('dialog', { name: 'Калькулятор' });
  const input = panel.getByLabel('Выражение');
  await input.waitFor();
  await waitStore(teacher, () => !document.querySelector('[aria-label="Выражение"]')?.disabled, 'загрузка калькулятора');
  await input.fill('72 км/ч в м/с');
  await panel.getByText('= 20 м/с').waitFor();
  await panel.getByRole('button', { name: 'На доску' }).click();
  await waitStore(teacher, () => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === 'core.calc'), 'результат на доске');
  let [c] = await objs(teacher, 'core.calc');
  if (c.props.expr !== '72 км/ч в м/с' || !c.props.latex.endsWith('=20\\,\\text{м}/\\text{с}')) throw new Error('результат: ' + JSON.stringify(c.props));
  ok(`перевод единиц: ${c.props.expr} → ${c.props.latex}`);

  // 2. Переменные, история, ошибка с понятным текстом.
  await input.fill('x = 5');
  await input.press('Enter');
  await input.fill('x^2 + 1');
  await panel.getByText('= 26').waitFor();
  await input.press('Enter');
  await panel.getByRole('list', { name: 'История вычислений' }).getByText('x^2 + 1').waitFor();
  await input.fill('5 м + 2 с');
  await panel.getByText('Единицы измерения не согласуются').waitFor();
  ok('переменная x = 5, x^2 + 1 = 26 в истории; ошибка единиц объяснена');
  await panel.getByRole('button', { name: 'На доску: x^2 + 1' }).click();
  await waitStore(teacher, () => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'core.calc').length === 2, 'второй результат');
  const calcs = await objs(teacher, 'core.calc');
  if (!(calcs[1].y > calcs[0].y)) throw new Error('второй результат встал поверх первого');
  ok('результат из истории встал ниже первого');
  await teacher.screenshot({ path: OUT + '/c1-calc.png' });
  await panel.getByRole('button', { name: 'Закрыть калькулятор' }).click();

  // 3. Двойной щелчок по результату — пересчёт.
  const b = await teacher.evaluate((id) => window.__doska.model.boundsOf([id]), calcs[0].id);
  const cam = await teacher.evaluate(() => { const s = window.__doska.store.getState(); return s.cameras[s.pageId]; });
  const sx = (x) => box.x + box.width / 2 + (x - cam.cx) * cam.zoom;
  const sy = (y) => box.y + box.height / 2 + (y - cam.cy) * cam.zoom;
  await teacher.mouse.dblclick(sx(b.x + b.width / 2), sy(b.y + b.height / 2));
  await input.waitFor();
  if ((await input.inputValue()) !== '72 км/ч в м/с') throw new Error('пересчёт: запись не подставилась');
  await input.fill('90 км/ч в м/с');
  await panel.getByRole('button', { name: 'Обновить на доске' }).click();
  await waitStore(teacher, (id) => window.__doska.model.getObject(id).props.latex.endsWith('=25\\,\\text{м}/\\text{с}'), 'пересчитанный результат', calcs[0].id);
  ok('двойной щелчок: результат пересчитан (90 км/ч = 25 м/с)');
  await teacher.keyboard.press('Escape');

  // 4. Распознавание рукописи: два штриха пером → «Распознать формулу».
  await teacher.keyboard.press('p');
  for (const [x0, y0, x1, y1] of [[150, 260, 230, 330], [150, 330, 230, 260]]) {
    await teacher.mouse.move(box.x + x0, box.y + y0);
    await teacher.mouse.down();
    for (let i = 1; i <= 12; i++) await teacher.mouse.move(box.x + x0 + ((x1 - x0) * i) / 12, box.y + y0 + ((y1 - y0) * i) / 12);
    await teacher.mouse.up();
  }
  const strokes = (await objs(teacher, 'core.stroke')).map((s) => s.id);
  if (strokes.length !== 2) throw new Error('штрихов: ' + strokes.length);
  await teacher.keyboard.press('v');
  await teacher.evaluate((ids) => window.__doska.store.getState().setSelection(ids), strokes);
  await teacher.getByRole('button', { name: 'Распознать формулу' }).click();
  const dlg = teacher.locator('dialog[open]');
  await dlg.getByRole('heading', { name: 'Распознанная формула' }).waitFor({ timeout: 15000 });
  await dlg.locator('math-field').waitFor();
  const req = ocrRequests[0];
  if (!req || req.type !== 'image/png' || !req.png || req.height < 90 || req.height > 140) throw new Error('запрос к распознаванию: ' + JSON.stringify(req));
  ok(`рукопись ушла на распознавание: PNG ${req.width}×${req.height}`);
  await dlg.getByRole('button', { name: 'Вставить' }).click();
  await dlg.waitFor({ state: 'detached' });
  const forms = await objs(teacher, 'core.formula');
  const left = (await objs(teacher, 'core.stroke')).length;
  if (forms.length !== 1 || !/^x\^\{?2\}?\+1$/.test(forms[0].props.latex) || left !== 0) throw new Error(`после распознавания: ${JSON.stringify(forms)}, штрихов ${left}`);
  ok('формула x^2+1 встала на место рукописи, штрихи убраны');
  await teacher.keyboard.press('Control+z');
  await waitStore(teacher, () => {
    const all = [...window.__doska.model.doc.getMap('objects').values()].map((o) => o.get('type'));
    return all.filter((t) => t === 'core.stroke').length === 2 && !all.includes('core.formula');
  }, 'отмена распознавания одним шагом');
  ok('Ctrl+Z вернул рукопись одним шагом');

  // 5. Ученик в «Лекции» считает, но на доску не ставит.
  await student.keyboard.press('c');
  const sp = student.getByRole('dialog', { name: 'Калькулятор' });
  await sp.getByLabel('Выражение').waitFor();
  await waitStore(student, () => !document.querySelector('[aria-label="Выражение"]')?.disabled, 'калькулятор ученика');
  await sp.getByLabel('Выражение').fill('2 кг * 9,8 м/с^2');
  await sp.getByText('= 19,6 Н').waitFor();
  if (!(await sp.getByRole('button', { name: 'На доску' }).isDisabled())) throw new Error('ученик в «Лекции» может ставить результат');
  await student.screenshot({ path: OUT + '/c2-student.png' });
  ok('ученик считает (2 кг · 9,8 м/с² = 19,6 Н), кнопка «На доску» недоступна');

  await browser.close();
  fakeOcr.close();
  console.log('ВСЁ ПРОШЛО');
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
