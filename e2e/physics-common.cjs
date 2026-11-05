// Сквозной сценарий общих инструментов физики (этап 7.1a): опора и брусок на
// ней, масштаб «1 клетка — 2 Н» в диалоге, сила тяжести и реакция опоры
// протяжкой от точек приложения (значения по масштабу), обозначение «mg»,
// смена масштаба пересчитывает векторы, сумма векторов, повёрнутые оси и
// проекции; ученик видит всё.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/physics-common.cjs <classId> (его печатает e2e/setup.mts)');

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
const P = 'physics.common.';
const all = (page, type) => page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type);
const count = (page, type, n) => waitStore(page, ([t, k]) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).length === k, `${type}: ${n}`, [type, n]);

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/physics-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Физика 7.1a', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  // Камера: мир = экран холста (зум 1, левый верхний угол — 0, 0).
  await teacher.evaluate(([w, h]) => { const s = window.__doska.store.getState(); s.setCamera({ cx: w / 2, cy: h / 2, zoom: 1 }); }, [box.width, box.height]);
  const at = (x, y) => [box.x + x, box.y + y];
  const dlg = teacher.locator('dialog[open]');
  const pick = async (title) => {
    await teacher.getByRole('button', { name: 'Физика: общее: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Физика: общее' }).getByRole('button', { name: title, exact: true }).click();
  };
  const dragFrom = async (from, to) => {
    await teacher.mouse.move(...at(...from));
    await teacher.mouse.down();
    await teacher.mouse.move(...at(...to), { steps: 6 });
    await teacher.mouse.up();
  };

  // 1. Опора и брусок на ней (щелчок по линии опоры).
  await pick('Опора (пол, стена, наклонная)');
  await teacher.mouse.click(...at(400, 420));
  await count(teacher, P + 'support', 1);
  // Выделенная опора перехватила бы щелчок ручкой рамки.
  await teacher.keyboard.press('Escape');
  await pick('Брусок');
  await teacher.mouse.click(...at(400, 420));
  await count(teacher, P + 'body', 1);
  const [block] = await all(teacher, P + 'body');
  if (Math.abs(block.y - 395) > 0.5 || Math.abs(block.x - 400) > 0.5) throw new Error('брусок не на опоре: ' + JSON.stringify([block.x, block.y]));
  ok('брусок встал на опору нижней гранью');

  // 2. Масштаб сил в диалоге.
  await pick('Масштаб');
  await teacher.mouse.click(...at(120, 120));
  await dlg.getByLabel('Единиц в клетке').fill('2');
  await dlg.getByRole('button', { name: 'Вставить' }).click();
  await count(teacher, P + 'scale', 1);
  ok('масштаб «F: 1 клетка — 2 Н»');

  // 3. Сила тяжести из центра бруска вниз на 3 клетки, реакция опоры из середины нижней грани вверх.
  await teacher.keyboard.press('Escape');
  await pick('Вектор: сила');
  await dragFrom([400, 395], [400, 455]);
  await teacher.keyboard.press('Escape');
  await pick('Вектор: сила');
  await dragFrom([400, 420], [400, 360]);
  await count(teacher, P + 'vector', 2);
  let [mg, N] = await all(teacher, P + 'vector');
  if (mg.x !== 400 || mg.y !== 395 || mg.props.dy !== 60 || mg.props.perCell !== 2) throw new Error('сила тяжести: ' + JSON.stringify(mg));
  if (N.y !== 420 || N.props.dy !== -60) throw new Error('реакция опоры: ' + JSON.stringify(N));
  ok('сила тяжести из центра бруска и реакция опоры из середины нижней грани — по точкам привязки, по 6 Н');

  // 4. Обозначения на панели свойств.
  await teacher.evaluate((id) => window.__doska.store.getState().setSelection([id]), mg.id);
  await teacher.getByLabel('Обозначение (F_тр — индекс)').fill('mg');
  await teacher.evaluate((id) => window.__doska.store.getState().setSelection([id]), N.id);
  await teacher.getByLabel('Обозначение (F_тр — индекс)').fill('N');
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'physics.common.vector').map((o) => o.toJSON().props.label).sort().join() === 'N,mg', 'обозначения у ученика');
  ok('обозначения mg и N видны ученику');

  // 5. Новый масштаб пересчитывает векторы.
  // Инструмент силы остаётся активным (несколько сил подряд) — возвращаемся к выделению.
  // Фокус — с поля панели свойств, иначе клавиши уйдут в него.
  await teacher.evaluate(() => document.activeElement?.blur());
  await teacher.keyboard.press('Escape');
  await teacher.keyboard.press('v');
  await teacher.mouse.dblclick(...at(125, 120));
  await dlg.getByLabel('Единиц в клетке').fill('5');
  await dlg.getByRole('button', { name: 'Сохранить' }).click();
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'physics.common.vector').every((o) => o.toJSON().props.perCell === 5), 'масштаб 5 у векторов');
  ok('масштаб «1 клетка — 5 Н»: значения векторов пересчитаны (15 Н)');

  // 6. Сила тяги вправо и сумма трёх сил.
  await teacher.keyboard.press('Escape');
  await pick('Вектор: сила');
  await dragFrom([440, 395], [520, 395]);
  await count(teacher, P + 'vector', 3);
  const ids = (await all(teacher, P + 'vector')).map((v) => v.id);
  await teacher.evaluate((v) => window.__doska.store.getState().setSelection(v), ids);
  await pick('Сумма векторов');
  await count(student, P + 'sum', 1);
  const sumTip = await teacher.evaluate(async () => {
    const { sumGeom } = await import('/src/physics/common/vectors.tsx');
    const sum = [...window.__doska.model.doc.getMap('objects').values()].find((o) => o.get('type') === 'physics.common.sum').toJSON();
    return sumGeom(sum, window.__doska.model.resolve);
  });
  if (Math.abs(sumTip.tip.x - 480) > 0.5 || Math.abs(sumTip.tip.y - 395) > 0.5) throw new Error('равнодействующая: ' + JSON.stringify(sumTip.tip));
  ok('равнодействующая mg + N + F — 4 клетки вправо (правило многоугольника)');

  // 7. Оси вдоль наклона (повёрнуты на 30°) и проекции силы тяги.
  await teacher.keyboard.press('Escape');
  await pick('Оси координат');
  await teacher.mouse.click(...at(700, 300));
  const [axes] = await all(teacher, P + 'axes');
  await teacher.evaluate((id) => window.__doska.model.updateObjects([{ id, patch: { rotation: -Math.PI / 6 } }]), axes.id);
  await pick('Проекции на оси');
  await teacher.mouse.click(...at(500, 395));
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === 'physics.common.vector' && o.toJSON().props.decompose && o.toJSON().props.axisAngle === 30), 'проекции у ученика');
  await teacher.keyboard.press('Escape');
  await teacher.screenshot({ path: OUT + '/physics-1-forces.png' });
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(400);
  await student.screenshot({ path: OUT + '/physics-2-student.png' });
  ok('проекции силы на оси, повёрнутые на 30°, — у ученика тоже');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
