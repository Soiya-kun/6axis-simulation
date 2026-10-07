import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Code2,
  Crosshair,
  Cuboid,
  FileJson,
  Focus,
  Layers3,
  LoaderCircle,
  Maximize2,
  Move3D,
  Pause,
  Play,
  RotateCcw,
  Route,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Upload,
  X,
  AlertTriangle,
  Repeat2,
} from 'lucide-react';
import { Scene } from './Scene';
import { cloneConfig, validateConfig } from './core/config';
import { containment, forwardKinematics } from './core/kinematics';
import { DEG, norm, rotationError, sub } from './core/math';
import { compileTrajectory, frameAt, toCSV } from './core/simulation';
import type { Config, SimulationResult } from './core/types';

type Tab = 'robot' | 'trajectory' | 'workspace';
const storageKey = 'axis-studio.config.v1';
function readSaved(): Config {
  try {
    const data = localStorage.getItem(storageKey);
    if (data) {
      const c = JSON.parse(data);
      validateConfig(c);
      return c;
    }
  } catch {
    /* An invalid saved document must not prevent launch. */
  }
  return cloneConfig();
}
function download(name: string, data: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  function commit() {
    const n = Number(draft);
    if (
      draft.trim() &&
      Number.isFinite(n) &&
      (min === undefined || n >= min) &&
      (max === undefined || n <= max)
    )
      onChange(n);
    else setDraft(String(value));
  }
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          aria-label={label}
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {unit && <small>{unit}</small>}
      </div>
    </label>
  );
}
function SectionTitle({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="section-title">
      <span>{number}</span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
function AppIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M8 25h17M12 24v-7l10-5-6-7M12 17l-6-6 5-6"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="17" r="3" fill="#111b2c" stroke="currentColor" strokeWidth="2" />
      <circle cx="22" cy="12" r="3" fill="#111b2c" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
export function App() {
  const [config, setConfig] = useState<Config>(readSaved),
    [tab, setTab] = useState<Tab>('robot'),
    [result, setResult] = useState<SimulationResult | null>(null),
    [resultConfig, setResultConfig] = useState('');
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [loop, setLoop] = useState(false);
  const [view, setView] = useState<'perspective' | 'top' | 'front'>('perspective'),
    [viewRevision, setViewRevision] = useState(0),
    [showWorkspace, setShowWorkspace] = useState(true),
    [showTrail, setShowTrail] = useState(true),
    [help, setHelp] = useState(false),
    [resultTab, setResultTab] = useState<'joints' | 'report'>('joints');
  const worker = useRef<Worker | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    stage = useRef<HTMLDivElement>(null),
    configRef = useRef(config);
  configRef.current = config;
  const dirty = !!result && JSON.stringify(config) !== resultConfig;
  const update = (fn: (c: Config) => void) => {
    setPlaying(false);
    setError('');
    setConfig((c) => {
      const next = cloneConfig(c);
      fn(next);
      return next;
    });
  };
  function run(c: Config = configRef.current) {
    setPlaying(false);
    setError('');
    try {
      validateConfig(c);
      compileTrajectory(c)(0);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    worker.current?.terminate();
    const w = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setBusy(true);
    setProgress(0);
    const snapshot = JSON.stringify(c);
    w.onmessage = (e) => {
      if (worker.current !== w) return;
      if (e.data.type === 'progress') setProgress(e.data.progress);
      if (e.data.type === 'result') {
        setResult(e.data.result);
        setResultConfig(snapshot);
        setTime(0);
        setBusy(false);
        w.terminate();
        worker.current = null;
      }
      if (e.data.type === 'error') {
        setError(e.data.error);
        setBusy(false);
        w.terminate();
        worker.current = null;
      }
    };
    w.onerror = (e) => {
      if (worker.current !== w) return;
      setError(e.message || '計算ワーカーでエラーが発生しました');
      setBusy(false);
      w.terminate();
      worker.current = null;
    };
    w.postMessage(c);
  }
  useEffect(() => {
    run(configRef.current);
    return () => worker.current?.terminate();
  }, []);
  useEffect(() => {
    try {
      validateConfig(config);
      compileTrajectory(config)(0);
      localStorage.setItem(storageKey, JSON.stringify(config));
    } catch {
      /* Keep the last valid save. */
    }
  }, [config]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    if (!playing || !result || dirty) return;
    let id = 0,
      last = performance.now();
    const end = result.frames.at(-1)!.t;
    const animate = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1) * speed;
      last = now;
      setTime((t) => {
        const next = t + dt;
        if (next >= end) {
          if (loop) return next % end;
          setPlaying(false);
          return end;
        }
        return next;
      });
      id = requestAnimationFrame(animate);
    };
    id = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(id);
  }, [playing, speed, result, dirty, loop]);
  const angles =
    result && !dirty ? frameAt(result, time).angles : config.initialAngles.map((a) => a * DEG);
  const pose = forwardKinematics(config.links, angles),
    region = containment(config.links, pose, config.workspace);
  let tipError: number | null = null,
    orientationError: number | null = null;
  try {
    const target = compileTrajectory(config)(time);
    tipError = norm(sub(target.position, pose.tip));
    orientationError = target.rotation
      ? norm(rotationError(target.rotation, pose.rotation)) / DEG
      : 0;
  } catch {
    /* The editor reports invalid expressions on run. */
  }
  const currentNG = region.violatingLinks.length > 0;
  const seek = (t: number) => {
    setPlaying(false);
    setTime(t);
  };
  async function importFile(file: File) {
    try {
      if (file.size > 2_000_000) throw new Error('設定ファイルは2MB以下にしてください');
      const parsed = JSON.parse(await file.text()),
        c = parsed.config ?? parsed;
      validateConfig(c);
      compileTrajectory(c)(0);
      worker.current?.terminate();
      worker.current = null;
      setBusy(false);
      setPlaying(false);
      setConfig(c);
      setNotice('設定を読み込みました');
      run(c);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const issues = result
    ? [
        ...result.frames
          .filter((f) => !f.converged || f.violatingLinks.length)
          .map((f) => ({
            t: f.t,
            text: f.violatingLinks.length
              ? `J${f.violatingLinks.map((i) => i + 1).join(', J')} が領域外`
              : `IK未収束 · 誤差 ${f.error.toFixed(2)} mm / ${f.orientationError.toFixed(2)}°`,
          })),
        ...result.sweeps
          .filter((s) => s.status !== 'safe')
          .map((s) => ({
            t: s.t!,
            text:
              s.status === 'violation'
                ? 'フレーム間で領域逸脱'
                : 'フレーム間の安全性を確認できません',
          })),
      ].sort((a, b) => a.t - b.t)
    : [];
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="AXIS Studio">
          <span className="brand-icon">
            <AppIcon />
          </span>
          <b>
            AXIS<span>STUDIO</span>
          </b>
        </a>
        <div className="top-divider" />
        <span className="project-name">
          6-axis simulation <ChevronDown size={13} />
        </span>
        <span className="local-badge">
          <i />
          LOCAL WORKSPACE
        </span>
        <div className="top-actions">
          <button
            className="icon-button"
            title="使い方"
            aria-label="使い方"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={18} />
          </button>
          <span className="avatar">A</span>
        </div>
      </header>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ROBOTICS / MOTION LAB</div>
          <h1>
            ロボットシミュレーション <span>6 DOF</span>
          </h1>
          <p>軌道を設計し、6軸アームの動きと稼働領域を検証。</p>
        </div>
        <div className="heading-actions">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = '';
            }}
          />
          <button
            className="button secondary import-button"
            onClick={() => fileInput.current?.click()}
            title="設定JSONを読み込む"
          >
            <Upload size={15} />
            読み込み
          </button>
          <button
            className="button secondary"
            onClick={() => {
              try {
                validateConfig(config);
                download('axis-config.json', JSON.stringify(config, null, 2));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <ArrowDownToLine size={15} />
            設定を保存
          </button>
          <button className="button primary" disabled={busy} onClick={() => run()}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Play size={15} fill="currentColor" />
            )}
            {busy ? `計算中 ${Math.round(progress * 100)}%` : '軌道を計算'}
            {!busy && <span className="button-key">↵</span>}
          </button>
          {busy && (
            <button
              className="icon-button cancel-button"
              aria-label="計算を中止"
              onClick={() => {
                worker.current?.terminate();
                worker.current = null;
                setBusy(false);
                setNotice('計算を中止しました');
              }}
            >
              <X size={17} />
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={17} />
          {error}
          <button onClick={() => setError('')} aria-label="エラーを閉じる">
            <X size={16} />
          </button>
        </div>
      )}
      <div className="workbench">
        <aside className="settings-panel">
          <div className="panel-heading">
            <SlidersHorizontal size={16} />
            <b>シミュレーション設定</b>
            <span>mm / deg</span>
          </div>
          <nav className="setting-tabs" aria-label="設定カテゴリ">
            {(
              [
                { key: 'robot', label: 'ロボット', icon: Move3D },
                { key: 'trajectory', label: '軌道関数', icon: Route },
                { key: 'workspace', label: '稼働領域', icon: Box },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? 'active' : ''}
                onClick={() => setTab(t.key)}
              >
                <t.icon size={17} />
                {t.label}
              </button>
            ))}
          </nav>
          <div className="settings-scroll">
            {tab === 'robot' && (
              <>
                <SectionTitle number="01" title="アーム構成">
                  <span className="tiny-badge">SERIAL 6R</span>
                </SectionTitle>
                <p className="section-description">
                  各リンクの長さと直径を設定します。
                  <br />
                  回転軸はローカル座標系に対応します。
                </p>
                <div className="link-column-labels">
                  <span>LINK / AXIS</span>
                  <span>長さ</span>
                  <span>直径</span>
                </div>
                <div className="link-list">
                  {config.links.map((link, i) => (
                    <div className="link-card" key={i}>
                      <div className="link-main">
                        <div className="link-name">
                          <span className={`joint-tag joint-${i}`}>J{i + 1}</span>
                          <div>
                            <b>{link.name}</b>
                            <select
                              aria-label={`J${i + 1} 回転軸`}
                              value={link.axis}
                              onChange={(e) =>
                                update((c) => {
                                  c.links[i].axis = e.target.value as 'X' | 'Y' | 'Z';
                                })
                              }
                            >
                              {['X', 'Y', 'Z'].map((a) => (
                                <option key={a}>{a}</option>
                              ))}
                            </select>
                            <small>軸回転</small>
                          </div>
                        </div>
                        <NumberField
                          label={`J${i + 1} 長さ`}
                          value={link.length}
                          min={1}
                          max={3000}
                          onChange={(v) =>
                            update((c) => {
                              c.links[i].length = v;
                            })
                          }
                        />
                        <NumberField
                          label={`J${i + 1} 直径`}
                          value={link.diameter}
                          min={1}
                          max={1000}
                          onChange={(v) =>
                            update((c) => {
                              c.links[i].diameter = v;
                            })
                          }
                        />
                      </div>
                      <details>
                        <summary>
                          角度・可動範囲 <span>{config.initialAngles[i]}°</span>
                        </summary>
                        <div className="joint-controls">
                          <label className="slider-label">
                            探索の初期角度 <output>{config.initialAngles[i]}°</output>
                            <input
                              type="range"
                              aria-label={`J${i + 1} 初期角度`}
                              min={link.min}
                              max={link.max}
                              step={1}
                              value={config.initialAngles[i]}
                              onChange={(e) =>
                                update((c) => {
                                  c.initialAngles[i] = Number(e.target.value);
                                })
                              }
                            />
                          </label>
                          <div className="two-fields">
                            <NumberField
                              label={`J${i + 1} 下限`}
                              value={link.min}
                              min={-360}
                              max={360}
                              unit="°"
                              onChange={(v) =>
                                update((c) => {
                                  c.links[i].min = v;
                                })
                              }
                            />
                            <NumberField
                              label={`J${i + 1} 上限`}
                              value={link.max}
                              min={-360}
                              max={360}
                              unit="°"
                              onChange={(v) =>
                                update((c) => {
                                  c.links[i].max = v;
                                })
                              }
                            />
                          </div>
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
                <div className="reach-total">
                  <span>リンク長の合計</span>
                  <strong>
                    {config.links.reduce((s, l) => s + l.length, 0).toLocaleString()}{' '}
                    <small>mm</small>
                  </strong>
                </div>
                <div className="info-note">
                  <Layers3 size={16} />
                  <span>太さを含むカプセル形状で、腕全体が領域内に収まるか検証します。</span>
                </div>
              </>
            )}
            {tab === 'trajectory' && (
              <>
                <SectionTitle number="02" title="手先の軌道関数" />
                <p className="section-description">
                  時間 t [秒] に対する手先の位置 [mm]。
                  <br />
                  逆運動学から各関節の角度を求めます。
                </p>
                <label className="field-label">
                  プリセット
                  <select
                    aria-label="軌道プリセット"
                    value=""
                    onChange={(e) => {
                      const value = e.target.value;
                      update((c) => {
                        Object.assign(
                          c.trajectory,
                          value === 'orbit'
                            ? {
                                x: '520 + 90 * cos(2*pi*t/8)',
                                y: '140 * sin(2*pi*t/8)',
                                z: '400 + 60 * sin(4*pi*t/8)',
                                duration: 8,
                              }
                            : value === 'circle'
                              ? {
                                  x: '520',
                                  y: '120 * cos(2*pi*t/8)',
                                  z: '400 + 120 * sin(2*pi*t/8)',
                                  duration: 8,
                                }
                              : { x: '420 + 180*t/8', y: '-120 + 240*t/8', z: '400', duration: 8 },
                        );
                      });
                    }}
                  >
                    <option value="" disabled>
                      軌道を選択
                    </option>
                    <option value="orbit">立体オービット</option>
                    <option value="circle">円軌道</option>
                    <option value="line">直線移動</option>
                  </select>
                </label>
                <div className="formula-fields">
                  {(['x', 'y', 'z'] as const).map((axis, i) => (
                    <label key={axis}>
                      <span className={`axis-symbol axis-${i}`}>{axis}(t)</span>
                      <input
                        aria-label={`${axis}(t)`}
                        spellCheck={false}
                        value={config.trajectory[axis]}
                        onChange={(e) =>
                          update((c) => {
                            c.trajectory[axis] = e.target.value;
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="syntax-note">
                  <Code2 size={14} />
                  <code>sin cos sqrt abs min max pi t ^</code>
                </div>
                <div className="two-fields">
                  <NumberField
                    label="シミュレーション時間"
                    value={config.trajectory.duration}
                    min={0.05}
                    max={120}
                    step={0.1}
                    unit="s"
                    onChange={(v) =>
                      update((c) => {
                        c.trajectory.duration = v;
                      })
                    }
                  />
                  <NumberField
                    label="時間刻み"
                    value={config.trajectory.step}
                    min={0.005}
                    max={2}
                    step={0.01}
                    unit="s"
                    onChange={(v) =>
                      update((c) => {
                        c.trajectory.step = v;
                      })
                    }
                  />
                </div>
                <label className="toggle-row">
                  <div>
                    <b>手先姿勢も指定</b>
                    <small>Roll / Pitch / Yaw [deg]</small>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.trajectory.orientation}
                    onChange={(e) =>
                      update((c) => {
                        c.trajectory.orientation = e.target.checked;
                      })
                    }
                  />
                  <span className="toggle" />
                </label>
                {config.trajectory.orientation && (
                  <div className="formula-fields orientation-fields">
                    {(['roll', 'pitch', 'yaw'] as const).map((axis) => (
                      <label key={axis}>
                        <span>{axis}(t)</span>
                        <input
                          aria-label={`${axis}(t)`}
                          value={config.trajectory[axis]}
                          onChange={(e) =>
                            update((c) => {
                              c.trajectory[axis] = e.target.value;
                            })
                          }
                        />
                      </label>
                    ))}
                    <small>R = Rz(yaw) · Ry(pitch) · Rx(roll)</small>
                  </div>
                )}
                <SectionTitle number="03" title="数値ソルバー" />
                <div className="two-fields">
                  <NumberField
                    label="位置許容誤差"
                    value={config.solver.tolerance}
                    min={0.01}
                    max={20}
                    step={0.1}
                    unit="mm"
                    onChange={(v) =>
                      update((c) => {
                        c.solver.tolerance = v;
                      })
                    }
                  />
                  <NumberField
                    label="最大反復数"
                    value={config.solver.iterations}
                    min={10}
                    max={300}
                    onChange={(v) =>
                      update((c) => {
                        c.solver.iterations = v;
                      })
                    }
                  />
                  <NumberField
                    label="初期値の探索数"
                    value={config.solver.attempts}
                    min={1}
                    max={12}
                    onChange={(v) =>
                      update((c) => {
                        c.solver.attempts = v;
                      })
                    }
                  />
                  <NumberField
                    label="姿勢許容誤差"
                    value={config.solver.orientationTolerance}
                    min={0.01}
                    max={10}
                    step={0.1}
                    unit="°"
                    onChange={(v) =>
                      update((c) => {
                        c.solver.orientationTolerance = v;
                      })
                    }
                  />
                </div>
                <div className="info-note">
                  <Activity size={16} />
                  <span>
                    前時刻の解を引き継ぎ、減衰最小二乗法と複数初期値で探索。未収束はNGとして報告します。
                  </span>
                </div>
              </>
            )}
            {tab === 'workspace' && (
              <>
                <SectionTitle number="02" title="稼働可能な領域" />
                <p className="section-description">
                  全リンクが収まる許容領域を指定。
                  <br />
                  腕の一部でもはみ出すとNGです。
                </p>
                <div className="shape-selector">
                  <button
                    className={config.workspace.type === 'box' ? 'selected' : ''}
                    onClick={() =>
                      update((c) => {
                        c.workspace.type = 'box';
                      })
                    }
                  >
                    <Cuboid size={22} />
                    <b>直方体</b>
                    <small>Bounding box</small>
                  </button>
                  <button
                    className={config.workspace.type === 'sphere' ? 'selected' : ''}
                    onClick={() =>
                      update((c) => {
                        c.workspace.type = 'sphere';
                      })
                    }
                  >
                    <GlobeIcon />
                    <b>球</b>
                    <small>Bounding sphere</small>
                  </button>
                </div>
                {config.workspace.type === 'box' ? (
                  <>
                    <div className="region-head">
                      <span>WORLD AXIS</span>
                      <span>最小 [mm]</span>
                      <span>最大 [mm]</span>
                    </div>
                    {(['X', 'Y', 'Z'] as const).map((a, i) => (
                      <div className="region-row" key={a}>
                        <span className={`axis-symbol axis-${i}`}>{a}</span>
                        <NumberField
                          label={`${a} 最小`}
                          value={config.workspace.min[i]}
                          onChange={(v) =>
                            update((c) => {
                              c.workspace.min[i] = v;
                            })
                          }
                        />
                        <NumberField
                          label={`${a} 最大`}
                          value={config.workspace.max[i]}
                          onChange={(v) =>
                            update((c) => {
                              c.workspace.max[i] = v;
                            })
                          }
                        />
                      </div>
                    ))}
                    <div className="dimension-box">
                      <Box size={17} />
                      <span>
                        {config.workspace.max
                          .map((v, i) => v - config.workspace.min[i])
                          .join(' × ')}{' '}
                        <small>mm</small>
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="three-fields">
                      {(['X', 'Y', 'Z'] as const).map((a, i) => (
                        <NumberField
                          key={a}
                          label={`中心 ${a}`}
                          value={config.workspace.center[i]}
                          unit="mm"
                          onChange={(v) =>
                            update((c) => {
                              c.workspace.center[i] = v;
                            })
                          }
                        />
                      ))}
                    </div>
                    <NumberField
                      label="半径"
                      value={config.workspace.radius}
                      min={1}
                      max={100000}
                      unit="mm"
                      onChange={(v) =>
                        update((c) => {
                          c.workspace.radius = v;
                        })
                      }
                    />
                  </>
                )}
                <div className="workspace-rule">
                  <ShieldCheck size={23} />
                  <b>腕全体で判定</b>
                  <p>
                    各リンクの直径・関節の丸みまで含めた形状を判定します。境界に接する状態は許容します。
                  </p>
                  <span>
                    <Check size={13} />
                    端点だけでなくリンク全体
                  </span>
                  <span>
                    <Check size={13} />
                    フレーム間の動作も検証
                  </span>
                </div>
                <p className="section-description">
                  固定台座は判定対象外。モデルの基準位置は (0, 0,
                  0)、Z軸が上方向です。最下部の丸みを収めるため、Z最小値を負に設定します。
                </p>
              </>
            )}
          </div>
          <div className="settings-footer">
            <span>
              <i />
              設定はこのブラウザーに自動保存
            </span>
            <button
              title="初期設定に戻す"
              aria-label="初期設定に戻す"
              onClick={() => {
                const c = cloneConfig();
                setConfig(c);
                setPlaying(false);
                run(c);
                setNotice('初期設定に戻しました');
              }}
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </aside>
        <main className="main-panel">
          <div className="viewport" ref={stage}>
            <div className="viewport-toolbar">
              <div className="viewport-title">
                <Box size={15} />
                <b>3D ワークスペース</b>
                <span>WORLD</span>
              </div>
              <div className="view-controls">
                {(
                  [
                    { id: 'perspective', text: 'パース' },
                    { id: 'front', text: '正面' },
                    { id: 'top', text: '上面' },
                  ] as const
                ).map((v) => (
                  <button
                    key={v.id}
                    className={view === v.id ? 'active' : ''}
                    onClick={() => {
                      setView(v.id);
                      setViewRevision((n) => n + 1);
                    }}
                  >
                    {v.text}
                  </button>
                ))}
                <div className="control-divider" />
                <button
                  title="視点をリセット"
                  aria-label="視点をリセット"
                  onClick={() => {
                    setView('perspective');
                    setViewRevision((n) => n + 1);
                  }}
                >
                  <Focus size={16} />
                </button>
                <button
                  title="全画面"
                  aria-label="全画面"
                  onClick={() => {
                    if (document.fullscreenElement) void document.exitFullscreen();
                    else
                      void stage.current
                        ?.requestFullscreen()
                        .catch(() => setNotice('全画面表示に対応していません'));
                  }}
                >
                  <Maximize2 size={15} />
                </button>
              </div>
            </div>
            <div className="scene-container">
              <Scene
                config={config}
                angles={angles}
                result={dirty ? null : result}
                showWorkspace={showWorkspace}
                showTrail={showTrail}
                view={view}
                viewRevision={viewRevision}
              />
              <div className={`live-status ${currentNG ? 'danger' : ''}`}>
                <span className="live-dot" />
                <div>
                  <b>{currentNG ? '稼働領域から逸脱' : '全リンクが稼働領域内'}</b>
                  <span>
                    {currentNG
                      ? `対象: ${region.violatingLinks.map((i) => `J${i + 1}`).join(', ')}`
                      : `現在の最小余裕 ${region.clearance.toFixed(1)} mm`}
                  </span>
                </div>
              </div>
              <div className="tcp-card">
                <div>
                  <Crosshair size={13} />
                  <b>TOOL CENTER POINT</b>
                  <span>mm</span>
                </div>
                {(['X', 'Y', 'Z'] as const).map((a, i) => (
                  <p key={a}>
                    <span className={`text-axis-${i}`}>{a}</span>
                    <strong>{pose.tip[i].toFixed(1)}</strong>
                  </p>
                ))}
                <footer>
                  追従誤差{' '}
                  <b>
                    {tipError === null ? '—' : tipError.toFixed(2)} <small>mm</small>
                  </b>
                </footer>
                {config.trajectory.orientation && (
                  <footer>
                    姿勢誤差 <b>{orientationError === null ? '—' : orientationError.toFixed(2)}°</b>
                  </footer>
                )}
              </div>
              {dirty && (
                <div className="stale-overlay">
                  <Settings2 size={15} />
                  設定が変更されています
                  <button onClick={() => run()} disabled={busy}>
                    再計算
                    <ArrowRight size={13} />
                  </button>
                </div>
              )}
              <div className="view-legend">
                <button
                  className={showWorkspace ? 'enabled' : ''}
                  onClick={() => setShowWorkspace((v) => !v)}
                  aria-pressed={showWorkspace}
                >
                  <span className="legend-square" />
                  稼働領域
                </button>
                <button
                  className={showTrail ? 'enabled' : ''}
                  onClick={() => setShowTrail((v) => !v)}
                  aria-pressed={showTrail}
                >
                  <span className="legend-line" />
                  目標軌道
                </button>
                <span>
                  <i className="actual-dot" />
                  計算軌道
                </span>
              </div>
              <div className="orbit-hint">
                <Move3D size={13} />
                ドラッグで回転 · スクロールでズーム
              </div>
            </div>
          </div>
          <section className="playback">
            <div className="playback-controls">
              <button
                className="play-button"
                disabled={!result || dirty || busy}
                aria-label={playing ? '一時停止' : '再生'}
                onClick={() => {
                  if (result && time >= result.frames.at(-1)!.t) setTime(0);
                  setPlaying((p) => !p);
                }}
              >
                {playing ? (
                  <Pause size={17} fill="currentColor" />
                ) : (
                  <Play size={17} fill="currentColor" />
                )}
              </button>
              <button
                className="icon-button"
                title="先頭に戻る"
                aria-label="先頭に戻る"
                onClick={() => seek(0)}
              >
                <Square size={13} />
              </button>
              <div className="time-display">
                <b>
                  {time.toFixed(2)}
                  <small>s</small>
                </b>
                <span>/ {config.trajectory.duration.toFixed(2)} s</span>
              </div>
              <div className="playback-options">
                <button
                  className={`icon-button ${loop ? 'selected' : ''}`}
                  aria-label="ループ再生"
                  aria-pressed={loop}
                  onClick={() => setLoop((v) => !v)}
                >
                  <Repeat2 size={17} />
                </button>
                <select
                  aria-label="再生速度"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                >
                  {[0.25, 0.5, 1, 2].map((n) => (
                    <option key={n} value={n}>
                      {n}×
                    </option>
                  ))}
                </select>
                <span
                  className={`result-pill ${dirty ? 'stale' : result?.status === 'OK' ? 'ok' : result ? 'ng' : ''}`}
                >
                  {busy
                    ? '計算中'
                    : dirty
                      ? '未計算'
                      : result?.status === 'OK'
                        ? '検証済み'
                        : result?.status === 'NG'
                          ? 'NG あり'
                          : result
                            ? '未検証区間あり'
                            : '待機中'}
                </span>
              </div>
            </div>
            <div className="timeline">
              <div className="timeline-track">
                {result &&
                  !dirty &&
                  result.frames.map((f, i) => (
                    <span
                      key={i}
                      className={!f.converged || f.violatingLinks.length ? 'bad' : ''}
                      style={{ left: `${(f.t / config.trajectory.duration) * 100}%` }}
                    />
                  ))}
                <input
                  aria-label="再生時刻"
                  type="range"
                  min={0}
                  max={config.trajectory.duration}
                  step={0.001}
                  value={time}
                  disabled={!result || dirty}
                  onChange={(e) => seek(Number(e.target.value))}
                />
              </div>
              <div className="timeline-ticks">
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i}>{((i * config.trajectory.duration) / 4).toFixed(1)} s</span>
                ))}
              </div>
            </div>
          </section>
          <section className="results-panel">
            <header>
              <div className="result-tabs">
                <button
                  className={resultTab === 'joints' ? 'active' : ''}
                  onClick={() => setResultTab('joints')}
                >
                  <Activity size={14} />
                  関節角度
                </button>
                <button
                  className={resultTab === 'report' ? 'active' : ''}
                  onClick={() => setResultTab('report')}
                >
                  <ShieldCheck size={14} />
                  検証結果{' '}
                  {issues.length > 0 && <span className="issue-count">{issues.length}</span>}
                </button>
              </div>
              <div className="result-export">
                <button
                  disabled={!result || dirty}
                  onClick={() =>
                    result &&
                    download('axis-trajectory.csv', toCSV(result), 'text/csv;charset=utf-8')
                  }
                >
                  <ArrowDownToLine size={13} />
                  CSV
                </button>
                <button
                  disabled={!result || dirty}
                  onClick={() =>
                    result &&
                    download('axis-result.json', JSON.stringify({ config, result }, null, 2))
                  }
                >
                  <FileJson size={13} />
                  JSON
                </button>
              </div>
            </header>
            {resultTab === 'joints' ? (
              <>
                <div className="joint-readouts">
                  {angles.map((angle, i) => (
                    <div key={i}>
                      <div>
                        <span className={`joint-tag joint-${i}`}>J{i + 1}</span>
                        <small>{config.links[i].axis} AXIS</small>
                      </div>
                      <strong>
                        {(angle / DEG).toFixed(1)}
                        <small>°</small>
                      </strong>
                      <div className="angle-bar">
                        <i
                          style={{
                            width: `${Math.max(0, Math.min(100, ((angle / DEG - config.links[i].min) / (config.links[i].max - config.links[i].min)) * 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="result-summary">
                  <span>
                    <span className="tiny-dot" />
                    POSITION + WORKSPACE
                  </span>
                  <span>
                    最大誤差 <b>{result && !dirty ? result.summary.maxError.toFixed(2) : '—'} mm</b>
                  </span>
                  <span>
                    IK収束{' '}
                    <b>
                      {result && !dirty
                        ? `${result.summary.solved} / ${result.summary.samples}`
                        : '—'}
                    </b>
                  </span>
                  <span>
                    <Clock3 size={12} />
                    {result && !dirty ? `${Math.round(result.elapsedMs)} ms` : '—'}
                  </span>
                </div>
              </>
            ) : (
              <div className="report-content">
                {!result || dirty ? (
                  <p className="section-description">
                    軌道を計算すると、収束状況と領域判定の結果を表示します。
                  </p>
                ) : (
                  <>
                    <div className={`report-summary ${result.status === 'OK' ? '' : 'report-ng'}`}>
                      {result.status === 'OK' ? (
                        <CheckCircle2 size={23} />
                      ) : (
                        <AlertTriangle size={23} />
                      )}
                      <div>
                        <b>
                          {result.status === 'OK'
                            ? '全サンプルとフレーム間の領域検証を通過'
                            : result.status === 'NG'
                              ? '軌道を実行できない箇所があります'
                              : '安全性を確認できない区間があります'}
                        </b>
                        <p>
                          {result.summary.solved}/{result.summary.samples} 点でIK収束 ·
                          検査点の最小余裕 {result.summary.minClearance.toFixed(2)} mm · 補間検査{' '}
                          {result.summary.sweepChecks} 回
                        </p>
                      </div>
                    </div>
                    {issues.length > 0 && (
                      <div className="issues-list">
                        {issues.slice(0, 80).map((issue, i) => (
                          <button key={i} onClick={() => seek(issue.t)}>
                            <span>{issue.t.toFixed(3)} s</span>
                            {issue.text}
                            <ArrowRight size={13} />
                          </button>
                        ))}
                        {issues.length > 80 && (
                          <small>
                            ほか {issues.length - 80} 件。全件はJSON出力で確認できます。
                          </small>
                        )}
                      </div>
                    )}
                    <p className="report-note">
                      位置・姿勢誤差は指定時刻で評価。領域検証は表示モデルと関節角の線形補間に適用します。
                    </p>
                  </>
                )}
              </div>
            )}
          </section>
        </main>
      </div>
      <footer className="app-footer">
        <span>
          <i />
          ENGINE READY <span>·</span> Damped least squares IK
        </span>
        <span>
          右手座標系 · Z-up <span>·</span> AXIS STUDIO / 01
        </span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-label="使い方"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              autoFocus
              aria-label="使い方を閉じる"
              onClick={() => setHelp(false)}
            >
              <X />
            </button>
            <span className="eyebrow">QUICK START</span>
            <h2>軌道から、動きへ。</h2>
            <ol>
              <li>
                <b>ロボットを設定</b>
                <p>
                  6リンクの長さ・直径・回転軸・可動範囲を調整します。初期角度はIKの探索開始値です。
                </p>
              </li>
              <li>
                <b>軌道関数を入力</b>
                <p>
                  x(t), y(t), z(t) はmm、tは秒。三角関数の引数はラジアン。姿勢角の式の出力は度です。
                </p>
              </li>
              <li>
                <b>稼働領域を指定して計算</b>
                <p>全リンクをカプセル形状として、直方体または球の内側に収まるか検証します。</p>
              </li>
              <li>
                <b>再生・検証・出力</b>
                <p>再生バーで動作を確認。検証結果の時刻をクリックすると問題箇所へ移動できます。</p>
              </li>
            </ol>
            <div className="help-caveat">
              このモデルは運動学シミュレーターです。自己衝突・障害物・荷重・速度/加速度制約は対象外。IK未収束は「解が存在しない」証明ではありません。初期角度や探索数を変えて再計算できます。
            </div>
            <button className="button primary" onClick={() => setHelp(false)}>
              始める
              <ArrowRight size={15} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
function GlobeIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18M5 6.5c4 2 10 2 14 0M5 17.5c4-2 10-2 14 0" />
    </svg>
  );
}
