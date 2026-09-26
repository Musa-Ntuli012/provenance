import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, bootstrapRefresh, setAccessToken, setUnauthorizedHandler } from '../api/client';
import type { User, Tenant } from '../types';

interface AuthState {
  status: 'loading' | 'anon' | 'authed';
  user: User | null;
  tenant: Tenant | null;
}

interface AuthApi extends AuthState {
  login: (slug: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, tenant: null });

  const applySession = useCallback((data: { user: User }) => {
    setState({ status: 'authed', user: data.user, tenant: data.user.tenant });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setState({ status: 'anon', user: null, tenant: null }));
    (async () => {
      const boot = await bootstrapRefresh();
      if (boot?.user) {
        setAccessToken(boot.accessToken);
        applySession(boot);
      } else {
        setState({ status: 'anon', user: null, tenant: null });
      }
    })();
  }, [applySession]);

  const login = useCallback(async (slug: string, email: string, password: string) => {
    const data = await api<{ accessToken: string; user: User }>('/auth/login', {
      body: { slug, email, password },
    });
    setAccessToken(data.accessToken);
    applySession(data);
  }, [applySession]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* best-effort, clear locally regardless */
    }
    setAccessToken(null);
    setState({ status: 'anon', user: null, tenant: null });
  }, []);

  const refreshUser = useCallback(async () => {
    const data = await api<{ user: Omit<User, 'tenant'>; tenant: Tenant }>('/auth/me');
    setState((s) => (s.user ? { ...s, user: { ...s.user, ...data.user, tenant: data.tenant }, tenant: data.tenant } : s));
  }, []);

  const value = useMemo(
    () => ({ ...state, login, logout, refreshUser }),
    [state, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/* =================== client-side mirror of the server matrix =============== */

export const isClientRole = (role: string | undefined) => role === 'CLIENT_APPROVER' || role === 'CLIENT_TEMP';

const CAPS: Record<string, string[]> = {
  ORG_ADMIN: ['tenant.write', 'users.write', 'clients.write', 'projects.write', 'endorse', 'approvals.client', 'tasks.write', 'documents.write', 'documents.delete', 'finance.write', 'finance.endorse', 'finance.certify', 'projects.read', 'audit.read'],
  PM: ['projects.write', 'stages.advance', 'tasks.write', 'documents.write', 'documents.delete', 'finance.write', 'finance.certify', 'finance.read', 'projects.read', 'clients.read'],
  PROFESSIONAL_SERVICES_LEAD: ['endorse', 'finance.endorse', 'finance.read', 'tasks.write', 'documents.write', 'projects.read'],
  GEOTECHNICAL_LEAD: ['endorse', 'finance.endorse', 'finance.read', 'tasks.write', 'documents.write', 'projects.read'],
  CONSTRUCTION_MANAGER: ['endorse', 'finance.endorse', 'finance.read', 'tasks.write', 'documents.write', 'projects.read'],
  MEMBER: ['tasks.write', 'documents.write', 'finance.read', 'projects.read'],
  VIEWER: ['finance.read', 'projects.read'],
  CLIENT_APPROVER: ['approvals.client', 'projects.read:client'],
  CLIENT_TEMP: ['projects.read:client'],
};

export function can(role: string | undefined, capability: string): boolean {
  if (!role) return false;
  return (CAPS[role] ?? []).includes(capability);
}

export const ROLE_LABELS: Record<string, string> = {
  ORG_ADMIN: 'Org Admin',
  PM: 'Project Manager',
  PROFESSIONAL_SERVICES_LEAD: 'Prof. Services Lead',
  GEOTECHNICAL_LEAD: 'Geotechnical Lead',
  CONSTRUCTION_MANAGER: 'Construction Manager',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
  CLIENT_APPROVER: 'Client Approver',
  CLIENT_TEMP: 'Client (Temporary)',
};
