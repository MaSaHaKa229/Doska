// Сквозной сценарий построений в пространстве (этап 6.4b): в 3D-редакторе
// щелчками — сечение куба через середины трёх рёбер (шестиугольник),
// диагонали граней AB₁ и BC₁, расстояние и угол между ними, правка доли
// ребра; у ученика всё видно. На доске — развёртка куба и плоский чертёж
// (точки и отрезки планиметрии, Ctrl+Z убирает его одним шагом).
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/stereo-space.cjs <classId> (его печатает e2e/setup.mts)');

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
const S = 'math.stereo.';
const all = (page, type) => page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), type);
const countOf = (page, type) => page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type').startsWith(t)).length, type);

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  globalThis.__shot = () => teacher.screenshot({ path: OUT + '/stereo-b-fail.png' });
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Стереометрия 6.4b', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  const dlg = teacher.locator('dialog[open]');
  const pick = async (title) => {
    await teacher.getByRole('button', { name: 'Стереометрия: инструменты' }).click();
    await teacher.getByRole('menu', { name: 'Стереометрия' }).getByRole('button', { name: title, exact: true }).click();
  };

  // Куб и 3D-редактор, вкладка «Построения».
  await pick('Куб');
  await teacher.mouse.click(box.x + 260, box.y + 220);
  await waitStore(teacher, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), 'куб', S + 'scene');
  const [scene] = await all(teacher, S + 'scene');
  await teacher.keyboard.press('Escape');
  await teacher.mouse.dblclick(box.x + 260, box.y + 220);
  await dlg.getByRole('tab', { name: 'Построения' }).click();

  /** Экранная точка окна редактора для точки сцены (та же проекция, что у чертежа). */
  const screenOf = async (p) => {
    const q = await teacher.evaluate(async ([id, pt]) => {
      const { projection, sceneCenter } = await import('/src/math/stereo/solids.ts');
      const props = window.__doska.model.getObject(id).props;
      const k = Math.min(440 / props.w, 360 / props.h);
      return projection({ yaw: props.yaw, pitch: props.pitch, scale: props.scale * k }, sceneCenter(props.bodies)).project(pt);
    }, [scene.id, p]);
    // Окно просмотра измеряется каждый раз: подсказка режима меняет высоту диалога, и он смещается.
    const view = await dlg.getByRole('application').boundingBox();
    return { x: view.x + 220 + q.x, y: view.y + 180 + q.y };
  };
  const clickAt = async (p) => {
    const s = await screenOf(p);
    await teacher.mouse.click(s.x, s.y);
  };
  const mode = (name) => dlg.getByRole('radio', { name, exact: true }).click();
  const props = (page) => page.evaluate((id) => window.__doska.model.getObject(id).props, scene.id);

  // 1. Сечение через середины AB, BC, CC₁ (куб с ребром 4).
  await mode('Сечение');
  await clickAt([0, -2, 0]);
  await dlg.getByTestId('stereo-hint').filter({ hasText: 'Выбрано: K' }).waitFor();
  await clickAt([2, 0, 0]);
  await clickAt([2, 2, 2]);
  await waitStore(student, (id) => window.__doska.model.getObject(id).props.items.some((i) => i.k === 'section'), 'сечение у ученика', scene.id);
  let p = await props(student);
  if (JSON.stringify(p.points.map((q) => [q.name, q.at.k, q.at.t])) !== JSON.stringify([['K', 'edge', 0.5], ['L', 'edge', 0.5], ['M', 'edge', 0.5]])) throw new Error('точки сечения: ' + JSON.stringify(p.points));
  const hexagon = await student.evaluate(async (id) => {
    const { sectionOf } = await import('/src/math/stereo/space.ts');
    const pr = window.__doska.model.getObject(id).props;
    return sectionOf(pr, pr.items[0]).length;
  }, scene.id);
  if (hexagon !== 6) throw new Error('сечение — не шестиугольник: ' + hexagon);
  ok('сечение через середины AB, BC, CC₁ — правильный шестиугольник, у ученика тоже');

  // 2. Диагонали граней AB₁ и BC₁, расстояние и угол между ними.
  await mode('Отрезок');
  await clickAt([-2, -2, 0]);
  await clickAt([2, -2, 4]);
  await clickAt([2, -2, 0]);
  await clickAt([2, 2, 4]);
  // Щелчки — по самим отрезкам: AB₁ и BC₁ на высоте 2,6.
  await mode('Расстояние');
  await clickAt([0.6, -2, 2.6]);
  await clickAt([2, 0.6, 2.6]);
  await mode('Угол');
  await clickAt([0.6, -2, 2.6]);
  await clickAt([2, 0.6, 2.6]);
  const texts = await dlg.getByTestId('stereo-item').allTextContents();
  if (!texts.includes('ρ(AB₁, BC₁) = 4√3/3 ≈ 2,31') || !texts.includes('∠(AB₁, BC₁) = 60°')) throw new Error('измерения: ' + JSON.stringify(texts));
  await teacher.screenshot({ path: OUT + '/stereo-b1-editor.png' });
  ok('ρ(AB₁, BC₁) = 4√3/3 ≈ 2,31 и ∠(AB₁, BC₁) = 60° — щелчками по отрезкам');

  // 3. Доля ребра: K сдвигается к A, сечение перестраивается.
  await dlg.getByLabel('Доля ребра для K').fill('0.25');
  await waitStore(student, (id) => window.__doska.model.getObject(id).props.points[0].at.t === 0.25, 'K на четверти ребра у ученика', scene.id);
  const after = await student.evaluate(async (id) => {
    const { sectionOf } = await import('/src/math/stereo/space.ts');
    const pr = window.__doska.model.getObject(id).props;
    return sectionOf(pr, pr.items[0]).length;
  }, scene.id);
  ok(`K на четверти ребра AB — сечение перестроилось (${after} вершин)`);
  await dlg.getByRole('button', { name: 'Готово' }).click();
  await dlg.waitFor({ state: 'detached' });
  await teacher.screenshot({ path: OUT + '/stereo-b2-board.png' });

  // 4. Развёртка куба справа от сцены.
  await pick('Развёртка');
  await teacher.mouse.click(box.x + 260, box.y + 220);
  await waitStore(student, (t) => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === t), 'развёртка у ученика', S + 'net');
  const [net] = await all(teacher, S + 'net');
  if (net.deps[0] !== scene.id || net.props.body !== 'b1' || net.x <= scene.x + scene.props.w) throw new Error('развёртка: ' + JSON.stringify(net));
  ok('развёртка куба — объект справа от сцены, связан с ней');

  // 5. Плоский чертёж: точки и отрезки планиметрии; Ctrl+Z — одним шагом.
  await teacher.evaluate(() => { const s = window.__doska.store.getState(); s.setCamera({ ...s.cameras[s.pageId], zoom: 0.6 }); });
  await pick('Плоский чертёж');
  const sc = await teacher.evaluate((id) => { const s = window.__doska.store.getState(); const c = s.cameras[s.pageId]; const o = window.__doska.model.getObject(id); return { c, o: { x: o.x, y: o.y } }; }, scene.id);
  // Центр сцены на экране: камера cx, cy — центр холста.
  const canvasCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await teacher.mouse.click(canvasCenter.x + (sc.o.x + 180 - sc.c.cx) * sc.c.zoom, canvasCenter.y + (sc.o.y + 150 - sc.c.cy) * sc.c.zoom);
  await waitStore(teacher, () => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === 'math.planimetry.segment').length > 0, 'плоский чертёж');
  const pts = await all(teacher, 'math.planimetry.point');
  const labels = pts.filter((q) => !q.props.ghost).map((q) => q.props.label).sort();
  for (const l of ['A', 'B', 'C', 'D', 'A₁', 'B₁', 'C₁', 'D₁', 'K', 'L', 'M']) if (!labels.includes(l)) throw new Error('нет точки ' + l + ': ' + labels);
  const segs = await all(teacher, 'math.planimetry.segment');
  if (!segs.some((q) => q.props.dash === 'dashed')) throw new Error('нет пунктирных отрезков');
  await teacher.keyboard.press('Escape');
  await teacher.evaluate(() => window.__doska.commands.fit(false));
  await teacher.waitForTimeout(400);
  await teacher.screenshot({ path: OUT + '/stereo-b3-flat.png' });
  ok(`плоский чертёж: ${labels.length} подписанных точек, ${segs.length} отрезков (невидимые — пунктиром)`);
  const planBefore = await countOf(teacher, 'math.planimetry.');
  await teacher.keyboard.press('Control+z');
  await waitStore(student, () => [...window.__doska.model.doc.getMap('objects').values()].every((o) => !o.get('type').startsWith('math.planimetry.')), 'отмена плоского чертежа');
  ok(`Ctrl+Z убирает плоский чертёж (${planBefore} объектов) одним шагом`);

  // 6. Ученик видит сечение и измерения на чертеже сцены.
  await student.evaluate(() => window.__doska.commands.fit(false));
  await student.waitForTimeout(400);
  await student.screenshot({ path: OUT + '/stereo-b4-student.png' });
  p = await props(student);
  if (p.items.length !== 5) throw new Error('построения у ученика: ' + p.items.length);
  ok('у ученика 5 построений: сечение, два отрезка, расстояние и угол');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch(async (e) => {
  console.error(e);
  await globalThis.__shot?.().catch(() => undefined);
  process.exit(1);
});
