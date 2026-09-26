/** Dependency-free SVG charts, compositor-friendly, warm-tinted, and quiet.
 *  Values are labelled on the ends; no floating tooltips needed for this scale. */

export function AreaChart({ data, height = 180 }: { data: { label: string; value: number }[]; height?: number }) {
  if (data.length === 0) return <div className="skeleton" style={{ height }} />;
  const W = 560;
  const H = height;
  const padX = 8;
  const padTop = 14;
  const padBottom = 26;
  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = data.length > 1 ? (W - padX * 2) / (data.length - 1) : 0;
  const pts = data.map((d, i) => [padX + i * stepX, padTop + (1 - d.value / max) * (H - padTop - padBottom)] as const);

  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - padBottom} L${pts[0][0].toFixed(1)},${H - padBottom} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Certified value by month">
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c0642c" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#c0642c" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={padX} x2={W - padX} y1={padTop + f * (H - padTop - padBottom)} y2={padTop + f * (H - padTop - padBottom)} stroke="rgba(62,46,27,0.08)" strokeDasharray="2 5" />
      ))}
      <path d={area} fill="url(#areaFill)" />
      <path d={line} fill="none" stroke="#c0642c" strokeWidth="2.2" strokeLinecap="round" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 4 : 2.5} fill={i === pts.length - 1 ? '#a5541f' : '#fffdf8'} stroke="#c0642c" strokeWidth="1.6" />
      ))}
      <text x={last[0]} y={last[1] - 10} textAnchor="end" fontSize="11" fontFamily="DM Mono, monospace" fill="#5d5244">
        R{(data[data.length - 1].value / 1e6).toFixed(1)}M
      </text>
      {data.map((d, i) => (
        <text key={d.label} x={pts[i][0]} y={H - 8} textAnchor="middle" fontSize="10" fontFamily="DM Mono, monospace" fill="#938773">
          {d.label}
        </text>
      ))}
    </svg>
  );
}

export function Donut({ data, size = 148 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Portfolio split">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {data.map((d) => {
            const frac = d.value / total;
            const seg = (
              <circle
                key={d.label}
                cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke={d.color} strokeWidth="14"
                strokeDasharray={`${(frac * c).toFixed(1)} ${c.toFixed(1)}`}
                strokeDashoffset={(-acc * c).toFixed(1)}
                strokeLinecap="butt"
              />
            );
            acc += frac;
            return seg;
          })}
        </g>
        <text x="50%" y="47%" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="20" fill="#251c12">{total}</text>
        <text x="50%" y="60%" textAnchor="middle" fontFamily="Montserrat, sans-serif" fontSize="9.5" fill="#938773" letterSpacing="1">PROJECTS</text>
      </svg>
      <div style={{ display: 'grid', gap: 8 }}>
        {data.map((d) => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flex: 'none' }} />
            <span style={{ color: 'var(--ink-2)' }}>{d.label}</span>
            <b className="mono" style={{ marginLeft: 'auto' }}>{d.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarList({ data }: { data: { label: string; value: number; suffix?: string }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{d.label}</span>
            <span className="mono">{d.value}{d.suffix ?? ''}</span>
          </div>
          <div className="progress">
            <i style={{ width: `${(d.value / max) * 100}%`, background: 'var(--gold)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
