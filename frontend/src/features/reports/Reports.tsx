import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Card, Money } from '../../components/ui';
import { Loading, LoadError } from '../../components/animations';
import { STAGE_NAMES } from '../../types';
import type { ProjectSummary } from '../../types';

/** Single, unconditional private-firm report view (spec §3.1): the
 *  government KPI branch does not exist in this build. */
export default function Reports() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['projects'], queryFn: () => api<{ projects: ProjectSummary[] }>('/projects') });

  const projects = data?.projects ?? [];
  const total = projects.reduce((s, p) => s + parseFloat(p.contract_value ?? '0'), 0);
  const complete = projects.filter((p) => p.status === 'COMPLETE').length;
  const active = projects.filter((p) => p.status === 'ACTIVE').length;

  const exportCsv = () => {
    const rows = [
      ['Code', 'Name', 'Client', 'Stage', 'Contract value (ZAR)', 'Status'],
      ...projects.map((p) => [
        p.code, p.name, p.client_name ?? '', STAGE_NAMES[p.current_stage_index - 1],
        p.contract_value ?? '', p.status,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `provenance-portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <Loading label="Loading report" size={150} />;
  if (isError) return <LoadError onRetry={() => refetch()} />;

  return (
    <div>
      <div className="page-head">
        <div className="title-block">
          <span className="eyebrow">Reporting</span>
          <h1 className="display">Private firm portfolio</h1>
          <p className="sub">Contract position across the whole book of work.</p>
        </div>
        <button className="btn secondary" onClick={exportCsv}>Export CSV</button>
      </div>

      <div className="kpi-grid">
        <Card pad kpi><div className="label">Projects</div><div className="value">{projects.length}</div><div className="foot">{active} active · {complete} complete</div></Card>
        <Card pad kpi><div className="label">Total contract value</div><div className="value"><Money v={total} /></div><div className="foot">Sum of all engagements</div></Card>
        <Card pad kpi>
          <div className="label">Average stage</div>
          <div className="value">{projects.length ? (projects.reduce((s, p) => s + p.current_stage_index, 0) / projects.length).toFixed(1) : 'none'}</div>
          <div className="foot">Of 11 stages</div>
        </Card>
        <Card pad kpi>
          <div className="label">Completion rate</div>
          <div className="value">{projects.length ? Math.round((complete / projects.length) * 100) : 0}%</div>
          <div className="foot">Of the full portfolio</div>
        </Card>
      </div>

      <Card>
        <div className="card-head"><h3 className="serif-h">Contract position by project</h3></div>
        <div className="card pad" style={{ paddingTop: 'var(--s3)' }}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Project</th><th>Client</th><th>Stage</th><th style={{ minWidth: 170 }}>% of portfolio value</th><th className="num">Contract value</th></tr></thead>
              <tbody>
                {projects.map((p) => {
                  const v = parseFloat(p.contract_value ?? '0');
                  const pct = total > 0 ? (v / total) * 100 : 0;
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}<div className="fine mono">{p.code}</div></td>
                      <td>{p.client_name ?? 'none'}</td>
                      <td className="fine">{STAGE_NAMES[p.current_stage_index - 1]}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="progress" style={{ flex: 1 }}><i style={{ width: `${pct}%` }} /></div>
                          <span className="mono fine" style={{ minWidth: 42, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="num"><Money v={p.contract_value} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
}
