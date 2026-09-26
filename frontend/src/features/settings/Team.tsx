import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth, ROLE_LABELS } from '../../auth/AuthContext';
import { Avatar, Badge, Button, Card, Field, FormRow, Modal, useToast, useCelebrate, When } from '../../components/ui';
import { Loading, ErrorBanner } from '../../components/animations';
import type { TeamUser } from '../../types';
import { Plus } from '../../components/icons';

const ROLES = ['PM', 'PROFESSIONAL_SERVICES_LEAD', 'GEOTECHNICAL_LEAD', 'CONSTRUCTION_MANAGER', 'MEMBER', 'VIEWER', 'ORG_ADMIN'] as const;

export default function Team() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: TeamUser[] }>('/users') });
  const celebrate = useCelebrate();

  const patch = async (u: TeamUser, body: Record<string, unknown>) => {
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', body });
      toast(`${u.full_name} updated`);
      void qc.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Update failed', 'err');
    }
  };

  const isAdmin = user?.role === 'ORG_ADMIN';

  return (
    <div style={{ display: 'grid', gap: 'var(--s4)' }}>
      <Card>
        <div className="card-head">
          <h3 className="serif-h">Team</h3>
          {isAdmin && <Button size="sm" icon={<Plus />} onClick={() => setShowNew(true)}>Add member</Button>}
        </div>
        <div className="card pad" style={{ paddingTop: 'var(--s3)' }}>
          {isLoading ? <Loading label="Loading team" size={130} /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Last sign-in</th>{isAdmin ? <th></th> : null}</tr></thead>
                <tbody>
                  {(data?.users ?? []).filter((u) => !u.role.startsWith('CLIENT_')).map((u) => (
                    <tr key={u.id}>
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Avatar name={u.full_name} />
                          <span style={{ display: 'grid' }}>
                            <b>{u.full_name}{u.id === user?.id ? ' (you)' : ''}</b>
                            <span className="fine">{u.email}</span>
                          </span>
                        </span>
                      </td>
                      <td>{isAdmin && u.id !== user?.id ? (
                        <select className="input" style={{ minHeight: 32, height: 32, padding: '2px 28px 2px 10px' }} value={u.role} onChange={(e) => void patch(u, { role: e.target.value })}>
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                      ) : (
                        <Badge tone={u.role === 'ORG_ADMIN' ? 'terracotta' : undefined}>{ROLE_LABELS[u.role] ?? u.role}</Badge>
                      )}</td>
                      <td>{u.status === 'ACTIVE' ? <Badge tone="sage" dot>active</Badge> : <Badge tone="clay" dot>disabled</Badge>}</td>
                      <td className="fine"><When iso={u.last_login_at} /></td>
                      {isAdmin ? (
                        <td>
                          {u.id !== user?.id && (
                            <Button size="sm" variant="ghost" onClick={() => void patch(u, { status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}>
                              {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                            </Button>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {showNew && (
        <NewMember
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            celebrate('Member added');
            void qc.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      )}
    </div>
  );
}

function NewMember({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ fullName: '', email: '', role: 'MEMBER', temporaryPassword: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/users', { body: f });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  };

  return (
    <Modal title="Add team member" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--s4)' }}>
        {error ? <ErrorBanner message={error} /> : null}
        <FormRow>
          <Field label="Full name"><input className="input" value={f.fullName} onChange={set('fullName')} required /></Field>
          <Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} required /></Field>
        </FormRow>
        <Field label="Role" hint="Domain leads endorse their own section's deliverables and financial records">
          <select className="input" value={f.role} onChange={set('role')}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        <Field label="Temporary password" hint="At least 10 characters with a number, they change it from Profile">
          <input className="input" value={f.temporaryPassword} onChange={set('temporaryPassword')} required minLength={10} />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add member'}</Button>
        </div>
      </form>
    </Modal>
  );
}
