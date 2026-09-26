import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Money, Badge, Card, Empty } from '../../components/ui';
import { Loading, LoadError } from '../../components/animations';
import { AreaChart, BarList } from '../../components/charts';
import { STAGE_NAMES } from '../../types';
import type { DashboardData } from '../../types';
import { Grid, Coins, Stamp, Shield, CheckCircle, Folder, Alert, Clock } from '../../components/icons';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/dashboard'),
  });

  if (isLoading) return <Loading label="Loading dashboard" size={160} />;
  if (isError) return <LoadError onRetry={() => refetch()} />;
  if (!data) return null;

  const firstName = user?.fullName.split(/\s+/)[0] ?? 'there';

  /* Client portal dashboard, deliberately minimal (scoped server-side too). */
  if (data.kind === 'client') {
    return (
      <div>
        <div className="page-head">
          <div className="title-block">
            <span className="eyebrow">Client portal</span>
            <h1 className="display">{greeting()}, {firstName}</h1>
            <p className="sub">Projects where {user?.tenant.name.split(' ')[0]} is the accountable client contact.</p>
          </div>
        </div>
        <div className="kpi-grid">
          <Card pad kpi>
            <div className="label"><Folder /> Your projects</div>
            <div className="value">{String(data.kpis.clientProjects ?? 0)}</div>
          </Card>
          <Card pad kpi>
            <div className="label"><Coins /> Portfolio value</div>
            <div className="value"><Money v={String(data.kpis.portfolioValue ?? '0')} /></div>
          </Card>
          <Card pad kpi>
            <div className="label"><Shield /> Awaiting your approval</div>
            <div className="value">{data.pendingApprovals?.length ?? 0}</div>
          </Card>
        </div>
        <Card pad>
          <h3 className="serif-h">Awaiting sign-off</h3>
          {data.pendingApprovals?.length ? (
            data.pendingApprovals.map((p) => (
              <div className="approval-row" key={p.id}>
                <div>
                  <Link to={`../projects/${p.id}`}><b>{p.name}</b></Link>
                  <div className="fine">Stage {p.stage_index}, {STAGE_NAMES[p.stage_index - 1]}</div>
                </div>
                <span style={{ marginLeft: 'auto' }}><Link className="btn sm" to={`../projects/${p.id}`}>Review</Link></span>
              </div>
            ))
          ) : (
            <Empty icon={<CheckCircle />} title="Nothing awaiting your signature" sub="When a stage gate is fully endorsed by the firm's domain leads, it appears here for your approval." />
          )}
        </Card>
      </div>
    );
  }

  const k = data.kpis;
  const months = data.certifiedByMonth ?? [];
  const stageBars = (data.stageDistribution ?? []).map((s) => ({
    label: STAGE_NAMES[s.current_stage_index - 1],
    value: s.n,
  }));

  return (
    <div>
      <div className="page-head">
        <div className="title-block">
          <span className="eyebrow">Private firm portfolio</span>
          <h1 className="display">{greeting()}, {firstName}</h1>
          <p className="sub">{new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <Link to="../projects" className="btn secondary">View portfolio</Link>
      </div>

      <div className="kpi-grid">
        <Card kpi>
          <div className="label"><Grid /> Active projects</div>
          <div className="value">{String(k.activeProjects ?? 0)}</div>
          <div className="foot">{String(k.completedProjects ?? 0)} completed to date</div>
        </Card>
        <Card kpi>
          <div className="label"><Coins /> Portfolio value</div>
          <div className="value"><Money v={String(k.portfolioValue ?? 0)} /></div>
          <div className="foot">Across all live engagements</div>
        </Card>
        <Card kpi>
          <div className="label"><Stamp /> Certified this year</div>
          <div className="value"><Money v={String(k.certifiedYtd ?? 0)} /></div>
          <div className="foot"><Money v={String(k.certifiedAll ?? 0)} /> certified all-time</div>
        </Card>
        <Card kpi>
          <div className="label"><Shield /> Pending sign-offs</div>
          <div className="value">{Number(k.pendingEndorsements ?? 0) + Number(k.pendingClientApprovals ?? 0)}</div>
          <div className="foot">{String(k.pendingClientApprovals ?? 0)} with the client</div>
        </Card>
      </div>

      <div className="dash-grid">
        <Card>
          <div className="card-head">
            <h3 className="serif-h">Certified value</h3>
            <span className="fine">Net of deductions · last {months.length || 6} months</span>
          </div>
          <div className="card pad" style={{ padding: 'var(--s4) var(--s5) var(--s5)' }}>
            {months.length ? (
              <AreaChart data={months.map((m) => ({ label: m.month.slice(2).replace('-', '/'), value: parseFloat(m.net_value) }))} />
            ) : (
              <Empty icon={<Coins />} title="No certificates yet" sub="Certified payment certificates will chart here." />
            )}
          </div>
        </Card>
        <Card>
          <div className="card-head"><h3 className="serif-h">Live projects by stage</h3></div>
          <div className="card pad" style={{ padding: 'var(--s4) var(--s5) var(--s5)' }}>
            {stageBars.length ? <BarList data={stageBars} /> : <Empty icon={<Folder />} title="No active projects" />}
          </div>
        </Card>
      </div>

      <div className="dash-grid">
        <Card>
          <div className="card-head"><h3 className="serif-h">Recent activity</h3><Link className="fine" to="../settings/activity">Full audit trail</Link></div>
          <div className="card pad" style={{ padding: '0 var(--s5) var(--s4)' }}>
            {(data.recentActivity ?? []).map((a, i) => (
              <div className="feed-item" key={i}>
                <span className="when">{new Date(a.created_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}</span>
                <span className="what"><b>{a.actor_name ?? 'System'}</b>, {a.summary}</span>
              </div>
            ))}
            {!data.recentActivity?.length && <Empty icon={<Clock />} title="Quiet so far" />}
          </div>
        </Card>
        <Card>
          <div className="card-head"><h3 className="serif-h">My outstanding tasks</h3><Link className="fine" to="../kanban">Board</Link></div>
          <div className="card pad" style={{ padding: 'var(--s2) var(--s5) var(--s4)' }}>
            {(data.outstandingTasks ?? []).map((t) => (
              <div className="approval-row" key={t.id}>
                <span className="priority-dot" style={{ background: t.priority === 'HIGH' ? 'var(--clay)' : t.priority === 'MEDIUM' ? 'var(--gold)' : 'var(--sage)' }} />
                <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <span className="fine" style={{ color: 'var(--ink)', fontWeight: 600 }}>{t.title}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{t.project_name}{t.due_date ? ` · due ${new Date(t.due_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}` : ''}</span>
                </span>
                <span style={{ marginLeft: 'auto' }}><Badge tone={t.status === 'REVIEW' ? 'gold' : 'terracotta'}>{t.status === 'IN_PROGRESS' ? 'in progress' : t.status.toLowerCase()}</Badge></span>
              </div>
            ))}
            {!data.outstandingTasks?.length && <Empty icon={<CheckCircle />} title="All clear" sub="No outstanding tasks assigned to you." />}
          </div>
        </Card>
      </div>

      {Number(k.pendingEndorsements ?? 0) > 0 && (
        <div style={{ marginTop: 'var(--s4)' }}>
          <div className="portal-note">
            <Alert />
            <span>
              <b>{String(k.pendingEndorsements)}</b> stage gate{Number(k.pendingEndorsements) === 1 ? '' : 's'} need your domain endorsement, <Link to="../approvals">review now</Link>.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
