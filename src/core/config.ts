import type { Config } from './types';
export const defaultConfig: Config = {
  version: 1,
  name: 'Orbital study',
  links: [
    { name: 'ベース', axis: 'Z', length: 180, diameter: 100, min: -180, max: 180 },
    { name: 'ショルダー', axis: 'Y', length: 320, diameter: 84, min: -150, max: 150 },
    { name: 'エルボー', axis: 'Y', length: 260, diameter: 70, min: -150, max: 150 },
    { name: 'リスト 1', axis: 'X', length: 100, diameter: 56, min: -180, max: 180 },
    { name: 'リスト 2', axis: 'Y', length: 90, diameter: 46, min: -150, max: 150 },
    { name: 'ツール', axis: 'X', length: 70, diameter: 34, min: -180, max: 180 },
  ],
  initialAngles: [0, -65, 95, 0, -30, 0],
  workspace: {
    type: 'box',
    min: [-550, -550, -60],
    max: [850, 550, 950],
    center: [100, 0, 380],
    radius: 720,
  },
  trajectory: {
    x: '520 + 90 * cos(2*pi*t/8)',
    y: '140 * sin(2*pi*t/8)',
    z: '400 + 60 * sin(4*pi*t/8)',
    orientation: false,
    roll: '0',
    pitch: '0',
    yaw: '0',
    duration: 8,
    step: 0.08,
  },
  solver: { iterations: 100, attempts: 5, tolerance: 2, orientationTolerance: 1 },
};
export const cloneConfig = (config: Config = defaultConfig): Config => structuredClone(config);
export function validateConfig(value: unknown): asserts value is Config {
  const c = value as Config;
  const num = (x: unknown, min: number, max: number, label: string) => {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max)
      throw new Error(`${label}: ${min}〜${max} の数値が必要です`);
  };
  const vector = (x: unknown, label: string) => {
    if (!Array.isArray(x) || x.length !== 3) throw new Error(`${label}: 3要素が必要です`);
    x.forEach((v) => num(v, -1e5, 1e5, label));
  };
  if (!c || c.version !== 1 || typeof c.name !== 'string' || c.name.length > 100)
    throw new Error('設定ファイルの形式が不正です (version: 1)');
  if (!Array.isArray(c.links) || c.links.length !== 6) throw new Error('6本のリンクが必要です');
  if (!Array.isArray(c.initialAngles) || c.initialAngles.length !== 6)
    throw new Error('6軸の初期角度が必要です');
  c.links.forEach((l, i) => {
    if (!l || typeof l.name !== 'string' || !['X', 'Y', 'Z'].includes(l.axis))
      throw new Error(`J${i + 1}: 軸が不正です`);
    num(l.length, 1, 3000, '長さ');
    num(l.diameter, 1, 1000, '直径');
    num(l.min, -360, 360, '角度下限');
    num(l.max, -360, 360, '角度上限');
    if (l.min >= l.max) throw new Error(`J${i + 1}: 角度下限は上限未満にしてください`);
    num(c.initialAngles[i], l.min, l.max, `J${i + 1} 初期角度`);
  });
  if (!c.workspace || !['box', 'sphere'].includes(c.workspace.type))
    throw new Error('領域の種類が不正です');
  vector(c.workspace.min, '領域下限');
  vector(c.workspace.max, '領域上限');
  vector(c.workspace.center, '球の中心');
  num(c.workspace.radius, 1, 1e5, '球の半径');
  if (c.workspace.min.some((v, i) => v >= c.workspace.max[i]))
    throw new Error('領域下限は上限未満にしてください');
  const tr = c.trajectory;
  if (!tr || typeof tr.orientation !== 'boolean') throw new Error('軌道設定が不正です');
  for (const k of ['x', 'y', 'z', 'roll', 'pitch', 'yaw'] as const)
    if (typeof tr[k] !== 'string' || tr[k].length > 512 || !tr[k].trim())
      throw new Error(`${k}(t) が不正です`);
  num(tr.duration, 0.05, 120, '時間');
  num(tr.step, 0.005, 2, '刻み');
  if (tr.step > tr.duration) throw new Error('時間刻みは全時間以下にしてください');
  if (Math.ceil(tr.duration / tr.step) > 2000)
    throw new Error('サンプル数を2001点以下にしてください');
  if (!c.solver) throw new Error('ソルバー設定が必要です');
  num(c.solver.iterations, 10, 300, '反復数');
  num(c.solver.attempts, 1, 12, '探索数');
  num(c.solver.tolerance, 0.01, 20, '位置許容誤差');
  num(c.solver.orientationTolerance, 0.01, 10, '姿勢許容誤差');
  if (!Number.isInteger(c.solver.iterations) || !Number.isInteger(c.solver.attempts))
    throw new Error('反復数と探索数は整数で指定してください');
}
