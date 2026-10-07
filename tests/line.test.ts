import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultLineConfig,
  inspectionLine,
  presetConfig,
  validateLineConfig,
} from '../src/core/line/config';
import { LineSimulator, simulateLine } from '../src/core/line/engine';
import type { LineConfig } from '../src/core/line/types';

const run = (patch: Partial<LineConfig> = {}) =>
  simulateLine({ ...structuredClone(defaultLineConfig), ...patch });
test('standard batch completes only after every inspected part exits downstream', () => {
  const r = run();
  assert.equal(r.status, 'OK');
  assert.equal(r.summary.good, 12);
  assert.equal(r.state.generated, 12);
  assert.equal(r.state.active, null);
  assert.equal(r.state.queue.length + r.state.output.length, 0);
  assert.equal(r.state.events.filter((e) => e.code === 'PART_EXIT').length, 12);
  assert.equal(r.state.events.filter((e) => e.code === 'DONE_RECEIVED').length, 12);
  assert.ok(r.summary.elapsed > 110);
});
test('replay speed and advance chunk sizes do not change the plant or PLC result', () => {
  const config = presetConfig('optimized');
  const fast = simulateLine(config);
  const slow = new LineSimulator(config);
  while (!slow.finished) slow.advance(0.017);
  assert.deepEqual(slow.result(), fast);
  assert.equal(fast.status, 'OK');
  assert.equal(fast.summary.challengePassed, true);
  assert.ok(fast.summary.elapsed < run().summary.elapsed);
});
test('a scheduled arrival into a full infeed faults instead of silently delaying supply', () => {
  const engine = new LineSimulator(presetConfig('overfeed'));
  engine.advance(15.01);
  const full = engine.snapshot();
  assert.equal(full.status, 'RUNNING');
  assert.equal(full.queue.length, inspectionLine.inputCapacity);
  assert.equal(full.generated, 6);
  assert.ok(full.events.some((e) => e.code === 'INPUT_BUFFER_FULL'));
  assert.deepEqual(
    full.events.filter((e) => e.code === 'PART_FEED').map((e) => Math.round(e.at * 100)),
    [1, 301, 601, 901, 1201, 1501],
  );
  engine.advance(2.99);
  assert.equal(engine.snapshot().status, 'RUNNING');
  engine.advance(0.01);
  const fault = engine.snapshot();
  assert.equal(fault.status, 'NG');
  assert.equal(fault.fault?.code, 'INPUT_OVERFLOW');
  assert.equal(fault.time, 18.01);
  assert.equal(fault.queue.length, inspectionLine.inputCapacity);
  assert.equal(fault.generated, 6);
  assert.equal(fault.signals.motorRun, false);
  assert.equal(fault.signals.robotRequest, false);
  engine.advance(100);
  assert.deepEqual(engine.snapshot(), fault);
  assert.deepEqual(engine.result(), simulateLine(presetConfig('overfeed')));
  assert.equal(run({ feedInterval: 10 }).status, 'OK');
});
test('a full infeed can drain when no additional work is scheduled', () => {
  const r = run({ feedInterval: 3, batchSize: 6 });
  assert.ok(r.state.events.some((e) => e.code === 'INPUT_BUFFER_FULL'));
  assert.equal(r.status, 'OK');
  assert.equal(r.summary.good, 6);
  assert.equal(r.state.queue.length, 0);
});
test('PLC wait before robot request includes deceleration and physical settling', () => {
  const moving = run({ stopWait: 0.08 });
  assert.equal(moving.state.fault?.code, 'CLAMP_WHILE_MOVING');
  assert.ok(moving.state.velocity > 0);
  const vibration = run({ stopWait: 0.55 });
  assert.equal(vibration.state.fault?.code, 'UNSETTLED_PART');
  assert.equal(vibration.state.velocity, 0);
});
test('inspection completion is distinct from robot-home and the interlock prevents interference', () => {
  const unsafe = simulateLine(presetConfig('race'));
  assert.equal(unsafe.state.fault?.code, 'ROBOT_INTERFERENCE');
  assert.equal(unsafe.state.robot, 'retreat');
  const safe = run({ releaseWait: 0, requireRobotHome: true });
  assert.equal(safe.status, 'OK');
  assert.ok(safe.summary.elapsed < run().summary.elapsed);
});
test('short completion pulses can be missed between PLC scans; held signal is acknowledged', () => {
  const pulse = simulateLine(presetConfig('pulse'));
  assert.equal(pulse.state.fault?.code, 'DONE_TIMEOUT');
  assert.equal(pulse.state.robot, 'home');
  assert.ok(pulse.state.history.some((s) => s.processDone));
  assert.equal(
    pulse.state.events.some((e) => e.code === 'DONE_RECEIVED'),
    false,
  );
  const held = run({ plcScan: 0.2, doneMode: 'latched' });
  assert.equal(held.status, 'OK');
});
test('short inspection time produces rejected work instead of a falsely successful faster batch', () => {
  const r = run({ inspectionTime: 0.4 });
  assert.equal(r.status, 'NG');
  assert.equal(r.summary.completed, 12);
  assert.equal(r.summary.good, 0);
  assert.equal(r.summary.rejected, 12);
  assert.equal(r.summary.challengePassed, false);
});
test('sensor faults and stopping distance produce different physical failures', () => {
  assert.equal(
    run({ faults: { ...defaultLineConfig.faults, positionSensor: 'off' } }).state.fault?.code,
    'POSITION_OVERRUN',
  );
  assert.equal(
    run({ faults: { ...defaultLineConfig.faults, positionSensor: 'on' } }).state.fault?.code,
    'POSITION_MISMATCH',
  );
  assert.equal(run({ conveyorSpeed: 1000 }).state.fault?.code, 'POSITION_OVERRUN');
  assert.equal(
    run({ faults: { ...defaultLineConfig.faults, dropDone: true } }).state.fault?.code,
    'DONE_TIMEOUT',
  );
});
test('finite accumulation buffers respect capacity and spacing under downstream blockage', () => {
  const engine = new LineSimulator({
    ...structuredClone(defaultLineConfig),
    faults: { ...defaultLineConfig.faults, outputBlocked: true },
  });
  while (!engine.finished) {
    engine.advance(0.1);
    const s = engine.snapshot();
    assert.ok(s.queue.length <= inspectionLine.inputCapacity);
    assert.ok(s.output.length <= inspectionLine.outputCapacity);
    for (let i = 1; i < s.output.length; i++)
      assert.ok(
        s.output[i - 1].x - s.output[i].x >=
          inspectionLine.partLength + inspectionLine.partGap - 1e-8,
      );
  }
  assert.equal(engine.snapshot().fault?.code, 'DOWNSTREAM_JAM');
  assert.equal(engine.snapshot().completed, 0);
});
test('runtime faults can be cleared before watchdog expires; terminal faults remain latched', () => {
  const engine = new LineSimulator(structuredClone(defaultLineConfig));
  engine.setInputs({ outputBlocked: true });
  engine.advance(20);
  assert.equal(engine.finished, false);
  engine.setInputs({ outputBlocked: false });
  engine.advance(220);
  assert.equal(engine.snapshot().status, 'OK');
  const faulted = new LineSimulator(presetConfig('rushed'));
  faulted.advance(20);
  const before = faulted.snapshot();
  faulted.setInputs({ outputBlocked: true });
  faulted.advance(30);
  assert.deepEqual(faulted.snapshot(), before);
});
test('time budget exhaustion stays UNVERIFIED; emergency stop is latched NG', () => {
  const r = run({ timeLimit: 10 });
  assert.equal(r.status, 'UNVERIFIED');
  assert.ok(r.summary.completed < 12);
  const engine = new LineSimulator(structuredClone(defaultLineConfig));
  engine.advance(1);
  engine.emergencyStop();
  engine.advance(100);
  assert.equal(engine.snapshot().fault?.code, 'EMERGENCY_STOP');
  assert.equal(engine.snapshot().time, 1);
});
test('invalid JSON and non-finite values are rejected before simulation', () => {
  for (const patch of [
    { conveyorSpeed: NaN },
    { plcScan: 0 },
    { batchSize: 2.5 },
    { timeLimit: Infinity },
    { faults: null },
    { requireRobotHome: 'false' },
    { version: 2 },
  ]) {
    assert.throws(() => validateLineConfig({ ...defaultLineConfig, ...patch }));
  }
  const engine = new LineSimulator(structuredClone(defaultLineConfig));
  assert.throws(() => engine.advance(Infinity));
  const input = structuredClone(defaultLineConfig);
  const independent = new LineSimulator(input);
  input.conveyorSpeed = 1400;
  assert.equal(independent.config.conveyorSpeed, 300);
});
