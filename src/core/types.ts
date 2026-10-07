export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Axis = 'X' | 'Y' | 'Z';
export interface Link {
  name: string;
  axis: Axis;
  length: number;
  diameter: number;
  min: number;
  max: number;
}
export interface Workspace {
  type: 'box' | 'sphere';
  min: Vec3;
  max: Vec3;
  center: Vec3;
  radius: number;
}
export interface Trajectory {
  x: string;
  y: string;
  z: string;
  orientation: boolean;
  roll: string;
  pitch: string;
  yaw: string;
  duration: number;
  step: number;
}
export interface SolverSettings {
  iterations: number;
  attempts: number;
  tolerance: number;
  orientationTolerance: number;
}
export interface Config {
  version: 1;
  name: string;
  links: Link[];
  initialAngles: number[];
  workspace: Workspace;
  trajectory: Trajectory;
  solver: SolverSettings;
}
export interface Pose {
  points: Vec3[];
  rotation: Mat3;
  tip: Vec3;
}
export interface Target {
  position: Vec3;
  rotation?: Mat3;
}
export interface Containment {
  clearances: number[];
  clearance: number;
  violatingLinks: number[];
}
export interface Frame {
  t: number;
  angles: number[];
  target: Vec3;
  tip: Vec3;
  error: number;
  orientationError: number;
  clearance: number;
  violatingLinks: number[];
  converged: boolean;
  iterations: number;
}
export interface SweepResult {
  status: 'safe' | 'violation' | 'unverified';
  clearance: number;
  t?: number;
  links?: number[];
  checks: number;
}
export interface SimulationResult {
  status: 'OK' | 'NG' | 'UNVERIFIED';
  frames: Frame[];
  sweeps: SweepResult[];
  summary: {
    samples: number;
    solved: number;
    failed: number;
    violations: number;
    maxError: number;
    minClearance: number;
    maxOrientationError: number;
    sweepChecks: number;
    firstIssueTime: number | null;
  };
  elapsedMs: number;
}
