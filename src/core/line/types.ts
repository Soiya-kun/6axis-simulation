/** All distances are mm, all times are seconds. No renderer or browser dependencies. */
export type LinePhase =
  'feeding' | 'positioning' | 'settling' | 'working' | 'releasing' | 'unloading';
export type RobotPhase = 'home' | 'approach' | 'inspect' | 'retreat';
export type LineStatus = 'READY' | 'RUNNING' | 'OK' | 'NG' | 'UNVERIFIED';
export interface LineConfig {
  kind: 'manufacturing-line';
  version: 1;
  lineId: 'inspection-01';
  name: string;
  batchSize: number;
  timeLimit: number;
  feedInterval: number;
  conveyorSpeed: number;
  acceleration: number;
  outputSpeed: number;
  plcScan: number;
  sensorDelay: number;
  stopWait: number;
  inspectionTime: number;
  releaseWait: number;
  robotTimeout: number;
  jamTimeout: number;
  requireRobotHome: boolean;
  doneMode: 'latched' | 'pulse';
  donePulse: number;
  faults: FaultInputs;
}
export interface FaultInputs {
  positionSensor: 'normal' | 'off' | 'on';
  dropDone: boolean;
  outputBlocked: boolean;
}
export interface LineDefinition {
  id: LineConfig['lineId'];
  controller: 'inspection';
  name: string;
  description: string;
  inputCapacity: number;
  outputCapacity: number;
  entryX: number;
  sensorX: number;
  workMin: number;
  workMax: number;
  transferX: number;
  exitX: number;
  partLength: number;
  partGap: number;
  approachTime: number;
  retreatTime: number;
  minimumSettle: number;
  minimumInspection: number;
  targetSeconds: number;
}
export interface Part {
  id: number;
  x: number;
  createdAt: number;
  enteredAt: number;
  inspected: boolean;
  quality: 'pending' | 'good' | 'reject';
}
export interface Signals {
  partPresent: boolean;
  motorRun: boolean;
  robotRequest: boolean;
  robotBusy: boolean;
  processDone: boolean;
  robotHome: boolean;
  downstreamReady: boolean;
}
export interface LineEvent {
  at: number;
  level: 'info' | 'warning' | 'fault';
  code: string;
  message: string;
}
export interface SignalSample extends Signals {
  at: number;
}
export interface LineFault {
  code: string;
  message: string;
  cause: string;
  remedy: string;
  at: number;
}
export interface LineState {
  status: LineStatus;
  time: number;
  phase: LinePhase;
  phaseSince: number;
  robot: RobotPhase;
  robotSince: number;
  velocity: number;
  queue: Part[];
  active: Part | null;
  output: Part[];
  generated: number;
  completed: number;
  good: number;
  rejected: number;
  robotBusyTime: number;
  downstreamWait: number;
  lastCycle: number | null;
  completionTimes: number[];
  signals: Signals;
  inputs: FaultInputs;
  fault: LineFault | null;
  events: LineEvent[];
  history: SignalSample[];
}
export interface LineSummary {
  completed: number;
  good: number;
  rejected: number;
  elapsed: number;
  throughput: number;
  robotUtilization: number;
  averageCycle: number | null;
  downstreamWait: number;
  challengePassed: boolean;
}
export interface LineResult {
  kind: 'manufacturing-line-result';
  config: LineConfig;
  status: LineStatus;
  summary: LineSummary;
  state: LineState;
}
