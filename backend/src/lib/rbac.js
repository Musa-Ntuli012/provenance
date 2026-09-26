/**
 * Role → capability matrix. Server-side source of truth; the UI mirrors it
 * for convenience only. Capabilities are checked per route AND per resource
 * (a role grants the action, RLS + explicit predicates grant the record).
 */

export const ROLES = [
  'SUPER_ADMIN',
  'ORG_ADMIN',
  'PM',
  'PROFESSIONAL_SERVICES_LEAD',
  'GEOTECHNICAL_LEAD',
  'CONSTRUCTION_MANAGER',
  'MEMBER',
  'CLIENT_APPROVER',
  'VIEWER',
  'CLIENT_TEMP',
];

export const DOMAINS = ['PROFESSIONAL_SERVICES', 'GEOTECHNICAL', 'CONSTRUCTION_MANAGEMENT'];

export const ROLE_BY_DOMAIN = {
  PROFESSIONAL_SERVICES: 'PROFESSIONAL_SERVICES_LEAD',
  GEOTECHNICAL: 'GEOTECHNICAL_LEAD',
  CONSTRUCTION_MANAGEMENT: 'CONSTRUCTION_MANAGER',
};

export const STAGES = [
  'Multi-Year Planning',
  'Inception',
  'Feasibility & Concept',
  'Preliminary Design',
  'Detailed Design',
  'Procurement & Tender',
  'Construction',
  'Handover',
  'Close-Out',
  'Defects Liability',
  'Complete',
];

export const CLIENT_ROLE_PREFIX = 'CLIENT_';

export const isClientRole = (role) => role === 'CLIENT_APPROVER' || role === 'CLIENT_TEMP';

const CAPS = {
  ORG_ADMIN: [
    'tenant.write', 'users.write', 'clients.write', 'projects.write', 'stages.advance',
    'endorse', 'approvals.client', 'tasks.write', 'documents.write', 'documents.delete',
    'finance.write', 'finance.endorse', 'finance.certify', 'projects.read', 'audit.read',
  ],
  PM: [
    'projects.write', 'stages.advance', 'tasks.write',
    'documents.write', 'documents.delete', 'finance.write', 'finance.certify',
    'finance.read', 'projects.read', 'clients.read',
  ],
  PROFESSIONAL_SERVICES_LEAD: ['endorse', 'finance.endorse', 'finance.read', 'tasks.write', 'documents.write', 'projects.read'],
  GEOTECHNICAL_LEAD: ['endorse', 'finance.endorse', 'finance.read', 'tasks.write', 'documents.write', 'projects.read'],
  CONSTRUCTION_MANAGER: ['endorse', 'finance.endorse', 'finance.read', 'tasks.write', 'documents.write', 'projects.read'],
  MEMBER: ['tasks.write', 'documents.write', 'finance.read', 'projects.read'],
  VIEWER: ['finance.read', 'projects.read'],
  // Client roles: scoped to their own organisation's projects, read-only
  // except the formal client approval of a stage gate.
  CLIENT_APPROVER: ['approvals.client', 'projects.read:client'],
  CLIENT_TEMP: ['projects.read:client'],
};

/** Whether a role holds a capability. `endorse` is domain-checked separately. */
export function can(role, capability) {
  return (CAPS[role] ?? []).includes(capability);
}

/** Domain leads may endorse only their own domain. */
export function canEndorseDomain(user, domain) {
  if (user.role === 'ORG_ADMIN') return true;
  return ROLE_BY_DOMAIN[domain] === user.role;
}
