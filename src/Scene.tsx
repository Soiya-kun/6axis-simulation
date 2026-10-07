import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Config, SimulationResult, Vec3 } from './core/types';
import { containment, forwardKinematics } from './core/kinematics';

interface Props {
  config: Config;
  angles: number[];
  result: SimulationResult | null;
  showWorkspace: boolean;
  showTrail: boolean;
  view: 'perspective' | 'top' | 'front';
  viewRevision: number;
}
function label(text: string, color = '#475569') {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.roundRect(6, 8, 116, 48, 14);
  ctx.fill();
  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, 64, 42);
  const texture = new THREE.CanvasTexture(canvas),
    sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(72, 36, 1);
  return sprite;
}
function dispose(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = mesh.material
      ? Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]
      : [];
    materials.forEach((m) => {
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    });
  });
}
const point = (p: Vec3) => new THREE.Vector3(...p);

export function Scene(props: Props) {
  const mount = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  latest.current = props;
  const api = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    robot: THREE.Group;
    region: THREE.Group;
    paths: THREE.Group;
    linkMeshes: { body: THREE.Mesh; start: THREE.Mesh; end: THREE.Mesh; label: THREE.Sprite }[];
    tcp: THREE.Group;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const host = mount.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError(
        'WebGLを初期化できません。ハードウェアアクセラレーションを有効にして再読み込みしてください。数値計算と設定は引き続き使えます。',
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor('#edf1f5');
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      'aria-label',
      '6軸ロボットの3Dビュー。ドラッグで回転、ホイールで拡大縮小',
    );
    renderer.domElement.setAttribute('role', 'img');
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#edf1f5', 3200, 6500);
    const camera = new THREE.PerspectiveCamera(36, 1, 1, 15000);
    camera.up.set(0, 0, 1);
    camera.position.set(1500, -1850, 1350);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(170, 0, 280);
    controls.enableDamping = true;
    controls.minDistance = 300;
    controls.maxDistance = 6500;
    controls.maxPolarAngle = Math.PI * 0.95;
    scene.add(new THREE.HemisphereLight('#ffffff', '#637489', 2.5));
    const light = new THREE.DirectionalLight('#fff7eb', 3.5);
    light.position.set(500, -500, 1700);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, {
      left: -1500,
      right: 1500,
      top: 1500,
      bottom: -1500,
      near: 1,
      far: 4000,
    });
    light.shadow.bias = -0.0005;
    scene.add(light);
    const fill = new THREE.DirectionalLight('#c4e5ff', 2);
    fill.position.set(-700, 800, 700);
    scene.add(fill);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(10000, 10000),
      new THREE.MeshStandardMaterial({ color: '#e9eef3', roughness: 0.9 }),
    );
    floor.position.z = -62;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(4000, 40, '#b8c6d2', '#d3dce4');
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -61;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    scene.add(grid);
    const axes = new THREE.AxesHelper(230);
    axes.position.set(-350, -400, -58);
    scene.add(axes);
    [
      ['X', [-95, -400, -58], '#bd655f'],
      ['Y', [-350, -145, -58], '#43836e'],
      ['Z', [-350, -400, 197], '#4f7db4'],
    ].forEach(([text, pos, color]) => {
      const s = label(text as string, color as string);
      s.position.copy(point(pos as Vec3));
      scene.add(s);
    });
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(95, 108, 32, 48),
      new THREE.MeshStandardMaterial({ color: '#34445b', metalness: 0.65, roughness: 0.4 }),
    );
    base.rotation.x = Math.PI / 2;
    base.position.z = -43;
    base.castShadow = true;
    base.receiveShadow = true;
    scene.add(base);
    const robot = new THREE.Group(),
      region = new THREE.Group(),
      paths = new THREE.Group(),
      tcp = new THREE.Group();
    scene.add(robot, region, paths, tcp);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(9, 20, 16),
      new THREE.MeshBasicMaterial({ color: '#0baf99' }),
    );
    tcp.add(marker, new THREE.AxesHelper(65));
    const linkMeshes = Array.from({ length: 6 }, (_, i) => {
      const material = new THREE.MeshStandardMaterial({
        color: i === 0 || i === 3 || i === 5 ? '#35465c' : '#eda653',
        metalness: 0.35,
        roughness: 0.32,
      });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40), material),
        start = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), material.clone()),
        end = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), material.clone());
      [body, start, end].forEach((m) => {
        m.castShadow = true;
        m.receiveShadow = true;
        robot.add(m);
      });
      const tag = label(`J${i + 1}`);
      robot.add(tag);
      return { body, start, end, label: tag };
    });
    api.current = { scene, camera, controls, robot, region, paths, linkMeshes, tcp };
    const resize = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      if (width && height) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      }
    });
    resize.observe(host);
    let animation = 0;
    const render = () => {
      const { config, angles } = latest.current;
      const pose = forwardKinematics(config.links, angles),
        regionCheck = containment(config.links, pose, config.workspace);
      linkMeshes.forEach((m, i) => {
        const start = point(pose.points[i]),
          end = point(pose.points[i + 1]),
          direction = end.clone().sub(start),
          r = Math.max(0.5, config.links[i].diameter / 2);
        m.body.position.copy(start.clone().add(end).multiplyScalar(0.5));
        m.body.scale.set(r, direction.length(), r);
        m.body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
        m.start.position.copy(start);
        m.end.position.copy(end);
        m.start.scale.setScalar(r);
        m.end.scale.setScalar(r);
        const color = regionCheck.violatingLinks.includes(i)
          ? '#e25353'
          : i === 0 || i === 3 || i === 5
            ? '#35465c'
            : '#eda653';
        [m.body, m.start, m.end].forEach((mesh) =>
          (mesh.material as THREE.MeshStandardMaterial).color.set(color),
        );
        m.label.position.copy(start).add(new THREE.Vector3(0, -r - 28, 48));
      });
      tcp.position.copy(point(pose.tip));
      controls.update();
      renderer.render(scene, camera);
      animation = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(animation);
      resize.disconnect();
      controls.dispose();
      dispose(scene);
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, []);
  useEffect(() => {
    const ctx = api.current;
    if (!ctx) return;
    dispose(ctx.region);
    ctx.region.clear();
    const w = props.config.workspace;
    const geometry =
      w.type === 'box'
        ? new THREE.BoxGeometry(...(w.max.map((x, i) => Math.max(1, x - w.min[i])) as Vec3))
        : new THREE.SphereGeometry(Math.max(1, w.radius), 40, 24);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: '#1ca695',
        transparent: true,
        opacity: 0.025,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const lines = new THREE.LineSegments(
      w.type === 'box'
        ? new THREE.EdgesGeometry(geometry)
        : new THREE.WireframeGeometry(new THREE.SphereGeometry(w.radius, 16, 10)),
      new THREE.LineBasicMaterial({
        color: '#51a99e',
        transparent: true,
        opacity: w.type === 'box' ? 0.55 : 0.15,
        depthWrite: false,
      }),
    );
    ctx.region.add(mesh, lines);
    ctx.region.position.copy(
      point(w.type === 'box' ? (w.min.map((x, i) => (x + w.max[i]) / 2) as Vec3) : w.center),
    );
    ctx.region.visible = props.showWorkspace;
  }, [props.config.workspace, props.showWorkspace]);
  useEffect(() => {
    const ctx = api.current;
    if (!ctx) return;
    dispose(ctx.paths);
    ctx.paths.clear();
    if (props.result) {
      const target = new THREE.BufferGeometry().setFromPoints(
        props.result.frames.map((f) => point(f.target)),
      );
      const line = new THREE.Line(
        target,
        new THREE.LineDashedMaterial({
          color: '#119e8d',
          dashSize: 9,
          gapSize: 6,
          transparent: true,
          opacity: 0.8,
        }),
      );
      line.computeLineDistances();
      ctx.paths.add(line);
      const actual = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(props.result.frames.map((f) => point(f.tip))),
        new THREE.LineBasicMaterial({ color: '#4c78db', transparent: true, opacity: 0.7 }),
      );
      ctx.paths.add(actual);
    }
    ctx.paths.visible = props.showTrail;
  }, [props.result, props.showTrail]);
  useEffect(() => {
    const ctx = api.current;
    if (!ctx) return;
    ctx.controls.target.set(170, 0, 280);
    ctx.camera.position.copy(
      point(
        props.view === 'top'
          ? [170, -1, 2400]
          : props.view === 'front'
            ? [170, -2400, 280]
            : [1500, -1850, 1350],
      ),
    );
    ctx.controls.update();
  }, [props.view, props.viewRevision]);
  return (
    <div className="scene" ref={mount}>
      {error && (
        <div className="webgl-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
