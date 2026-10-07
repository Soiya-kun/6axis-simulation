import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Factory,
  FlaskConical,
  Gauge,
  Layers3,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  SlidersHorizontal,
  Square,
  Trophy,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  defaultLineConfig,
  inspectionLine,
  lineFields,
  linePresets,
  presetConfig,
  validateLineConfig,
} from '../core/line/config';
import { LineSimulator, summarizeLine } from '../core/line/engine';
import type { FaultInputs, LineConfig, LineResult, LineState } from '../core/line/types';
import { StudioNav } from '../StudioNav';
import { LineScene, SignalTrace, signalLabels } from './LineScene';
import './line.css';

const storageKey = 'axis-studio.line.v1';
const statusLabels = {
  READY: '開始待ち',
  RUNNING: '稼働中',
  OK: '全数良品で完了',
  NG: 'NG / 要調整',
  UNVERIFIED: '未完了 / 時間上限',
};
function savedConfig(): LineConfig {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    validateLineConfig(data);
    return data;
  } catch {
    return structuredClone(defaultLineConfig);
  }
}
function saveFile(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function validationError(config: LineConfig) {
  try {
    validateLineConfig(config);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
}
const fmt = (n: number | null, digits = 1) => (n === null ? '—' : n.toFixed(digits));

export function LineStudio() {
  const [config, setConfig] = useState<LineConfig>(savedConfig);
  const engine = useRef<LineSimulator | null>(null);
  if (!engine.current) engine.current = new LineSimulator(config);
  const [state, setState] = useState<LineState>(() => engine.current!.snapshot());
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [settingTab, setSettingTab] = useState<'parameters' | 'presets'>('parameters');
  const [lowerTab, setLowerTab] = useState<'signals' | 'log'>('signals');
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const [testing, setTesting] = useState(false);
  const [trials, setTrials] = useState<LineResult[]>([]);
  const [notice, setNotice] = useState('');
  const worker = useRef<Worker | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(config) !== JSON.stringify(engine.current.config);
  const invalid = validationError(config);
  const summary = summarizeLine(state, engine.current.config);
  const currentConfig = engine.current.config;
  const terminal = ['OK', 'NG', 'UNVERIFIED'].includes(state.status);
  const latestTrial = trials[0];
  const trialCurrent = latestTrial && JSON.stringify(latestTrial.config) === JSON.stringify(config);

  useEffect(() => {
    if (!invalid) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(config));
      } catch {
        /* Storage is optional. */
      }
    }
  }, [config, invalid]);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (!running) return;
    let id = 0,
      previous = performance.now(),
      lastPaint = previous;
    const frame = (now: number) => {
      // Hidden/background tabs pause, instead of simulating a large unobserved catch-up.
      // An effect can start after this frame's RAF timestamp was sampled.
      const delta = Math.max(0, Math.min((now - previous) / 1000, 0.1));
      previous = now;
      if (!document.hidden) engine.current!.advance(delta * speed);
      if (now - lastPaint >= 40 || engine.current!.finished) {
        setState(engine.current!.snapshot());
        lastPaint = now;
      }
      if (engine.current!.finished) {
        setRunning(false);
        return;
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [running, speed]);
  useEffect(() => {
    if (!help) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHelp(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [help]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  function cancelTest() {
    worker.current?.terminate();
    worker.current = null;
    setTesting(false);
  }
  function edit(patch: Partial<LineConfig>) {
    setRunning(false);
    cancelTest();
    setError('');
    setState(engine.current!.snapshot());
    setConfig((prev) => ({ ...prev, ...patch }));
  }
  function reset(next = config) {
    setRunning(false);
    cancelTest();
    setError('');
    try {
      engine.current = new LineSimulator(next);
      setState(engine.current.snapshot());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  function play() {
    if (running) {
      setRunning(false);
      setState(engine.current!.snapshot());
      return;
    }
    if ((dirty || terminal) && !reset()) return;
    setRunning(true);
  }
  function singleStep() {
    if (dirty && !reset()) return;
    engine.current!.advanceScan();
    setState(engine.current!.snapshot());
  }
  function fastTest() {
    setRunning(false);
    setState(engine.current!.snapshot());
    setError('');
    if (invalid) {
      setError(invalid);
      return;
    }
    cancelTest();
    const w = new Worker(new URL('../line.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setTesting(true);
    w.onmessage = (e) => {
      if (worker.current !== w) return;
      if (e.data.type === 'result')
        setTrials((prev) => [e.data.result as LineResult, ...prev].slice(0, 5));
      else setError(e.data.message);
      cancelTest();
    };
    w.onerror = (e) => {
      if (worker.current === w) {
        setError(e.message || '検証に失敗しました');
        cancelTest();
      }
    };
    w.postMessage(config);
  }
  function inject(patch: Partial<FaultInputs>) {
    engine.current!.setInputs(patch);
    setState(engine.current!.snapshot());
  }
  async function importFile(input: File) {
    try {
      if (input.size > 2_000_000) throw new Error('2MB以下のJSONを選択してください');
      const parsed = JSON.parse(await input.text()),
        next = parsed?.config ?? parsed;
      validateLineConfig(next);
      setConfig(next);
      reset(next);
      setNotice('ライン設定を読み込みました');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function field(key: (typeof lineFields)[number]['key']) {
    const f = lineFields.find((v) => v.key === key)!;
    return (
      <label className="line-field" key={key}>
        <span>{f.label}</span>
        <div>
          <input
            aria-label={f.label}
            type="number"
            value={Number.isFinite(config[key]) ? config[key] : ''}
            min={f.min}
            max={f.max}
            step={f.step}
            onChange={(e) => edit({ [key]: e.target.valueAsNumber })}
          />
          <small>{f.unit}</small>
        </div>
      </label>
    );
  }

  return (
    <div className="line-app">
      <header className="topbar">
        <a className="brand" href="#line" aria-label="AXIS Studio">
          <Factory className="brand-icon" size={30} />
          <b>
            AXIS<span>STUDIO</span>
          </b>
        </a>
        <div className="top-divider" />
        <StudioNav active="line" />
        <span className="local-badge">
          <i />
          LOCAL WORKSPACE
        </span>
        <button className="icon-button" aria-label="ラインの使い方" onClick={() => setHelp(true)}>
          <CircleHelp size={18} />
        </button>
      </header>
      <main className="line-main">
        <div className="line-heading">
          <div>
            <div className="eyebrow">MANUFACTURING / CONTROL LAB</div>
            <h1>
              製造ラインシミュレーション <span>LINE 01</span>
            </h1>
            <p>信号をつなぎ、待ち時間を調整。止まらないラインをつくろう。</p>
          </div>
          <div className="line-heading-actions">
            <input
              ref={file}
              hidden
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const input = e.target.files?.[0];
                if (input) void importFile(input);
                e.target.value = '';
              }}
            />
            <button className="button secondary" onClick={() => file.current?.click()}>
              <Upload size={14} />
              読み込み
            </button>
            <button
              className="button secondary"
              disabled={!!invalid}
              onClick={() => saveFile('line-config.json', config)}
            >
              <ArrowDownToLine size={14} />
              設定を保存
            </button>
            <button className="button primary" disabled={!!invalid || testing} onClick={fastTest}>
              {testing ? <LoaderCircle size={15} className="spin" /> : <FlaskConical size={15} />}
              一括検証
            </button>
          </div>
        </div>
        {(error || invalid) && (
          <div className="line-error" role="alert">
            {error || invalid}
          </div>
        )}
        <div className="line-layout">
          <aside className="line-settings line-card">
            <div className="line-card-heading">
              <SlidersHorizontal size={15} />
              <b>ライン設定</b>
              <span>RECIPE</span>
            </div>
            <div className="line-tabs" role="tablist" aria-label="ライン設定カテゴリ">
              <button
                role="tab"
                aria-selected={settingTab === 'parameters'}
                onClick={() => setSettingTab('parameters')}
              >
                パラメーター
              </button>
              <button
                role="tab"
                aria-selected={settingTab === 'presets'}
                onClick={() => setSettingTab('presets')}
              >
                実験プリセット
              </button>
            </div>
            {settingTab === 'presets' ? (
              <div className="line-presets">
                <p>設定を読み込んで「一括検証」。結果を比較して、止まった原因を探しましょう。</p>
                {linePresets.map((p, i) => (
                  <button
                    key={p.id}
                    className={`line-preset ${config.name === p.title ? 'selected' : ''}`}
                    onClick={() => {
                      const next = presetConfig(p.id);
                      setConfig(next);
                      reset(next);
                    }}
                  >
                    <span className="line-preset-index">0{i + 1}</span>
                    <div>
                      <small>{p.tag}</small>
                      <strong>{p.title}</strong>
                      <p>{p.description}</p>
                    </div>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="line-parameters">
                <section>
                  <label className="line-recipe-name">
                    設定名
                    <input
                      aria-label="ライン設定名"
                      value={config.name}
                      maxLength={100}
                      onChange={(e) => edit({ name: e.target.value })}
                    />
                  </label>
                  <h3>
                    <span>01</span>搬送条件 <Layers3 size={13} />
                  </h3>
                  {field('conveyorSpeed')}
                  {field('acceleration')}
                  {field('feedInterval')}
                  {field('outputSpeed')}
                  <div className="line-tip">
                    搬入は最大4個。満杯でも供給は止まらず、次のワークが到着するとあふれで停止します。
                  </div>
                </section>
                <section>
                  <h3>
                    <span>02</span>工程タイミング <Clock3 size={13} />
                  </h3>
                  {field('stopWait')}
                  {field('inspectionTime')}
                  {field('releaseWait')}
                  <div className="line-tip">
                    停止命令 → 制動 → 安定（0.20 s）
                    <br />
                    検品には1.20 s、退避には0.65 s必要です。
                  </div>
                  <label className="line-switch">
                    <input
                      type="checkbox"
                      checked={config.requireRobotHome}
                      onChange={(e) => edit({ requireRobotHome: e.target.checked })}
                    />
                    <span>
                      退避確認インターロック<small>ROBOT_HOMEを確認して搬送を許可</small>
                    </span>
                    <ShieldCheck size={16} />
                  </label>
                </section>
                <details>
                  <summary>
                    <span>03</span>PLC・信号・監視 <ChevronRight size={13} />
                  </summary>
                  {field('plcScan')}
                  {field('sensorDelay')}
                  <label className="line-select-field">
                    完了信号の方式
                    <select
                      aria-label="完了信号の方式"
                      value={config.doneMode}
                      onChange={(e) => edit({ doneMode: e.target.value as LineConfig['doneMode'] })}
                    >
                      <option value="latched">保持式（受信までON）</option>
                      <option value="pulse">パルス式</option>
                    </select>
                  </label>
                  {config.doneMode === 'pulse' && field('donePulse')}
                  {field('robotTimeout')}
                  {field('jamTimeout')}
                </details>
                <details>
                  <summary>
                    <span>04</span>生産計画・初期故障 <ChevronRight size={13} />
                  </summary>
                  {field('batchSize')}
                  {field('timeLimit')}
                  <label className="line-select-field">
                    位置センサー
                    <select
                      aria-label="初期位置センサー"
                      value={config.faults.positionSensor}
                      onChange={(e) =>
                        edit({
                          faults: {
                            ...config.faults,
                            positionSensor: e.target.value as FaultInputs['positionSensor'],
                          },
                        })
                      }
                    >
                      <option value="normal">正常</option>
                      <option value="off">OFF固着</option>
                      <option value="on">ON固着</option>
                    </select>
                  </label>
                  <label className="line-check">
                    <input
                      type="checkbox"
                      checked={config.faults.dropDone}
                      onChange={(e) =>
                        edit({ faults: { ...config.faults, dropDone: e.target.checked } })
                      }
                    />
                    完了信号を遮断
                  </label>
                  <label className="line-check">
                    <input
                      type="checkbox"
                      checked={config.faults.outputBlocked}
                      onChange={(e) =>
                        edit({ faults: { ...config.faults, outputBlocked: e.target.checked } })
                      }
                    />
                    搬出を閉塞
                  </label>
                </details>
              </div>
            )}
            <div className="line-settings-footer">
              <span>
                <i />
                {dirty ? '変更あり · 開始時に反映' : '設定反映済み'}
              </span>
              <button
                onClick={() => {
                  const next = presetConfig('standard');
                  setConfig(next);
                  reset(next);
                }}
              >
                標準に戻す
              </button>
            </div>
          </aside>

          <div className="line-center">
            <section className="line-scene-card line-card">
              <div className="line-card-heading">
                <span className="line-cell-icon">
                  <Factory size={15} />
                </span>
                <b>{inspectionLine.name}</b>
                <span
                  className={`line-status status-${state.status.toLowerCase()}`}
                  data-testid="line-status"
                >
                  <i />
                  {state.status === 'RUNNING' && !running ? '一時停止' : statusLabels[state.status]}
                </span>
              </div>
              <div className="line-scene-meta">
                <span>
                  <i className="legend-input" />
                  未検品 <i className="legend-good" />
                  良品 <i className="legend-arm" />
                  ロボット
                </span>
                <span>
                  2D DIGITAL TWIN <span className="line-live-dot" /> {running ? 'LIVE' : 'STANDBY'}
                </span>
              </div>
              <div className="line-scene-scroll">
                <LineScene state={state} config={currentConfig} running={running} />
              </div>
              <div className="line-pan-hint">
                横にスワイプしてライン全体を確認 <ArrowRight size={10} />
              </div>
              <div className="line-sequence" aria-label="制御シーケンス">
                {(
                  [
                    'feeding',
                    'positioning',
                    'settling',
                    'working',
                    'releasing',
                    'unloading',
                  ] as const
                ).map((p, i) => (
                  <div key={p} className={state.phase === p ? 'active' : ''}>
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    {['搬入', '位置決め', '停止待ち', '検品', '退避確認', '搬出'][i]}
                    {i < 5 && <ChevronRight size={11} />}
                  </div>
                ))}
              </div>
              {dirty && (
                <div className="line-dirty" role="status">
                  設定が変更されています。開始・ステップで新しい設定を反映し、先頭から実行します。
                </div>
              )}
              <div className="line-transport">
                <div className="line-play-buttons">
                  <button
                    className="line-play"
                    aria-label={
                      running ? 'ラインを一時停止' : terminal ? 'ラインを再実行' : 'ラインを開始'
                    }
                    disabled={!!invalid || testing}
                    onClick={play}
                  >
                    {running ? (
                      <Pause size={17} fill="currentColor" />
                    ) : (
                      <Play size={17} fill="currentColor" />
                    )}
                  </button>
                  <button
                    aria-label="ラインをリセット"
                    title="現在の設定でリセット"
                    onClick={() => reset()}
                    disabled={!!invalid}
                  >
                    <RotateCcw size={17} />
                  </button>
                  <button
                    aria-label="1スキャン進める"
                    title="1スキャン進める"
                    disabled={running || (terminal && !dirty) || !!invalid || testing}
                    onClick={singleStep}
                  >
                    <SkipForward size={17} />
                  </button>
                </div>
                <div className="line-clock">
                  <b data-testid="line-clock">
                    {state.time.toFixed(2)}
                    <small>s</small>
                  </b>
                  <span>/ {currentConfig.timeLimit} s</span>
                </div>
                <label className="line-speed">
                  再生速度
                  <select
                    aria-label="ライン再生速度"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                  >
                    {[0.5, 1, 2, 5, 10].map((n) => (
                      <option key={n} value={n}>
                        {n}×
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="line-emergency"
                  disabled={terminal || state.time === 0}
                  onClick={() => {
                    setRunning(false);
                    engine.current!.emergencyStop();
                    setState(engine.current!.snapshot());
                  }}
                >
                  <Square size={12} fill="currentColor" />
                  非常停止
                </button>
              </div>
            </section>

            <div className="line-metrics">
              <div>
                <span>
                  <Layers3 size={13} />
                  良品 / 計画
                </span>
                <strong>
                  {state.good}
                  <small>/ {currentConfig.batchSize} 個</small>
                </strong>
                <div className="line-mini-progress">
                  <i style={{ width: `${(state.good / currentConfig.batchSize) * 100}%` }} />
                </div>
              </div>
              <div>
                <span>
                  <Clock3 size={13} />
                  平均排出タクト
                </span>
                <strong>
                  {fmt(summary.averageCycle, 2)}
                  <small>s / 個</small>
                </strong>
                <p>搬出間隔の平均</p>
              </div>
              <div>
                <span>
                  <Gauge size={13} />
                  実績生産性
                </span>
                <strong>
                  {fmt(summary.throughput, 0)}
                  <small>個 / h</small>
                </strong>
                <p>立上げ時間を含む良品数</p>
              </div>
              <div>
                <span>
                  <Activity size={13} />
                  ロボット稼働率
                </span>
                <strong>
                  {fmt(summary.robotUtilization, 0)}
                  <small>%</small>
                </strong>
                <p>
                  不良 {state.rejected} 個 · 下流待ち {fmt(state.downstreamWait)} s
                </p>
              </div>
            </div>

            <section className="line-card line-diagnostics">
              <div className="line-diagnostics-heading">
                <div className="line-tabs" role="tablist" aria-label="ライン監視">
                  <button
                    role="tab"
                    aria-selected={lowerTab === 'signals'}
                    onClick={() => setLowerTab('signals')}
                  >
                    <Activity size={14} />
                    信号タイミング
                  </button>
                  <button
                    role="tab"
                    aria-selected={lowerTab === 'log'}
                    onClick={() => setLowerTab('log')}
                  >
                    イベントログ <small>{state.events.length}</small>
                  </button>
                </div>
                <span>{lowerTab === 'signals' ? '直近16秒 · HIGH / LOW' : '新しいイベント順'}</span>
              </div>
              {lowerTab === 'signals' ? (
                <div className="line-trace-scroll">
                  <SignalTrace state={state} />
                </div>
              ) : (
                <div className="line-event-log" aria-label="イベントログ">
                  {state.events
                    .slice(-50)
                    .reverse()
                    .map((e, i) => (
                      <div key={`${e.at}-${i}`} className={`event-${e.level}`}>
                        <time>{e.at.toFixed(2)} s</time>
                        <code>{e.code}</code>
                        <span>{e.message}</span>
                      </div>
                    ))}
                </div>
              )}
            </section>
          </div>

          <aside className="line-right">
            <section className="line-challenge">
              <div>
                <Trophy size={17} />
                <span>MISSION 01</span>
                <small>{summary.challengePassed ? 'CLEAR' : 'CHALLENGE'}</small>
              </div>
              <h2>速く、正確に、止めずに。</h2>
              <p>
                12個すべてを良品で搬出。
                <br />
                <strong>110秒以内</strong>の完走を目指そう。
              </p>
              <div className="line-challenge-progress">
                <span>良品 {state.good} / 12</span>
                <b>{Math.min(100, (state.good / 12) * 100).toFixed(0)}%</b>
              </div>
              <div className="line-mini-progress">
                <i style={{ width: `${Math.min(100, (state.good / 12) * 100)}%` }} />
              </div>
              <button
                onClick={() => {
                  setSettingTab('presets');
                }}
              >
                プリセットで実験する <ArrowRight size={13} />
              </button>
            </section>
            <section className="line-card line-io">
              <div className="line-card-heading">
                <Zap size={14} />
                <b>PLC I/O モニター</b>
                <span>{(currentConfig.plcScan * 1000).toFixed(0)} ms</span>
              </div>
              {signalLabels.map((sig) => (
                <div className="line-io-row" key={sig.key}>
                  <code>{sig.address}</code>
                  <span>{sig.label}</span>
                  <b className={state.signals[sig.key] ? 'on' : ''}>
                    <i />
                    {state.signals[sig.key] ? 'ON' : 'OFF'}
                  </b>
                </div>
              ))}
            </section>
            <section className="line-card line-fault-controls">
              <div className="line-card-heading">
                <FlaskConical size={15} />
                <b>故障を試す</b>
                <span>LIVE</span>
              </div>
              <p>
                実行中にも切り替え可能。
                <br />
                リセットすると初期故障設定に戻ります。
              </p>
              <label className="line-select-field">
                位置センサー
                <select
                  aria-label="実行中の位置センサー"
                  disabled={terminal || dirty}
                  value={state.inputs.positionSensor}
                  onChange={(e) =>
                    inject({ positionSensor: e.target.value as FaultInputs['positionSensor'] })
                  }
                >
                  <option value="normal">正常</option>
                  <option value="off">OFF固着</option>
                  <option value="on">ON固着</option>
                </select>
              </label>
              <button
                disabled={terminal || dirty}
                aria-pressed={state.inputs.outputBlocked}
                onClick={() => inject({ outputBlocked: !state.inputs.outputBlocked })}
              >
                <span className={state.inputs.outputBlocked ? 'injected' : ''} />
                {state.inputs.outputBlocked ? '搬出閉塞を解除' : '搬出を閉塞する'}
              </button>
              <button
                disabled={terminal || dirty}
                aria-pressed={state.inputs.dropDone}
                onClick={() => inject({ dropDone: !state.inputs.dropDone })}
              >
                <span className={state.inputs.dropDone ? 'injected' : ''} />
                {state.inputs.dropDone ? '完了信号を復旧' : '完了信号を遮断'}
              </button>
            </section>
          </aside>
        </div>

        {(state.fault || terminal) && (
          <section className={`line-result-banner ${state.status.toLowerCase()}`} role="status">
            <div>
              <strong>
                {state.fault
                  ? `${state.fault.code} · ${state.fault.message}`
                  : statusLabels[state.status]}
              </strong>
              <p>
                {state.fault?.cause ??
                  (state.status === 'OK'
                    ? `${state.good}個を${fmt(state.time, 2)}秒で搬出しました。${summary.challengePassed ? 'ミッションクリア！' : '待機と搬送条件を調整して、さらにタクトを短縮できます。'}`
                    : state.status === 'NG'
                      ? `検品不足のワークが${state.rejected}個あります。検品時間は1.20秒以上必要です。`
                      : '検証時間内に全数搬出できませんでした。イベントとI/Oを確認してください。')}
              </p>
              {state.fault && <p className="line-remedy">調整のヒント：{state.fault.remedy}</p>}
            </div>
            <button
              className="button secondary"
              onClick={() => saveFile('line-run-result.json', engine.current!.result())}
            >
              <ArrowDownToLine size={14} />
              実行結果を保存
            </button>
          </section>
        )}

        <section className="line-card line-trials">
          <div className="line-card-heading">
            <FlaskConical size={16} />
            <b>実験ノート</b>
            <span>直近5回 · このセッション</span>
          </div>
          {!trials.length ? (
            <div className="line-trials-empty">
              <div>
                <FlaskConical size={25} />
              </div>
              <p>
                <strong>設定を変えて、結果を比べよう。</strong>
                <span>
                  「一括検証」で現在の設定を最後まで高速実行。アニメーションと同じエンジンで検証します。
                </span>
              </p>
              <button
                className="button secondary"
                disabled={!!invalid || testing}
                onClick={fastTest}
              >
                最初の検証 <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            <>
              <div className="line-trials-table">
                <table>
                  <thead>
                    <tr>
                      <th>設定</th>
                      <th>判定</th>
                      <th>良品 / 計画</th>
                      <th>完了・停止時刻</th>
                      <th>平均タクト</th>
                      <th>原因 / ミッション</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trials.map((t, i) => (
                      <tr key={i} data-testid="trial-row">
                        <td>
                          <span className="line-trial-number">
                            {String(trials.length - i).padStart(2, '0')}
                          </span>
                          {t.config.name}
                          {i === 0 && <small>{trialCurrent ? '現在の設定' : '以前の設定'}</small>}
                        </td>
                        <td>
                          <b className={`trial-status status-${t.status.toLowerCase()}`}>
                            {t.status}
                          </b>
                        </td>
                        <td>
                          {t.summary.good} / {t.config.batchSize}
                        </td>
                        <td>{t.summary.elapsed.toFixed(2)} s</td>
                        <td>{fmt(t.summary.averageCycle, 2)} s</td>
                        <td>
                          {t.state.fault?.code ??
                            (t.summary.challengePassed
                              ? 'MISSION CLEAR'
                              : t.status === 'OK'
                                ? '全数良品'
                                : t.status === 'UNVERIFIED'
                                  ? '検証時間上限'
                                  : '検品時間不足')}
                        </td>
                        <td>
                          <button
                            title="この検証の設定を復元"
                            aria-label={`実験${i + 1}の設定を復元`}
                            onClick={() => {
                              setConfig(t.config);
                              reset(t.config);
                              setNotice('実験の設定を復元しました');
                            }}
                          >
                            <RotateCcw size={14} />
                          </button>
                          <button
                            title="検証結果を保存"
                            aria-label={`実験${i + 1}の結果を保存`}
                            onClick={() => saveFile('line-result.json', t)}
                          >
                            <ArrowDownToLine size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="line-trial-detail" role="status">
                {latestTrial.state.fault ? (
                  <>
                    <b>{latestTrial.state.fault.message}</b>
                    <span>{latestTrial.state.fault.cause}</span>
                    <p>調整のヒント：{latestTrial.state.fault.remedy}</p>
                  </>
                ) : (
                  <>
                    <b>{latestTrial.status === 'OK' ? '検証完了' : '確認が必要です'}</b>
                    <span>
                      {latestTrial.status === 'OK'
                        ? `${latestTrial.summary.good}個すべて良品。${latestTrial.summary.challengePassed ? '110秒以内のミッション達成です。' : '次は待機時間を調整してみましょう。'}`
                        : latestTrial.status === 'UNVERIFIED'
                          ? '時間上限までに全数搬出できていません。上限や供給間隔を確認してください。'
                          : '検品時間不足によりNG品が発生しました。1.20秒以上の検品時間が必要です。'}
                    </span>
                  </>
                )}
              </div>
            </>
          )}
        </section>
        <footer className="line-footer">
          <span>
            <i />
            ローカル制御シミュレーション · 10 ms固定刻み
          </span>
          <span>
            離散制御・簡易運動モデル / 実機の安全認証・動力学解析は対象外{' '}
            <button onClick={() => setHelp(true)}>
              モデルについて <CircleHelp size={12} />
            </button>
          </span>
        </footer>
      </main>
      {notice && (
        <div className="line-toast" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
      {help && (
        <div className="line-help-backdrop" onClick={() => setHelp(false)}>
          <section
            className="line-help"
            role="dialog"
            aria-modal="true"
            aria-label="ラインシミュレーターの使い方"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="line-help-close"
              aria-label="使い方を閉じる"
              autoFocus
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">CONTROL LAB / GUIDE</div>
            <h2>信号で動く、小さな工場。</h2>
            <p>
              ワークは搬入バッファから検品コンベアへ。位置センサーをPLCが読むとコンベアを減速停止し、ロボットに検品を要求します。検品完了と退避完了を確認してから、搬出コンベアへ引き渡します。
            </p>
            <ol>
              <li>まず再生ボタンで、ワークとI/Oの変化を観察。</li>
              <li>待機時間や速度を変更し、「一括検証」で結果を比較。</li>
              <li>異常時は原因と調整のヒントを確認し、設定を直して再実行。</li>
            </ol>
            <h3>このモデルで計算すること</h3>
            <p>
              搬送の加減速、有限バッファ、定周期供給による搬入あふれ、センサー応答遅延、PLC周期、開始要求／完了応答、退避のインターロック、短い信号の見逃し、検品時間不足、詰まりを扱います。搬入バッファは最大4個で、満杯のまま次のワークが到着するとNG停止します。完了信号は検品終了時に立ち、退避完了とは別です。
            </p>
            <h3>時間・寸法とモデルの範囲</h3>
            <p>
              10
              ms固定刻み。各設定の時間は次の刻みに切り上げられます。長さはmm、時間は秒。センサー位置1060
              mm、ワーク長120 mm、検品可能中心位置1000〜1260
              mm。安定に0.20秒、検品に1.20秒、ロボットの接近に0.60秒、退避に0.65秒を必要とします。
            </p>
            <p>
              SVGは模式図です。ロボット軌道は工程進捗で補間し、干渉は作業中の搬送から判定します。6軸IK、3D形状衝突、トルク、空圧、実PLC通信は未連携です。非常停止はモデルを停止時点で凍結します。停止後はリセットで復旧してください。
            </p>
            <p>
              OKは設定された生産数を全数良品で搬出、NGは故障または検品不足、UNVERIFIEDは時間上限による未完了です。再生速度は計算結果を変えません。バックグラウンドタブでは再生を休止します。
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
