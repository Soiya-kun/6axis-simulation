import type { LineConfig, LineState, Part, Signals } from '../core/line/types';
import { inspectionLine } from '../core/line/config';

export const signalLabels: { key: keyof Signals; label: string; address: string }[] = [
  { key: 'partPresent', label: '位置センサー', address: 'X0' },
  { key: 'motorRun', label: 'コンベア運転', address: 'Y0' },
  { key: 'robotRequest', label: '検品開始要求', address: 'Y1' },
  { key: 'robotBusy', label: 'ロボット動作中', address: 'X1' },
  { key: 'processDone', label: '検品完了', address: 'X2' },
  { key: 'robotHome', label: '退避完了', address: 'X3' },
  { key: 'downstreamReady', label: '下流受入許可', address: 'X4' },
];
const phaseLabels = {
  feeding: '搬入待ち',
  positioning: '位置決め',
  settling: '停止・安定待ち',
  working: 'ロボット検品',
  releasing: '退避・搬送許可待ち',
  unloading: '搬出中',
};
export const linePhaseLabel = (s: LineState) => phaseLabels[s.phase];
const sx = (x: number) => 244 + x * 0.231;

function Workpiece({ part, x, y = 298 }: { part: Part; x: number; y?: number }) {
  const good = part.quality === 'good',
    rejected = part.quality === 'reject';
  return (
    <g transform={`translate(${x},${y})`} className="line-workpiece">
      <rect
        x="-19"
        y="-18"
        width="38"
        height="36"
        rx="6"
        fill={rejected ? '#fee5dd' : good ? '#c9f1df' : '#edf1f6'}
        stroke={rejected ? '#d77354' : good ? '#399c7d' : '#7b8da4'}
        strokeWidth="1.5"
      />
      <rect x="-11" y="-11" width="22" height="14" rx="3" fill={good ? '#8fd6b7' : '#c4cdd8'} />
      <circle cx="0" cy="-4" r="4" fill={good ? '#387c65' : '#5d6e84'} />
      <text y="13" textAnchor="middle" fontSize="8" fill="#425268">
        {String(part.id).padStart(2, '0')}
      </text>
      {good && (
        <g transform="translate(16,-19)">
          <circle r="7" fill="#14856c" />
          <path d="m-3 0 2 2 4-4" fill="none" stroke="white" strokeWidth="1.5" />
        </g>
      )}
    </g>
  );
}
function Belt({
  x,
  width,
  moving,
  offset,
}: {
  x: number;
  width: number;
  moving: boolean;
  offset: number;
}) {
  return (
    <g>
      <rect x={x} y="258" width={width} height="83" rx="15" fill="#d6dee7" stroke="#b0becc" />
      <rect x={x + 5} y="266" width={width - 10} height="65" rx="10" fill="#e9eef3" />
      {Array.from({ length: Math.floor((width - 24) / 14) }, (_, i) => (
        <rect
          key={i}
          x={x + 10 + ((i * 14 + offset) % (width - 24))}
          y="271"
          width="5"
          height="55"
          rx="2.5"
          fill={moving ? '#c0ccd9' : '#cbd5df'}
        />
      ))}
      <path
        d={`M${x + 12} 257h${width - 24}M${x + 12} 341h${width - 24}`}
        stroke="#94a6b9"
        strokeWidth="3"
      />
      {[x + 24, x + width - 24].map((v) => (
        <g key={v}>
          <rect x={v - 4} y="345" width="8" height="12" rx="2" fill="#9dacba" />
          <circle cx={v} cy="350" r="2" fill="#74889e" />
        </g>
      ))}
    </g>
  );
}
export function LineScene({
  state: s,
  config: c,
  running,
}: {
  state: LineState;
  config: LineConfig;
  running: boolean;
}) {
  const d = inspectionLine;
  const robotAge = s.time - s.robotSince;
  const extension =
    s.robot === 'approach'
      ? Math.min(1, robotAge / d.approachTime)
      : s.robot === 'inspect'
        ? 1
        : s.robot === 'retreat'
          ? Math.max(0, 1 - robotAge / d.retreatTime)
          : 0;
  const targetX = sx(s.active?.x ?? 1100);
  const handX = 550 + (targetX - 550) * extension;
  const handY = 204 + 86 * extension;
  const elbowX = 605 - 31 * extension,
    elbowY = 166 + 48 * extension;
  const alarm = !!s.fault;
  const transferOn = s.velocity > 0 && running;
  return (
    <svg
      className="line-scene-svg"
      viewBox="0 0 1000 465"
      role="img"
      aria-label={`製造ライン俯瞰図。${linePhaseLabel(s)}。搬入待ち${s.queue.length}個、搬出待ち${s.output.length}個。`}
    >
      <defs>
        <pattern id="factory-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="#d8e0e8" />
        </pattern>
        <linearGradient id="cell-floor" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#f3f8fa" />
          <stop offset="1" stopColor="#eaf2f4" />
        </linearGradient>
        <filter id="robot-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="5" stdDeviation="3" floodOpacity=".1" />
        </filter>
      </defs>
      <rect width="1000" height="465" fill="url(#factory-grid)" />
      <rect
        x="354"
        y="80"
        width="342"
        height="310"
        rx="20"
        fill="url(#cell-floor)"
        stroke={alarm ? '#d7816e' : '#b6ccce'}
        strokeDasharray="5 5"
      />
      <text x="370" y="103" fill="#82969f" fontSize="9" letterSpacing="2">
        ROBOT INSPECTION CELL
      </text>
      <g fill="#64748b" fontSize="10" letterSpacing="1.5">
        <text x="70" y="54">
          01 / INFEED
        </text>
        <text x="388" y="54">
          02 / INSPECTION
        </text>
        <text x="732" y="54">
          03 / OUTFEED
        </text>
      </g>
      <g fill="#27384f" fontSize="16" fontWeight="600">
        <text x="70" y="77">
          搬入バッファ
        </text>
        <text x="388" y="77">
          ロボット検品
        </text>
        <text x="732" y="77">
          搬出・次工程
        </text>
      </g>
      <rect x="65" y="166" width="166" height="46" rx="7" fill="#fff" stroke="#dbe3eb" />
      <circle
        cx="81"
        cy="183"
        r="3"
        fill={
          s.fault?.code === 'INPUT_OVERFLOW'
            ? '#d77354'
            : s.queue.length >= d.inputCapacity
              ? '#d39a43'
              : '#229f86'
        }
      />
      <text x="93" y="187" fill="#5a6b81" fontSize="10">
        {s.fault?.code === 'INPUT_OVERFLOW'
          ? '供給過多 / あふれ停止'
          : s.queue.length >= d.inputCapacity
            ? '満杯 / 次の到着に注意'
            : '定周期供給 / 蓄積搬送'}
      </text>
      <text x="81" y="202" fill="#8a98a8" fontSize="9">
        BUFFER {s.queue.length} / {d.inputCapacity} · {c.feedInterval.toFixed(1)} s
      </text>
      <Belt x={65} width={196} moving={running && s.queue.length > 0} offset={(s.time * 16) % 14} />
      <Belt x={268} width={390} moving={transferOn} offset={sx(s.active?.x ?? 0) % 14} />
      <Belt
        x={666}
        width={237}
        moving={running && s.output.length > 0 && !s.inputs.outputBlocked}
        offset={(s.time * c.outputSpeed * 0.231) % 14}
      />
      <rect
        x={sx(d.workMin)}
        y="263"
        width={(d.workMax - d.workMin) * 0.231}
        height="71"
        rx="4"
        fill="#52b5a515"
        stroke="#5cafa0"
        strokeDasharray="3 3"
      />
      <path
        d={`M${sx(d.sensorX)} 246v101`}
        stroke={s.signals.partPresent ? '#22a68b' : '#bdced5'}
        strokeDasharray="3 3"
        strokeWidth="2"
      />
      <rect
        x={sx(d.sensorX) - 8}
        y="237"
        width="16"
        height="14"
        rx="3"
        fill={s.signals.partPresent ? '#148b78' : '#53697e'}
      />
      <text x={sx(d.sensorX) - 18} y="370" fill="#77909a" fontSize="9">
        X0 位置検出
      </text>
      {s.queue.map((p, i) => (
        <Workpiece key={p.id} part={p} x={234 - i * 47} />
      ))}
      {s.active && <Workpiece part={s.active} x={sx(s.active.x)} />}
      {s.output.map((p) => (
        <Workpiece key={p.id} part={p} x={sx(p.x)} />
      ))}
      <g filter="url(#robot-shadow)">
        <rect x="498" y="122" width="78" height="63" rx="12" fill="#dbe4eb" stroke="#9caec0" />
        {[507, 567].map((x) =>
          [131, 175].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill="#8ca2b3" />),
        )}
        <circle cx="537" cy="154" r="24" fill="#b5c4d0" stroke="#8ba1b5" />
        <path
          d={`M537 154L${elbowX} ${elbowY}L${handX} ${handY}`}
          fill="none"
          stroke="#a2b5c5"
          strokeWidth="24"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={`M537 154L${elbowX} ${elbowY}L${handX} ${handY}`}
          fill="none"
          stroke={alarm ? '#e6aa69' : '#f4be70'}
          strokeWidth="18"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="537" cy="154" r="12" fill="#536880" stroke="#e5ebef" strokeWidth="3" />
        <circle cx={elbowX} cy={elbowY} r="11" fill="#536880" stroke="#e5ebef" strokeWidth="3" />
        <rect x={handX - 10} y={handY - 6} width="20" height="16" rx="4" fill="#40576e" />
        <path
          d={`M${handX - 8} ${handY + 9}v8h4M${handX + 8} ${handY + 9}v8h-4`}
          fill="none"
          stroke="#40576e"
          strokeWidth="3"
        />
      </g>
      {s.robot === 'inspect' && (
        <g>
          <rect
            x={targetX - 26}
            y="272"
            width="52"
            height="52"
            rx="8"
            fill="#4dbb9f12"
            stroke="#35a88c"
          />
          <path
            d={`M${targetX - 24} ${276 + (robotAge % 0.5) * 85}h48`}
            stroke="#3bb294"
            strokeWidth="2"
          />
          <text x={targetX} y="396" textAnchor="middle" fontSize="10" fill="#238d77">
            検品中 · {Math.min(100, (robotAge / c.inspectionTime) * 100).toFixed(0)}%
          </text>
        </g>
      )}
      <g transform="translate(744 163)">
        <rect width="143" height="49" rx="7" fill="#fff" stroke="#dbe3eb" />
        <circle cx="14" cy="17" r="3" fill={s.signals.downstreamReady ? '#229f86' : '#d47b59'} />
        <text x="25" y="21" fontSize="10" fill="#5a6b81">
          {s.signals.downstreamReady ? '次工程 受入可能' : 'バッファ満杯'}
        </text>
        <text x="14" y="37" fill="#8a98a8" fontSize="9">
          BUFFER {s.output.length} / {d.outputCapacity}
        </text>
      </g>
      {s.inputs.outputBlocked && (
        <g>
          <path d="M896 248v104" stroke="#d97457" strokeWidth="7" />
          <text x="905" y="239" textAnchor="end" fontSize="10" fill="#bd6045">
            搬出閉塞
          </text>
        </g>
      )}
      <g stroke="#93a7b9" fill="none" strokeWidth="1.5">
        <path d="M305 397h35l-5-4m5 4-5 4M732 397h35l-5-4m5 4-5 4" />
      </g>
      <g fontSize="9" fill="#7e90a4">
        <text x="65" y="434">
          TOP VIEW · 単位 mm
        </text>
        <text x="500" y="434" textAnchor="middle">
          {s.velocity.toFixed(0)} mm/s · {linePhaseLabel(s)}
        </text>
        <text x="930" y="434" textAnchor="end">
          LINE 01 / AUTO
        </text>
      </g>
      <g transform="translate(923 106)">
        <rect x="-3" y="0" width="6" height="51" rx="3" fill="#52677d" />
        <rect x="-9" y="-11" width="18" height="12" rx="4" fill={alarm ? '#e87860' : '#e7cfcb'} />
        <rect
          x="-9"
          y="3"
          width="18"
          height="12"
          rx="4"
          fill={!running && !alarm ? '#e8ba64' : '#ebe3cc'}
        />
        <rect
          x="-9"
          y="17"
          width="18"
          height="12"
          rx="4"
          fill={running && !alarm ? '#36ae8c' : '#c5dfd8'}
        />
      </g>
    </svg>
  );
}

export function SignalTrace({ state }: { state: LineState }) {
  const end = Math.max(16, state.time),
    start = end - 16;
  const x = (t: number) => 163 + ((t - start) / 16) * 695;
  // Include the last sample before the visible window to keep held signals continuous.
  const first = state.history.findIndex((h) => h.at >= start);
  const samples = state.history.slice(Math.max(0, first - 1));
  return (
    <svg
      className="signal-trace"
      viewBox="0 0 900 210"
      role="img"
      aria-label="直近16秒のPLC信号タイミングチャート"
    >
      {[0, 4, 8, 12, 16].map((t) => (
        <g key={t}>
          <path d={`M${x(start + t)} 12v166`} stroke="#e9edf2" />
          <text x={x(start + t)} y="201" textAnchor="middle" fontSize="9" fill="#8a98a7">
            {(start + t).toFixed(0)}s
          </text>
        </g>
      ))}
      {signalLabels.map(({ key, label, address }, i) => {
        const low = 30 + i * 23,
          high = low - 11;
        let path = '';
        samples.forEach((sample, index) => {
          const px = x(Math.max(start, sample.at)),
            py = sample[key] ? high : low;
          path += index === 0 ? `M${px} ${py}` : `H${px}V${py}`;
        });
        if (samples.length) path += `H${x(state.time)}`;
        return (
          <g key={key}>
            <text x="10" y={low - 2} fontSize="9" fill="#9aa7b4">
              {address}
            </text>
            <text x="38" y={low - 2} fontSize="10" fill="#536479">
              {label}
            </text>
            <path
              d={path}
              stroke={state.signals[key] ? '#169b83' : '#6f91a4'}
              fill="none"
              strokeWidth="1.5"
            />
            <circle cx="879" cy={low - 6} r="3" fill={state.signals[key] ? '#19a88b' : '#d9e0e7'} />
          </g>
        );
      })}
      <path d={`M${x(state.time)} 10v174`} stroke="#e5ae54" strokeDasharray="3 3" />
    </svg>
  );
}
