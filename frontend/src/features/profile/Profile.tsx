import { useState } from 'react';
import { api } from '../../api/client';
import { useAuth, ROLE_LABELS, isClientRole } from '../../auth/AuthContext';
import { Button, Card, Field, useToast, useCelebrate } from '../../components/ui';
import { CheckCircle } from '../../components/icons';

export default function Profile() {
  const { user, tenant } = useAuth();
  const toast = useToast();
  const celebrate = useCelebrate();
  const [pwd, setPwd] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  if (!user) return null;

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/users/me/password', { body: pwd });
      celebrate('Password changed');
      setConfirm(true);
      setPwd({ currentPassword: '', newPassword: '' });
      // All sessions (including this one) were revoked server-side.
      setTimeout(() => window.location.assign('/login'), 1600);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Change failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div className="title-block">
          <span className="eyebrow">Your account</span>
          <h1 className="display">Profile</h1>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--s4)' }}>
        <Card pad>
          <h3 className="serif-h" style={{ marginBottom: 10 }}>Account</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="meta-item"><span className="k">Name</span><span className="v">{user.fullName}</span></div>
            <div className="meta-item"><span className="k">Email</span><span className="v">{user.email}</span></div>
            <div className="meta-item"><span className="k">Role</span><span className="v">{ROLE_LABELS[user.role] ?? user.role}</span></div>
            <div className="meta-item"><span className="k">Workspace</span><span className="v">{tenant?.name} <span className="mono fine">/{tenant?.slug}</span></span></div>
            {isClientRole(user.role) && (
              <div className="portal-note" style={{ marginTop: 6 }}>
                <CheckCircle />
                <span>Client portal access{user.role === 'CLIENT_TEMP' ? ' (temporary, read-only)' : ' (you may sign off stage gates)'}.</span>
              </div>
            )}
          </div>
        </Card>

        <Card pad>
          <h3 className="serif-h" style={{ marginBottom: 10 }}>Change password</h3>
          {confirm ? (
            <div className="portal-note">
              <CheckCircle />
              <span>Password changed. All sessions were signed out, redirecting you to sign in…</span>
            </div>
          ) : (
            <form onSubmit={changePassword} style={{ display: 'grid', gap: 'var(--s4)' }}>
              <Field label="Current password">
                <input className="input" type="password" value={pwd.currentPassword} onChange={(e) => setPwd((p) => ({ ...p, currentPassword: e.target.value }))} autoComplete="current-password" required />
              </Field>
              <Field label="New password" hint="At least 10 characters, with a number">
                <input className="input" type="password" value={pwd.newPassword} onChange={(e) => setPwd((p) => ({ ...p, newPassword: e.target.value }))} autoComplete="new-password" required minLength={10} />
              </Field>
              <Button type="submit" disabled={busy} style={{ justifySelf: 'start' }}>
                {busy ? 'Changing…' : 'Change password'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
