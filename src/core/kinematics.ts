import {
  add,
  DEG,
  identity,
  multiply,
  norm,
  rotation,
  rotationError,
  solveLinear,
  sub,
  transform,
} from './math';
import type { Config, Containment, Frame, Link, Pose, Target, Vec3, Workspace } from './types';

// Intrinsic joint axes. Link 1 translates along local Z; links 2–6 along local X.
// Angles are radians in the engine; lengths and clearance are millimetres.
export function forwardKinematics(links: Link[], angles: number[]): Pose {
  let r = identity(),
    p: Vec3 = [0, 0, 0];
  const points: Vec3[] = [p];
  links.forEach((link, i) => {
    r = multiply(r, rotation(link.axis, angles[i]));
    p = add(p, transform(r, i === 0 ? [0, 0, link.length] : [link.length, 0, 0]));
    points.push(p);
  });
  return { points, rotation: r, tip: p };
}

export function containment(links: Link[], pose: Pose, workspace: Workspace): Containment {
  // Each entire link is a capsule. A convex box/sphere contains it iff both
  // endpoint balls are contained. This includes the end caps and joint volume.
  const pointClearance = (p: Vec3, r: number) =>
    workspace.type === 'sphere'
      ? workspace.radius - norm(sub(p, workspace.center)) - r
      : Math.min(...p.flatMap((v, j) => [v - r - workspace.min[j], workspace.max[j] - v - r]));
  const clearances = links.map((link, i) =>
    Math.min(
      pointClearance(pose.points[i], link.diameter / 2),
      pointClearance(pose.points[i + 1], link.diameter / 2),
    ),
  );
  return {
    clearances,
    clearance: Math.min(...clearances),
    violatingLinks: clearances.flatMap((c, i) => (c < -1e-7 ? [i] : [])),
  };
}

export function solveIK(config: Config, target: Target, previous: number[], t = 0): Frame {
  const { links, solver, workspace } = config;
  const clamp = (q: number[]) =>
    q.map((a, i) => Math.max(links[i].min * DEG, Math.min(links[i].max * DEG, a)));
  const evaluate = (q: number[]) => {
    const pose = forwardKinematics(links, q),
      region = containment(links, pose, workspace),
      diff = sub(target.position, pose.tip);
    const orientation = target.rotation ? rotationError(target.rotation, pose.rotation) : [0, 0, 0];
    const residual = [
      ...diff.map((v) => v / 1000),
      ...(target.rotation ? orientation.map((v) => v * 0.25) : []),
      ...region.clearances.map((c) => Math.max(0, 0.05 - c) * 0.006),
      ...q.map((a, i) => (a - previous[i]) * 0.00002),
    ];
    return {
      pose,
      region,
      error: norm(diff),
      orientationError: norm(orientation) / DEG,
      residual,
      cost: residual.reduce((s, x) => s + x * x, 0),
    };
  };
  let bestQ = clamp(previous),
    best = evaluate(bestQ),
    iterations = 0;
  const converged = (v: ReturnType<typeof evaluate>) =>
    v.error <= solver.tolerance &&
    v.orientationError <= solver.orientationTolerance &&
    v.region.violatingLinks.length === 0;
  for (let attempt = 0; attempt < solver.attempts; attempt++) {
    let q =
      attempt === 0
        ? [...bestQ]
        : clamp(
            previous.map(
              (a, j) => a + Math.sin((attempt + 1) * (j + 1) * 2.399963) * (0.45 + attempt * 0.45),
            ),
          );
    let current = evaluate(q),
      damping = 0.0003,
      stalled = 0;
    for (let it = 0; it < solver.iterations; it++) {
      iterations++;
      if (current.cost < best.cost || (converged(current) && !converged(best))) {
        best = current;
        bestQ = [...q];
      }
      if (converged(current)) {
        best = current;
        bestQ = q;
        break;
      }
      const h = 1e-5;
      const columns = q.map((_, j) => {
        const shifted = [...q];
        shifted[j] += h;
        const v = evaluate(shifted).residual;
        return v.map((x, k) => (x - current.residual[k]) / h);
      });
      const a = columns.map((col, j) =>
        columns.map(
          (other, k) => col.reduce((s, v, r) => s + v * other[r], 0) + (j === k ? damping : 0),
        ),
      );
      const b = columns.map((col) => -col.reduce((s, v, r) => s + v * current.residual[r], 0));
      const delta = solveLinear(a, b),
        scale = Math.min(1, 0.28 / Math.max(1e-12, ...delta.map(Math.abs)));
      const candidate = clamp(q.map((angle, j) => angle + delta[j] * scale)),
        next = evaluate(candidate);
      if (next.cost < current.cost) {
        const improvement = current.cost - next.cost;
        q = candidate;
        current = next;
        damping = Math.max(1e-7, damping * 0.65);
        stalled = improvement < 1e-13 ? stalled + 1 : 0;
      } else {
        damping = Math.min(10, damping * 4);
        stalled++;
      }
      if (stalled >= 12) break;
    }
    if (current.cost < best.cost || (converged(current) && !converged(best))) {
      best = current;
      bestQ = q;
    }
    if (converged(best)) break;
  }
  return {
    t,
    angles: bestQ,
    target: target.position,
    tip: best.pose.tip,
    error: best.error,
    orientationError: best.orientationError,
    clearance: best.region.clearance,
    violatingLinks: best.region.violatingLinks,
    converged:
      best.error <= solver.tolerance && best.orientationError <= solver.orientationTolerance,
    iterations,
  };
}
