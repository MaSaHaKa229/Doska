import type { JsonValue } from '../board/json.js';
import type { TemplateLevel } from '../api/templates.js';

/**
 * Встроенные шаблоны библиотеки (этап 8.1a): доски-задачи по разделам.
 * Сервер создаёт их при запуске (по ключу, один раз). Свойства объектов —
 * как у инструментов разделов; соответствие схемам проверяет тест
 * frontend/src/templates/builtin.test.ts.
 */

export interface BuiltinObject {
  type: string;
  /** Версия схемы props (как version модуля). */
  v?: number;
  x: number;
  y: number;
  props: Record<string, JsonValue>;
  /** Зависимости — номера объектов в этом же списке (в документе станут id). */
  deps?: number[];
}

export interface BuiltinTemplate {
  key: string;
  title: string;
  description: string;
  section: string;
  level: TemplateLevel;
  tags: string[];
  /** Условие задачи — текстовый блок вверху доски. */
  task: string;
  objects: BuiltinObject[];
}

const PLAY0 = { running: false, t0: 0, at: 0 };

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    key: 'physics.mechanics.incline',
    title: 'Брусок на наклонной плоскости',
    description: 'Силы, второй закон Ньютона в проекциях, ускорение с учётом трения. Анимация соскальзывания.',
    section: 'physics.mechanics',
    level: 'SCHOOL',
    tags: ['динамика', 'трение', 'наклонная плоскость'],
    task: 'Брусок массой 2 кг соскальзывает с наклонной плоскости с углом наклона 30°. Коэффициент трения 0,2. Найдите ускорение бруска и силу трения.',
    objects: [{ type: 'physics.mechanics.incline', x: 120, y: 420, props: { alpha: 30, m: 2, mu: 0.2, g: 9.8, len: 4, forces: true, scale: 60, color: 'accent-2', speed: 1, play: PLAY0 } }],
  },
  {
    key: 'physics.mechanics.throw',
    title: 'Бросок под углом к горизонту',
    description: 'Траектория, составляющие скорости, дальность и наибольшая высота.',
    section: 'physics.mechanics',
    level: 'SCHOOL',
    tags: ['кинематика', 'баллистика'],
    task: 'Мяч брошен с земли со скоростью 15 м/с под углом 45° к горизонту. Найдите время полёта, дальность и наибольшую высоту подъёма.',
    objects: [{ type: 'physics.mechanics.throw', x: 80, y: 520, props: { v0: 15, angle: 45, h0: 0, g: 9.8, scale: 20, color: 'accent-4', showVelocity: true, components: true, marks: true, speed: 1, play: PLAY0 } }],
  },
  {
    key: 'physics.waves.pendulum',
    title: 'Математический маятник',
    description: 'Период T = 2π√(l/g), силы, графики x(t) и v(t).',
    section: 'physics.waves',
    level: 'SCHOOL',
    tags: ['колебания', 'маятник', 'период'],
    task: 'Найдите период колебаний математического маятника длиной 1 м. Как изменится период, если длину нити увеличить в 4 раза?',
    objects: [{ type: 'physics.waves.pendulum', x: 300, y: 200, props: { l: 1, g: 9.8, A: 15, m: 0.5, forces: true, scale: 220, speed: 1, play: PLAY0 } }],
  },
  {
    key: 'physics.modern.photoeffect',
    title: 'Фотоэффект',
    description: 'Уравнение Эйнштейна, красная граница, задерживающее напряжение, вольт-амперная характеристика.',
    section: 'physics.modern',
    level: 'SCHOOL',
    tags: ['кванты', 'фотоэффект'],
    task: 'Калиевый катод (работа выхода 2,2 эВ) освещают светом с длиной волны 400 нм. Найдите максимальную кинетическую энергию фотоэлектронов и задерживающее напряжение. Будет ли фотоэффект при 700 нм?',
    objects: [{ type: 'physics.modern.photoeffect', x: 40, y: 450, props: { metal: 'K', lambda: 400, intensity: 60, U: 0, speed: 1, play: PLAY0 } }],
  },
  {
    key: 'physics.modern.bohr',
    title: 'Атом водорода: спектр',
    description: 'Уровни энергии, переходы, серия Бальмера.',
    section: 'physics.modern',
    level: 'SCHOOL',
    tags: ['атом', 'бор', 'спектр'],
    task: 'Найдите длину волны и частоту фотона, излучаемого атомом водорода при переходе электрона с третьего уровня на второй. К какой серии относится линия?',
    objects: [{ type: 'physics.modern.bohr', x: 220, y: 520, props: { n: 3, k: 2, absorb: false, speed: 1, play: PLAY0 } }],
  },
  {
    key: 'math.analysis.intersection',
    title: 'Графики: точки пересечения',
    description: 'Две функции на одних осях — найти точки пересечения графически и аналитически.',
    section: 'math.analysis',
    level: 'SCHOOL',
    tags: ['графики', 'уравнения'],
    task: 'Постройте графики функций y = x² − 4 и y = 2x − 1. Найдите координаты точек пересечения графически и проверьте, решив уравнение.',
    objects: [
      { type: 'math.analysis.axes', x: 40, y: 140, props: { w: 480, h: 360, xMin: -8, xMax: 8, yMin: -6, yMax: 6, grid: true, color: 'ink' } },
      { type: 'math.analysis.curve', x: 0, y: 0, deps: [0], props: { text: 'y = x^2 - 4', color: 'accent-3', width: 2.5, dash: 'solid', showLabel: true, tMin: 0, tMax: 6.2832 } },
      { type: 'math.analysis.curve', x: 0, y: 0, deps: [0], props: { text: 'y = 2x - 1', color: 'accent-1', width: 2.5, dash: 'solid', showLabel: true, tMin: 0, tMax: 6.2832 } },
    ],
  },
  {
    key: 'math.stereo.section',
    title: 'Куб: сечение плоскостью',
    description: 'Пространственная сцена с кубом — построение сечения по трём точкам.',
    section: 'math.stereo',
    level: 'SCHOOL',
    tags: ['стереометрия', 'сечение', 'куб'],
    task: 'Постройте сечение куба плоскостью, проходящей через середины трёх рёбер, выходящих из одной вершины. Найдите площадь сечения, если ребро куба равно 4.',
    objects: [
      {
        type: 'math.stereo.scene',
        v: 2,
        x: 60,
        y: 140,
        props: {
          w: 360, h: 300, yaw: -1.1344640137963142, pitch: 0.3839724354387525, scale: 40, hidden: 'dashed', frame: false, labelSize: 16,
          bodies: [{ a: 4, b: 3, h: 4, n: 4, r: 2.5, r2: 1.2, k: 0.5, base: [], shift: [0, 0], pos: [0, 0, 0], fill: 'accent-2', opacity: 0.12, edge: 'ink', labels: '', showLabels: true, axis: false, id: 'b1', kind: 'cube' }],
          points: [],
          items: [],
        },
      },
    ],
  },
  {
    key: 'math.multivar.saddle',
    title: 'Седло: линии уровня и градиент',
    description: 'Поверхность z = x² − y², касательная плоскость, линии уровня и градиент.',
    section: 'math.multivar',
    level: 'UNIVERSITY',
    tags: ['функции нескольких переменных', 'градиент'],
    task: 'Для функции z = x² − y² постройте линии уровня, найдите градиент и уравнение касательной плоскости в точке M(1; 0,5).',
    objects: [
      { type: 'math.multivar.surface', x: 300, y: 560, props: { f: 'x^2 - y^2', xMin: -2, xMax: 2, yMin: -2, yMax: 2, n: 24, yaw: 35, pitch: 30, floor: true, tangent: true, x0: 1, y0: 0.5 } },
      { type: 'math.multivar.contours', x: 760, y: 240, props: { f: 'x^2 - y^2', xMin: -2, xMax: 2, yMin: -2, yMax: 2, count: 8, heat: true, grads: false, x0: 1, y0: 0.5 } },
    ],
  },
  {
    key: 'math.diffeq.cauchy',
    title: 'Задача Коши: Эйлер и Рунге — Кутта',
    description: 'Поле направлений, интегральные кривые, сравнение численных методов.',
    section: 'math.diffeq',
    level: 'UNIVERSITY',
    tags: ['дифференциальные уравнения', 'численные методы'],
    task: 'Решите задачу Коши y′ = x − y, y(−3) = 2. Сравните решения методами Эйлера и Рунге — Кутты с шагом 0,5 и 0,1. Найдите точное решение.',
    objects: [{ type: 'math.diffeq.slope', x: 60, y: 240, props: { f: 'x - y', xMin: -4, xMax: 4, yMin: -4, yMax: 4, density: 18, method: 'both', h: 0.5, points: [{ x: -3, y: 2 }] } }],
  },
  {
    key: 'math.complex.operations',
    title: 'Действия с комплексными числами',
    description: 'Сумма, произведение и частное на комплексной плоскости; формы записи.',
    section: 'math.complex',
    level: 'SCHOOL',
    tags: ['комплексные числа'],
    task: 'Даны z₁ = 3 + 2i и z₂ = 1 − 1,5i. Найдите z₁ + z₂, z₁·z₂ и z₁/z₂, запишите z₁ в тригонометрической форме и изобразите числа на плоскости.',
    objects: [{ type: 'math.complex.plane', x: 60, y: 260, props: { R: 5, numbers: [{ re: 3, im: 2 }, { re: 1, im: -1.5 }], op: 'mul', n: 3 } }],
  },
  {
    key: 'math.prob.factories',
    title: 'Полная вероятность и формула Байеса',
    description: 'Три завода, доли годных деталей — дерево вероятностей.',
    section: 'math.prob',
    level: 'SCHOOL',
    tags: ['вероятность', 'байес'],
    task: 'Три завода выпускают 30 %, 50 % и 20 % деталей; доли годных — 0,9, 0,8 и 0,6. Найдите вероятность того, что случайная деталь годная, и вероятность того, что годная деталь изготовлена первым заводом.',
    objects: [{ type: 'math.prob.tree', x: 60, y: 300, props: { k: 3, p1: 0.3, p2: 0.5, p3: 0.2, p4: 0, a1: 0.9, a2: 0.8, a3: 0.6, a4: 0.5, focus: 1 } }],
  },
  {
    key: 'math.discrete.shortest',
    title: 'Кратчайший путь в графе',
    description: 'Алгоритм Дейкстры по шагам на взвешенном графе.',
    section: 'math.discrete',
    level: 'SCHOOL',
    tags: ['графы', 'дейкстра'],
    task: 'Найдите кратчайший путь из A в F и его длину. Выполните алгоритм Дейкстры по шагам и запишите расстояния до всех вершин.',
    objects: [
      {
        type: 'math.discrete.graph',
        x: 60,
        y: 280,
        props: {
          vertices: [{ x: 60, y: 140 }, { x: 220, y: 60 }, { x: 220, y: 230 }, { x: 400, y: 60 }, { x: 400, y: 230 }, { x: 540, y: 145 }],
          edges: 'AB 4, AC 2, BC 1, BD 5, CE 9, CD 10, DE 2, DF 6, EF 3',
          directed: false,
          weighted: true,
          algo: 'none',
          start: 0,
          target: 5,
          speed: 1,
          play: PLAY0,
        },
      },
    ],
  },
];
