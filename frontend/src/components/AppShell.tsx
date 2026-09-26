import { NavLink, Outlet, useLocation, useParams, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth, isClientRole, ROLE_LABELS } from '../auth/AuthContext';
import type { PendingApproval } from '../types';
import { Mark, Grid, Users, Folder, Shield, Board, Calendar, Chart, MapPin, File, Gear } from './icons';

export default function AppShell() {
  const { user, logout } = useAuth();
  const { slug } = useParams();
  const location = useLocation();

  // Hooks must run unconditionally, gate the query via `enabled`, not placement.
  const pending = useQuery({
    queryKey: ['pending-approvals-count'],
    queryFn: () => api<{ pending: PendingApproval[] }>('/projects/approvals/pending'),
    enabled:
      !!user && !isClientRole(user.role) && user.role !== 'VIEWER' && user.role !== 'MEMBER',
    refetchInterval: 30_000,
  });
  const pendingCount = pending.data?.pending.length ?? 0;

  if (!user || !user.tenant) return <Navigate to="/login" replace />;
  if (slug !== user.tenant.slug) return <Navigate to={`/${user.tenant.slug}/dashboard`} replace />;

  const client = isClientRole(user.role);

  const nav = [
    ...(client
      ? [
          { to: 'dashboard', label: 'Dashboard', icon: Grid },
          { to: 'projects', label: 'Projects', icon: Folder },
          { to: 'approvals', label: 'Approvals', icon: Shield },
        ]
      : [
          { to: 'dashboard', label: 'Dashboard', icon: Grid },
          { to: 'clients', label: 'Clients', icon: Users },
          { to: 'projects', label: 'Projects', icon: Folder },
          { to: 'approvals', label: 'Approvals', icon: Shield, guard: 'approvals' },
          { to: 'kanban', label: 'Board', icon: Board },
          { to: 'calendar', label: 'Calendar', icon: Calendar },
          { to: 'reports', label: 'Reports', icon: Chart },
          { to: 'maps', label: 'Maps', icon: MapPin },
          { to: 'files', label: 'Files', icon: File },
        ]),
  ];

  const pageName =
    nav.find((n) => location.pathname.includes(`/${n.to}`))?.label ??
    (location.pathname.includes('/settings') ? 'Settings' : location.pathname.includes('/profile') ? 'Profile' : '');

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to={`/${slug}/dashboard`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="wordmark">
            <span className="mark"><Mark color="#e8b98a" /></span>
            <span>
              <span className="name">Provenance</span>
              <span className="sub">{user.tenant.name}</span>
            </span>
          </div>
        </NavLink>

        <nav className="nav" aria-label="Primary">
          {!client && <div className="nav-label">Workspace</div>}
          {nav.map((n) => (
            <NavLink key={n.to} to={`/${slug}/${n.to}`} className={({ isActive }) => (isActive ? 'active' : '')}>
              <n.icon />
              {n.label}
              {n.guard === 'approvals' && pendingCount > 0 ? <span className="count">{pendingCount}</span> : null}
            </NavLink>
          ))}
          {!client && (
            <>
              <div className="nav-label">Organisation</div>
              <NavLink to={`/${slug}/settings`} className={({ isActive }) => (isActive ? 'active' : '')}>
                <Gear />
                Settings
              </NavLink>
            </>
          )}
        </nav>

        <div className="spacer" />
        <NavLink to={`/${slug}/profile`} className="user-chip" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="avatar">{user.fullName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('')}</span>
          <span className="who">
            <b>{user.fullName}</b>
            <span>{ROLE_LABELS[user.role] ?? user.role}</span>
          </span>
        </NavLink>
        <button className="btn ghost sm" onClick={() => void logout()} style={{ justifyContent: 'flex-start' }}>
          Sign out
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="crumb">
            {user.tenant.name} <span style={{ opacity: 0.5 }}>/</span> <b>{pageName}</b>
          </span>
          <span className="spacer" />
          {client && (
            <span className="badge gold" title="You are viewing the client portal">
              Client portal
            </span>
          )}
        </header>
        <div className="content">
          <div className="screen" key={location.pathname}>
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
