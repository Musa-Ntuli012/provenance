import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Badge, Button, Card, Empty, Field, FormRow, Money, Modal, useCelebrate, Avatar } from '../../components/ui';
import { Loading, LoadError, ErrorBanner } from '../../components/animations';
import { useAuth, can } from '../../auth/AuthContext';
import { DOMAIN_LABELS, STAGE_NAMES } from '../../types';
import type { ClientOrg, Domain, ProjectSummary } from '../../types';
import { Search, Plus, Folder } from '../../components/icons';
import { useSlug } from '../../router';

type DomainFilter = 'ALL' | Domain;

export default function Projects() {
  const { user } = useAuth();
  const slug = useSlug();
  const navigate = useNavigate();
  const celebrate = useCelebrate();
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState<DomainFilter>('ALL');
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ projects: ProjectSummary[] }>('/projects'),
  });

  const filtered = useMemo(() => {
    let list = data?.projects ?? [];
    if (domain !== 'ALL') list = list.filter((p) => p.leads?.some((l) => l.domain === domain));
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter((p) => `${p.code} ${p.name} ${p.client_name ?? ''}`.toLowerCase().includes(needle));
    }
    return list;
  }, [data, domain, q]);

  return (
    <div>
      <div className="page-head">
        <div className="title-block">
          <span className="eyebrow">Portfolio</span>
          <h1 className="display">Projects</h1>
          <p className="sub">Tabbed by domain section, {DOMAIN_LABELS.PROFESSIONAL_SERVICES}, {DOMAIN_LABELS.GEOTECHNICAL}, {DOMAIN_LABELS.CONSTRUCTION_MANAGEMENT}.</p>
        </div>
        {can(user?.role, 'projects.write') && (
          <Button icon={<Plus />} onClick={() => setShowNew(true)}>New project</Button>
        )}
      </div>

      <div className="toolbar">
        <div className="search">
          <Search />
          <input className="input" placeholder="Search code, name or client…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="segmented" role="tablist" aria-label="Domain filter">
          <button className={domain === 'ALL' ? 'active' : ''} onClick={() => setDomain('ALL')}>All</button>
          {(Object.keys(DOMAIN_LABELS) as Domain[]).map((d) => (
            <button key={d} className={domain === d ? 'active' : ''} onClick={() => setDomain(d)}>
              {DOMAIN_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      <Card>
        {isLoading ? (
          <Loading label="Loading projects" size={150} />
        ) : isError ? (
          <LoadError onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          <Empty icon={<Folder />} title="No projects match" sub={q ? 'Try a different search.' : 'Create the first project to open its stage ladder.'} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Client</th>
                  <th style={{ minWidth: 180 }}>Stage</th>
                  <th>Domain leads</th>
                  <th className="num">Contract value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => navigate(`/${slug}/projects/${p.id}`)}>
                    <td>
                      <Link to={`/${slug}/projects/${p.id}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 600 }}>
                        {p.name}
                      </Link>
                      <div className="fine mono">{p.code}</div>
                    </td>
                    <td>{p.client_name ?? <span className="muted">none</span>}</td>
                    <td>
                      <div className="stage-cell">
                        <span className="t">
                          <span>{STAGE_NAMES[p.current_stage_index - 1]}</span>
                          <span>{p.current_stage_index}/11</span>
                        </span>
                        <div className="progress"><i style={{ width: `${(p.current_stage_index / 11) * 100}%` }} /></div>
                      </div>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex' }}>
                        {(p.leads ?? []).map((l) => <Avatar key={l.domain} name={l.name} stack />)}
                        {!p.leads?.length && <span className="muted">unassigned</span>}
                      </span>
                    </td>
                    <td className="num"><Money v={p.contract_value} /></td>
                    <td>
                      {p.status === 'COMPLETE' ? <Badge tone="sage">complete</Badge>
                      : p.status === 'ON_HOLD' ? <Badge tone="clay">on hold</Badge>
                      : p.gate_status === 'PENDING_CLIENT' ? <Badge tone="gold" dot>client sign-off</Badge>
                      : <Badge tone="terracotta" dot>active</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); celebrate('Project created'); navigate(`/${slug}/projects/${id}`); }} />}
    </div>
  );
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', description: '', clientOrgId: '', contractValue: '', startDate: '', targetEndDate: '', latitude: '', longitude: '',
  });
  const [psLead, setPsLead] = useState('');
  const [geoLead, setGeoLead] = useState('');
  const [cmLead, setCmLead] = useState('');

  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api<{ clients: ClientOrg[] }>('/clients') });
  const team = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: { id: string; full_name: string; role: string }[] }>('/users') });

  const staff = (role: string) => (team.data?.users ?? []).filter((u) => u.role === role);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const domains = [
        psLead && { domain: 'PROFESSIONAL_SERVICES' as const, userId: psLead },
        geoLead && { domain: 'GEOTECHNICAL' as const, userId: geoLead },
        cmLead && { domain: 'CONSTRUCTION_MANAGEMENT' as const, userId: cmLead },
      ].filter(Boolean) as { domain: Domain; userId: string }[];
      const res = await api<{ project: { id: string } }>('/projects', {
        body: {
          name: form.name,
          description: form.description || undefined,
          clientOrgId: form.clientOrgId || undefined,
          contractValue: form.contractValue ? parseFloat(form.contractValue) : undefined,
          startDate: form.startDate || undefined,
          targetEndDate: form.targetEndDate || undefined,
          latitude: form.latitude ? parseFloat(form.latitude) : undefined,
          longitude: form.longitude ? parseFloat(form.longitude) : undefined,
          domains,
        },
      });
      onCreated(res.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create project');
      setBusy(false);
    }
  };

  return (
    <Modal title="New project" onClose={onClose} wide>
      <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--s4)' }}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Project name">
          <input className="input" value={form.name} onChange={set('name')} placeholder="Waterfront Precinct, Bulk Services" required minLength={3} />
        </Field>
        <Field label="Description">
          <textarea className="input" value={form.description} onChange={set('description')} placeholder="Scope summary…" />
        </Field>
        <FormRow>
          <Field label="Client">
            <select className="input" value={form.clientOrgId} onChange={set('clientOrgId')}>
              <option value="">none yet</option>
              {(clients.data?.clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Contract value (ZAR)">
            <input className="input mono" type="number" min="0" step="0.01" value={form.contractValue} onChange={set('contractValue')} placeholder="234000000" />
          </Field>
        </FormRow>
        <FormRow>
          <Field label="Start date">
            <input className="input" type="date" value={form.startDate} onChange={set('startDate')} />
          </Field>
          <Field label="Target completion">
            <input className="input" type="date" value={form.targetEndDate} onChange={set('targetEndDate')} />
          </Field>
        </FormRow>
        <FormRow>
          <Field label="Latitude" hint="For the GPS project map">
            <input className="input mono" value={form.latitude} onChange={set('latitude')} placeholder="-25.743" />
          </Field>
          <Field label="Longitude">
            <input className="input mono" value={form.longitude} onChange={set('longitude')} placeholder="27.858" />
          </Field>
        </FormRow>
        <div className="hr" style={{ margin: 0 }} />
        <div className="eyebrow">Domain sections, assign a lead to each active domain</div>
        <FormRow>
          <Field label="Professional Services lead">
            <select className="input" value={psLead} onChange={(e) => setPsLead(e.target.value)}>
              <option value="">not active</option>
              {staff('PROFESSIONAL_SERVICES_LEAD').map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
          <Field label="Geotechnical lead">
            <select className="input" value={geoLead} onChange={(e) => setGeoLead(e.target.value)}>
              <option value="">not active</option>
              {staff('GEOTECHNICAL_LEAD').map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
        </FormRow>
        <Field label="Construction Management lead">
          <select className="input" value={cmLead} onChange={(e) => setCmLead(e.target.value)}>
            <option value="">not active</option>
            {staff('CONSTRUCTION_MANAGER').map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </Field>
        <div style={{ display: 'flex', gap: 'var(--s2)', justifyContent: 'flex-end' }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</Button>
        </div>
      </form>
    </Modal>
  );
}
