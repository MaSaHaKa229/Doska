import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { BoardObject, PluginEditorProps } from '@doska/shared';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { PALETTE, resolveColor, type CanvasTheme } from '../../objects/colors';
import { notifySceneCamera, registerSceneCamera } from '../../collab/follow';
import { MAX_BODIES, SCENE_TYPE, TEXTBOOK_VIEW, sceneSvg, sceneWith, type SceneProps } from './objects';
import { BODY_KINDS, BODY_TITLES, POLY_BASE_KINDS, ROUND_KINDS, bodyPoints, fitScale, isConvex, newBody, viewDir, type Body, type BodyKind } from './solids';

const ThreeView = lazy(() => import('./three-view'));

const VW = 440;
const VH = 360;
const DEG = Math.PI / 180;
const PITCH_MAX = 89.5 * DEG;

/** Азимут в (−π; π]: многократное вращение не выводит его за пределы схемы. */
const wrapYaw = (a: number) => a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));

/** Масштаб редактора: рамка сцены вписана в окно просмотра. */
const editorK = (p: SceneProps) => Math.min(VW / p.w, VH / p.h);

const uiTheme = (): CanvasTheme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

/** Число с запятой или точкой. */
const num = (s: string) => {
  const v = Number(s.trim().replace(',', '.'));
  return s.trim() && Number.isFinite(v) ? v : null;
};
const fmt = (v: number) => String(Math.round(v * 1000) / 1000).replace('.', ',');

/** Поле числа: правка хранится текстом, в тело попадает только корректное значение. */
function NumField({ label, value, min, max, onChange, width = 92, title }: { label: string; value: number; min: number; max: number; onChange(v: number): void; width?: number; title?: string }) {
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value));
  }, [value, focused]);
  const v = num(text);
  const bad = v === null || v < min || v > max;
  return (
    <label className="field" style={{ width }} title={title}>
      <span className="field__label">{label}</span>
      <input
        className="input"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={bad}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const n = num(e.target.value);
          if (n !== null && n >= min && n <= max) onChange(n);
        }}
      />
    </label>
  );
}

/** Вершины своего основания: «0;0 4;0 3;3». */
function parseBase(s: string): [number, number][] | null {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  const pts: [number, number][] = [];
  for (const p of parts) {
    const [x, y, ...rest] = p.split(';');
    const a = num(x ?? '');
    const b = num(y ?? '');
    if (a === null || b === null || rest.length) return null;
    pts.push([a, b]);
  }
  return pts;
}

const baseText = (b: Body) => b.base.map(([x, y]) => `${fmt(x)};${fmt(y)}`).join('  ');

function BaseField({ body, onChange }: { body: Body; onChange(base: [number, number][]): void }) {
  const [text, setText] = useState(baseText(body));
  const pts = parseBase(text);
  const err = !text.trim() ? null : !pts ? 'Пары «x;y» через пробел' : pts.length < 3 ? 'Нужно не меньше трёх вершин' : pts.length > 12 ? 'Не больше 12 вершин' : !isConvex(pts) ? 'Многоугольник должен быть выпуклым' : null;
  return (
    <label className="field" style={{ width: '100%' }}>
      <span className="field__label">Своё основание (вершины x;y, пусто — правильный многоугольник)</span>
      <input
        className="input mono"
        aria-label="Вершины основания"
        aria-invalid={!!err}
        value={text}
        placeholder="0;0  4;0  3;3"
        onChange={(e) => {
          setText(e.target.value);
          const p = parseBase(e.target.value);
          if (!e.target.value.trim()) onChange([]);
          else if (p && p.length >= 3 && p.length <= 12 && isConvex(p)) onChange(p);
        }}
      />
      {err && <span className="small" style={{ color: 'var(--danger)' }}>{err}</span>}
    </label>
  );
}

function ColorSelect({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <label className="field" style={{ width: 130 }}>
      <span className="field__label">{label}</span>
      <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {PALETTE.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Параметры тела по его виду. */
function BodyFields({ body, set }: { body: Body; set(patch: Partial<Body>): void }) {
  const f: ReactNode[] = [];
  const S = (key: 'a' | 'b' | 'h' | 'r' | 'r2', label: string, title?: string) => <NumField key={key} label={label} title={title} value={body[key]} min={0.05} max={1000} onChange={(v) => set({ [key]: v })} />;
  const regular = POLY_BASE_KINDS.includes(body.kind) && body.base.length < 3;
  switch (body.kind) {
    case 'cube':
      f.push(S('a', 'Ребро a'));
      break;
    case 'box':
      f.push(S('a', 'Длина a'), S('b', 'Ширина b'), S('h', 'Высота c'));
      break;
    case 'cylinder':
    case 'cone':
      f.push(S('r', 'Радиус R'), S('h', 'Высота h'));
      break;
    case 'tcone':
      f.push(S('r', 'Радиус R'), S('r2', 'Радиус r'), S('h', 'Высота h'));
      break;
    case 'sphere':
      f.push(S('r', 'Радиус R'));
      break;
    default: {
      if (regular) {
        f.push(
          <NumField key="n" label="Сторон n" value={body.n} min={3} max={12} width={80} onChange={(v) => set({ n: Math.round(v) })} />,
          // Сторона правильного основания: a = 2R·sin(π/n), хранится радиус R.
          <NumField key="side" label="Сторона основания" value={2 * body.r * Math.sin(Math.PI / body.n)} min={0.05} max={1000} width={130} onChange={(v) => set({ r: v / (2 * Math.sin(Math.PI / body.n)) })} />,
        );
      }
      f.push(S('h', 'Высота h'));
      if (body.kind === 'frustum') f.push(<NumField key="k" label="Отношение оснований k" value={body.k} min={0.05} max={0.95} width={150} onChange={(v) => set({ k: v })} />);
      const what = body.kind === 'pyramid' ? 'вершины' : 'верхнего основания';
      f.push(
        <NumField key="sx" label={`Сдвиг ${what} x`} value={body.shift[0]} min={-1000} max={1000} width={150} onChange={(v) => set({ shift: [v, body.shift[1]] })} />,
        <NumField key="sy" label="y" value={body.shift[1]} min={-1000} max={1000} width={70} onChange={(v) => set({ shift: [body.shift[0], v] })} />,
      );
    }
  }
  return (
    <>
      <div className="stereo-fields">{f}</div>
      {POLY_BASE_KINDS.includes(body.kind) && <BaseField key={body.id} body={body} onChange={(base) => set({ base })} />}
      <div className="stereo-fields">
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <NumField
            key={axis}
            label={`Положение ${axis}`}
            value={body.pos[i]!}
            min={-1000}
            max={1000}
            width={96}
            onChange={(v) => {
              const pos = [...body.pos] as [number, number, number];
              pos[i] = v;
              set({ pos });
            }}
          />
        ))}
      </div>
      <div className="stereo-fields">
        <ColorSelect label="Цвет граней" value={body.fill} onChange={(fill) => set({ fill })} />
        <ColorSelect label="Цвет рёбер" value={body.edge} onChange={(edge) => set({ edge })} />
        <label className="field" style={{ width: 130 }}>
          <span className="field__label">Непрозрачность</span>
          <input type="range" aria-label="Непрозрачность граней" min={0} max={1} step={0.05} value={body.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />
        </label>
      </div>
      <div className="stereo-fields">
        <label className="field" style={{ flex: 1, minWidth: 160 }}>
          <span className="field__label">Свои подписи через запятую</span>
          <input className="input" aria-label="Подписи вершин" maxLength={200} value={body.labels} placeholder={ROUND_KINDS.includes(body.kind) ? 'O, O₁' : 'A, B, C, …'} onChange={(e) => set({ labels: e.target.value })} />
        </label>
      </div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={body.showLabels} onChange={(e) => set({ showLabels: e.target.checked })} />
          <span>Подписи</span>
        </label>
        {ROUND_KINDS.includes(body.kind) && (
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={body.axis} onChange={(e) => set({ axis: e.target.checked })} />
            <span>{body.kind === 'sphere' ? 'Центр' : 'Ось и центры оснований'}</span>
          </label>
        )}
      </div>
    </>
  );
}

const nextId = (bodies: Body[]) => {
  let i = 1;
  while (bodies.some((b) => b.id === `b${i}`)) i++;
  return `b${i}`;
};

/** Новое тело справа от остальных, на той же плоскости. */
function placeNew(kind: BodyKind, bodies: Body[]): Body {
  const b = newBody(kind, nextId(bodies));
  if (!bodies.length) return b;
  const maxX = Math.max(...bodies.flatMap(bodyPoints).map((p) => p[0]));
  const minX = Math.min(...bodyPoints(b).map((p) => p[0]));
  return { ...b, pos: [maxX - minX + 1.5, 0, b.pos[2]] };
}

/**
 * 3D-редактор сцены: объёмный вид (three.js) с чертежом поверх, вращение
 * мышью и пальцами, масштаб колесом и щипком, тела и их параметры. Правки
 * сразу видны на доске (одним шагом отмены), «Отмена» возвращает сцену.
 * Без права изменения (ученик и сцена учителя) — только просмотр: вид
 * вращается у себя и ничего не записывается.
 */
export function StereoEditor({ objectId, at, ctx, close, readOnly, subscribeObject }: PluginEditorProps) {
  const [id, setId] = useState(objectId);
  const obj = id ? (ctx.resolve.getObject(id) as BoardObject<SceneProps> | undefined) : undefined;
  const original = useRef<SceneProps | null>(obj?.props ?? null);
  const [props, setProps] = useState<SceneProps>(() => obj?.props ?? sceneWith('cube'));
  const [sel, setSel] = useState(0);
  const [glFailed, setGlFailed] = useState(false);
  const [addKind, setAddKind] = useState<BodyKind>('cube');
  const propsRef = useRef(props);
  propsRef.current = props;

  // Новая сцена (из палитры без инструмента): создаётся сразу.
  useEffect(() => {
    if (id) return;
    const nid = ctx.createObject<SceneProps>(SCENE_TYPE, { x: (at?.x ?? 0) - props.w / 2, y: (at?.y ?? 0) - props.h / 2, props });
    if (nid) {
      setId(nid);
      ctx.setSelection([nid]);
    } else close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Запись на доску: не чаще раза в 80 мс, все правки сеанса — один шаг отмены.
  const written = useRef<SceneProps | null>(obj?.props ?? null);
  const wrote = useRef(false);
  const fromFollow = useRef(false);
  useEffect(() => {
    if (!id || readOnly || props === written.current) return;
    if (fromFollow.current) {
      fromFollow.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      const p = propsRef.current;
      if (!ctx.canModify(id) || p === written.current) return;
      ctx.transact(() => ctx.updateObject<SceneProps>(id, { props: p }), { merge: wrote.current });
      written.current = p;
      wrote.current = true;
    }, 80);
    return () => window.clearTimeout(t);
  }, [props, id, ctx]);

  // Правки других участников (и просмотр без права записи): сцена из документа, свой вид сохраняется.
  useEffect(() => {
    if (!id) return;
    return subscribeObject(id, () => {
      const doc = (ctx.resolve.getObject(id) as BoardObject<SceneProps> | undefined)?.props;
      if (!doc) {
        close();
        return;
      }
      if (JSON.stringify(doc) === JSON.stringify(written.current)) return;
      written.current = doc;
      setProps((p) => (readOnly ? { ...doc, yaw: p.yaw, pitch: p.pitch, scale: p.scale } : doc));
    });
  }, [id, ctx, subscribeObject, readOnly, close]);

  // «Следуйте за мной»: камера открытой сцены.
  useEffect(() => {
    if (!id) return;
    return registerSceneCamera(id, {
      get: () => {
        const p = propsRef.current;
        const d = viewDir(p.yaw, p.pitch);
        return { position: [d[0] * 10, d[1] * 10, d[2] * 10], target: [0, 0, 0], up: [0, 0, 1], zoom: p.scale };
      },
      set: (cam) => {
        const d = [cam.position[0] - cam.target[0], cam.position[1] - cam.target[1], cam.position[2] - cam.target[2]] as const;
        const l = Math.hypot(...d);
        if (l < 1e-9) return;
        fromFollow.current = true;
        setProps((p) => ({ ...p, yaw: Math.atan2(d[1], d[0]), pitch: Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.asin(d[2] / l))), scale: Math.max(1, Math.min(1000, cam.zoom)) }));
      },
    });
  }, [id]);

  const update = useCallback((fn: (p: SceneProps) => SceneProps, camera = false) => {
    setProps(fn);
    if (camera) notifySceneCamera();
  }, []);

  const setBody = (i: number, patch: Partial<Body>) => update((p) => ({ ...p, bodies: p.bodies.map((b, k) => (k === i ? { ...b, ...patch } : b)) }));

  const fit = () => update((p) => ({ ...p, scale: fitScale(p.bodies, p, p.w, p.h) }), true);
  const setView = (yaw: number, pitch: number) => update((p) => ({ ...p, yaw, pitch }), true);

  // Вращение: протяжка (мышь, перо, палец), масштаб: колесо и щипок.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onDown = (e: RPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onMove = (e: RPointerEvent) => {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (ps.size >= 2) {
      const other = [...ps.entries()].find(([k]) => k !== e.pointerId)![1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
      if (d0 > 4) update((p) => ({ ...p, scale: Math.max(1, Math.min(1000, (p.scale * d1) / d0)) }), true);
    } else {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      update((p) => ({ ...p, yaw: wrapYaw(p.yaw - dx * 0.01), pitch: Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p.pitch + dy * 0.01)) }), true);
    }
    ps.set(e.pointerId, cur);
  };
  const onUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
  };
  const wheelHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wheelHost.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      update((p) => ({ ...p, scale: Math.max(1, Math.min(1000, p.scale * Math.exp(-e.deltaY * 0.0015))) }), true);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [update]);

  // Чертёж поверх объёмного вида — тот же, что на доске, в масштабе окна.
  const theme = uiTheme();
  const k = editorK(props);
  const overlay = useMemo(() => sceneSvg({ ...props, w: VW, h: VH, scale: props.scale * k, frame: false, labelSize: props.labelSize }, 0, 0, theme), [props, k, theme]);
  const frameW = props.w * k;
  const frameH = props.h * k;
  const colorOf = useCallback((b: Body) => resolveColor(b.fill, theme), [theme]);

  const body = props.bodies[Math.min(sel, props.bodies.length - 1)];
  const bodyIndex = Math.min(sel, props.bodies.length - 1);

  const cancel = () => {
    if (id && wrote.current && ctx.canModify(id)) ctx.transact(() => ctx.updateObject<SceneProps>(id, { props: original.current ?? propsRef.current }), { merge: true });
    // Новая сцена без исходного состояния: «Отмена» её удаляет.
    if (id && !original.current) ctx.deleteObjects([id]);
    written.current = propsRef.current;
    close();
  };
  const done = () => {
    const p = propsRef.current;
    if (id && !readOnly && p !== written.current && ctx.canModify(id)) ctx.transact(() => ctx.updateObject<SceneProps>(id, { props: p }), { merge: wrote.current });
    written.current = p;
    close();
  };

  const deg = (v: number) => Math.round(((v / DEG) % 360 + 540) % 360 - 180);

  return (
    <Dialog
      open
      onClose={done}
      wide
      title={readOnly ? '3D-сцена — просмотр' : '3D-сцена'}
      footer={
        readOnly ? (
          <Button variant="primary" onClick={done}>
            Закрыть
          </Button>
        ) : (
          <>
            <Button onClick={cancel}>Отмена</Button>
            <Button variant="primary" onClick={done}>
              Готово
            </Button>
          </>
        )
      }
    >
      <div className="stereo-editor">
        <div>
          <div
            ref={wheelHost}
            className="stereo-view"
            style={{ width: VW, height: VH }}
            role="application"
            aria-label="Сцена: протяните, чтобы повернуть; колесо — масштаб"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {!glFailed && (
              <Suspense fallback={null}>
                <ThreeView bodies={props.bodies} view={{ yaw: props.yaw, pitch: props.pitch, scale: props.scale * k }} width={VW} height={VH} colorOf={colorOf} onFail={() => setGlFailed(true)} />
              </Suspense>
            )}
            <div className="stereo-view__frame" style={{ width: frameW, height: frameH, left: (VW - frameW) / 2, top: (VH - frameH) / 2 }} />
            <svg className="stereo-view__svg" width={VW} height={VH} viewBox={`0 0 ${VW} ${VH}`} dangerouslySetInnerHTML={{ __html: overlay }} />
          </div>
          {glFailed && <p className="small muted">Объёмный вид недоступен в этом браузере (нет WebGL) — чертёж и вращение работают.</p>}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <Button size="small" onClick={() => setView(TEXTBOOK_VIEW.yaw, TEXTBOOK_VIEW.pitch)}>
              Как в учебнике
            </Button>
            <Button size="small" onClick={() => setView(-Math.PI / 2, 0)}>
              Спереди
            </Button>
            <Button size="small" onClick={() => setView(0, 0)}>
              Сбоку
            </Button>
            <Button size="small" onClick={() => setView(-Math.PI / 2, PITCH_MAX)}>
              Сверху
            </Button>
            <Button size="small" onClick={fit}>
              Вписать
            </Button>
          </div>
          <p className="small muted" aria-live="polite">
            Поворот {deg(props.yaw)}°, наклон {deg(props.pitch)}°. Пунктирная рамка — граница сцены на доске.
          </p>
        </div>

        <fieldset className="stereo-panel" disabled={readOnly}>
          {readOnly && <p className="small muted">Сцену можно вращать и приближать у себя; изменить её может только автор или учитель.</p>}
          <div className="stereo-fields">
            <label className="field" style={{ flex: 1 }}>
              <span className="field__label">Тело</span>
              <select className="select" aria-label="Тело сцены" value={bodyIndex} onChange={(e) => setSel(Number(e.target.value))} disabled={!props.bodies.length}>
                {props.bodies.map((b, i) => (
                  <option key={b.id} value={i}>
                    {i + 1}. {BODY_TITLES[b.kind]}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="small"
              disabled={!body}
              onClick={() => {
                update((p) => ({ ...p, bodies: p.bodies.filter((_, i) => i !== bodyIndex) }));
                setSel(Math.max(0, bodyIndex - 1));
              }}
            >
              Удалить тело
            </Button>
          </div>
          {body ? <BodyFields key={body.id} body={body} set={(patch) => setBody(bodyIndex, patch)} /> : <p className="muted">В сцене нет тел — добавьте тело ниже.</p>}
          <hr className="stereo-sep" />
          <div className="stereo-fields">
            <label className="field" style={{ flex: 1 }}>
              <span className="field__label">Добавить тело</span>
              <select className="select" aria-label="Вид нового тела" value={addKind} onChange={(e) => setAddKind(e.target.value as BodyKind)}>
                {BODY_KINDS.map((kk) => (
                  <option key={kk} value={kk}>
                    {BODY_TITLES[kk]}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="small"
              disabled={props.bodies.length >= MAX_BODIES}
              onClick={() => {
                update((p) => {
                  const bodies = [...p.bodies, placeNew(addKind, p.bodies)];
                  return { ...p, bodies, scale: fitScale(bodies, p, p.w, p.h) };
                });
                setSel(props.bodies.length);
              }}
            >
              Добавить
            </Button>
          </div>
          <div className="stereo-fields">
            <label className="field" style={{ flex: 1 }}>
              <span className="field__label">Невидимые линии</span>
              <select className="select" aria-label="Невидимые линии" value={props.hidden} onChange={(e) => update((p) => ({ ...p, hidden: e.target.value as SceneProps['hidden'] }))}>
                <option value="dashed">Пунктиром</option>
                <option value="hide">Скрыть</option>
                <option value="solid">Сплошными</option>
              </select>
            </label>
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}
