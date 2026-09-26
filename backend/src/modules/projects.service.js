import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { ROLE_BY_DOMAIN, STAGES, isClientRole } from '../lib/rbac.js';
import { toRow } from '../db/mongo.js';

/** Restrict a query so client-organisation users can only ever reach
 *  projects belonging to their own organisation. Staff roles see the whole
 *  tenant portfolio (tenant scoping is applied by the data layer itself). */
export function clientScopeFilter(user) {
  if (!isClientRole(user.role)) return {};
  if (!user.clientOrgId) return { $expr: false };
  return { client_org_id: user.clientOrgId };
}

export async function loadProjectForUser(db, user, projectId) {
  const project = await db.coll('projects').findOne({ _id: projectId, ...clientScopeFilter(user) });
  if (!project) throw notFound('Project not found');
  return project;
}

export async function getProjectDetail(db, user, projectId) {
  const project = await loadProjectForUser(db, user, projectId);

  const client = project.client_org_id
    ? await db.coll('client_organisations').findOne(
        { _id: project.client_org_id },
        { projection: { _id: 1, name: 1, org_type: 1, contact_name: 1, contact_email: 1 } },
      )
    : null;

  const assignments = await db.coll('project_domain_assignments').find(
    { project_id: projectId },
    { sort: { domain: 1 } },
  );
  const leadIds = assignments.map((a) => a.user_id);
  const leads = leadIds.length
    ? await db.coll('users').find(
        { _id: { $in: leadIds } },
        { projection: { _id: 1, full_name: 1, email: 1, role: 1 } },
      )
    : [];
  const leadMap = new Map(leads.map((u) => [u._id, u]));

  const gates = await db.coll('stage_gates').find({ project_id: projectId }, { sort: { stage_index: 1 } });

  const endorsements = await db.coll('endorsements').find(
    { project_id: projectId },
    { sort: { created_at: 1 } },
  );
  const endorserIds = [...new Set(endorsements.map((e) => e.user_id))];
  const endorsers = endorserIds.length
    ? await db.coll('users').find({ _id: { $in: endorserIds } }, { projection: { _id: 1, full_name: 1 } })
    : [];
  const endorserMap = new Map(endorsers.map((u) => [u._id, u.full_name]));

  const approvals = await db.coll('stage_approvals').find(
    { project_id: projectId },
    { sort: { created_at: 1 } },
  );
  const approverIds = [...new Set(approvals.map((a) => a.user_id))];
  const approvers = approverIds.length
    ? await db.coll('users').find({ _id: { $in: approverIds } }, { projection: { _id: 1, full_name: 1 } })
    : [];
  const approverMap = new Map(approvers.map((u) => [u._id, u.full_name]));

  const detail = {
    project: {
      ...toRowProject(project),
      stageName: STAGES[project.current_stage_index - 1],
    },
    client: client ? toRowClient(client) : null,
    assignments: assignments.map((a) => {
      const u = leadMap.get(a.user_id);
      return {
        domain: a.domain,
        user: { id: a.user_id, fullName: u?.full_name ?? null, email: u?.email ?? null, role: u?.role ?? null },
      };
    }),
    gates: gates.map((g) => ({
      ...toRowGate(g),
      stageName: STAGES[g.stage_index - 1],
      endorsements: endorsements
        .filter((e) => e.stage_index === g.stage_index)
        .map((e) => ({ ...toRow(e), endorser_name: endorserMap.get(e.user_id) ?? null })),
      approvals: approvals
        .filter((a) => a.stage_index === g.stage_index)
        .map((a) => ({ ...toRow(a), approver_name: approverMap.get(a.user_id) ?? null })),
    })),
  };

  // Finance is a staff-only context, the client portal never receives it.
  if (!isClientRole(user.role)) {
    const funding = await db.coll('funding_allocations').find(
      { project_id: projectId },
      { sort: { created_at: 1 } },
    );
    const certs = await db.coll('payment_certificates').find(
      { project_id: projectId, status: 'CERTIFIED' },
      { projection: { gross_value: 1, deductions: 1 } },
    );
    const allCerts = await db.coll('payment_certificates').find(
      { project_id: projectId },
      { projection: { status: 1 } },
    );
    const vos = await db.coll('variation_orders').find(
      { project_id: projectId, status: 'APPROVED' },
      { projection: { value: 1 } },
    );
    const allVos = await db.coll('variation_orders').find(
      { project_id: projectId },
      { projection: { _id: 1 } },
    );
    const sum = (rows, f) => rows.reduce((s, r) => s + (parseFloat(r[f]) || 0), 0);
    const netSum = certs.reduce((s, c) => s + (parseFloat(c.gross_value) || 0) - (parseFloat(c.deductions) || 0), 0);
    const approvedVo = sum(vos, 'value');
    const money = (n) => (n === 0 ? '0' : n.toFixed(2));
    detail.funding = funding.map(toRow);
    detail.financeSummary = {
      certified_gross: money(sum(certs, 'gross_value')),
      certified_net: money(netSum),
      certified_count: certs.length,
      pending_count: allCerts.filter((c) => c.status === 'DRAFT' || c.status === 'ENDORSED').length,
      approved_value: money(approvedVo),
      total_count: allVos.length,
    };
  }

  return detail;
}

export async function createProject(db, user, b) {
  const n = await db.coll('projects').countDocuments({});
  const code = `PRJ-${String(n + 1).padStart(3, '0')}`;

  // Domain leads must exist in this tenant and hold the matching lead role.
  for (const a of b.domains ?? []) {
    const u = await db.coll('users').findOne({ _id: a.userId }, { projection: { _id: 1, role: 1 } });
    if (!u) throw badRequest('Assigned user not found');
    if (u.role !== ROLE_BY_DOMAIN[a.domain]) {
      throw badRequest(`${a.domain} lead must hold the ${ROLE_BY_DOMAIN[a.domain]} role`);
    }
  }

  const now = new Date();
  const project = await db.coll('projects').insertOne({
    code,
    name: b.name,
    description: b.description ?? null,
    client_org_id: b.clientOrgId ?? null,
    status: 'ACTIVE',
    current_stage_index: 1,
    contract_value: b.contractValue != null ? b.contractValue.toFixed(2) : null,
    currency: b.currency ?? 'ZAR',
    start_date: b.startDate ?? null,
    target_end_date: b.targetEndDate ?? null,
    latitude: b.latitude != null ? String(b.latitude) : null,
    longitude: b.longitude != null ? String(b.longitude) : null,
    created_by: user.id,
    created_at: now,
  });

  for (const a of b.domains ?? []) {
    await db.coll('project_domain_assignments').insertOne({
      project_id: project._id,
      domain: a.domain,
      user_id: a.userId,
    });
  }
  for (const f of b.funding ?? []) {
    await db.coll('funding_allocations').insertOne({
      project_id: project._id,
      source_name: f.sourceName,
      funder_type: f.funderType ?? 'client',
      amount: f.amount.toFixed(2),
      created_at: new Date(),
    });
  }

  // Seed the 11-stage gate ladder; stage 1 opens immediately.
  await db.coll('stage_gates').insertMany(
    Array.from({ length: 11 }, (_, i) => ({
      project_id: project._id,
      stage_index: i + 1,
      status: i === 0 ? 'IN_PROGRESS' : 'LOCKED',
      client_approval_required: true,
      opened_at: i === 0 ? now : null,
      completed_at: null,
      client_reviewed_at: null,
    })),
  );

  await audit(db, {
    actorId: user.id,
    actorRole: user.role,
    action: 'project.created',
    entity: 'project',
    entityId: project._id,
    summary: `Project created, ${code} ${project.name}`,
    detail: { code },
  });
  return toRowProject(project);
}

async function completeGateAndAdvance(db, user, projectId, stageIndex) {
  await db.coll('stage_gates').updateOne(
    { project_id: projectId, stage_index: stageIndex },
    { $set: { status: 'COMPLETED', completed_at: new Date() } },
  );
  if (stageIndex < 11) {
    await db.coll('stage_gates').updateOne(
      { project_id: projectId, stage_index: stageIndex + 1, status: 'LOCKED' },
      { $set: { status: 'IN_PROGRESS', opened_at: new Date() } },
    );
    await db.coll('projects').updateOne(
      { _id: projectId },
      { $set: { current_stage_index: stageIndex + 1 } },
    );
  } else {
    await db.coll('projects').updateOne({ _id: projectId }, { $set: { status: 'COMPLETE' } });
  }
  const project = await db.coll('projects').findOne({ _id: projectId }, { projection: { name: 1 } });
  await audit(db, {
    actorId: user.id,
    actorRole: user.role,
    action: 'gate.completed',
    entity: 'project',
    entityId: projectId,
    summary: `Stage gate ${stageIndex} (${STAGES[stageIndex - 1]}) passed on ${project?.name ?? projectId}${
      stageIndex === 11 ? ', project complete' : `; stage ${stageIndex + 1} (${STAGES[stageIndex]}) opened`
    }`,
  });
}

/** Recompute a gate after a state change. All *current* domain endorsements
 *  (newer than any client rejection) satisfy the endorsement requirement. */
async function reevaluateGate(db, user, projectId, stageIndex) {
  const gate = await db.coll('stage_gates').findOne({ project_id: projectId, stage_index: stageIndex });
  if (!gate || gate.status === 'LOCKED' || gate.status === 'COMPLETED') return gate;

  const assigned = (await db.coll('project_domain_assignments').find(
    { project_id: projectId },
    { projection: { domain: 1 } },
  )).map((r) => r.domain);

  const endorsed = (await db.coll('endorsements').find(
    {
      project_id: projectId,
      stage_index: stageIndex,
      decision: 'ENDORSED',
      created_at: { $gt: gate.client_reviewed_at ?? new Date(0) },
    },
    { projection: { domain: 1 } },
  )).map((r) => r.domain);

  const allEndorsed = assigned.length > 0 && assigned.every((d) => endorsed.includes(d));

  if (!allEndorsed) {
    if (gate.status === 'PENDING_CLIENT') {
      await db.coll('stage_gates').updateOne(
        { project_id: projectId, stage_index: stageIndex },
        { $set: { status: 'IN_PROGRESS' } },
      );
      return { ...gate, status: 'IN_PROGRESS' };
    }
    return gate;
  }

  if (!gate.client_approval_required) {
    await completeGateAndAdvance(db, user, projectId, stageIndex);
    return { ...gate, status: 'COMPLETED' };
  }
  if (gate.status !== 'PENDING_CLIENT') {
    await db.coll('stage_gates').updateOne(
      { project_id: projectId, stage_index: stageIndex },
      { $set: { status: 'PENDING_CLIENT' } },
    );
    return { ...gate, status: 'PENDING_CLIENT' };
  }
  return gate;
}

export async function endorseStage(db, user, projectId, stageIndex, domain, decision, note) {
  const project = await loadProjectForUser(db, user, projectId);
  if (project.status === 'COMPLETE') throw conflict('This project is complete');

  const gate = await db.coll('stage_gates').findOne({ project_id: projectId, stage_index: stageIndex });
  if (!gate) throw notFound('Stage gate not found');
  if (gate.status === 'LOCKED') throw conflict('That stage has not opened yet');
  if (gate.status === 'COMPLETED') throw conflict('That gate has already passed');

  // Resource-scoped authorisation: ORG_ADMIN may act on behalf of a domain;
  // otherwise the requesting user must hold that domain's assignment.
  const assignment = await db.coll('project_domain_assignments').findOne({
    project_id: projectId,
    domain,
  });
  const isAdmin = user.role === 'ORG_ADMIN';
  if (!isAdmin && (!assignment || assignment.user_id !== user.id)) {
    throw forbidden(`Only the assigned ${ROLE_BY_DOMAIN[domain]} can endorse this domain`);
  }

  await db.coll('endorsements').updateOne(
    { project_id: projectId, stage_index: stageIndex, domain },
    {
      $set: { user_id: user.id, decision, note: note ?? null, created_at: new Date() },
    },
    { upsert: true },
  );
  await audit(db, {
    actorId: user.id,
    actorRole: user.role,
    action: decision === 'ENDORSED' ? 'endorsement.endorsed' : 'endorsement.changes_requested',
    entity: 'project',
    entityId: projectId,
    summary: `${decision === 'ENDORSED' ? 'Endorsed' : 'Changes requested on'} ${STAGES[stageIndex - 1]} (${domain.replaceAll('_', ' ').toLowerCase()}), ${project.name}`,
    detail: { stageIndex, domain, decision, note },
  });

  return reevaluateGate(db, user, projectId, stageIndex);
}

export async function clientStageApproval(db, user, projectId, stageIndex, decision, note) {
  const project = await loadProjectForUser(db, user, projectId);

  // A CLIENT_APPROVER may only sign off their own organisation's projects.
  if (user.role === 'CLIENT_APPROVER' && user.clientOrgId !== project.client_org_id) {
    throw forbidden('This project belongs to a different client organisation');
  }
  if (user.role === 'CLIENT_TEMP') {
    throw forbidden('Temporary client access is read-only');
  }

  const gate = await db.coll('stage_gates').findOne({ project_id: projectId, stage_index: stageIndex });
  if (!gate) throw notFound('Stage gate not found');
  if (gate.status !== 'PENDING_CLIENT') throw conflict('This gate is not awaiting client approval');

  await db.coll('stage_approvals').insertOne({
    project_id: projectId,
    stage_index: stageIndex,
    user_id: user.id,
    decision,
    note: note ?? null,
    created_at: new Date(),
  });
  await audit(db, {
    actorId: user.id,
    actorRole: user.role,
    action: decision === 'APPROVED' ? 'approval.approved' : 'approval.rejected',
    entity: 'project',
    entityId: projectId,
    summary: `Client ${decision === 'APPROVED' ? 'approved' : 'rejected'} ${STAGES[stageIndex - 1]}, ${project.name}`,
    detail: { stageIndex, decision, note },
  });

  if (decision === 'APPROVED') {
    await completeGateAndAdvance(db, user, projectId, stageIndex);
    return { gateStatus: 'COMPLETED' };
  }
  // Rejected: domains must re-endorse, endorsements older than this review
  // no longer satisfy the gate (client_reviewed_at bound in reevaluateGate).
  await db.coll('stage_gates').updateOne(
    { project_id: projectId, stage_index: stageIndex },
    { $set: { status: 'IN_PROGRESS', client_reviewed_at: new Date() } },
  );
  return { gateStatus: 'IN_PROGRESS' };
}

// Shape helpers: the SQL rows exposed `id`; every projection here follows.
function toRowProject(p) {
  return {
    id: p._id,
    code: p.code,
    name: p.name,
    description: p.description,
    client_org_id: p.client_org_id,
    status: p.status,
    current_stage_index: p.current_stage_index,
    contract_value: p.contract_value,
    currency: p.currency,
    start_date: p.start_date,
    target_end_date: p.target_end_date,
    latitude: p.latitude,
    longitude: p.longitude,
    created_by: p.created_by,
    created_at: p.created_at,
  };
}

function toRowClient(c) {
  return { id: c._id, name: c.name, org_type: c.org_type, contact_name: c.contact_name, contact_email: c.contact_email };
}

function toRowGate(g) {
  return {
    id: g._id,
    stage_index: g.stage_index,
    status: g.status,
    client_approval_required: g.client_approval_required,
    opened_at: g.opened_at,
    completed_at: g.completed_at,
    client_reviewed_at: g.client_reviewed_at,
  };
}

export { toRowProject as toRow };
