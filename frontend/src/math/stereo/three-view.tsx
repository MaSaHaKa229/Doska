import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  BufferGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { isPolyhedron, polyTriangles, roundDims, sceneCenter, viewDir, type Body, type View } from './solids';

export interface ThreeViewProps {
  bodies: Body[];
  view: View;
  width: number;
  height: number;
  /** Цвет граней тела (уже переведённый в цвет темы). */
  colorOf(body: Body): string;
  /** WebGL недоступен — редактор показывает только чертёж. */
  onFail(): void;
}

/**
 * Объёмный вид сцены в 3D-редакторе (three.js — отдельный чанк). Камера
 * ортогональная и совпадает с проекцией чертежа (solids.projection), поэтому
 * чертёж-оверлей редактора ложится точно на тела. Кадр рисуется по
 * изменению, без постоянного цикла.
 */
export default function ThreeView({ bodies, view, width, height, colorOf, onFail }: ThreeViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const st = useRef<{ renderer: WebGLRenderer; scene: Scene; camera: OrthographicCamera; group: Group; light: DirectionalLight } | null>(null);

  useEffect(() => {
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      onFail();
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    host.current!.appendChild(renderer.domElement);
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);
    camera.up.set(0, 0, 1);
    scene.add(new AmbientLight(0xffffff, 0.9));
    const light = new DirectionalLight(0xffffff, 2.4);
    scene.add(light);
    const group = new Group();
    scene.add(group);
    st.current = { renderer, scene, camera, group, light };
    return () => {
      st.current = null;
      group.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose();
          (o.material as MeshLambertMaterial).dispose();
        }
      });
      renderer.dispose();
      // Контекстов WebGL у страницы мало (около 16): отдаём сразу, не дожидаясь сборщика мусора.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Тела.
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    for (const o of [...s.group.children]) {
      s.group.remove(o);
      if (o instanceof Mesh) {
        o.geometry.dispose();
        (o.material as MeshLambertMaterial).dispose();
      }
    }
    for (const b of bodies) {
      let geo: BufferGeometry;
      if (isPolyhedron(b.kind)) {
        geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(polyTriangles(b), 3));
        geo.computeVertexNormals();
      } else if (b.kind === 'sphere') {
        geo = new SphereGeometry(b.r, 48, 24);
        geo.translate(...b.pos);
      } else {
        const { r1, r2, h } = roundDims(b);
        // Ось цилиндра three.js — y; у сцены — z.
        geo = new CylinderGeometry(r2, r1, h, 64);
        geo.rotateX(Math.PI / 2);
        geo.translate(b.pos[0], b.pos[1], b.pos[2] + h / 2);
      }
      const mat = new MeshLambertMaterial({ color: colorOf(b), transparent: true, opacity: 0.25 + 0.6 * b.opacity, side: DoubleSide, depthWrite: false });
      s.group.add(new Mesh(geo, mat));
    }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodies, colorOf]);

  useEffect(draw);

  function draw() {
    const s = st.current;
    if (!s) return;
    s.renderer.setSize(width, height);
    const c = sceneCenter(bodies);
    const d = viewDir(view.yaw, view.pitch);
    const hw = width / 2 / view.scale;
    const hh = height / 2 / view.scale;
    Object.assign(s.camera, { left: -hw, right: hw, top: hh, bottom: -hh });
    const center = new Vector3(...c);
    s.camera.position.copy(center).addScaledVector(new Vector3(...d), 1000);
    s.camera.lookAt(center);
    s.camera.updateProjectionMatrix();
    // Свет из-за левого плеча зрителя.
    s.light.position.copy(s.camera.position).add(new Vector3(-d[1] * 300, d[0] * 300, 400));
    s.renderer.render(s.scene, s.camera);
  }

  return <div ref={host} className="stereo-view__gl" aria-hidden />;
}
