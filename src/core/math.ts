import type { Axis, Mat3, Vec3 } from './types';
export const DEG = Math.PI / 180;
export const identity = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const norm = (a: number[]) => Math.hypot(...a);
export const transform = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
export function multiply(a: Mat3, b: Mat3): Mat3 {
  return Array.from({ length: 9 }, (_, i) => {
    const r = Math.floor(i / 3),
      c = i % 3;
    return a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }) as Mat3;
}
export function rotation(axis: Axis, angle: number): Mat3 {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return axis === 'X'
    ? [1, 0, 0, 0, c, -s, 0, s, c]
    : axis === 'Y'
      ? [c, 0, s, 0, 1, 0, -s, 0, c]
      : [c, -s, 0, s, c, 0, 0, 0, 1];
}
export const euler = (roll: number, pitch: number, yaw: number) =>
  multiply(multiply(rotation('Z', yaw), rotation('Y', pitch)), rotation('X', roll));
// SO(3) logarithm, including the 180-degree case where the usual skew formula vanishes.
export function rotationError(target: Mat3, actual: Mat3): Vec3 {
  const transpose = [
    actual[0],
    actual[3],
    actual[6],
    actual[1],
    actual[4],
    actual[7],
    actual[2],
    actual[5],
    actual[8],
  ] as Mat3;
  const r = multiply(target, transpose),
    c = Math.max(-1, Math.min(1, (r[0] + r[4] + r[8] - 1) / 2)),
    angle = Math.acos(c);
  if (angle < 1e-8) return [0, 0, 0];
  if (Math.PI - angle < 1e-5) {
    const d = [r[0], r[4], r[8]],
      k = d.indexOf(Math.max(...d));
    const v: Vec3 = [0, 0, 0];
    v[k] = Math.sqrt(Math.max(0, (d[k] + 1) / 2));
    for (let j = 0; j < 3; j++) if (j !== k) v[j] = (r[k * 3 + j] + r[j * 3 + k]) / (4 * v[k]);
    return v.map((x) => x * angle) as Vec3;
  }
  const f = angle / (2 * Math.sin(angle));
  return [(r[7] - r[5]) * f, (r[2] - r[6]) * f, (r[3] - r[1]) * f];
}
export function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length,
    a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[p][k])) p = i;
    [a[k], a[p]] = [a[p], a[k]];
    if (Math.abs(a[k][k]) < 1e-14) return Array(n).fill(0);
    const div = a[k][k];
    for (let j = k; j <= n; j++) a[k][j] /= div;
    for (let i = 0; i < n; i++)
      if (i !== k) {
        const f = a[i][k];
        for (let j = k; j <= n; j++) a[i][j] -= f * a[k][j];
      }
  }
  return a.map((row) => row[n]);
}
export const interpolateAngles = (a: number[], b: number[], t: number) =>
  a.map((x, i) => x + (b[i] - x) * t);
