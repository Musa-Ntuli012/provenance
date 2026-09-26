import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Badge, Card, Empty, Money } from '../../components/ui';
import { Loading, LoadError } from '../../components/animations';
import { STAGE_NAMES } from '../../types';
import type { ProjectSummary } from '../../types';
import { MapPin } from '../../components/icons';

/** GPS project map, a self-contained schematic plot (no tile server, no
 *  network dependency): project coordinates projected into an SVG canvas,
 *  pin size scaled by contract value. */
export default function Maps() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['projects'], queryFn: () => api<{ projects: ProjectSummary[] }>('/projects') });
  const [hover, setHover] = useState<string | null>(null);

  const projects = useMemo(
    () => (data?.projects ?? []).filter((p) => p.latitude && p.longitude),
    [data],
  );

  const W = 640;
  const H = 460;
  const PAD = 48;

  const bounds = useMemo(() => {
    if (projects.length === 0) return null;
    const lats = projects.map((p) => parseFloat(p.latitude!));
    const lngs = projects.map((p) => parseFloat(p.longitude!));
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const spanLat = Math.max(maxLat - minLat, 0.08);
    const spanLng = Math.max(maxLng - minLng, 0.08);
    return { minLat, spanLat, minLng, spanLng };
  }, [projects]);

  const project = (p: ProjectSummary) => {
    if (!bounds) return [0, 0];
    const x = PAD + ((parseFloat(p.longitude!) - bounds.minLng) / bounds.spanLng) * (W - PAD * 2);
    const y = H - PAD - ((parseFloat(p.latitude!) - bounds.minLat) / bounds.spanLat) * (H - PAD * 2);
    return [x, y] as const;
  };

  const maxVal = Math.max(...projects.map((p) => parseFloat(p.contract_value ?? '0')), 1);

  return (
    <div>
      <div className="page-head">
        <div className="title-block">
          <span className="eyebrow">Geographic index</span>
          <h1 className="display">Project map</h1>
          <p className="sub">Schematic GPS plot, pin size follows contract value.</p>
        </div>
      </div>

      <div className="map-wrap">
        <Card pad>
          {isLoading ? (
            <Loading label="Loading map" size={150} />
          ) : isError ? (
            <LoadError onRetry={() => refetch()} />
          ) : projects.length === 0 ? (
            <Empty icon={<MapPin />} title="No geolocated projects" sub="Add latitude and longitude to a project to place it on the map." />
          ) : (
            <svg className="map-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Project locations">
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M40 0H0V40" fill="none" stroke="rgba(62,46,27,0.07)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect x="0" y="0" width={W} height={H} rx="14" fill="#efe7d6" />
              <rect x="0" y="0" width={W} height={H} rx="14" fill="url(#grid)" />
              {projects.map((p) => {
                const [x, y] = project(p);
                const v = parseFloat(p.contract_value ?? '0');
                const r = 8 + (v / maxVal) * 12;
                const active = hover === p.id;
                return (
                  <g key={p.id} className="map-pin" onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} onClick={() => setHover(p.id)}>
                    <circle cx={x} cy={y} r={r + 6} fill="rgba(192,100,44,0.15)" />
                    <circle cx={x} cy={y} r={r} fill={active ? '#a5541f' : '#c0642c'} stroke="#fffdf8" strokeWidth="2.5" />
                    <text x={x} y={y + 3.5} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#fff7ef" fontFamily="DM Mono, monospace">{p.code.replace('PRJ-', '')}</text>
                    {active && (
                      <g transform={`translate(${Math.min(x + r + 8, W - 190)}, ${Math.max(y - 30, 10)})`}>
                        <rect width="180" height="58" rx="9" fill="#251c12" opacity="0.96" />
                        <text x="12" y="21" fontSize="11.5" fontWeight="600" fill="#f7f1e6" fontFamily="Montserrat, sans-serif">{p.name.slice(0, 30)}</text>
                        <text x="12" y="38" fontSize="10" fill="rgba(247,241,230,0.7)" fontFamily="Montserrat, sans-serif">{STAGE_NAMES[p.current_stage_index - 1]}</text>
                        <text x="12" y="51" fontSize="10" fill="#e8b98a" fontFamily="DM Mono, monospace">{new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(v)}</text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </Card>

        <Card pad style={{ alignContent: 'start' }}>
          <h3 className="serif-h">Index</h3>
          <div className="hr" />
          {projects.map((p) => (
            <div className="approval-row" key={p.id} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}>
              <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <Link to={`../projects/${p.id}`} style={{ fontWeight: 600 }}>{p.name}</Link>
                <span className="fine mono">{p.code} · {Number(p.latitude).toFixed(3)}, {Number(p.longitude).toFixed(3)}</span>
              </span>
              <span style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <Money v={p.contract_value} />
                <div><Badge tone={p.status === 'COMPLETE' ? 'sage' : 'terracotta'}>{p.status.toLowerCase()}</Badge></div>
              </span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
