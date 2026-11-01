// Сквозной сценарий формул (этап 5.3a): MathLive и палитра, правка
// двойным щелчком, блок «Решение» с проверкой шагов, вставка из Ctrl+K.
const { chromium } = require('playwright');
const OUT = process.env.E2E_OUT || require('node:os').tmpdir();
const BASE = 'http://localhost:5173';
const CLASS_ID = process.argv[2];
if (!CLASS_ID) throw new Error('Укажите id класса: node e2e/formula.cjs <classId> (его печатает e2e/setup.mts)');

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
  const browser = await chromium.launch();
  const teacher = await login(browser, 'e2e.teacher');
  const student = await login(browser, 'e2e.student1');
  const boardId = await teacher.evaluate(async (classId) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1];
    const r = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ title: 'Формулы 5.3a', classIds: [classId], mode: 'LECTURE' }) });
    return (await r.json()).board.id;
  }, CLASS_ID);
  for (const p of [teacher, student]) {
    await p.goto(`${BASE}/boards/${boardId}`);
    await waitStore(p, () => window.__doska?.store.getState().synced, 'синхронизация');
  }
  const box = await teacher.getByTestId('board-canvas').boundingBox();
  const dlg = teacher.locator('dialog[open]');

  // 1. Формула: шаблон «Дробь» из палитры и набор с клавиатуры в MathLive.
  await teacher.keyboard.press('f');
  await teacher.mouse.click(box.x + 120, box.y + 80);
  await dlg.locator('math-field').waitFor({ timeout: 15000 });
  await dlg.getByRole('button', { name: 'Дробь', exact: true }).click();
  await teacher.keyboard.type('a+1');
  await teacher.keyboard.press('Tab');
  await teacher.keyboard.type('2');
  await teacher.screenshot({ path: OUT + '/f1-mathlive.png' });
  await teacher.keyboard.press('Enter');
  await dlg.waitFor({ state: 'detached' });
  let [f] = await objs(teacher, 'core.formula');
  if (!f || !/\\frac\{a\+1\}\{2\}/.test(f.props.latex)) throw new Error('формула: ' + JSON.stringify(f));
  ok(`формула из палитры и клавиатуры: ${f.props.latex}`);

  // 2. Двойной щелчок — правка кодом LaTeX.
  await teacher.mouse.dblclick(box.x + 140, box.y + 110);
  await dlg.locator('math-field').waitFor();
  await dlg.getByRole('button', { name: 'Код LaTeX' }).click();
  await dlg.getByLabel('Код LaTeX').fill('\\int_0^1 x^2\\,dx=\\frac{1}{3}');
  await dlg.getByRole('button', { name: 'Сохранить' }).click();
  await waitStore(teacher, () => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === 'core.formula' && String(o.get('props').latex).startsWith('\\int')), 'правка формулы');
  ok('двойной щелчок открыл формулу, правка кодом сохранена');

  // 3. Блок «Решение»: три шага, один неверный.
  await teacher.keyboard.press('Shift+F');
  await teacher.mouse.click(box.x + 120, box.y + 300);
  const steps = ['2x+3=11', '2x=8', 'x=5'];
  for (const [n, latex] of steps.entries()) {
    if (n > 0) await dlg.getByRole('button', { name: 'Добавить шаг' }).click();
    await dlg.locator('math-field').waitFor();
    await dlg.getByRole('button', { name: 'Код LaTeX' }).click();
    await dlg.getByLabel('Код LaTeX').fill(latex);
    await dlg.getByRole('button', { name: /Вставить|Сохранить/ }).click();
  }
  await dlg.getByLabel('Комментарий к шагу 2').fill('перенесли 3 вправо');
  await dlg.getByRole('button', { name: 'Сохранить' }).click();
  await dlg.waitFor({ state: 'detached' });
  const [sol] = await objs(teacher, 'core.solution');
  if (!sol || sol.props.steps.map((s) => s.latex).join('|') !== steps.join('|') || sol.props.steps[1].note !== 'перенесли 3 вправо') {
    throw new Error('решение: ' + JSON.stringify(sol));
  }
  ok('блок «Решение»: три шага с комментарием');
  const marks = await teacher.evaluate(async (ls) => (await import('/src/formula/check.ts')).checkSteps(ls), steps);
  if (marks.join() !== 'ok,unknown') throw new Error('проверка шагов: ' + marks.join());
  ok('проверка переходов: 2x+3=11 → 2x=8 ✓, 2x=8 → x=5 ?');

  // 4. Ctrl+K: шаблон формулы.
  await teacher.keyboard.press('Control+k');
  // Поле поиска получает фокус после открытия — заполняем его явно.
  await teacher.locator('dialog[open] input').first().fill('дискриминант');
  await teacher.getByRole('option', { name: /Формула: дискриминант/ }).click();
  await waitStore(teacher, () => [...window.__doska.model.doc.getMap('objects').values()].some((o) => o.get('type') === 'core.formula' && o.get('props').latex === 'D=b^2-4ac'), 'формула из Ctrl+K');
  ok('Ctrl+K вставил формулу «дискриминант»');

  // Ученик видит всё (режим «Лекция»: только смотрит).
  await waitStore(student, () => window.__doska.model.doc.getMap('objects').size === 3, 'ученик видит три объекта');
  await student.waitForTimeout(2000);
  await student.screenshot({ path: OUT + '/f2-student.png' });
  ok('ученик видит формулы и решение');

  await browser.close();
  console.log('ВСЁ ПРОШЛО');
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});
