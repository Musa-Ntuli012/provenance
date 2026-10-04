import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { ROLE_BY_DOMAIN, STAGES, isClientRole } from '../lib/rbac.js';

/** Restrict a query so client-organisation users can only ever reach
 *  projects belonging to their own organisation. Staff roles see the whole
 *  tenant portfolio (RLS already constrains everything to the tenant). */
export function clientScopePredicate(user, alias = 'p', startParam = 1) {
  if (!isClientRole(user.role)) return { clause: 'true', params: [] };
  if (!user.clientOrgId) return { clause: 'false', params: [] };
  return { clause: `${alias}.client_org_id = $${startParam}`, params: [user.clientOrgId] };
}

export async function loadProjectForUser(client, user, projectId) {
  const scope = clientScopePredicate(user, 'p', 2);
  const r = await client.query(
    `SELECT p.* FROM projects p WHERE p.id = $1 AND ${scope.clause}`,
    [projectId, ...scope.params],
  );
  if (r.rowCount === 0) throw notFound('Project not found');
  return r.rows[0];
}

export async function getProjectDetail(client, user, projectId) {
  const project = await loadProjectForUser(client, user, projectId);

  const clientRow = await client.query(
    `SELECT id, name, org_type, contact_name, contact_email FROM client_organisations WHERE id = $1`,
    [project.client_org_id],
  );

  const assignments = await client.query(
    `SELECT a.domain, u.id AS user_id, u.full_name, u.email, u.role
       FROM project_domain_assignments a JOIN users u ON u.id = a.user_id
      WHERE a.project_id = $1
      ORDER BY a.domain`,
    [projectId],
  );

  const gates = await client.query(
    `SELECT stage_index, status, client_approval_required, opened_at, completed_at, client_reviewed_at
       FROM stage_gates WHERE project_id = $1 ORDER BY stage_index`,
    [projectId],
  );

  const endorsements = await client.query(
    `SELECT e.*, u.full_name AS endorser_name
       FROM endorsements e JOIN users u ON u.id = e.user_id
      WHERE e.project_id = $1 ORDER BY e.created_at`,
    [projectId],
  );

  const approvals = await client.query(
    `SELECT a.*, u.full_name AS approver_name
       FROM stage_approvals a JOIN users u ON u.id = a.user_id
      WHERE a.project_id = $1 ORDER BY a.created_at`,
    [projectId],
  );

  const detail = {
    project: { ...project, stageName: STAGES[project.current_stage_index - 1] },
    client: clientRow.rows[0] ?? null,
    assignments: assignments.rows.map((a) => ({
      domain: a.domain,
      user: { id: a.user_id, fullName: a.full_name, email: a.email, role: a.role },
    })),
    gates: gates.rows.map((g) => ({
      ...g,
      stageName: STAGES[g.stage_index - 1],
      endorsements: endorsements.rows.filter((e) => e.stage_index === g.stage_index),
      approvals: approvals.rows.filter((a) => a.stage_index === g.stage_index),
    })),
  };

  // Finance is a staff-only context, the client portal never receives it.
  if (!isClientRole(user.role)) {
    const funding = await client.query(
      `SELECT * FROM funding_allocations WHERE project_id = $1 ORDER BY created_at`,
      [projectId],
    );
    const certs = await client.query(
      `SELECT COALESCE(SUM(gross_value) FILTER (WHERE status = 'CERTIFIED'), 0)::text AS certified_gross,
              COALESCE(SUM(gross_value - deductions) FILTER (WHERE status = 'CERTIFIED'), 0)::text AS certified_net,
              COUNT(*) FILTER (WHERE status = 'CERTIFIED')::int AS certified_count,
              COUNT(*) FILTER (WHERE status IN ('DRAFT','ENDORSED'))::int AS pending_count
         FROM payment_certificates WHERE project_id = $1`,
      [projectId],
    );
    const variations = await client.query(
      `SELECT COALESCE(SUM(value) FILTER (WHERE status = 'APPROVED'), 0)::text AS approved_value,
              COUNT(*)::int AS total_count
         FROM variation_orders WHERE project_id = $1`,
      [projectId],
    );
    detail.funding = funding.rows;
    detail.financeSummary = { ...certs.rows[0], ...variations.rows[0] };
  }

  return detail;
}

export async function createProject(client, user, b) {
  const codeRow = await client.query(`SELECT COUNT(*)::int AS n FROM projects`);
  const code = `PRJ-${String(codeRow.rows[0].n + 1).padStart(3, '0')}`;

  // Domain leads must exist in this tenant and hold the matching lead role.
  for (const a of b.domains ?? []) {
    const u = await client.query('SELECT id, role FROM users WHERE id = $1', [a.userId]);
    if (u.rowCount === 0) throw badRequest('Assigned user not found');
    if (u.rows[0].role !== ROLE_BY_DOMAIN[a.domain]) {
      throw badRequest(`${a.domain} lead must hold the ${ROLE_BY_DOMAIN[a.domain]} role`);
    }
  }

  const row = await client.query(
    `INSERT INTO projects
       (name, description, client_org_id, contract_value, currency, start_date, target_end_date,
        latitude, longitude, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      b.name,
      b.description ?? null,
      b.clientOrgId ?? null,
      b.contractValue != null ? b.contractValue.toFixed(2) : null,
      b.currency ?? 'ZAR',
      b.startDate ?? null,
      b.targetEndDate ?? null,
      b.latitude ?? null,
      b.longitude ?? null,
      user.id,
    ],
  );
  const project = row.rows[0];

  for (const a of b.domains ?? []) {
    await client.query(
      `INSERT INTO project_domain_assignments (project_id, domain, user_id) VALUES ($1, $2, $3)`,
      [project.id, a.domain, a.userId],
    );
  }
  for (const f of b.funding ?? []) {
    await client.query(
      `INSERT INTO funding_allocations (project_id, source_name, funder_type, amount)
       VALUES ($1, $2, $3, $4)`,
      [project.id, f.sourceName, f.funderType ?? 'client', f.amount.toFixed(2)],
    );
  }

  // Seed the 11-stage gate ladder; stage 1 opens immediately.
  for (let i = 1; i <= 11; i++) {
    await client.query(
      `INSERT INTO stage_gates (project_id, stage_index, status, opened_at)
       VALUES ($1, $2, $3, $4)`,
      [project.id, i, i === 1 ? 'IN_PROGRESS' : 'LOCKED', i === 1 ? new Date() : null],
    );
  }

  await audit(client, {
    actorId: user.id,
    actorRole: user.role,
    action: 'project.created',
    entity: 'project',
    entityId: project.id,
    summary: `Project created, ${code} ${project.name}`,
    detail: { code },
  });
  return project;
}

async function completeGateAndAdvance(client, user, projectId, stageIndex) {
  await client.query(
    `UPDATE stage_gates SET status = 'COMPLETED', completed_at = now() WHERE project_id = $1 AND stage_index = $2`,
    [projectId, stageIndex],
  );
  if (stageIndex < 11) {
    await client.query(
      `UPDATE stage_gates SET status = 'IN_PROGRESS', opened_at = now()
        WHERE project_id = $1 AND stage_index = $2 AND status = 'LOCKED'`,
      [projectId, stageIndex + 1],
    );
    await client.query(`UPDATE projects SET current_stage_index = $2 WHERE id = $1`, [projectId, stageIndex + 1]);
  } else {
    await client.query(`UPDATE projects SET status = 'COMPLETE' WHERE id = $1`, [projectId]);
  }
  const r = await client.query('SELECT name FROM projects WHERE id = $1', [projectId]);
  await audit(client, {
    actorId: user.id,
    actorRole: user.role,
    action: 'gate.completed',
    entity: 'project',
    entityId: projectId,
    summary: `Stage gate ${stageIndex} (${STAGES[stageIndex - 1]}) passed on ${r.rows[0]?.name ?? projectId}${
      stageIndex === 11 ? ', project complete' : `; stage ${stageIndex + 1} (${STAGES[stageIndex]}) opened`
    }`,
  });
}

/** Recompute a gate after a state change. All *current* domain endorsements
 *  (newer than any client rejection) satisfy the endorsement requirement. */
async function reevaluateGate(client, user, projectId, stageIndex) {
  const gate = (
    await client.query(`SELECT * FROM stage_gates WHERE project_id = $1 AND stage_index = $2`, [projectId, stageIndex])
  ).rows[0];
  if (!gate || gate.status === 'LOCKED' || gate.status === 'COMPLETED') return gate;

  const assigned = (
    await client.query(`SELECT domain FROM project_domain_assignments WHERE project_id = $1`, [projectId])
  ).rows.map((r) => r.domain);

  const endorsed = (
    await client.query(
      `SELECT domain FROM endorsements
        WHERE project_id = $1 AND stage_index = $2 AND decision = 'ENDORSED'
          AND created_at > COALESCE($3::timestamptz, to_timestamp(0))`,
      [projectId, stageIndex, gate.client_reviewed_at],
    )
  ).rows.map((r) => r.domain);

  const allEndorsed = assigned.length > 0 && assigned.every((d) => endorsed.includes(d));

  if (!allEndorsed) {
    if (gate.status === 'PENDING_CLIENT') {
      await client.query(`UPDATE stage_gates SET status = 'IN_PROGRESS' WHERE project_id = $1 AND stage_index = $2`, [
        projectId,
        stageIndex,
      ]);
      return { ...gate, status: 'IN_PROGRESS' };
    }
    return gate;
  }

  if (!gate.client_approval_required) {
    await completeGateAndAdvance(client, user, projectId, stageIndex);
    return { ...gate, status: 'COMPLETED' };
  }
  if (gate.status !== 'PENDING_CLIENT') {
    await client.query(`UPDATE stage_gates SET status = 'PENDING_CLIENT' WHERE project_id = $1 AND stage_index = $2`, [
      projectId,
      stageIndex,
    ]);
    return { ...gate, status: 'PENDING_CLIENT' };
  }
  return gate;
}

export async function endorseStage(client, user, projectId, stageIndex, domain, decision, note) {
  const project = await loadProjectForUser(client, user, projectId);
  if (project.status === 'COMPLETE') throw conflict('This project is complete');

  const gate = (
    await client.query(`SELECT * FROM stage_gates WHERE project_id = $1 AND stage_index = $2`, [projectId, stageIndex])
  ).rows[0];
  if (!gate) throw notFound('Stage gate not found');
  if (gate.status === 'LOCKED') throw conflict('That stage has not opened yet');
  if (gate.status === 'COMPLETED') throw conflict('That gate has already passed');

  // Resource-scoped authorisation: ORG_ADMIN may act on behalf of a domain;
  // otherwise the requesting user must hold that domain's assignment.
  const assignment = (
    await client.query(`SELECT * FROM project_domain_assignments WHERE project_id = $1 AND domain = $2`, [
      projectId,
      domain,
    ])
  ).rows[0];
  const isAdmin = user.role === 'ORG_ADMIN';
  if (!isAdmin && (!assignment || assignment.user_id !== user.id)) {
    throw forbidden(`Only the assigned ${ROLE_BY_DOMAIN[domain]} can endorse this domain`);
  }

  await client.query(
    `INSERT INTO endorsements (project_id, stage_index, domain, user_id, decision, note)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (project_id, stage_index, domain)
     DO UPDATE SET user_id = EXCLUDED.user_id, decision = EXCLUDED.decision,
                   note = EXCLUDED.note, created_at = now()`,
    [projectId, stageIndex, domain, user.id, decision, note ?? null],
  );
  await audit(client, {
    actorId: user.id,
    actorRole: user.role,
    action: decision === 'ENDORSED' ? 'endorsement.endorsed' : 'endorsement.changes_requested',
    entity: 'project',
    entityId: projectId,
    summary: `${decision === 'ENDORSED' ? 'Endorsed' : 'Changes requested on'} ${STAGES[stageIndex - 1]} (${domain.replaceAll('_', ' ').toLowerCase()}), ${project.name}`,
    detail: { stageIndex, domain, decision, note },
  });

  return reevaluateGate(client, user, projectId, stageIndex);
}

export async function clientStageApproval(client, user, projectId, stageIndex, decision, note) {
  const project = await loadProjectForUser(client, user, projectId);

  // A CLIENT_APPROVER may only sign off their own organisation's projects.
  if (user.role === 'CLIENT_APPROVER' && user.clientOrgId !== project.client_org_id) {
    throw forbidden('This project belongs to a different client organisation');
  }
  if (user.role === 'CLIENT_TEMP') {
    throw forbidden('Temporary client access is read-only');
  }

  const gate = (
    await client.query(`SELECT * FROM stage_gates WHERE project_id = $1 AND stage_index = $2`, [projectId, stageIndex])
  ).rows[0];
  if (!gate) throw notFound('Stage gate not found');
  if (gate.status !== 'PENDING_CLIENT') throw conflict('This gate is not awaiting client approval');

  await client.query(
    `INSERT INTO stage_approvals (project_id, stage_index, user_id, decision, note)
     VALUES ($1,$2,$3,$4,$5)`,
    [projectId, stageIndex, user.id, decision, note ?? null],
  );
  await audit(client, {
    actorId: user.id,
    actorRole: user.role,
    action: decision === 'APPROVED' ? 'approval.approved' : 'approval.rejected',
    entity: 'project',
    entityId: projectId,
    summary: `Client ${decision === 'APPROVED' ? 'approved' : 'rejected'} ${STAGES[stageIndex - 1]}, ${project.name}`,
    detail: { stageIndex, decision, note },
  });

  if (decision === 'APPROVED') {
    await completeGateAndAdvance(client, user, projectId, stageIndex);
    return { gateStatus: 'COMPLETED' };
  }
  // Rejected: domains must re-endorse, endorsements older than this review
  // no longer satisfy the gate (client_reviewed_at bound in reevaluateGate).
  await client.query(
    `UPDATE stage_gates SET status = 'IN_PROGRESS', client_reviewed_at = now()
      WHERE project_id = $1 AND stage_index = $2`,
    [projectId, stageIndex],
  );
  return { gateStatus: 'IN_PROGRESS' };
}
