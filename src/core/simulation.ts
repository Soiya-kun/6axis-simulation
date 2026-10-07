import { validateConfig } from './config';
import { compileExpression } from './expression';
import { containment, forwardKinematics, solveIK } from './kinematics';
import { DEG, euler, interpolateAngles } from './math';
import type { Config, Frame, SimulationResult, SweepResult, Target } from './types';

export function compileTrajectory(config: Config): (t: number) => Target {
  const tr = config.trajectory;
  const x = compileExpression(tr.x),
    y = compileExpression(tr.y),
    z = compileExpression(tr.z);
  const angles = tr.orientation ? [tr.roll, tr.pitch, tr.yaw].map(compileExpression) : null;
  return (t) => ({
    position: [x(t), y(t), z(t)],
    rotation: angles
      ? euler(angles[0](t) * DEG, angles[1](t) * DEG, angles[2](t) * DEG)
      : undefined,
  });
}

// Certify the actual playback motion (linear interpolation in joint space).
// For any point on the robot, sum(|delta q_j| * downstream length_j) bounds
// displacement. Box and sphere signed clearance are 1-Lipschitz. Recursively
// certify intervals using midpoint clearance minus half this displacement bound.
// If the budget is exhausted near a boundary, never report the interval as safe.
export function verifySweep(config: Config, from: Frame, to: Frame): SweepResult {
  const reach = config.links.map((_, i) => config.links.slice(i).reduce((s, l) => s + l.length, 0));
  let checks = 0,
    minimum = Math.min(from.clearance, to.clearance);
  function visit(a: number[], b: number[], ta: number, tb: number, depth: number): SweepResult {
    const q = interpolateAngles(a, b, 0.5),
      t = (ta + tb) / 2,
      region = containment(config.links, forwardKinematics(config.links, q), config.workspace);
    checks++;
    minimum = Math.min(minimum, region.clearance);
    if (region.violatingLinks.length)
      return { status: 'violation', clearance: minimum, t, links: region.violatingLinks, checks };
    const bound = a.reduce((s, angle, i) => s + Math.abs(b[i] - angle) * reach[i], 0) / 2;
    if (region.clearance - bound >= -1e-7) return { status: 'safe', clearance: minimum, checks };
    if (depth >= 12 || checks >= 1024)
      return { status: 'unverified', clearance: minimum, t, checks };
    const left = visit(a, q, ta, t, depth + 1);
    if (left.status !== 'safe') return left;
    return visit(q, b, t, tb, depth + 1);
  }
  if (from.violatingLinks.length || to.violatingLinks.length) {
    const f = from.violatingLinks.length ? from : to;
    return { status: 'violation', clearance: minimum, t: f.t, links: f.violatingLinks, checks: 0 };
  }
  return visit(from.angles, to.angles, from.t, to.t, 0);
}

export function simulate(
  config: Config,
  onProgress?: (fraction: number) => void,
): SimulationResult {
  validateConfig(config);
  const started = performance.now(),
    targetAt = compileTrajectory(config);
  const n = Math.ceil(config.trajectory.duration / config.trajectory.step),
    times = Array.from({ length: n + 1 }, (_, i) =>
      Math.min(i * config.trajectory.step, config.trajectory.duration),
    );
  // Validate every requested target before spending time solving.
  const targets = times.map((t) => targetAt(t));
  const frames: Frame[] = [],
    sweeps: SweepResult[] = [];
  let previous = config.initialAngles.map((a) => a * DEG);
  for (let i = 0; i < times.length; i++) {
    const frame = solveIK(config, targets[i], previous, times[i]);
    frames.push(frame);
    if (i) sweeps.push(verifySweep(config, frames[i - 1], frame));
    previous = frame.angles;
    if (i % 5 === 0 || i === times.length - 1) onProgress?.((i + 1) / times.length);
  }
  const failed = frames.filter((f) => !f.converged).length,
    violations = frames.filter((f) => f.violatingLinks.length > 0).length;
  const badTimes = [
    ...frames.filter((f) => !f.converged || f.violatingLinks.length).map((f) => f.t),
    ...sweeps.filter((s) => s.status !== 'safe').map((s) => s.t!),
  ];
  return {
    status:
      failed || violations || sweeps.some((s) => s.status === 'violation')
        ? 'NG'
        : sweeps.some((s) => s.status === 'unverified')
          ? 'UNVERIFIED'
          : 'OK',
    frames,
    sweeps,
    summary: {
      samples: frames.length,
      solved: frames.length - failed,
      failed,
      violations,
      maxError: Math.max(...frames.map((f) => f.error)),
      minClearance: Math.min(...frames.map((f) => f.clearance), ...sweeps.map((s) => s.clearance)),
      maxOrientationError: Math.max(...frames.map((f) => f.orientationError)),
      sweepChecks: sweeps.reduce((s, r) => s + r.checks, 0),
      firstIssueTime: badTimes.length ? Math.min(...badTimes) : null,
    },
    elapsedMs: performance.now() - started,
  };
}

export function frameAt(result: SimulationResult, t: number): { angles: number[]; index: number } {
  const frames = result.frames;
  let lo = 0,
    hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = frames[lo],
    b = frames[Math.min(lo + 1, frames.length - 1)];
  return {
    angles: interpolateAngles(
      a.angles,
      b.angles,
      a.t === b.t ? 0 : Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))),
    ),
    index: lo,
  };
}

export function toCSV(result: SimulationResult): string {
  const header = [
    't_s',
    ...Array.from({ length: 6 }, (_, i) => `J${i + 1}_deg`),
    'target_x_mm',
    'target_y_mm',
    'target_z_mm',
    'tip_x_mm',
    'tip_y_mm',
    'tip_z_mm',
    'error_mm',
    'orientation_error_deg',
    'clearance_mm',
    'ik_converged',
    'violating_links',
  ];
  return [
    header.join(','),
    ...result.frames.map((f) =>
      [
        f.t,
        ...f.angles.map((a) => a / DEG),
        ...f.target,
        ...f.tip,
        f.error,
        f.orientationError,
        f.clearance,
        f.converged,
        f.violatingLinks.map((i) => `J${i + 1}`).join('|'),
      ].join(','),
    ),
  ].join('\n');
}
