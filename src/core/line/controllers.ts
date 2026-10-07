import type { LineConfig, LineDefinition, LinePhase, LineState } from './types';

export interface ControllerContext {
  state: LineState;
  config: LineConfig;
  transition: (phase: LinePhase) => void;
  fail: (code: string, message: string, cause: string, remedy: string) => void;
}
export type LineController = (context: ControllerContext) => void;

/** One invocation per PLC scan. Plant motion and process durations belong to the engine. */
const inspectionController: LineController = ({ state: s, config: c, transition, fail }) => {
  const age = s.time - s.phaseSince;
  const EPS = 1e-8;
  switch (s.phase) {
    case 'feeding':
      s.signals.motorRun = false;
      s.signals.robotRequest = false;
      if (!s.active && s.queue.length && s.signals.robotHome) {
        s.active = s.queue.shift()!;
        s.active.enteredAt = s.time;
        transition('positioning');
        s.signals.motorRun = true;
      }
      break;
    case 'positioning':
      if (s.signals.partPresent) {
        s.signals.motorRun = false;
        transition('settling');
      }
      break;
    case 'settling':
      if (age + EPS >= c.stopWait) {
        s.signals.robotRequest = true;
        transition('working');
      }
      break;
    case 'working':
      if (s.signals.processDone) {
        s.signals.robotRequest = false;
        transition('releasing');
      } else if (age + EPS >= c.robotTimeout) {
        fail(
          'DONE_TIMEOUT',
          'PLCが検品完了信号を受信できず停止',
          'ロボットの処理時間超過、信号の遮断、またはスキャン間の短いパルスが原因です。',
          '完了信号を保持式にする、PLC周期を短くする、処理時間に合わせてタイムアウトを延ばす設定を試してください。',
        );
      }
      break;
    case 'releasing':
      if (
        age + EPS >= c.releaseWait &&
        (!c.requireRobotHome || s.signals.robotHome) &&
        s.signals.downstreamReady
      ) {
        transition('unloading');
        s.signals.motorRun = true;
      }
      break;
    case 'unloading':
      s.signals.motorRun = s.signals.downstreamReady;
      break;
  }
};

/** New sequences can register another controller without changing the simulation clock. */
export const lineControllers: Record<LineDefinition['controller'], LineController> = {
  inspection: inspectionController,
};
