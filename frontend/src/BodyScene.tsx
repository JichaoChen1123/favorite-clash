import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { getMuscle, muscleForName, type MuscleId } from './muscles';

// Reuse only the static model buffer when returning from another menu.
THREE.Cache.enabled = true;

type Engine = { highlight: (id: MuscleId | null) => void; view: (side: 'front' | 'back' | 'reset') => void };

export default function BodyScene({ selected, onPick }: { selected: MuscleId | null; onPick: (id: MuscleId) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const pickRef = useRef(onPick); pickRef.current = onPick;
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [hovered, setHovered] = useState<MuscleId | null>(null);
  const [facing, setFacing] = useState('front');

  useEffect(() => {
    const container = host.current!;
    let disposed = false, frame = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let observer: ResizeObserver | null = null;
    let cleanup = () => {};
    setReady(false); setError(''); setProgress(0); setHovered(null);
    const initFrame = requestAnimationFrame(() => {
      if (disposed) return;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      } catch { setError('当前浏览器暂时无法显示3D模型。仍可从下方肌群列表选择，或换一个支持3D的浏览器。'); return; }
      const canvas = renderer.domElement;
      canvas.setAttribute('aria-label', '可旋转的人体肌群模型，轻点选择肌群，左右方向键旋转');
      canvas.setAttribute('role', 'img'); canvas.tabIndex = 0;
      container.appendChild(canvas);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0xf1f3e9, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1, .01, 30);
      const renderScene = () => { if (!disposed && renderer) renderer.render(scene, camera); };
      const center = new THREE.Vector3(0, .95, 0);
      const size = new THREE.Vector3(1, 1.9, .5);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x9ba58c, 2.2));
      const key = new THREE.DirectionalLight(0xfff9ea, 2.6); key.position.set(2, 3, 4); scene.add(key);
      const fill = new THREE.DirectionalLight(0xd6e1ca, 1.1); fill.position.set(-2, 1, -3); scene.add(fill);
      controls = new OrbitControls(camera, canvas);
      controls.addEventListener('change', renderScene);
      controls.enableDamping = true; controls.dampingFactor = .09; controls.enablePan = false;
      controls.addEventListener('start', () => setFacing('orbit'));
      controls.minPolarAngle = Math.PI * .23; controls.maxPolarAngle = Math.PI * .77;
      controls.target.copy(center);
      let fitDistance = 3.5;
      function fit(side: 'front' | 'back' | 'reset') {
        const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
        fitDistance = Math.max(size.y * .57 / Math.tan(THREE.MathUtils.degToRad(18)), size.x * .6 / (aspect * Math.tan(THREE.MathUtils.degToRad(18))));
        camera.position.set(center.x, center.y + .03, center.z + (side === 'back' ? -1 : 1) * fitDistance);
        controls!.target.copy(center); controls!.minDistance = size.y * .72; controls!.maxDistance = fitDistance * 1.7;
        controls!.update(); renderScene(); setFacing(side === 'back' ? 'back' : 'front');
      }
      function resize() { if (!renderer || disposed) return; camera.aspect = container.clientWidth / Math.max(container.clientHeight, 1); camera.updateProjectionMatrix(); renderer.setSize(container.clientWidth, container.clientHeight); renderScene(); }
      observer = new ResizeObserver(resize); observer.observe(container); resize(); fit('front');
      const base = new THREE.MeshStandardMaterial({ color: 0xb0bea2, roughness: .82, metalness: 0 });
      const bone = new THREE.MeshStandardMaterial({ color: 0xe0dfd1, roughness: .9 });
      const active = new THREE.MeshStandardMaterial({ color: 0x6a9353, emissive: 0x24391a, emissiveIntensity: .18, roughness: .67 });
      const hover = new THREE.MeshStandardMaterial({ color: 0x91ac72, roughness: .75 });
      const meshes: THREE.Mesh[] = [];
      let model: THREE.Group | null = null;
      let hoverId: MuscleId | null = null;
      function paint(id: MuscleId | null) {
        for (const mesh of meshes) {
          const group = mesh.userData.fitnessGroup as MuscleId | null;
          mesh.material = mesh.userData.layer === 'skeleton' ? bone : group && group === id ? active : group && group === hoverId ? hover : base;
        }
        renderScene();
      }
      engine.current = { highlight: paint, view: fit };
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      loader.load('/models/ecorche/ecorche.meshopt.glb', gltf => {
        if (disposed) { gltf.scene.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose(); } }); return; }
        model = gltf.scene;
        model.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
          object.visible = object.userData.layer !== 'deep muscles';
          object.userData.fitnessGroup = object.userData.layer === 'superficial muscles' ? muscleForName(String(object.userData.name || object.name)) : null;
          if (object.visible) meshes.push(object);
        });
        scene.add(model); model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model); box.getCenter(center); box.getSize(size);
        paint(selectedRef.current); fit('front'); setReady(true); setProgress(100);
      }, event => { if (!disposed && event.total > 0) setProgress(Math.min(99, Math.round(event.loaded / event.total * 100))); }, () => { if (!disposed) setError('人体模型加载失败。可以重试，或从肌群列表继续选择。'); });
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const pointers = new Map<number, { x: number; y: number; time: number; moved: boolean }>();
      let multiTouch = false;
      function hit(event: PointerEvent): MuscleId | null {
        const rect = canvas.getBoundingClientRect();
        pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const first = raycaster.intersectObjects(meshes, false)[0];
        return first?.object.userData.fitnessGroup || null;
      }
      function down(event: PointerEvent) { pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, time: performance.now(), moved: false }); if (pointers.size > 1) multiTouch = true; }
      function up(event: PointerEvent) {
        const start = pointers.get(event.pointerId);
        const tap = start && !start.moved && !multiTouch && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 7 && performance.now() - start.time < 650;
        pointers.delete(event.pointerId);
        if (!pointers.size) multiTouch = false;
        if (tap && event.button === 0) { const id = hit(event); if (id) pickRef.current(id); }
      }
      function cancel(event: PointerEvent) { pointers.delete(event.pointerId); if (!pointers.size) multiTouch = false; }
      function move(event: PointerEvent) { const start = pointers.get(event.pointerId); if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 7) start.moved = true; if (event.pointerType !== 'mouse' || event.buttons) return; const id = hit(event); if (id !== hoverId) { hoverId = id; setHovered(id); paint(selectedRef.current); } canvas.style.cursor = id ? 'pointer' : 'grab'; }
      function leave() { hoverId = null; setHovered(null); paint(selectedRef.current); }
      function keyboard(event: KeyboardEvent) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault(); const offset = camera.position.clone().sub(controls!.target); const spherical = new THREE.Spherical().setFromVector3(offset); spherical.theta += (event.key === 'ArrowLeft' ? -1 : 1) * Math.PI / 12; camera.position.copy(controls!.target).add(new THREE.Vector3().setFromSpherical(spherical)); controls!.update();
      }
      canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', cancel); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerleave', leave); canvas.addEventListener('keydown', keyboard);
      function draw() { if (disposed) return; controls!.update(); frame = requestAnimationFrame(draw); }
      draw();
      cleanup = () => {
        canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('keydown', keyboard);
        controls!.removeEventListener('change', renderScene);
        model?.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
        base.dispose(); bone.dispose(); active.dispose(); hover.dispose();
      };
    });
    return () => { disposed = true; cancelAnimationFrame(initFrame); cancelAnimationFrame(frame); observer?.disconnect(); cleanup(); controls?.dispose(); renderer?.dispose(); renderer?.domElement.remove(); engine.current = null; };
  }, [reload]);

  useEffect(() => { engine.current?.highlight(selected); }, [selected]);
  const label = getMuscle(hovered || selected || null)?.name;
  return <div className="body-scene-card"><div className="body-scene-toolbar"><span><i />{selected ? '目标肌群已高亮' : '轻点肌群，确认你的选择'}</span><div>{(['front', 'back', 'reset'] as const).map(side => <button type="button" key={side} disabled={!ready} aria-pressed={side !== 'reset' ? facing === side : undefined} onClick={() => engine.current?.view(side)}>{side === 'front' ? '正面' : side === 'back' ? '背面' : '复位'}</button>)}</div></div><div className="body-scene" ref={host} aria-busy={!ready && !error}>{!ready && !error && <div className="model-loading" role="status"><span className="spinner" /><b>正在打开人体模型</b><span>{progress ? `已读取 ${progress}%` : '首次打开约需加载6MB'}</span></div>}{error && <div className="model-loading model-error" role="alert"><b>暂时无法显示模型</b><p>{error}</p><button type="button" className="button secondary" onClick={() => setReload(value => value + 1)}>重新加载模型</button></div>}{ready && <div className="model-hover-label" aria-live="polite">{label || '旋转查看正面与背面'}</div>}</div><p className="body-scene-hint">单指拖动旋转 · 双指缩放 · 轻点肌群选择<span>也可从右侧或下方列表选择</span></p></div>;
}
