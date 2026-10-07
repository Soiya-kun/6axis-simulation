import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneConfig, validateConfig } from '../src/core/config';
import { compileExpression } from '../src/core/expression';
import { containment, forwardKinematics, solveIK } from '../src/core/kinematics';
import { DEG, identity, norm, rotation, rotationError, sub } from '../src/core/math';
import { compileTrajectory, frameAt, simulate, toCSV, verifySweep } from '../src/core/simulation';
import type { Config, Frame } from '../src/core/types';
const near = (a: number, b: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function frame(config: Config, angles: number[], t: number): Frame {
  const pose = forwardKinematics(config.links, angles),
    check = containment(config.links, pose, config.workspace);
  return {
    t,
    angles,
    target: pose.tip,
    tip: pose.tip,
    error: 0,
    orientationError: 0,
    clearance: check.clearance,
    violatingLinks: check.violatingLinks,
    converged: true,
    iterations: 0,
  };
}

test('formula parser: arithmetic, precedence, constants and time', () => {
  near(compileExpression('520 + 90*cos(2*pi*t/8)')(0), 610);
  near(compileExpression('-2^2 + 2^-2 + max(3, 4)')(0), 0.25);
  near(compileExpression('2^3^2')(0), 512);
  near(compileExpression('sqrt(9)+abs(-2)+atan2(0,1)+1e-3')(0), 5.001);
  near(compileExpression('sin(pi*t/2)')(1), 1);
});
test('formula parser rejects code, unknown names, invalid syntax and singular values', () => {
  for (const source of [
    'globalThis.alert(1)',
    't=4',
    'sin(1,2)',
    'constructor(1)',
    'unknown(t)',
    '1 2',
    '(',
    '',
    '1;2',
  ])
    assert.throws(() => compileExpression(source));
  assert.throws(() => compileExpression('1/(t-0.5)')(0.5));
  assert.throws(() => compileExpression('sqrt(-1)')(0));
});
test('forward kinematics matches analytic zero and 90-degree base poses', () => {
  const c = cloneConfig(),
    p = forwardKinematics(c.links, [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(p.tip, [840, 0, 180]);
  assert.deepEqual(p.rotation, identity());
  const turned = forwardKinematics(c.links, [Math.PI / 2, 0, 0, 0, 0, 0]);
  near(turned.tip[0], 0);
  near(turned.tip[1], 840);
  near(turned.tip[2], 180);
});
test('180-degree orientation error does not collapse to zero', () => {
  for (const axis of ['X', 'Y', 'Z'] as const)
    near(norm(rotationError(rotation(axis, Math.PI), identity())), Math.PI);
});
test('box checks full thickness even with both endpoints inside; touching is allowed', () => {
  const c = cloneConfig(),
    p = forwardKinematics(c.links, [0, 0, 0, 0, 0, 0]);
  c.workspace.max[0] = 850;
  const check = containment(c.links, p, c.workspace);
  near(check.clearance, -7);
  assert.ok(check.violatingLinks.includes(5));
  c.workspace.max[0] = 857;
  assert.equal(containment(c.links, p, c.workspace).violatingLinks.length, 0);
  c.workspace.min[2] = 0;
  assert.ok(containment(c.links, p, c.workspace).violatingLinks.includes(0));
});
test('sphere checks endpoint caps, not only joint centers', () => {
  const c = cloneConfig(),
    p = forwardKinematics(c.links, [0, 0, 0, 0, 0, 0]);
  c.workspace.type = 'sphere';
  c.workspace.center = [0, 0, 180];
  c.workspace.radius = 850;
  const check = containment(c.links, p, c.workspace);
  near(check.clearance, -7);
  assert.ok(check.violatingLinks.includes(5));
  c.workspace.radius = 857;
  assert.equal(containment(c.links, p, c.workspace).violatingLinks.length, 0);
});
test('IK recovers a known reachable full pose while respecting joint limits', () => {
  const c = cloneConfig(),
    target = forwardKinematics(
      c.links,
      [25, -65, 80, 35, -35, 50].map((a) => a * DEG),
    );
  c.solver.iterations = 180;
  c.solver.attempts = 10;
  const f = solveIK(
    c,
    { position: target.tip, rotation: target.rotation },
    c.initialAngles.map((a) => a * DEG),
  );
  assert.ok(f.converged, `error=${f.error}, orientation=${f.orientationError}`);
  assert.equal(f.violatingLinks.length, 0);
  f.angles.forEach((q, i) => assert.ok(q >= c.links[i].min * DEG && q <= c.links[i].max * DEG));
});
test('default trajectory and sphere trajectory pass with bounded error', () => {
  for (const type of ['box', 'sphere'] as const) {
    const c = cloneConfig();
    c.workspace.type = type;
    const r = simulate(c);
    assert.equal(r.status, 'OK');
    assert.equal(r.summary.samples, 101);
    assert.ok(r.summary.maxError <= c.solver.tolerance);
    assert.ok(r.summary.sweepChecks >= 100);
    assert.ok(r.frames.every((f) => f.angles.every(Number.isFinite)));
  }
});
test('unreachable target reports NG rather than inventing a solution', () => {
  const c = cloneConfig();
  Object.assign(c.trajectory, { x: '4000', y: '0', z: '400', duration: 0.1, step: 0.1 });
  const r = simulate(c);
  assert.equal(r.status, 'NG');
  assert.equal(r.summary.failed, 2);
  assert.ok(r.summary.maxError > 2000);
  assert.equal(r.summary.firstIssueTime, 0);
});
test('thick links outside the workspace produce NG even when target is reachable', () => {
  const c = cloneConfig();
  c.workspace.min[2] = 0;
  c.trajectory.duration = 0.1;
  c.trajectory.step = 0.1;
  const r = simulate(c);
  assert.equal(r.status, 'NG');
  assert.ok(r.summary.violations > 0);
  assert.ok(r.summary.minClearance < 0);
});
test('swept check catches intermediate violation with safe endpoint poses', () => {
  const c = cloneConfig();
  c.workspace.min = [-500, -1000, -60];
  c.workspace.max = [500, 1000, 950];
  const a = frame(c, [-Math.PI / 2, 0, 0, 0, 0, 0], 0),
    b = frame(c, [Math.PI / 2, 0, 0, 0, 0, 0], 1);
  assert.equal(a.violatingLinks.length, 0);
  assert.equal(b.violatingLinks.length, 0);
  const swept = verifySweep(c, a, b);
  assert.equal(swept.status, 'violation');
  near(swept.t!, 0.5);
  assert.ok(swept.clearance < 0);
});
test('near-boundary swept interval is never falsely certified', () => {
  const c = cloneConfig();
  c.workspace.min[2] = -50;
  const a = frame(
      c,
      [0, -65, 95, 0, -30, 0].map((a) => a * DEG),
      0,
    ),
    b = frame(
      c,
      [1, -65, 95, 0, -30, 0].map((a) => a * DEG),
      1,
    );
  assert.equal(verifySweep(c, a, b).status, 'unverified');
});
test('simulation includes final non-grid time and playback interpolates joint angles', () => {
  const c = cloneConfig();
  c.trajectory.duration = 0.23;
  c.trajectory.step = 0.1;
  const r = simulate(c);
  assert.deepEqual(
    r.frames.map((f) => f.t),
    [0, 0.1, 0.2, 0.23],
  );
  const p = frameAt(r, 0.05);
  p.angles.forEach((v, i) => near(v, (r.frames[0].angles[i] + r.frames[1].angles[i]) / 2));
  assert.deepEqual(frameAt(r, 100).angles, r.frames.at(-1)!.angles);
  assert.equal(toCSV(r).split('\n').length, 5);
  assert.ok(toCSV(r).startsWith('t_s,J1_deg,J2_deg'));
});
test('invalid configurations and interior expression errors are rejected', () => {
  const c = cloneConfig();
  c.links[0].diameter = NaN;
  assert.throws(() => validateConfig(c));
  const d = cloneConfig();
  d.workspace.max[0] = d.workspace.min[0];
  assert.throws(() => validateConfig(d));
  const e = cloneConfig();
  e.trajectory.step = 0.005;
  e.trajectory.duration = 120;
  assert.throws(() => validateConfig(e));
  const f = cloneConfig();
  f.initialAngles[0] = 999;
  assert.throws(() => validateConfig(f));
  const g = cloneConfig();
  g.trajectory.x = '1/(t-0.5)';
  g.trajectory.duration = 1;
  g.trajectory.step = 0.1;
  assert.throws(() => simulate(g));
});
test('reproducible simulation and orientation expressions', () => {
  const c = cloneConfig();
  c.trajectory.duration = 0.1;
  c.trajectory.step = 0.1;
  const a = simulate(c),
    b = simulate(c);
  assert.deepEqual(a.frames, b.frames);
  c.trajectory.orientation = true;
  c.trajectory.yaw = '180*t';
  const target = compileTrajectory(c)(1);
  near(norm(rotationError(target.rotation!, identity())), Math.PI);
  assert.ok(norm(sub(a.frames[0].tip, a.frames[0].target)) < 2);
});
