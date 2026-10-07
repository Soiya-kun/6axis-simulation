import type { LineConfig, LineDefinition } from './types';

export const inspectionLine: LineDefinition = {
  id: 'inspection-01',
  controller: 'inspection',
  name: '精密パーツ検品ライン',
  description: '搬入 → 位置決め → ロボット検品 → 退避確認 → 搬出',
  inputCapacity: 4,
  outputCapacity: 3,
  entryX: 200,
  sensorX: 1060,
  workMin: 1000,
  workMax: 1260,
  transferX: 1800,
  exitX: 2600,
  partLength: 120,
  partGap: 70,
  approachTime: 0.6,
  retreatTime: 0.65,
  minimumSettle: 0.2,
  minimumInspection: 1.2,
  targetSeconds: 110,
};
/** Register geometry/process requirements here; controller selection lives in engine.ts. */
export const lineDefinitions: Record<LineConfig['lineId'], LineDefinition> = {
  'inspection-01': inspectionLine,
};
export const defaultLineConfig: LineConfig = {
  kind: 'manufacturing-line',
  version: 1,
  lineId: 'inspection-01',
  name: '標準・安定運転',
  batchSize: 12,
  timeLimit: 240,
  feedInterval: 10,
  conveyorSpeed: 300,
  acceleration: 600,
  outputSpeed: 400,
  plcScan: 0.02,
  sensorDelay: 0.04,
  stopWait: 0.85,
  inspectionTime: 1.6,
  releaseWait: 0.8,
  robotTimeout: 6,
  jamTimeout: 12,
  requireRobotHome: true,
  doneMode: 'latched',
  donePulse: 0.1,
  faults: { positionSensor: 'normal', dropDone: false, outputBlocked: false },
};
export const linePresets = [
  {
    id: 'standard',
    title: '安定運転',
    tag: 'BASELINE',
    description: '余裕のある待機時間。まずは信号の流れを観察。',
    patch: {},
  },
  {
    id: 'optimized',
    title: 'タクトを短縮',
    tag: 'CHALLENGE',
    description: '加減速と待機を調整。全数良品で110秒以内を目指す。',
    patch: {
      feedInterval: 7,
      conveyorSpeed: 450,
      acceleration: 1600,
      stopWait: 0.52,
      inspectionTime: 1.2,
      releaseWait: 0,
      outputSpeed: 500,
    },
  },
  {
    id: 'overfeed',
    title: '供給過多',
    tag: 'EXPERIMENT',
    description: '3秒ごとの供給に検品が追いつかず、搬入バッファがあふれる。',
    patch: { feedInterval: 3 },
  },
  {
    id: 'rushed',
    title: '停止待ち不足',
    tag: 'EXPERIMENT',
    description: 'まだ動いているワークにロボットが進入すると？',
    patch: { stopWait: 0.08 },
  },
  {
    id: 'race',
    title: '退避の競合',
    tag: 'EXPERIMENT',
    description: '退避インターロックを外し、完了直後に搬送。',
    patch: { releaseWait: 0, requireRobotHome: false },
  },
  {
    id: 'pulse',
    title: '信号を見逃す',
    tag: 'EXPERIMENT',
    description: 'PLCより短い完了パルス。受信できるか確かめる。',
    patch: { plcScan: 0.2, doneMode: 'pulse', donePulse: 0.01 },
  },
] satisfies {
  id: string;
  title: string;
  tag: string;
  description: string;
  patch: Partial<LineConfig>;
}[];

export function presetConfig(id: string): LineConfig {
  const preset = linePresets.find((item) => item.id === id);
  if (!preset) throw new Error('不明なプリセットです');
  return { ...structuredClone(defaultLineConfig), ...preset.patch, name: preset.title };
}
export const lineFields = [
  {
    key: 'conveyorSpeed',
    label: '検品コンベア速度',
    unit: 'mm/s',
    min: 50,
    max: 1500,
    step: 10,
    group: 'transport',
  },
  {
    key: 'acceleration',
    label: '加速度・減速度',
    unit: 'mm/s²',
    min: 100,
    max: 5000,
    step: 100,
    group: 'transport',
  },
  {
    key: 'feedInterval',
    label: 'ワーク供給間隔',
    unit: 's',
    min: 0.2,
    max: 30,
    step: 0.1,
    group: 'transport',
  },
  {
    key: 'outputSpeed',
    label: '搬出コンベア速度',
    unit: 'mm/s',
    min: 50,
    max: 1500,
    step: 10,
    group: 'transport',
  },
  {
    key: 'stopWait',
    label: '停止後の開始待ち',
    unit: 's',
    min: 0,
    max: 5,
    step: 0.01,
    group: 'timing',
  },
  {
    key: 'inspectionTime',
    label: '検品時間',
    unit: 's',
    min: 0.05,
    max: 10,
    step: 0.05,
    group: 'timing',
  },
  {
    key: 'releaseWait',
    label: '完了後の搬送待ち',
    unit: 's',
    min: 0,
    max: 5,
    step: 0.01,
    group: 'timing',
  },
  {
    key: 'plcScan',
    label: 'PLCスキャン周期',
    unit: 's',
    min: 0.01,
    max: 0.5,
    step: 0.01,
    group: 'signals',
  },
  {
    key: 'sensorDelay',
    label: 'センサー応答遅延',
    unit: 's',
    min: 0,
    max: 1,
    step: 0.01,
    group: 'signals',
  },
  {
    key: 'robotTimeout',
    label: '完了信号タイムアウト',
    unit: 's',
    min: 0.2,
    max: 30,
    step: 0.1,
    group: 'signals',
  },
  {
    key: 'jamTimeout',
    label: '搬出詰まりタイムアウト',
    unit: 's',
    min: 1,
    max: 60,
    step: 1,
    group: 'signals',
  },
  {
    key: 'donePulse',
    label: '完了パルス幅',
    unit: 's',
    min: 0.01,
    max: 1,
    step: 0.01,
    group: 'signals',
  },
  { key: 'batchSize', label: '生産数', unit: '個', min: 1, max: 100, step: 1, group: 'batch' },
  {
    key: 'timeLimit',
    label: '検証時間上限',
    unit: 's',
    min: 10,
    max: 1800,
    step: 10,
    group: 'batch',
  },
] as const;

export function validateLineConfig(value: unknown): asserts value is LineConfig {
  if (!value || typeof value !== 'object')
    throw new Error('ライン設定はJSONオブジェクトで指定してください');
  const c = value as Record<string, unknown>;
  if (c.kind !== 'manufacturing-line' || c.version !== 1 || c.lineId !== 'inspection-01')
    throw new Error('未対応のライン設定形式・バージョン・ラインIDです');
  if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 100)
    throw new Error('設定名は1〜100文字で指定してください');
  for (const f of lineFields) {
    const v = c[f.key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < f.min || v > f.max)
      throw new Error(`${f.label}は${f.min}〜${f.max} ${f.unit}で指定してください`);
    if (f.key === 'batchSize' && !Number.isInteger(v))
      throw new Error('生産数は整数で指定してください');
  }
  if (
    typeof c.requireRobotHome !== 'boolean' ||
    !['latched', 'pulse'].includes(c.doneMode as string)
  )
    throw new Error('インターロック・完了信号の設定が不正です');
  const faults = c.faults as Record<string, unknown> | undefined;
  if (
    !faults ||
    !['normal', 'off', 'on'].includes(faults.positionSensor as string) ||
    typeof faults.dropDone !== 'boolean' ||
    typeof faults.outputBlocked !== 'boolean'
  )
    throw new Error('故障入力の設定が不正です');
}
