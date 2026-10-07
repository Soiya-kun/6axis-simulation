import { lineDefinitions, validateLineConfig } from './config';
import { lineControllers } from './controllers';
import type {
  FaultInputs,
  LineConfig,
  LineDefinition,
  LinePhase,
  LineResult,
  LineState,
  LineSummary,
  RobotPhase,
} from './types';

export const LINE_STEP = 0.01;
const EPS = 1e-8;
const terminal = (s: LineState) => ['OK', 'NG', 'UNVERIFIED'].includes(s.status);

/** Fixed-step plant + sampled PLC. Wall-clock/render frequency never alters the result. */
export class LineSimulator {
  readonly config: LineConfig;
  readonly definition: LineDefinition;
  private s: LineState;
  private tick = 0;
  private remainder = 0;
  private nextScan = 0;
  private nextFeed = 0;
  private sensorRaw = false;
  private sensorSince = 0;
  private stoppedSince = 0;
  private doneAt: number | null = null;
  private cycleStarted = false;
  private blockedSince: number | null = null;
  private previousSignals = '';

  constructor(config: LineConfig) {
    validateLineConfig(config);
    this.config = structuredClone(config);
    this.definition = lineDefinitions[config.lineId];
    this.s = {
      status: 'READY',
      time: 0,
      phase: 'feeding',
      phaseSince: 0,
      robot: 'home',
      robotSince: 0,
      velocity: 0,
      queue: [],
      active: null,
      output: [],
      generated: 0,
      completed: 0,
      good: 0,
      rejected: 0,
      robotBusyTime: 0,
      downstreamWait: 0,
      lastCycle: null,
      completionTimes: [],
      signals: {
        partPresent: false,
        motorRun: false,
        robotRequest: false,
        robotBusy: false,
        processDone: false,
        robotHome: true,
        downstreamReady: true,
      },
      inputs: structuredClone(config.faults),
      fault: null,
      events: [],
      history: [],
    };
    this.event('READY', 'ライン準備完了。搬入から検品、搬出までの信号を観察できます。');
    this.recordSignals();
  }
  get finished() {
    return terminal(this.s);
  }
  snapshot(): LineState {
    return structuredClone(this.s);
  }
  emergencyStop() {
    if (this.finished) return;
    this.fail(
      'EMERGENCY_STOP',
      '非常停止が押されました',
      'シミュレーションを現在の時刻で凍結しました。',
      '原因を確認し、リセットして再実行してください。',
    );
    this.recordSignals();
  }
  /** Runtime fault injection is separate from recipe edits. Terminal faults are latched. */
  setInputs(patch: Partial<FaultInputs>) {
    if (this.finished) return;
    const next = { ...this.s.inputs, ...patch };
    validateLineConfig({ ...this.config, faults: next });
    this.s.inputs = next;
    this.event(
      'INPUT_CHANGED',
      `故障入力変更: センサー=${next.positionSensor}, 完了信号遮断=${next.dropDone}, 搬出閉塞=${next.outputBlocked}`,
      'warning',
    );
  }
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new Error('進行時間は有限の非負値で指定してください');
    if (this.finished || seconds === 0) return;
    this.remainder += seconds;
    while (this.remainder + EPS >= LINE_STEP && !this.finished) {
      this.remainder = Math.max(0, this.remainder - LINE_STEP);
      this.step();
    }
  }
  advanceScan() {
    // Imported recipes can specify a scan period between the 10 ms clock ticks.
    this.advance(Math.ceil(this.config.plcScan / LINE_STEP - EPS) * LINE_STEP);
  }
  result(): LineResult {
    return {
      kind: 'manufacturing-line-result',
      config: structuredClone(this.config),
      status: this.s.status,
      summary: summarizeLine(this.s, this.config),
      state: this.snapshot(),
    };
  }
  private event(code: string, message: string, level: 'info' | 'warning' | 'fault' = 'info') {
    this.s.events.push({ at: this.s.time, code, message, level });
    if (this.s.events.length > 4000) this.s.events.shift();
  }
  private fail(code: string, message: string, cause: string, remedy: string) {
    const s = this.s;
    s.status = 'NG';
    s.fault = { code, message, cause, remedy, at: s.time };
    s.signals.motorRun = false;
    s.signals.robotRequest = false;
    this.event(code, message, 'fault');
  }
  private phase(phase: LinePhase) {
    this.s.phase = phase;
    this.s.phaseSince = this.s.time;
    const labels: Record<LinePhase, string> = {
      feeding: '搬入待ち',
      positioning: '位置決め搬送',
      settling: '停止・安定待ち',
      working: '検品要求',
      releasing: '完了受信・退避待ち',
      unloading: '搬出開始',
    };
    this.event('PHASE', labels[phase]);
    if (phase === 'releasing') this.event('DONE_RECEIVED', 'PLCが完了信号を受信。開始要求をOFF。');
  }
  private robot(phase: RobotPhase) {
    this.s.robot = phase;
    this.s.robotSince = this.s.time;
  }
  private readyForOutput() {
    const { s, definition: d } = this;
    return (
      s.output.length < d.outputCapacity &&
      s.output.every((p) => p.x - d.transferX >= d.partLength + d.partGap - EPS)
    );
  }
  private updateOutput() {
    const { s, config: c, definition: d } = this;
    // Downstream zones accumulate without overlap. A blocked exit fills the finite buffer.
    for (let i = 0; i < s.output.length; i++) {
      const p = s.output[i];
      const stop =
        i === 0
          ? s.inputs.outputBlocked
            ? d.exitX
            : Infinity
          : s.output[i - 1].x - d.partLength - d.partGap;
      p.x = Math.min(p.x + c.outputSpeed * LINE_STEP, stop);
    }
    while (s.output[0] && s.output[0].x >= d.exitX && !s.inputs.outputBlocked) {
      const p = s.output.shift()!;
      s.completed++;
      if (p.quality === 'good') s.good++;
      else s.rejected++;
      s.lastCycle = s.completionTimes.length ? s.time - s.completionTimes.at(-1)! : null;
      s.completionTimes.push(s.time);
      this.event(
        'PART_EXIT',
        `ワーク #${String(p.id).padStart(2, '0')} 搬出 / ${p.quality === 'good' ? '良品' : '検品不足・NG'}`,
        p.quality === 'good' ? 'info' : 'warning',
      );
    }
    s.signals.downstreamReady = this.readyForOutput();
  }
  private updateTransport() {
    const { s, config: c, definition: d } = this;
    const before = s.velocity;
    const target = s.signals.motorRun && s.active ? c.conveyorSpeed : 0;
    s.velocity +=
      Math.sign(target - before) * Math.min(Math.abs(target - before), c.acceleration * LINE_STEP);
    if (before > EPS || s.velocity > EPS) this.stoppedSince = s.time;
    if (s.active) {
      s.active.x += (before + s.velocity) * 0.5 * LINE_STEP;
      if (s.velocity > EPS && s.robot !== 'home') {
        this.fail(
          'ROBOT_INTERFERENCE',
          '退避前の搬送によりロボットとワークが干渉',
          'PROCESS_DONEは検品の終了です。ロボットはまだ退避中で、搬送の許可信号ではありません。',
          '「退避確認インターロック」を有効にするか、完了後の搬送待ちを退避時間以上にしてください。',
        );
        return;
      }
      if (!s.active.inspected && s.active.x > d.workMax + EPS) {
        this.fail(
          'POSITION_OVERRUN',
          'ワークが検品可能範囲を通過',
          `位置 ${s.active.x.toFixed(0)} mm。センサー応答・PLCスキャン・制動距離の合計で停止位置が決まります。`,
          'センサー故障を解除し、搬送速度を下げる、減速度を上げる、応答遅延を短くする設定を試してください。',
        );
        return;
      }
      if (s.active.x >= d.transferX) {
        // The transfer zone has a mechanical stop gate, unlike the inspection position.
        s.active.x = d.transferX;
        s.velocity = 0;
        if (s.signals.downstreamReady) {
          s.output.push(s.active);
          s.active = null;
          s.signals.motorRun = false;
          this.phase('feeding');
        }
      }
    }
  }
  private updateSensor() {
    const { s, definition: d, config: c } = this;
    const raw =
      s.inputs.positionSensor === 'on' ||
      (s.inputs.positionSensor === 'normal' &&
        !!s.active &&
        Math.abs(s.active.x - d.sensorX) <= d.partLength / 2);
    if (raw !== this.sensorRaw) {
      this.sensorRaw = raw;
      this.sensorSince = s.time;
    }
    if (s.time - this.sensorSince + EPS >= c.sensorDelay) s.signals.partPresent = raw;
  }
  private updateRobot() {
    const { s, definition: d, config: c } = this;
    if (!s.signals.robotRequest && s.robot === 'home') this.cycleStarted = false;
    if (s.robot === 'home' && s.signals.robotRequest && !this.cycleStarted) {
      if (s.velocity > EPS) {
        this.fail(
          'CLAMP_WHILE_MOVING',
          '停止する前にロボットが進入',
          `開始要求時の速度は ${s.velocity.toFixed(1)} mm/s。開始待ちは停止命令から計時されます。`,
          '停止後の開始待ちを「速度 ÷ 減速度 + 安定時間0.20秒」より長くしてください。',
        );
        return;
      }
      if (s.time - this.stoppedSince + EPS < d.minimumSettle) {
        this.fail(
          'UNSETTLED_PART',
          'ワークの振動が収まる前にクランプ',
          '停止後に必要な安定時間0.20秒が確保されていません。',
          '停止後の開始待ちを延ばしてください。',
        );
        return;
      }
      if (!s.active || s.active.x < d.workMin || s.active.x > d.workMax) {
        this.fail(
          'POSITION_MISMATCH',
          '検品位置にワークがありません',
          '位置センサーの信号と実際のワーク位置が一致していません。',
          '位置センサーのON固着を解除してください。',
        );
        return;
      }
      this.cycleStarted = true;
      this.doneAt = null;
      this.robot('approach');
    }
    const age = s.time - s.robotSince;
    if (s.robot === 'approach' && age + EPS >= d.approachTime) this.robot('inspect');
    else if (s.robot === 'inspect' && age + EPS >= c.inspectionTime) {
      if (s.active) {
        s.active.inspected = true;
        s.active.quality = c.inspectionTime + EPS >= d.minimumInspection ? 'good' : 'reject';
        if (s.active.quality === 'reject')
          this.event(
            'INSPECTION_SHORT',
            '検品時間が必要露光時間1.20秒未満。ワークはNGです。',
            'warning',
          );
      }
      this.doneAt = s.time;
      this.event('PROCESS_DONE', 'ロボット検品完了。PROCESS_DONEを出力し、退避を開始。');
      this.robot('retreat');
    } else if (s.robot === 'retreat' && age + EPS >= d.retreatTime) {
      this.robot('home');
      this.event('ROBOT_HOME', 'ロボット退避完了。ROBOT_HOMEがON。');
    }
    s.signals.robotBusy = s.robot !== 'home';
    s.signals.robotHome = s.robot === 'home';
    s.signals.processDone =
      !s.inputs.dropDone &&
      this.doneAt !== null &&
      (c.doneMode === 'latched'
        ? s.signals.robotRequest
        : s.time - this.doneAt < c.donePulse - EPS);
    if (s.signals.robotBusy) s.robotBusyTime += LINE_STEP;
  }
  private scanPLC() {
    lineControllers[this.definition.controller]({
      state: this.s,
      config: this.config,
      transition: (phase) => this.phase(phase),
      fail: (code, message, cause, remedy) => this.fail(code, message, cause, remedy),
    });
  }
  private recordSignals() {
    const key = JSON.stringify(this.s.signals);
    if (key !== this.previousSignals || this.tick % 10 === 0 || this.finished) {
      this.s.history.push({ at: this.s.time, ...this.s.signals });
      this.previousSignals = key;
      if (this.s.history.length > 1200) this.s.history.shift();
    }
  }
  private step() {
    const { s, config: c, definition: d } = this;
    s.status = 'RUNNING';
    s.time = ++this.tick * LINE_STEP;
    if (s.generated < c.batchSize && s.time + EPS >= this.nextFeed) {
      // The upstream source follows its own schedule; it cannot wait for buffer space.
      if (s.queue.length >= d.inputCapacity) {
        this.fail(
          'INPUT_OVERFLOW',
          '供給過多で搬入バッファがあふれました',
          `ワーク #${String(s.generated + 1).padStart(2, '0')} が到着しましたが、搬入バッファは ${s.queue.length}/${d.inputCapacity} 個で満杯です。供給間隔 ${c.feedInterval.toFixed(2)} 秒に対して検品側の引き取りが追いついていません。`,
          'ワーク供給間隔を長くするか、搬送・工程時間を短縮して、次の到着までにバッファの空きを確保してください。',
        );
        this.recordSignals();
        return;
      }
      s.queue.push({
        id: ++s.generated,
        x: d.entryX,
        createdAt: s.time,
        enteredAt: s.time,
        inspected: false,
        quality: 'pending',
      });
      this.nextFeed = s.time + c.feedInterval;
      this.event(
        'PART_FEED',
        `ワーク #${String(s.generated).padStart(2, '0')} を搬入バッファへ供給`,
      );
      if (s.queue.length === d.inputCapacity)
        this.event(
          'INPUT_BUFFER_FULL',
          `搬入バッファ満杯（${d.inputCapacity}/${d.inputCapacity}）。次の到着までに空きがなければ、あふれで停止します。`,
          'warning',
        );
    }
    this.updateOutput();
    this.updateTransport();
    if (this.finished) {
      this.recordSignals();
      return;
    }
    this.updateSensor();
    this.updateRobot();
    if (this.finished) {
      this.recordSignals();
      return;
    }
    if (s.time + EPS >= this.nextScan) {
      this.scanPLC();
      this.nextScan = s.time + c.plcScan;
    }
    if (this.finished) {
      this.recordSignals();
      return;
    }
    const blocked =
      !s.signals.downstreamReady &&
      (s.phase === 'releasing' || s.phase === 'unloading' || s.inputs.outputBlocked);
    if (blocked) {
      this.blockedSince ??= s.time;
      s.downstreamWait += LINE_STEP;
      if (s.time - this.blockedSince + EPS >= c.jamTimeout)
        this.fail(
          'DOWNSTREAM_JAM',
          '搬出バッファが満杯になりライン停止',
          '下流の受入許可が戻らず、詰まり監視時間を超えました。',
          '搬出閉塞を解除するか、搬出速度・供給間隔を調整してください。',
        );
    } else this.blockedSince = null;
    if (!this.finished && s.completed === c.batchSize) {
      s.status = s.rejected ? 'NG' : 'OK';
      s.signals.motorRun = false;
      this.event('BATCH_COMPLETE', `生産完了: 良品 ${s.good} / NG ${s.rejected}`);
    }
    if (!this.finished && s.time + EPS >= c.timeLimit) {
      s.status = 'UNVERIFIED';
      s.signals.motorRun = false;
      this.event('TIME_LIMIT', '検証時間上限に到達。全数搬出を確認できていません。', 'warning');
    }
    this.recordSignals();
  }
}

export function summarizeLine(s: LineState, c: LineConfig): LineSummary {
  const times = s.completionTimes;
  return {
    completed: s.completed,
    good: s.good,
    rejected: s.rejected,
    elapsed: s.time,
    throughput: s.time ? (s.good / s.time) * 3600 : 0,
    robotUtilization: s.time ? (s.robotBusyTime / s.time) * 100 : 0,
    averageCycle: times.length > 1 ? (times.at(-1)! - times[0]) / (times.length - 1) : null,
    downstreamWait: s.downstreamWait,
    challengePassed:
      s.status === 'OK' && c.batchSize === 12 && s.time <= lineDefinitions[c.lineId].targetSeconds,
  };
}
export function simulateLine(config: LineConfig): LineResult {
  const engine = new LineSimulator(config);
  engine.advance(config.timeLimit + LINE_STEP);
  return engine.result();
}
export function lineEventsCSV(result: LineResult): string {
  const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
  return [
    'time_s,level,code,message',
    ...result.state.events.map(
      (e) => `${e.at.toFixed(2)},${e.level},${e.code},${quote(e.message)}`,
    ),
  ].join('\n');
}
