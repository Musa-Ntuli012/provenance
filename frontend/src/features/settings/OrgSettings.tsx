import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth, can } from '../../auth/AuthContext';
import { Button, Card, Field, useToast, useCelebrate } from '../../components/ui';
import { Loading } from '../../components/animations';
import type { Tenant } from '../../types';

export default function OrgSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const editable = can(user?.role, 'tenant.write');
  const { data, isLoading } = useQuery({ queryKey: ['tenant'], queryFn: () => api<{ tenant: Tenant }>('/tenant/current') });
  const celebrate = useCelebrate();
  const [f, setF] = useState({ name: '', industry: '', contactName: '', contactEmail: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data?.tenant) {
      setF({
        name: data.tenant.name ?? '',
        industry: data.tenant.industry ?? '',
        contactName: data.tenant.contact_name ?? '',
        contactEmail: data.tenant.contact_email ?? '',
      });
    }
  }, [data]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/tenant/current', {
        method: 'PATCH',
        body: { name: f.name, industry: f.industry, contactName: f.contactName, contactEmail: f.contactEmail },
      });
      celebrate('Organisation updated');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save', 'err');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Loading label="Loading settings" size={130} />;

  return (
    <Card pad>
      <h3 className="serif-h" style={{ marginBottom: 6 }}>Organisation profile</h3>
      <p className="fine" style={{ marginTop: 0 }}>
        Workspace address: <span className="mono">{data?.tenant.slug}</span> · workflow profile <span className="mono">{data?.tenant.industry ? 'private v11' : ''}</span>
      </p>
      <form onSubmit={save} style={{ display: 'grid', gap: 'var(--s4)', maxWidth: 560 }}>
        <Field label="Firm name">
          <input className="input" value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} disabled={!editable} required />
        </Field>
        <Field label="Industry">
          <select className="input" value={f.industry} onChange={(e) => setF((s) => ({ ...s, industry: e.target.value }))} disabled={!editable}>
            <option value="engineering_consulting">Engineering consulting</option>
            <option value="geotechnical">Geotechnical specialist</option>
            <option value="construction_management">Construction management</option>
            <option value="multi_discipline">Multi-discipline practice</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Primary contact name">
          <input className="input" value={f.contactName} onChange={(e) => setF((s) => ({ ...s, contactName: e.target.value }))} disabled={!editable} />
        </Field>
        <Field label="Primary contact email">
          <input className="input" type="email" value={f.contactEmail} onChange={(e) => setF((s) => ({ ...s, contactEmail: e.target.value }))} disabled={!editable} />
        </Field>
        {editable && <Button type="submit" disabled={busy} style={{ justifySelf: 'start' }}>{busy ? 'Saving…' : 'Save changes'}</Button>}
      </form>
    </Card>
  );
}
