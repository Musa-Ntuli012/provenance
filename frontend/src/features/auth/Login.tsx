import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button, Field } from '../../components/ui';
import { ErrorBanner } from '../../components/animations';
import { Mark, Check, Shield, Stamp, Layers } from '../../components/icons';

export default function Login() {
  const { status, user, login } = useAuth();
  const navigate = useNavigate();
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authed' && user) return <Navigate to={`/${user.tenant.slug}/dashboard`} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(slug.trim().toLowerCase(), email.trim(), password);
      navigate(`/${slug.trim().toLowerCase()}/dashboard`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = (role: 'pm' | 'admin' | 'client') => {
    setSlug('mbe-demo');
    setEmail(
      role === 'pm' ? 'thabiso@molamobosman.co.za'
      : role === 'admin' ? 'amara@molamobosman.co.za'
      : 'dineo@bluekruger.co.za',
    );
    setPassword('Provenance!Demo1');
  };

  return (
    <div className="auth">
      <section className="auth-brand">
        <svg className="arcs" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
          {[140, 240, 340, 440, 540].map((r) => (
            <circle key={r} cx="520" cy="180" r={r} fill="none" stroke="rgba(232,185,138,0.16)" strokeWidth="1.2" />
          ))}
          {[100, 200, 300].map((r) => (
            <circle key={r} cx="40" cy="860" r={r} fill="none" stroke="rgba(184,144,64,0.18)" strokeWidth="1.2" />
          ))}
        </svg>
        <div className="logo">
          <span className="mark"><Mark color="#e8b98a" /></span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '0.02em' }}>Provenance</span>
        </div>
        <div>
          <h1 className="display">The chain of custody for engineering delivery.</h1>
          <p className="tagline" style={{ marginTop: 18 }}>
            Eleven stages, three domains, one unbroken record, the right document, the right approval, at the right time.
          </p>
          <ul style={{ marginTop: 32 }}>
            <li><Check /> Stage-gate sign-off with domain endorsement</li>
            <li><Stamp /> Payment certificates under a formal approval chain</li>
            <li><Shield /> Client portal with time-boxed, read-only access</li>
            <li><Layers /> Every action on an append-only audit trail</li>
          </ul>
        </div>
        <div className="foot">Kyvrex · Private Firm Platform</div>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="head">
            <h2 className="serif-h" style={{ fontSize: 28 }}>Sign in</h2>
            <p className="muted" style={{ margin: 0 }}>Enter your workspace address and credentials.</p>
          </div>

          {error ? <ErrorBanner message={error} /> : null}

          <Field label="Workspace address" hint="Your firm's workspace, e.g. mbe-demo">
            <input
              className="input"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="mbe-demo"
              autoComplete="organization"
              required
            />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@firm.co.za" autoComplete="username" required />
          </Field>
          <Field label="Password">
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" autoComplete="current-password" required />
          </Field>

          <Button type="submit" block size="lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>

          <div className="demo-box">
            <b style={{ fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Demo workspace, mbe-demo</b>
            <span>Password for every demo user: <code>Provenance!Demo1</code></span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button type="button" variant="secondary" size="sm" onClick={() => fillDemo('admin')}>Org admin</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => fillDemo('pm')}>Project manager</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => fillDemo('client')}>Client approver</Button>
            </span>
          </div>

          <p className="fine" style={{ margin: 0, textAlign: 'center' }}>
            New firm? <Link to="/register">Create a workspace</Link>
          </p>
        </form>
      </section>
    </div>
  );
}
