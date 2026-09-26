import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useAuth, isClientRole } from './auth/AuthContext';
import AppShell from './components/AppShell';
import Login from './features/auth/Login';
import Register from './features/auth/Register';
import Dashboard from './features/dashboard/Dashboard';
import Projects from './features/projects/Projects';
import ProjectDetail from './features/projects/ProjectDetail';
import Clients from './features/clients/Clients';
import Approvals from './features/approvals/Approvals';
import Kanban from './features/kanban/Kanban';
import CalendarScreen from './features/calendar/CalendarScreen';
import Reports from './features/reports/Reports';
import Maps from './features/maps/Maps';
import Files from './features/files/Files';
import Settings from './features/settings/Settings';
import Profile from './features/profile/Profile';

function RequireAuth({ children }: { children: ReactElement }) {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="skeleton" style={{ width: 220, height: 16 }} />
      </div>
    );
  }
  if (status === 'anon') return <Navigate to="/login" replace />;
  return children;
}

/** Routes guarded server-side too, the client-side check only shapes the UI. */
function StaffOnly({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (user && isClientRole(user.role)) return <Navigate to="../dashboard" replace />;
  return children;
}

export default function Router() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/:slug" element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="clients" element={<StaffOnly><Clients /></StaffOnly>} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="kanban" element={<StaffOnly><Kanban /></StaffOnly>} />
        <Route path="calendar" element={<StaffOnly><CalendarScreen /></StaffOnly>} />
        <Route path="reports" element={<StaffOnly><Reports /></StaffOnly>} />
        <Route path="maps" element={<StaffOnly><Maps /></StaffOnly>} />
        <Route path="files" element={<Files />} />
        <Route path="settings/*" element={<StaffOnly><Settings /></StaffOnly>} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

/** Convenience hook for screens under /:slug. */
export function useSlug(): string {
  const { slug } = useParams();
  return slug ?? '';
}
