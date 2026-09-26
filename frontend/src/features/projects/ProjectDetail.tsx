import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth, can, ROLE_LABELS } from '../../auth/AuthContext';
import { Badge, Button, Card, Confirm, Empty, Field, FormRow, Modal, Money, useToast, useCelebrate, Avatar } from '../../components/ui';
import { Loading, LoadError, ErrorBanner } from '../../components/animations';
import { DOMAIN_LABELS } from '../../types';
import type { DocumentRecord, Domain, ProjectDetail as Detail, Certificate, VariationOrder } from '../../types';
import { ArrowLeft, Check, CheckCircle, Clock, Coins, File, Layers, Plus, Stamp, Upload, X, Alert } from '../../components/icons';

type Tab = 'overview' | 'gates' | 'domains' | 'finance' | 'files' | 'activity';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'gates', label: 'Stage gates' },
  { id: 'domains', label: 'Domains' },
  { id: 'finance', label: 'Finance' },
  { id: 'files', label: 'Files' },
  { id: 'activity', label: 'Activity' },
];

export default function ProjectDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api<Detail>(`/projects/${id}`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['project', id] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['pending-approvals-count'] });
  };

  if (isLoading) return <Loading label="Loading project" size={150} />;
  if (isError) return <LoadError onRetry={() => refetch()} />;
  if (!data) return null;

  const { project, client, gates } = data;
  const isClient = user?.role === 'CLIENT_APPROVER' || user?.role === 'CLIENT_TEMP';
  const tabs = TABS.filter((t) => (t.id !== 'finance' || !isClient));

  return (
    <div>
      <div style={{ marginBottom: 'var(--s3)' }}>
        <Link to="../projects" className="fine" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft width={14} height={14} /> Portfolio
        </Link>
      </div>

      <Card pad style={{ marginBottom: 'var(--s5)' }}>
        <div className="proj-head" style={{ margin: 0 }}>
          <div>
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span className="mono fine">{project.code}</span>
              {project.status === 'COMPLETE' ? <Badge tone="sage">complete</Badge>
                : project.status === 'ON_HOLD' ? <Badge tone="clay">on hold</Badge>
                : gates[project.current_stage_index - 1]?.status === 'PENDING_CLIENT' ? <Badge tone="gold" dot>client sign-off</Badge>
                : <Badge tone="terracotta" dot>active</Badge>}
            </span>
            <h1 className="serif-h" style={{ fontSize: 30 }}>{project.name}</h1>
            <div className="meta">
              <div className="meta-item"><span className="k">Client</span><span className="v">{client?.name ?? 'none'}</span></div>
              <div className="meta-item"><span className="k">Contract</span><span className="v mono"><Money v={project.contract_value} /></span></div>
              <div className="meta-item"><span className="k">Current stage</span><span className="v">{project.stageName} <span className="muted">({project.current_stage_index}/11)</span></span></div>
              {project.target_end_date && (
                <div className="meta-item"><span className="k">Target completion</span><span className="v">{new Date(project.target_end_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
              )}
              {project.latitude && project.longitude && (
                <div className="meta-item"><span className="k">Position</span><span className="v mono">{Number(project.latitude).toFixed(3)}, {Number(project.longitude).toFixed(3)}</span></div>
              )}
            </div>
          </div>
        </div>

        <div className="stage-rail" role="list" aria-label="Stage ladder">
          {gates.map((g) => (
            <div key={g.stage_index} role="listitem" className={`stage-node ${g.status === 'COMPLETED' ? 'done' : ''} ${g.stage_index === project.current_stage_index ? 'current' : ''}`}>
              <span className="pip">{g.status === 'COMPLETED' ? <Check width={13} height={13} /> : g.stage_index}</span>
              <span className="nm">{g.stageName}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="tabs" style={{ marginBottom: 'var(--s5)' }}>
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'overview' && <Overview data={data} onInvalidate={invalidate} />}
      {tab === 'gates' && <Gates data={data} onInvalidate={invalidate} />}
      {tab === 'domains' && <Domains data={data} />}
      {tab === 'finance' && <Finance projectId={id} onInvalidate={invalidate} />}
      {tab === 'files' && <FilesTab projectId={id} />}
      {tab === 'activity' && <ActivityTab projectId={id} />}
    </div>
  );
}

/* ================================ Overview ================================ */

function Overview({ data, onInvalidate }: { data: Detail; onInvalidate: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [funding, setFunding] = useState({ sourceName: '', amount: '' });
  const addFunding = useMutation({
    mutationFn: () => api(`/finance/projects/${data.project.id}/funding`, { body: { sourceName: funding.sourceName, amount: parseFloat(funding.amount) } }),
    onSuccess: () => { setFunding({ sourceName: '', amount: '' }); toast('Funding source allocated'); onInvalidate(); },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed', 'err'),
  });

  return (
    <div style={{ display: 'grid', gap: 'var(--s4)' }}>
      <Card pad>
        <h3 className="serif-h" style={{ marginBottom: 8 }}>Scope</h3>
        <p className="muted" style={{ margin: 0, maxWidth: '80ch' }}>{data.project.description || 'No scope description captured yet.'}</p>
      </Card>
      {data.financeSummary && (
        <Card pad>
          <h3 className="serif-h" style={{ marginBottom: 12 }}>Financial position</h3>
          <div className="meta" style={{ marginTop: 0 }}>
            <div className="meta-item"><span className="k">Certified to date (net)</span><span className="v mono"><Money v={data.financeSummary.certified_net} cents /></span></div>
            <div className="meta-item"><span className="k">Certificates</span><span className="v mono">{data.financeSummary.certified_count} certified · {data.financeSummary.pending_count} in flight</span></div>
            <div className="meta-item"><span className="k">Approved variations</span><span className="v mono"><Money v={data.financeSummary.approved_value} cents /></span></div>
            <div className="meta-item">
              <span className="k">Contract certified</span>
              <span className="v mono">
                {data.project.contract_value
                  ? `${Math.min(100, Math.round((parseFloat(data.financeSummary.certified_gross) / parseFloat(data.project.contract_value)) * 100))}%`
                  : 'none'}
              </span>
            </div>
          </div>
        </Card>
      )}
      {data.funding && (
        <Card pad>
          <h3 className="serif-h" style={{ marginBottom: 12 }}>Funding sources</h3>
          {data.funding.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Source</th><th>Type</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {data.funding.map((f) => (
                    <tr key={f.id}><td>{f.source_name}</td><td><Badge>{f.funder_type}</Badge></td><td className="num"><Money v={f.amount} cents /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="fine">No funding sources allocated.</p>
          )}
          {can(user?.role, 'finance.write') && (
            <form style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'end', flexWrap: 'wrap' }}
              onSubmit={(e) => { e.preventDefault(); if (funding.sourceName && funding.amount) addFunding.mutate(); }}>
              <div style={{ flex: 2, minWidth: 180 }}>
                <Field label="Add source"><input className="input" value={funding.sourceName} onChange={(e) => setFunding((f) => ({ ...f, sourceName: e.target.value }))} placeholder="Client development facility" /></Field>
              </div>
              <div style={{ flex: 1, minWidth: 130 }}>
                <Field label="Amount (ZAR)"><input className="input mono" type="number" min="0" step="0.01" value={funding.amount} onChange={(e) => setFunding((f) => ({ ...f, amount: e.target.value }))} /></Field>
              </div>
              <Button type="submit" variant="secondary" icon={<Plus />} disabled={addFunding.isPending}>Allocate</Button>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}

/* =============================== Stage gates ============================== */

function Gates({ data, onInvalidate }: { data: Detail; onInvalidate: () => void }) {
  const current = data.project.current_stage_index;

  return (
    <div className="gate-row">
      {data.gates.slice().sort((a, b) => b.stage_index - a.stage_index).map((g) => {
        const assigned = data.assignments.map((a) => a.domain);
        const isActive = g.stage_index === current;
        return (
          <Card key={g.stage_index} pad className={`gate-card ${!isActive && g.status !== 'PENDING_CLIENT' && g.status !== 'COMPLETED' ? 'dim' : ''}`}>
            <div className="gate-top">
              <span className="idx">STAGE {String(g.stage_index).padStart(2, '0')}</span>
              <b>{g.stageName}</b>
              {g.status === 'COMPLETED' && <Badge tone="sage"><Check width={11} height={11} /> passed</Badge>}
              {g.status === 'IN_PROGRESS' && <Badge tone="terracotta" dot>in progress</Badge>}
              {g.status === 'PENDING_CLIENT' && <Badge tone="gold" dot>awaiting client</Badge>}
              {g.status === 'LOCKED' && <Badge>locked</Badge>}
              {g.completed_at && <span className="fine"><Clock width={12} height={12} style={{ verticalAlign: -2 }} /> {new Date(g.completed_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
            </div>

            {(isActive || g.status === 'PENDING_CLIENT') && (
              <div className="req-list">
                {assigned.length === 0 && <span className="req wait"><Alert /> No domains assigned, add domain leads under Domains.</span>}
                {assigned.map((d) => {
                  const e = g.endorsements
                    .filter((x) => x.domain === d)
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
                  const fresh = e && (!g.client_reviewed_at || new Date(e.created_at) > new Date(g.client_reviewed_at));
                  return (
                    <span key={d} className={`req ${fresh ? (e.decision === 'ENDORSED' ? 'ok' : 'bad') : 'wait'}`}>
                      {fresh ? (e.decision === 'ENDORSED' ? <CheckCircle /> : <Alert />) : <Clock />}
                      {DOMAIN_LABELS[d]}, {fresh ? (e.decision === 'ENDORSED' ? `endorsed by ${e.endorser_name}` : `changes requested by ${e.endorser_name}`) : 'endorsement outstanding'}
                    </span>
                  );
                })}
                <span className={`req ${g.approvals.some((a) => a.decision === 'APPROVED' && (!g.client_reviewed_at || new Date(a.created_at) > new Date(g.client_reviewed_at))) ? 'ok' : 'wait'}`}>
                  {g.approvals.some((a) => a.decision === 'APPROVED' && (!g.client_reviewed_at || new Date(a.created_at) > new Date(g.client_reviewed_at))) ? <CheckCircle /> : <Clock />}
                  Client approval {g.client_approval_required ? '' : '(not required)'}
                </span>
              </div>
            )}

            {(isActive || g.status === 'PENDING_CLIENT') && <GateActions data={data} gate={g} onInvalidate={onInvalidate} />}

            {!isActive && g.status === 'COMPLETED' && g.approvals.length > 0 && (
              <span className="fine">Approved by {g.approvals[g.approvals.length - 1].approver_name}</span>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function GateActions({ data, gate, onInvalidate }: { data: Detail; gate: Detail['gates'][number]; onInvalidate: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const celebrate = useCelebrate();
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState<null | 'APPROVED' | 'REJECTED'>(null);

  const myDomain = data.assignments.find((a) => user && a.user.id === user.id)?.domain;
  const myEndorsement = gate.endorsements
    .filter((e) => e.domain === myDomain)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const myEndorsementIsCurrent =
    myEndorsement !== undefined &&
    (!gate.client_reviewed_at || new Date(myEndorsement.created_at) > new Date(gate.client_reviewed_at));
  const alreadyEndorsed = myEndorsementIsCurrent && myEndorsement.decision === 'ENDORSED';

  const endorse = useMutation({
    mutationFn: (decision: 'ENDORSED' | 'CHANGES_REQUESTED') =>
      api(`/projects/${data.project.id}/stages/${gate.stage_index}/endorse`, {
        body: { domain: myDomain, decision, note: note || undefined },
      }),
    onSuccess: (_d, decision) => {
      if (decision === 'ENDORSED') celebrate(`Endorsed, ${gate.stageName}`);
      else toast('Changes requested, returned to draft');
      setNote('');
      onInvalidate();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed', 'err'),
  });

  const clientApprove = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED') =>
      api(`/projects/${data.project.id}/stages/${gate.stage_index}/client-approval`, {
        body: { decision, note: note || undefined },
      }),
    onSuccess: (_d, decision) => {
      if (decision === 'APPROVED') celebrate('Gate approved, stage advanced');
      else toast('Gate returned for changes');
      setNote('');
      setConfirming(null);
      onInvalidate();
    },
    onError: (e) => {
      toast(e instanceof Error ? e.message : 'Failed', 'err');
      setConfirming(null);
    },
  });

  const canEndorse = can(user?.role, 'endorse') && myDomain && gate.status === 'IN_PROGRESS';
  const canApprove = can(user?.role, 'approvals.client') && gate.status === 'PENDING_CLIENT' && user?.role !== 'CLIENT_TEMP';

  if (!canEndorse && !canApprove && user?.role !== 'CLIENT_TEMP') return null;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Field label="Note to accompany your action" hint="Recorded on the audit trail">
        <textarea className="input" rows={2} style={{ minHeight: 56 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reviewed against the stage requirements…" />
      </Field>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {canEndorse && !alreadyEndorsed && (
          <>
            <Button size="sm" icon={<Check />} onClick={() => endorse.mutate('ENDORSED')} disabled={endorse.isPending}>Endorse {DOMAIN_LABELS[myDomain!]}</Button>
            <Button size="sm" variant="secondary" icon={<Alert />} onClick={() => endorse.mutate('CHANGES_REQUESTED')} disabled={endorse.isPending}>Request changes</Button>
          </>
        )}
        {canEndorse && alreadyEndorsed && (
          <span className="fine"><CheckCircle width={13} height={13} style={{ verticalAlign: -2, color: 'var(--sage)' }} /> You endorsed this stage.</span>
        )}
        {canApprove && (
          <>
            <Button size="sm" icon={<Stamp />} onClick={() => setConfirming('APPROVED')}>Approve stage</Button>
            <Button size="sm" variant="danger" icon={<X />} onClick={() => setConfirming('REJECTED')}>Return for changes</Button>
          </>
        )}
      </div>
      {confirming && (
        <Confirm
          title={confirming === 'APPROVED' ? `Approve ${gate.stageName}?` : `Return ${gate.stageName} for changes?`}
          body={confirming === 'APPROVED'
            ? 'Approval completes this gate, permanently records your sign-off, and opens the next stage. This cannot be undone.'
            : 'Returning the gate asks all domain leads to re-endorse the stage before it comes back to you.'}
          confirmLabel={confirming === 'APPROVED' ? 'Sign off' : 'Return gate'}
          danger={confirming === 'REJECTED'}
          onClose={() => setConfirming(null)}
          onConfirm={async () => { await clientApprove.mutateAsync(confirming); }}
        />
      )}
    </div>
  );
}

/* ================================ Domains ================================= */

function Domains({ data }: { data: Detail }) {
  const current = data.project.current_stage_index;
  const domains: Domain[] = ['PROFESSIONAL_SERVICES', 'GEOTECHNICAL', 'CONSTRUCTION_MANAGEMENT'];
  return (
    <div className="domain-cols">
      {domains.map((d, i) => {
        const a = data.assignments.find((x) => x.domain === d);
        const gate = data.gates[current - 1];
        const e = gate?.endorsements.filter((x) => x.domain === d).sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
        return (
          <Card pad key={d} className="domain-col">
            <span className={`badge ${['terracotta', 'gold', 'sage'][i]}`}>{DOMAIN_LABELS[d]}</span>
            {a ? (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar name={a.user.fullName} lg />
                  <span style={{ display: 'grid' }}>
                    <b>{a.user.fullName}</b>
                    <span className="fine">{ROLE_LABELS[a.user.role] ?? a.user.role}</span>
                  </span>
                </span>
                <span className="fine">{a.user.email}</span>
                <div className="hr" style={{ margin: '4px 0' }} />
                <span className="eyebrow">Current stage endorsement</span>
                {gate && gate.status !== 'LOCKED' ? (
                  e && (!gate.client_reviewed_at || new Date(e.created_at) > new Date(gate.client_reviewed_at)) ? (
                    <span className={`req ${e.decision === 'ENDORSED' ? 'ok' : 'bad'}`}>
                      {e.decision === 'ENDORSED' ? <CheckCircle /> : <Alert />} {e.decision === 'ENDORSED' ? 'Endorsed' : 'Changes requested'}
                    </span>
                  ) : (
                    <span className="req wait"><Clock /> Outstanding</span>
                  )
                ) : (
                  <span className="fine">Stage not open.</span>
                )}
              </>
            ) : (
              <span className="fine">No lead assigned, this domain is not active on the project.</span>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* ================================ Finance ================================= */

function Finance({ projectId, onInvalidate }: { projectId: string; onInvalidate: () => void }) {
  const certs = useQuery({ queryKey: ['certificates', projectId], queryFn: () => api<{ certificates: Certificate[] }>(`/finance/projects/${projectId}/certificates`) });
  const vos = useQuery({ queryKey: ['variations', projectId], queryFn: () => api<{ variationOrders: VariationOrder[] }>(`/finance/projects/${projectId}/variation-orders`) });
  const [showCert, setShowCert] = useState(false);
  const [showVo, setShowVo] = useState(false);

  return (
    <div style={{ display: 'grid', gap: 'var(--s4)' }}>
      <Card>
        <div className="card-head">
          <h3 className="serif-h">Payment certificates</h3>
          <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setShowCert(true)}>New certificate</Button>
        </div>
        <div className="card pad" style={{ paddingTop: 'var(--s3)' }}>
          {certs.isLoading ? <Loading label="Loading certificates" size={100} /> : (certs.data?.certificates.length ?? 0) === 0 ? (
            <Empty icon={<Coins />} title="No certificates raised" sub="Interim payment certificates appear here with their endorsement state." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>No.</th><th>Period</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net</th><th>Domain</th><th>Status</th></tr></thead>
                <tbody>
                  {(certs.data?.certificates ?? []).map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{c.certificate_no}</td>
                      <td className="fine">{new Date(c.period_start).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} to {new Date(c.period_end).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}</td>
                      <td className="num"><Money v={c.gross_value} cents /></td>
                      <td className="num"><Money v={c.deductions} cents /></td>
                      <td className="num"><b className="mono"><Money v={parseFloat(c.gross_value) - parseFloat(c.deductions)} cents /></b></td>
                      <td><Badge>{DOMAIN_LABELS[c.domain as Domain]?.slice(0, 12) ?? c.domain}</Badge></td>
                      <td>
                        <CertActions cert={c} onInvalidate={onInvalidate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="card-head">
          <h3 className="serif-h">Variation orders</h3>
          <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setShowVo(true)}>New variation</Button>
        </div>
        <div className="card pad" style={{ paddingTop: 'var(--s3)' }}>
          {vos.isLoading ? <Loading label="Loading variations" size={100} /> : (vos.data?.variationOrders.length ?? 0) === 0 ? (
            <Empty icon={<Layers />} title="No variations" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>No.</th><th>Description</th><th className="num">Value</th><th className="num">Time impact</th><th>Status</th></tr></thead>
                <tbody>
                  {(vos.data?.variationOrders ?? []).map((v) => (
                    <tr key={v.id}>
                      <td className="mono">{v.vo_number}</td>
                      <td className="fine" style={{ maxWidth: 380 }}>{v.description}</td>
                      <td className="num" style={{ color: parseFloat(v.value) < 0 ? 'var(--sage)' : undefined }}><Money v={v.value} cents /></td>
                      <td className="num">{v.time_impact_days > 0 ? `+${v.time_impact_days}d` : `${v.time_impact_days}d`}</td>
                      <td>
                        <VoActions vo={v} projectId={projectId} onInvalidate={onInvalidate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {showCert && <NewCertificate projectId={projectId} onClose={() => setShowCert(false)} onInvalidate={onInvalidate} />}
      {showVo && <NewVariation projectId={projectId} onClose={() => setShowVo(false)} onInvalidate={onInvalidate} />}
    </div>
  );
}

function CertActions({ cert, onInvalidate }: { cert: Certificate; onInvalidate: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const celebrate = useCelebrate();
  const act = useMutation({
    mutationFn: (action: 'endorse' | 'certify') =>
      api(`/finance/certificates/${cert.id}/${action}`, { body: action === 'endorse' ? { decision: 'ENDORSED' } : {} }),
    onSuccess: () => { celebrate(cert.status === 'DRAFT' ? 'Certificate endorsed' : 'Certificate certified'); onInvalidate(); },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed', 'err'),
  });

  if (cert.status === 'CERTIFIED') return <Badge tone="sage">certified</Badge>;
  if (cert.status === 'REJECTED') return <Badge tone="clay">rejected</Badge>;
  if (cert.status === 'ENDORSED') {
    return can(user?.role, 'finance.certify') ? (
      <Button size="sm" variant="secondary" icon={<Stamp />} onClick={() => act.mutate('certify')} disabled={act.isPending}>Certify</Button>
    ) : <Badge tone="gold">endorsed</Badge>;
  }
  // DRAFT, a lead of the certificate's own domain (or org admin) may endorse.
  const roleToDomain: Record<string, string> = {
    PROFESSIONAL_SERVICES_LEAD: 'PROFESSIONAL_SERVICES',
    GEOTECHNICAL_LEAD: 'GEOTECHNICAL',
    CONSTRUCTION_MANAGER: 'CONSTRUCTION_MANAGEMENT',
  };
  const myDomainEndorse =
    user?.role === 'ORG_ADMIN' ||
    (can(user?.role, 'finance.endorse') && roleToDomain[user?.role ?? ''] === cert.domain);
  return myDomainEndorse ? (
    <Button size="sm" variant="secondary" icon={<Check />} onClick={() => act.mutate('endorse')} disabled={act.isPending}>Endorse</Button>
  ) : <Badge>draft</Badge>;
}

function VoActions({ vo, projectId, onInvalidate }: { vo: VariationOrder; projectId: string; onInvalidate: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const celebrate = useCelebrate();
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/finance/variation-orders/${vo.id}/${body.action}`, { body }),
    onSuccess: () => {
      celebrate('Variation updated');
      void qc.invalidateQueries({ queryKey: ['variations', projectId] });
      onInvalidate();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed', 'err'),
  });

  if (vo.status === 'APPROVED') return <Badge tone="sage">approved</Badge>;
  if (vo.status === 'REJECTED') return <Badge tone="clay">rejected</Badge>;
  if (vo.status === 'ENDORSED' && can(user?.role, 'finance.write')) {
    return (
      <span style={{ display: 'inline-flex', gap: 6 }}>
        <Button size="sm" variant="secondary" onClick={() => act.mutate({ action: 'decision', decision: 'APPROVED' })}>Approve</Button>
        <Button size="sm" variant="ghost" onClick={() => act.mutate({ action: 'decision', decision: 'REJECTED' })}>Reject</Button>
      </span>
    );
  }
  if (vo.status === 'PROPOSED' && can(user?.role, 'finance.endorse')) {
    return <Button size="sm" variant="secondary" icon={<Check />} onClick={() => act.mutate({ action: 'endorse' })}>Endorse</Button>;
  }
  return <Badge tone={vo.status === 'ENDORSED' ? 'gold' : undefined}>{vo.status.toLowerCase()}</Badge>;
}

function NewCertificate({ projectId, onClose, onInvalidate }: { projectId: string; onClose: () => void; onInvalidate: () => void }) {
  const celebrate = useCelebrate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ certificateNo: '', periodStart: '', periodEnd: '', grossValue: '', deductions: '0', domain: 'CONSTRUCTION_MANAGEMENT' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/finance/projects/${projectId}/certificates`, {
        body: {
          certificateNo: f.certificateNo, periodStart: f.periodStart, periodEnd: f.periodEnd,
          grossValue: parseFloat(f.grossValue), deductions: parseFloat(f.deductions || '0'), domain: f.domain,
        },
      });
      celebrate('Certificate raised');
      onInvalidate();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  };

  return (
    <Modal title="New payment certificate" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--s4)' }}>
        {error ? <ErrorBanner message={error} /> : null}
        <FormRow>
          <Field label="Certificate number"><input className="input mono" value={f.certificateNo} onChange={set('certificateNo')} placeholder="PC-011" required /></Field>
          <Field label="Domain">
            <select className="input" value={f.domain} onChange={set('domain')}>
              {Object.entries(DOMAIN_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </FormRow>
        <FormRow>
          <Field label="Period start"><input className="input" type="date" value={f.periodStart} onChange={set('periodStart')} required /></Field>
          <Field label="Period end"><input className="input" type="date" value={f.periodEnd} onChange={set('periodEnd')} required /></Field>
        </FormRow>
        <FormRow>
          <Field label="Gross value (ZAR)"><input className="input mono" type="number" min="0" step="0.01" value={f.grossValue} onChange={set('grossValue')} required /></Field>
          <Field label="Deductions (ZAR)"><input className="input mono" type="number" min="0" step="0.01" value={f.deductions} onChange={set('deductions')} /></Field>
        </FormRow>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Raising…' : 'Raise certificate'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function NewVariation({ projectId, onClose, onInvalidate }: { projectId: string; onClose: () => void; onInvalidate: () => void }) {
  const celebrate = useCelebrate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ voNumber: '', description: '', value: '', timeImpactDays: '0' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/finance/projects/${projectId}/variation-orders`, {
        body: { voNumber: f.voNumber, description: f.description, value: parseFloat(f.value), timeImpactDays: parseInt(f.timeImpactDays || '0', 10) },
      });
      celebrate('Variation proposed');
      onInvalidate();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  };

  return (
    <Modal title="New variation order" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--s4)' }}>
        {error ? <ErrorBanner message={error} /> : null}
        <FormRow>
          <Field label="VO number"><input className="input mono" value={f.voNumber} onChange={set('voNumber')} placeholder="VO-004" required /></Field>
          <Field label="Time impact (days)"><input className="input mono" type="number" value={f.timeImpactDays} onChange={set('timeImpactDays')} /></Field>
        </FormRow>
        <Field label="Description"><textarea className="input" value={f.description} onChange={set('description')} required minLength={3} /></Field>
        <Field label="Value (ZAR)" hint="Negative for a credit variation">
          <input className="input mono" type="number" step="0.01" value={f.value} onChange={set('value')} required />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Proposing…' : 'Propose variation'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ================================ Files =================================== */

export function FilesTab({ projectId }: { projectId?: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const celebrate = useCelebrate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['documents', projectId ?? 'all'],
    queryFn: () => api<{ documents: DocumentRecord[] }>(projectId ? `/documents/projects/${projectId}/documents` : '/documents'),
  });
  const [busy, setBusy] = useState(false);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !projectId) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('projectId', projectId);
      fd.append('title', file.name.replace(/\.[^.]+$/, ''));
      fd.append('category', 'REPORT');
      await api('/documents', { formData: fd });
      celebrate('Document uploaded');
      void qc.invalidateQueries({ queryKey: ['documents'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  const docs = data?.documents ?? [];
  return (
    <Card>
      <div className="card-head">
        <h3 className="serif-h">Documents</h3>
        {projectId && can(user?.role, 'documents.write') && (
          <label className="btn secondary sm" style={{ cursor: busy ? 'wait' : 'pointer' }}>
            <Upload /> {busy ? 'Uploading…' : 'Upload'}
            <input type="file" style={{ display: 'none' }} onChange={upload} disabled={busy} />
          </label>
        )}
      </div>
      <div className="card pad" style={{ paddingTop: 'var(--s3)' }}>
        {isLoading ? <Loading label="Loading documents" size={120} /> : docs.length === 0 ? (
          <Empty icon={<File />} title="No documents" sub="Drawings, reports, certificates and approvals live here against their stage." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Title</th><th>Category</th>{!projectId ? <th>Project</th> : null}<th>Stage</th><th>By</th><th>Size</th><th></th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>{d.title}<div className="fine mono">{d.file_name}</div></td>
                    <td><Badge>{d.category.toLowerCase().replaceAll('_', ' ')}</Badge></td>
                    {!projectId ? <td>{d.project_name}</td> : null}
                    <td className="mono">{d.stage_index ? `S${d.stage_index}` : 'none'}</td>
                    <td className="fine">{d.uploader_name ?? 'none'}</td>
                    <td className="mono fine">{d.size_bytes ? `${(parseInt(d.size_bytes) / 1e6).toFixed(1)} MB` : 'none'}</td>
                    <td>
                      {d.storage_key ? (
                        <a className="icon-btn" href={`/api/documents/${d.id}/download`} title="Download" onClick={async (e) => {
                          e.preventDefault();
                          try {
                            const res = await fetch(`/api/documents/${d.id}/download`, { credentials: 'same-origin' });
                            if (!res.ok) throw new Error('Download failed');
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = d.file_name;
                            a.click();
                            URL.revokeObjectURL(url);
                          } catch (err) {
                            toast(err instanceof Error ? err.message : 'Download failed', 'err');
                          }
                        }}>
                          <Download />
                        </a>
                      ) : (
                        <span className="fine muted" title="Seeded metadata record, no file attached">metadata only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

function Download({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M4.5 20h15" />
    </svg>
  );
}

/* ================================ Activity ================================ */

function ActivityTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['audit', projectId],
    queryFn: () => api<{ events: import('../../types').AuditEvent[] }>(`/audit?projectId=${projectId}&limit=50`).catch(() => ({ events: [] })),
  });
  if (isLoading) return <Loading label="Loading activity" size={120} />;
  if (!data?.events.length) {
    return <Empty icon={<Clock />} title="No recorded activity" sub="Activity is visible to organisation administrators." />;
  }
  return (
    <Card pad>
      <div className="feed">
        {data.events.map((e) => (
          <div className="feed-item" key={e.id}>
            <span className="when">{new Date(e.created_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}</span>
            <span className="what"><b>{e.actor_name ?? 'System'}</b>, {e.summary}<div className="fine mono">{e.action}</div></span>
          </div>
        ))}
      </div>
    </Card>
  );
}
