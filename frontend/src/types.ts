export type Role =
  | 'ORG_ADMIN' | 'PM'
  | 'PROFESSIONAL_SERVICES_LEAD' | 'GEOTECHNICAL_LEAD' | 'CONSTRUCTION_MANAGER'
  | 'MEMBER' | 'VIEWER' | 'CLIENT_APPROVER' | 'CLIENT_TEMP';

export type Domain = 'PROFESSIONAL_SERVICES' | 'GEOTECHNICAL' | 'CONSTRUCTION_MANAGEMENT';

export const DOMAIN_LABELS: Record<Domain, string> = {
  PROFESSIONAL_SERVICES: 'Professional Services',
  GEOTECHNICAL: 'Geotechnical',
  CONSTRUCTION_MANAGEMENT: 'Construction Management',
};

export const STAGE_NAMES = [
  'Multi-Year Planning', 'Inception', 'Feasibility & Concept', 'Preliminary Design',
  'Detailed Design', 'Procurement & Tender', 'Construction', 'Handover', 'Close-Out',
  'Defects Liability', 'Complete',
];

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  clientOrgId?: string | null;
  tenant: Tenant;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  industry?: string;
  contact_name?: string | null;
  contact_email?: string | null;
}

export interface ProjectSummary {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETE';
  current_stage_index: number;
  contract_value: string | null;
  currency: string;
  start_date: string | null;
  target_end_date: string | null;
  latitude: string | null;
  longitude: string | null;
  client_name: string | null;
  leads: { domain: Domain; userId: string; name: string }[] | null;
  gate_status: 'LOCKED' | 'IN_PROGRESS' | 'PENDING_CLIENT' | 'COMPLETED' | null;
}

export interface Endorsement {
  id: string;
  stage_index: number;
  domain: Domain;
  decision: 'ENDORSED' | 'CHANGES_REQUESTED';
  note: string | null;
  created_at: string;
  user_id: string;
  endorser_name: string;
}

export interface StageApproval {
  id: string;
  stage_index: number;
  decision: 'APPROVED' | 'REJECTED';
  note: string | null;
  created_at: string;
  approver_name: string;
}

export interface Gate {
  stage_index: number;
  stageName: string;
  status: 'LOCKED' | 'IN_PROGRESS' | 'PENDING_CLIENT' | 'COMPLETED';
  client_approval_required: boolean;
  opened_at: string | null;
  completed_at: string | null;
  client_reviewed_at: string | null;
  endorsements: Endorsement[];
  approvals: StageApproval[];
}

export interface ProjectDetail {
  project: ProjectSummary & { description: string | null; stageName: string };
  client: { id: string; name: string; org_type: string } | null;
  assignments: { domain: Domain; user: { id: string; fullName: string; email: string; role: Role } }[];
  gates: Gate[];
  funding?: FundingAllocation[];
  financeSummary?: {
    certified_gross: string; certified_net: string; certified_count: number;
    pending_count: number; approved_value: string; total_count: number;
  };
}

export interface ClientOrg {
  id: string;
  name: string;
  org_type: 'municipality' | 'government_dept' | 'private_entity' | 'soe' | 'other';
  contact_name: string | null;
  contact_email: string | null;
  project_count: number;
  total_value: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: 'BACKLOG' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  assignee_id: string | null;
  assignee_name: string | null;
  due_date: string | null;
  position: number;
  domain: Domain | null;
  project_name: string;
  project_code: string;
}

export interface DocumentRecord {
  id: string;
  project_id: string;
  project_name?: string;
  category: string;
  title: string;
  file_name: string;
  storage_key: string | null;
  mime_type: string | null;
  size_bytes: string | null;
  stage_index: number | null;
  uploader_name: string | null;
  created_at: string;
}

export interface Certificate {
  id: string;
  project_id: string;
  certificate_no: string;
  period_start: string;
  period_end: string;
  gross_value: string;
  deductions: string;
  status: 'DRAFT' | 'ENDORSED' | 'CERTIFIED' | 'REJECTED';
  domain: Domain;
  endorsed_by_name: string | null;
  certified_at: string | null;
  created_at: string;
}

export interface VariationOrder {
  id: string;
  project_id: string;
  vo_number: string;
  description: string;
  value: string;
  time_impact_days: number;
  status: 'PROPOSED' | 'ENDORSED' | 'APPROVED' | 'REJECTED';
  endorsed_by_name: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface FundingAllocation {
  id: string;
  source_name: string;
  funder_type: string;
  amount: string;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string;
  detail: Record<string, unknown> | null;
  created_at: string;
  actor_name: string | null;
  actor_role: string | null;
}

export interface DashboardData {
  kind: 'firm' | 'client';
  kpis: Record<string, string | number>;
  certifiedByMonth?: { month: string; net_value: string }[];
  stageDistribution?: { current_stage_index: number; n: number }[];
  recentActivity?: { action: string; summary: string; entity: string; created_at: string; actor_name: string | null }[];
  outstandingTasks?: { id: string; title: string; status: string; priority: 'LOW'|'MEDIUM'|'HIGH'; due_date: string | null; project_name: string }[];
  pendingApprovals?: { id: string; name: string; stage_index: number }[];
}

export interface PendingApproval {
  id: string;
  code: string;
  name: string;
  client_name: string | null;
  current_stage_index: number;
  pending_stage: number;
  status: string;
}

export interface TeamUser {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  client_org_id: string | null;
  status: 'ACTIVE' | 'DISABLED';
  access_expires_at: string | null;
  created_at: string;
  last_login_at: string | null;
}
