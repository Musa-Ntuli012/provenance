import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Button, Field, FormRow, useToast } from '../../components/ui';
import { ErrorBanner } from '../../components/animations';
import { Mark } from '../../components/icons';

/** Registration is intentionally simple (spec §3.2): org name, slug,
 *  industry, primary contact, no conditional fields. The government
 *  province/municipality branches were removed with the dual-tenant model. */
export default function Register() {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    organisationName: '',
    slug: '',
    industry: 'engineering_consulting',
    contactName: '',
    contactEmail: '',
    adminName: '',
    password: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const slugify = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const slug = form.slug.trim() || slugify(form.organisationName);
    try {
      await api('/auth/register', { body: { ...form, slug } });
      toast('Workspace created, sign in to continue');
      navigate('/login');
    } catch (err) {
      const e2 = err as { message?: string; details?: { field: string; message: string }[] };
      setError(e2.message ?? 'Registration failed');
      if (e2.details) {
        const map: Record<string, string> = {};
        for (const d of e2.details) map[d.field.replace('body.', '')] = d.message;
        setFieldErrors(map);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-brand">
        <svg className="arcs" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
          {[140, 240, 340, 440, 540].map((r) => (
            <circle key={r} cx="520" cy="180" r={r} fill="none" stroke="rgba(232,185,138,0.16)" strokeWidth="1.2" />
          ))}
        </svg>
        <div className="logo">
          <span className="mark"><Mark color="#e8b98a" /></span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '0.02em' }}>Provenance</span>
        </div>
        <div>
          <h1 className="display">Your firm, its own workspace.</h1>
          <p className="tagline" style={{ marginTop: 18 }}>
            Multi-tenant by design, private-firm only. Each workspace is isolated at the database row level, not just in application code.
          </p>
        </div>
        <div className="foot">Kyvrex · Private Firm Platform</div>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit} style={{ width: 'min(480px, 100%)' }}>
          <div className="head">
            <h2 className="serif-h" style={{ fontSize: 28 }}>Create your workspace</h2>
            <p className="muted" style={{ margin: 0 }}>You'll be the organisation administrator.</p>
          </div>

          {error ? <ErrorBanner message={error} /> : null}

          <Field label="Firm name" error={fieldErrors.organisationName}>
            <input className="input" value={form.organisationName} onChange={set('organisationName')} placeholder="Molamo Bosman Consulting Engineers" required minLength={2} />
          </Field>
          <Field label="Workspace address" hint="Lowercase letters, numbers, hyphens" error={fieldErrors.slug}>
            <input className="input" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))} placeholder={slugify(form.organisationName) || 'your-firm'} pattern="[a-z0-9][\-a-z0-9]{1,62}" />
          </Field>
          <Field label="Industry">
            <select className="input" value={form.industry} onChange={set('industry')}>
              <option value="engineering_consulting">Engineering consulting</option>
              <option value="geotechnical">Geotechnical specialist</option>
              <option value="construction_management">Construction management</option>
              <option value="multi_discipline">Multi-discipline practice</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <FormRow>
            <Field label="Primary contact name">
              <input className="input" value={form.contactName} onChange={set('contactName')} placeholder="Amara Molamo" required />
            </Field>
            <Field label="Contact email" error={fieldErrors.contactEmail}>
              <input className="input" type="email" value={form.contactEmail} onChange={set('contactEmail')} placeholder="amara@firm.co.za" required />
            </Field>
          </FormRow>
          <Field label="Administrator name" hint="This account signs in as the organisation admin" error={fieldErrors.adminName}>
            <input className="input" value={form.adminName} onChange={set('adminName')} placeholder="Amara Molamo" required minLength={2} />
          </Field>
          <Field label="Administrator password" hint="At least 10 characters, with a number" error={fieldErrors.password}>
            <input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required minLength={10} />
          </Field>

          <Button type="submit" block size="lg" disabled={busy}>
            {busy ? 'Creating…' : 'Create workspace'}
          </Button>
          <p className="fine" style={{ margin: 0, textAlign: 'center' }}>
            Already have one? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </section>
    </div>
  );
}
