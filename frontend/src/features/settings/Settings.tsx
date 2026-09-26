import { NavLink, Route, Routes } from 'react-router-dom';
import OrgSettings from './OrgSettings';
import Team from './Team';
import Activity from './Activity';
import { Gear, Users, Shield } from '../../components/icons';
import { useAuth } from '../../auth/AuthContext';

export default function Settings() {
  const { user } = useAuth();
  return (
    <div>
      <div className="page-head">
        <div className="title-block">
          <span className="eyebrow">Administration</span>
          <h1 className="display">Settings</h1>
        </div>
      </div>
      <div className="settings-grid">
        <nav className="settings-nav">
          <NavLink to="organisation" className={({ isActive }) => (isActive ? 'active' : '')}><Gear /> Organisation</NavLink>
          <NavLink to="team" className={({ isActive }) => (isActive ? 'active' : '')}><Users /> Team & access</NavLink>
          {user?.role === 'ORG_ADMIN' && (
            <NavLink to="activity" className={({ isActive }) => (isActive ? 'active' : '')}><Shield /> Audit trail</NavLink>
          )}
        </nav>
        <div>
          <Routes>
            <Route index element={<OrgSettings />} />
            <Route path="organisation" element={<OrgSettings />} />
            <Route path="team" element={<Team />} />
            <Route path="activity" element={<Activity />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
