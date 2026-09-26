import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Badge, Button, Card, Empty, Field, FormRow, Modal, Money, useCelebrate } from '../../components/ui';
import { Loading, LoadError, ErrorBanner } from '../../components/animations';
import type { ClientOrg, TeamUser } from '../../types';
import { Plus, Users } from '../../components/icons';

const ORG_TYPES: Record<ClientOrg['org_type'], string> = {
  municipality: 'Municipality',
  government_dept: 'Government department',
  private_entity: 'Private entity',
  soe: 'State-owned entity',
  other: 'Other',
};

export default function Clients() {
  const [showNew, setShowNew] = useState(false);
  const [accessFor, setAccessFor] = useState<ClientOrg | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['clients'], queryFn: () => api<{ clients: ClientOrg[] }>('/clients') });
  const celebrate = useCelebrate();

  const clients = data?.clients ?? [];

  return (
    <div>
      <div className="page-head">
        <div className="title-block">
          <span className="eyebrow">Client roster</span>
          <h1 className="display">Clients</h1>
          <p className="sub">The organisations the firm does work for, municipalities, departments, developers and SOEs.</p>
        </div>
        <Button icon={<Plus />} onClick={() => setShowNew(true)}>Add client</Button>
      </div>

      {isLoading ? (
        <Loading label="Loading clients" size={140} />
      ) : isError ? (
        <Card><LoadError onRetry={() => refetch()} /></Card>
      ) : clients.length === 0 ? (
        <Card><Empty icon={<Users />} title="No clients yet" sub="Add the organisations you deliver work for." /></Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--s4)' }}>
          {clients.map((c) => (
            <Card pad key={c.id} style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                <b style={{ fontSize: 'var(--text-md)', lineHeight: 1.3 }}>{c.name}</b>
                <Badge tone={c.org_type === 'private_entity' ? 'terracotta' : c.org_type === 'municipality' ? 'gold' : undefined}>
                  {ORG_TYPES[c.org_type]}
                </Badge>
              </div>
              <div className="fine">{c.contact_name ?? 'No contact'}{c.contact_email ? ` · ${c.contact_email}` : ''}</div>
              <div className="hr" style={{ margin: '4px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="fine">{c.project_count} project{c.project_count === 1 ? '' : 's'}</span>
                <span className="mono"><Money v={c.total_value} /></span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setAccessFor(c)}>Portal access</Button>
            </Card>
          ))}
        </div>
      )}

      {showNew && (
        <NewClient onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); celebrate('Client added'); }} />
      )}
      {accessFor && (
        <PortalAccess client={accessFor} onClose={() => setAccessFor(null)} onCreated={() => { setAccessFor(null); celebrate('Portal access granted'); }} />
      )}
    </div>
  );
}

function NewClient({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', orgType: 'private_entity', contactName: '', contactEmail: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/clients', {
        body: {
          name: f.name, orgType: f.orgType,
          contactName: f.contactName || undefined, contactEmail: f.contactEmail || undefined,
        },
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  };

  return (
    <Modal title="Add client organisation" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--s4)' }}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Name"><input className="input" value={f.name} onChange={set('name')} placeholder="Blue Kruger Developments" required /></Field>
        <Field label="Organisation type" hint="A private firm's clients legitimately include government entities">
          <select className="input" value={f.orgType} onChange={set('orgType')}>
            {Object.entries(ORG_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <FormRow>
          <Field label="Contact name"><input className="input" value={f.contactName} onChange={set('contactName')} /></Field>
          <Field label="Contact email"><input className="input" type="email" value={f.contactEmail} onChange={set('contactEmail')} /></Field>
        </FormRow>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add client'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PortalAccess({ client, onClose, onCreated }: { client: ClientOrg; onClose: () => void; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ email: '', fullName: '', kind: 'CLIENT_APPROVER', expiresInDays: '14', temporaryPassword: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const existing = useQuery({
    queryKey: ['client-access', client.id],
    queryFn: () => api<{ users: TeamUser[] }>('/users'),
  });
  const portalUsers = (existing.data?.users ?? []).filter((u) => u.client_org_id === client.id);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/clients/access', {
        body: {
          clientId: client.id, email: f.email, fullName: f.fullName, kind: f.kind,
          expiresInDays: f.kind === 'CLIENT_TEMP' ? parseInt(f.expiresInDays, 10) : undefined,
          temporaryPassword: f.temporaryPassword,
        },
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  };

  return (
    <Modal title={`Portal access, ${client.name}`} onClose={onClose} wide>
      <div style={{ display: 'grid', gap: 'var(--s4)' }}>
        <div className="portal-note">
          <Users />
          <span>Client users see only this organisation's projects, scoped by the database, not the UI.</span>
        </div>
        {portalUsers.length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Name</th><th>Email</th><th>Kind</th><th>Expires</th></tr></thead>
              <tbody>
                {portalUsers.map((u) => (
                  <tr key={u.id}>
                    <td>{u.full_name}</td>
                    <td className="fine">{u.email}</td>
                    <td><Badge tone={u.role === 'CLIENT_TEMP' ? 'gold' : 'terracotta'}>{u.role === 'CLIENT_TEMP' ? 'temporary' : 'approver'}</Badge></td>
                    <td className="fine">{u.access_expires_at ? new Date(u.access_expires_at).toLocaleDateString('en-ZA') : 'none'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--s4)' }}>
          {error ? <ErrorBanner message={error} /> : null}
          <FormRow>
            <Field label="Full name"><input className="input" value={f.fullName} onChange={set('fullName')} required /></Field>
            <Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} required /></Field>
          </FormRow>
          <FormRow>
            <Field label="Access kind" hint="Temporary access is read-only">
              <select className="input" value={f.kind} onChange={set('kind')}>
                <option value="CLIENT_APPROVER">Standing approver (may sign off gates)</option>
                <option value="CLIENT_TEMP">Temporary, read-only</option>
              </select>
            </Field>
            {f.kind === 'CLIENT_TEMP' ? (
              <Field label="Expires in (days)"><input className="input mono" type="number" min="1" max="90" value={f.expiresInDays} onChange={set('expiresInDays')} /></Field>
            ) : <span />}
          </FormRow>
          <Field label="Initial password" hint="They should change it after first sign-in">
            <input className="input" type="text" value={f.temporaryPassword} onChange={set('temporaryPassword')} required minLength={10} placeholder="At least 10 characters with a number" />
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Granting…' : 'Grant access'}</Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
