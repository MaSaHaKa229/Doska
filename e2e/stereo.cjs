// Сквозной сценарий стереометрии (этап 6.4a): куб инструментом, 3D-редактор
// (объёмный вид, вращение протяжкой — у ученика сразу), правка ребра и второе
// тело, отмена всей правки одним шагом, «Следуйте за мной» для открытой сцены,
// тела вращения.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/stereo.cjs <classId> (его печатает e2e/setup.mts)');

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
const SCENE = 'math.stereo.scene';
const scenes = (page) => page.evaluate((t) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).map((o) => o.toJSON()), SCENE);
const count = (page, n) => waitStore(page, ([t, k]) => [...window.__doska.model.doc.getMap('objects').values()].filter((o) => o.get('type') === t).length === k, `сцен: ${n}`, [SCENE, n]);
const propsOf = (page, id) => page.evaluate((i) => window.__doska.model.getObject(i)?.props, id);

(async () => {
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Стереометрия 6.4a', classIds: [classId], mode: 'COLLABORATIVE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  const dlg = teacher.locator('dialog[open]');
  const pick = async (page, title) => {
    await page.getByRole('button', { name: 'Стереометрия: инструменты' }).click();
    await page.getByRole('menu', { name: 'Стереометрия' }).getByRole('button', { name: title, exact: true }).click();
  };

  // 1. Куб щелчком: сцена с телом, чертёж с невидимыми рёбрами.
  await pick(teacher, 'Куб');
  await teacher.mouse.click(box.x + 260, box.y + 220);
  await count(teacher, 1);
  await count(student, 1);
  const [scene] = await scenes(teacher);
  if (scene.props.bodies.length !== 1 || scene.props.bodies[0].kind !== 'cube' || scene.props.bodies[0].a !== 4) throw new Error('куб: ' + JSON.stringify(scene.props));
  await teacher.keyboard.press('Escape');
  await teacher.screenshot({ path: OUT + '/stereo-1-cube.png' });
  ok('куб ABCDA₁B₁C₁D₁ — сцена на доске, у ученика тоже');

  // 2. 3D-редактор двойным щелчком: объёмный вид (WebGL) и чертёж поверх.
  await teacher.mouse.dblclick(box.x + 260, box.y + 220);
  await dlg.getByRole('application').waitFor();
  const gl = await dlg.locator('.stereo-view canvas').count();
  const glNote = await dlg.getByText('Объёмный вид недоступен').count();
  if (!gl && !glNote) {
    await teacher.waitForTimeout(1500);
  }
  await waitStore(teacher, () => !!document.querySelector('dialog[open] .stereo-view canvas') || !!document.querySelector('dialog[open] .small.muted'), 'объёмный вид');
  const hasGl = await dlg.locator('.stereo-view canvas').count();
  ok(hasGl ? '3D-редактор: объёмный вид three.js и чертёж поверх' : '3D-редактор: WebGL нет — показан чертёж и подсказка');

  // 3. Вращение протяжкой: поворот виден у ученика по ходу жеста.
  const view = await dlg.getByRole('application').boundingBox();
  const yaw0 = scene.props.yaw;
  await teacher.mouse.move(view.x + 200, view.y + 180);
  await teacher.mouse.down();
  await teacher.mouse.move(view.x + 280, view.y + 150, { steps: 8 });
  await waitStore(student, ([id, y]) => Math.abs(window.__doska.model.getObject(id).props.yaw - y) > 0.3, 'поворот у ученика до отпускания', [scene.id, yaw0]);
  await teacher.mouse.up();
  const rotated = await propsOf(teacher, scene.id);
  if (!(rotated.pitch < scene.props.pitch)) throw new Error('наклон не изменился: ' + rotated.pitch);
  ok(`поворот на ${Math.round(((yaw0 - rotated.yaw) * 180) / Math.PI)}° виден ученику по ходу жеста`);

  // 4. Правка ребра и второе тело (конус справа).
  await dlg.getByLabel('Ребро a').fill('3');
  await dlg.getByLabel('Вид нового тела').selectOption({ label: 'Конус' });
  await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
  await waitStore(student, (id) => { const p = window.__doska.model.getObject(id).props; return p.bodies.length === 2 && p.bodies[0].a === 3 && p.bodies[1].kind === 'cone'; }, 'куб с ребром 3 и конус у ученика', scene.id);
  await dlg.getByLabel('Радиус R').fill('1,5');
  await waitStore(teacher, (id) => window.__doska.model.getObject(id).props.bodies[1].r === 1.5, 'радиус конуса 1,5 (запятая)', scene.id);
  await teacher.screenshot({ path: OUT + '/stereo-2-editor.png' });
  await dlg.getByRole('button', { name: 'Готово' }).click();
  await dlg.waitFor({ state: 'detached' });
  await teacher.screenshot({ path: OUT + '/stereo-3-board.png' });
  ok('ребро куба 3, конус R = 1,5 — правки сразу на доске');

  // 5. Отмена: вся правка в редакторе — один шаг.
  await teacher.keyboard.press('Control+z');
  await waitStore(student, ([id, y]) => { const p = window.__doska.model.getObject(id).props; return p.bodies.length === 1 && p.bodies[0].a === 4 && Math.abs(p.yaw - y) < 1e-9; }, 'отмена одним шагом', [scene.id, yaw0]);
  ok('Ctrl+Z возвращает сцену целиком (поворот, ребро, конус) одним шагом');

  // 6. «Отмена» в редакторе возвращает исходное.
  await teacher.mouse.dblclick(box.x + 260, box.y + 220);
  await dlg.getByLabel('Ребро a').fill('6');
  await waitStore(student, (id) => window.__doska.model.getObject(id).props.bodies[0].a === 6, 'ребро 6 у ученика', scene.id);
  await dlg.getByRole('button', { name: 'Отмена' }).click();
  await waitStore(student, (id) => window.__doska.model.getObject(id).props.bodies[0].a === 4, '«Отмена» вернула ребро 4', scene.id);
  ok('«Отмена» в редакторе возвращает сцену у всех');

  // 7. Ученик открывает сцену учителя только для просмотра: вращает у себя, в документ не пишет.
  await student.mouse.dblclick(box.x + 260, box.y + 220);
  const sdlg = student.locator('dialog[open]');
  await sdlg.getByRole('application').waitFor();
  await sdlg.getByRole('heading', { name: '3D-сцена — просмотр' }).waitFor();
  if (!(await sdlg.getByLabel('Ребро a').isDisabled())) throw new Error('поля ученика не заблокированы');
  const sv = await sdlg.getByRole('application').boundingBox();
  const before = await sdlg.locator('[aria-live]').textContent();
  await student.mouse.move(sv.x + 200, sv.y + 180);
  await student.mouse.down();
  await student.mouse.move(sv.x + 120, sv.y + 180, { steps: 5 });
  await student.mouse.up();
  const afterText = await sdlg.locator('[aria-live]').textContent();
  if (before === afterText) throw new Error('вид ученика не повернулся');
  await teacher.waitForTimeout(300);
  if ((await propsOf(teacher, scene.id)).yaw !== scene.props.yaw) throw new Error('просмотр ученика записал поворот в документ');
  ok('ученик вращает сцену учителя у себя (просмотр), документ не меняется');

  // 8. «Следуйте за мной»: открытая у ученика сцена поворачивается за учителем.
  await teacher.getByRole('button', { name: 'Урок' }).click();
  await teacher.getByRole('button', { name: 'Следуйте за мной' }).click();
  await student.getByTestId('follow-banner').waitFor();
  await teacher.keyboard.press('Escape');
  await teacher.mouse.dblclick(box.x + 260, box.y + 220);
  await dlg.getByRole('button', { name: 'Сверху' }).click();
  await waitStore(student, () => /наклон 90°/.test(document.querySelector('dialog[open] [aria-live]')?.textContent ?? ''), 'вид «сверху» в редакторе ученика');
  await student.screenshot({ path: OUT + '/stereo-4-follow.png' });
  ok('«Следуйте за мной»: редактор ученика повернулся «сверху» вслед за учителем');
  await dlg.getByRole('button', { name: 'Готово' }).click();
  await sdlg.locator('.dialog__footer').getByRole('button', { name: 'Закрыть' }).click();
  await teacher.getByRole('button', { name: 'Урок' }).click();
  await teacher.getByRole('button', { name: 'Закончить показ' }).click();
  await student.getByTestId('follow-banner').waitFor({ state: 'detached' });
  await teacher.keyboard.press('Escape');

  // 9. Тела вращения и многогранники — каждый инструментом.
  const tools = [['Цилиндр', 'cylinder'], ['Конус', 'cone'], ['Усечённый конус', 'tcone'], ['Шар', 'sphere'], ['Пирамида', 'pyramid'], ['Призма', 'prism'], ['Усечённая пирамида', 'frustum'], ['Прямоугольный параллелепипед', 'box']];
  // Мельче, чтобы сцены встали рядами без наложения.
  await teacher.evaluate(() => { const s = window.__doska.store.getState(); s.setCamera({ ...s.cameras[s.pageId], zoom: 0.55 }); });
  for (let i = 0; i < tools.length; i++) {
    await pick(teacher, tools[i][0]);
    await teacher.mouse.click(box.x + 140 + (i % 4) * 230, box.y + 380 + Math.floor(i / 4) * 200);
  }
  await count(student, 1 + tools.length);
  const kinds = (await scenes(student)).map((s) => s.props.bodies[0].kind).sort();
  if (JSON.stringify(kinds) !== JSON.stringify(['box', 'cone', 'cube', 'cylinder', 'frustum', 'prism', 'pyramid', 'sphere', 'tcone'])) throw new Error('тела: ' + kinds);
  await teacher.keyboard.press('Escape');
  await teacher.evaluate(() => window.__doska.commands.fit(false));
  await teacher.waitForTimeout(400);
  await teacher.screenshot({ path: OUT + '/stereo-6-all.png' });
  ok('9 видов тел ставятся инструментами раздела «Стереометрия»');

  await browser.close();
  console.log('Готово. Снимки:', OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
