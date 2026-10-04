/**
 * Demo seed, one private-firm tenant with a live portfolio.
 * Run: npm run db:seed   (requires migrations first: npm run db:migrate)
 *
 * Idempotent: re-running drops and recreates the demo tenant.
 *
 * DEMO CREDENTIALS (development only, never seed real passwords):
 *   workspace: mbe-demo        password for every seeded user: Provenance!Demo1
 */
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { config } from '../config.js';

const DEMO_SLUG = 'mbe-demo';
const DEMO_PASSWORD = 'Provenance!Demo1';

const admin = new pg.Client({ connectionString: config.databaseUrlAdmin });

const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400_000);
const daysAhead = (n) => new Date(Date.now() + n * 86400_000);

async function audit(db, tenantId, actorId, actorRole, action, entity, entityId, summary, at) {
  await db.query(
    `INSERT INTO audit_events (tenant_id, actor_id, actor_role, action, entity, entity_id, summary, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, now()))`,
    [tenantId, actorId, actorRole, action, entity, entityId, summary, at ?? null],
  );
}

async function main() {
  await admin.connect();
  console.log('seeding…');

  await admin.query('BEGIN');

  // Reset demo tenant if re-seeding.
  const existing = await admin.query('SELECT id FROM tenants WHERE slug = $1', [DEMO_SLUG]);
  if (existing.rowCount > 0) {
    await admin.query('DELETE FROM tenants WHERE id = $1', [existing.rows[0].id]);
    console.log('  (removed previous demo tenant)');
  }

  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const tenant = (
    await admin.query(
      `INSERT INTO tenants (name, slug, industry, contact_name, contact_email)
       VALUES ($1, $2, 'engineering_consulting', 'Amara Molamo', 'amara@molamobosman.co.za')
       RETURNING id`,
      ['Molamo Bosman Consulting Engineers', DEMO_SLUG],
    )
  ).rows[0];
  const T = tenant.id;

  const mkUser = async (email, fullName, role, extra = {}) =>
    (
      await admin.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, role, client_org_id, access_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [T, email, hash, fullName, role, extra.clientOrgId ?? null, extra.expires ?? null],
      )
    ).rows[0].id;

  const amara = await mkUser('amara@molamobosman.co.za', 'Amara Molamo', 'ORG_ADMIN');
  const thabiso = await mkUser('thabiso@molamobosman.co.za', 'Thabiso Mokoena', 'PM');
  const priya = await mkUser('priya@molamobosman.co.za', 'Priya Naidoo', 'PROFESSIONAL_SERVICES_LEAD');
  const sipho = await mkUser('sipho@molamobosman.co.za', 'Sipho Dlamini', 'GEOTECHNICAL_LEAD');
  const carel = await mkUser('carel@molamobosman.co.za', 'Carel van Wyk', 'CONSTRUCTION_MANAGER');
  await mkUser('lerato@molamobosman.co.za', 'Lerato Dube', 'MEMBER');
  await mkUser('naledi@molamobosman.co.za', 'Naledi Sithole', 'VIEWER');

  const mkClient = async (name, orgType, contactName, contactEmail) =>
    (
      await admin.query(
        `INSERT INTO client_organisations (tenant_id, name, org_type, contact_name, contact_email)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [T, name, orgType, contactName, contactEmail],
      )
    ).rows[0].id;

  const blueKruger = await mkClient('Blue Kruger Developments', 'private_entity', 'Dineo Kruger', 'dineo@bluekruger.co.za');
  const tshwane = await mkClient('City of Tshwane', 'municipality', 'Gugu Mahlangu', 'g.mahlangu@tshwane.gov.za');
  const halcyon = await mkClient('Halcyon Property Group', 'private_entity', 'Marc Halcyon', 'marc@halcyonpg.co.za');
  const corridor = await mkClient('Corridor Roads Agency', 'soe', 'Refilwe Motaung', 'r.motaung@corridorra.org.za');

  const dineo = await mkUser('dineo@bluekruger.co.za', 'Dineo Kruger', 'CLIENT_APPROVER', { clientOrgId: blueKruger });
  const gugu = await mkUser('g.mahlangu@tshwane.gov.za', 'Gugu Mahlangu', 'CLIENT_APPROVER', { clientOrgId: tshwane });
  await mkUser('site.office@halcyonpg.co.za', 'Halcyon Site Office', 'CLIENT_TEMP', {
    clientOrgId: halcyon,
    expires: daysAhead(30),
  });

  const DOMAINS = ['PROFESSIONAL_SERVICES', 'GEOTECHNICAL', 'CONSTRUCTION_MANAGEMENT'];
  const LEADS = { PROFESSIONAL_SERVICES: priya, GEOTECHNICAL: sipho, CONSTRUCTION_MANAGEMENT: carel };
  const STAGES = 11;

  const mkProject = async (p) => {
    const row = (
      await admin.query(
        `INSERT INTO projects (tenant_id, code, name, description, client_org_id, contract_value, currency,
                               start_date, target_end_date, latitude, longitude, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'ZAR',$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          T, p.code, p.name, p.description, p.clientId, p.value.toFixed(2),
          iso(daysAgo(p.startedDaysAgo)), iso(daysAhead(p.remainingDays)),
          p.lat, p.lng, amara, daysAgo(p.startedDaysAgo),
        ],
      )
    ).rows[0];
    for (const d of DOMAINS) {
      await admin.query(
        `INSERT INTO project_domain_assignments (project_id, domain, user_id, tenant_id) VALUES ($1,$2,$3,$4)`,
        [row.id, d, LEADS[d], T],
      );
    }
    await admin.query(
      `INSERT INTO funding_allocations (tenant_id, project_id, source_name, funder_type, amount)
       VALUES ($1,$2,$3,$4,$5)`,
      [T, row.id, p.fundingSource, p.fundingType, (p.value * 0.9).toFixed(2)],
    );
    return row.id;
  };

  /** Build the gate ladder + history for a project at `atStage` (1-based). */
  async function seedGates(projectId, atStage, { endorsed: currentEndorsed, state, clientApprover, approvedByOverride } = {}) {
    for (let i = 1; i <= STAGES; i++) {
      let status = 'LOCKED';
      let opened = null;
      let completed = null;
      if (i < atStage) {
        status = 'COMPLETED';
        opened = daysAgo(220 - i * 18);
        completed = daysAgo(220 - (i + 1) * 18);
      } else if (i === atStage) {
        status = state === 'PENDING_CLIENT' ? 'PENDING_CLIENT' : 'IN_PROGRESS';
        opened = daysAgo(24);
      }
      await admin.query(
        `INSERT INTO stage_gates (project_id, stage_index, tenant_id, status, opened_at, completed_at, client_reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [projectId, i, T, status, opened, completed, i < atStage ? completed : null],
      );
      if (i < atStage) {
        for (const d of DOMAINS) {
          await admin.query(
            `INSERT INTO endorsements (tenant_id, project_id, stage_index, domain, user_id, decision, note, created_at)
             VALUES ($1,$2,$3,$4,$5,'ENDORSED',$6,$7)`,
            [T, projectId, i, d, LEADS[d], 'No exceptions noted.', opened],
          );
        }
        await admin.query(
          `INSERT INTO stage_approvals (tenant_id, project_id, stage_index, user_id, decision, note, created_at)
           VALUES ($1,$2,$3,$4,'APPROVED','Approved for progression.',$5)`,
          [T, projectId, i, approvedByOverride ?? clientApprover, completed],
        );
      }
      if (i === atStage && currentEndorsed?.length) {
        for (const d of currentEndorsed) {
          await admin.query(
            `INSERT INTO endorsements (tenant_id, project_id, stage_index, domain, user_id, decision, note, created_at)
             VALUES ($1,$2,$3,$4,$5,'ENDORSED','Progressing as planned.',$6)`,
            [T, projectId, i, d, LEADS[d], daysAgo(10)],
          );
        }
      }
      if (i === atStage && state === 'PENDING_CLIENT') {
        for (const d of DOMAINS) {
          await admin.query(
            `INSERT INTO endorsements (tenant_id, project_id, stage_index, domain, user_id, decision, note, created_at)
             VALUES ($1,$2,$3,$4,$5,'ENDORSED','Ready for client review.',$6)`,
            [T, projectId, i, d, LEADS[d], daysAgo(6)],
          );
        }
      }
    }
    await admin.query(`UPDATE projects SET current_stage_index = $2 WHERE id = $1`, [projectId, atStage]);
  }

  const p1 = await mkProject({
    code: 'PRJ-001', name: 'Mogale Wastewater Works Upgrade',
    description: 'Phase 2 upgrade of the Mogale wastewater treatment works: new activated sludge modules, sludge dewatering building and outfall refurbishment.',
    clientId: tshwane, value: 148_500_000, startedDaysAgo: 420, remainingDays: 300,
    lat: -26.097, lng: 27.772, fundingSource: 'Municipal infrastructure grant allocation (client)', fundingType: 'client',
  });
  const p2 = await mkProject({
    code: 'PRJ-002', name: 'Menlyn Node Data Centre, Geotechnical & Foundations',
    description: 'Phase 1 geotechnical investigation and piling design for a two-basin data centre campus; rock socket verification and rail-generated vibration assessment.',
    clientId: halcyon, value: 62_300_000, startedDaysAgo: 260, remainingDays: 260,
    lat: -25.784, lng: 28.274, fundingSource: 'Halcyon development facility', fundingType: 'lender',
  });
  const p3 = await mkProject({
    code: 'PRJ-003', name: 'Blue Kruger Waterfront, Bulk Services',
    description: 'Bulk earthworks, water, sewer and stormwater trunk infrastructure for the waterfront precinct, including a pump station and outfall to the dam wall.',
    clientId: blueKruger, value: 234_000_000, startedDaysAgo: 640, remainingDays: 420,
    lat: -25.743, lng: 27.858, fundingSource: 'Blue Kruger Development Capital', fundingType: 'client',
  });
  const p4 = await mkProject({
    code: 'PRJ-004', name: 'N4 Corridor Culvert Rehabilitation',
    description: 'Rehabilitation of 14 major culvert structures between the interchange and the weighbridge: scour protection, headwall reconstruction and jacked sleeve insertion.',
    clientId: corridor, value: 38_750_000, startedDaysAgo: 540, remainingDays: 120,
    lat: -25.678, lng: 28.152, fundingSource: 'Corridor Roads Agency capital programme', fundingType: 'client',
  });
  const p5 = await mkProject({
    code: 'PRJ-005', name: 'Waterberg Solar Hybrid, Grid Connection Works',
    description: 'Feasibility and concept design for the 120 MW hybrid plant grid connection: overhead line routing, substation siting and geotechnical investigation of tower foundations.',
    clientId: halcyon, value: 96_200_000, startedDaysAgo: 130, remainingDays: 540,
    lat: -24.702, lng: 28.401, fundingSource: 'Halcyon Energy Partners', fundingType: 'client',
  });
  const p6 = await mkProject({
    code: 'PRJ-006', name: 'Tshwane Market Cold Chain Retrofit',
    description: 'Replacement refrigeration plant, thermal envelope upgrade and standby power integration at the fresh produce market.',
    clientId: tshwane, value: 27_900_000, startedDaysAgo: 60, remainingDays: 330,
    lat: -25.752, lng: 28.189, fundingSource: 'City of Tshwane capital budget 2026/27', fundingType: 'client',
  });

  await seedGates(p1, 5, { endorsed: ['PROFESSIONAL_SERVICES', 'GEOTECHNICAL'], clientApprover: gugu });
  await seedGates(p2, 4, { endorsed: ['PROFESSIONAL_SERVICES'], clientApprover: gugu });
  await seedGates(p3, 7, { state: 'PENDING_CLIENT', clientApprover: dineo });
  await seedGates(p4, 8, { state: 'PENDING_CLIENT', clientApprover: gugu });
  await seedGates(p5, 3, { endorsed: [], clientApprover: gugu });
  await seedGates(p6, 2, { endorsed: ['PROFESSIONAL_SERVICES'], clientApprover: gugu });

  // Payment certificates, construction-stage projects carry a history.
  const certs = [
    [p3, 'PC-001', 300, 270, 8_240_000, 82_400, 'CERTIFIED', carel],
    [p3, 'PC-002', 270, 240, 9_120_000, 91_200, 'CERTIFIED', carel],
    [p3, 'PC-003', 240, 210, 11_360_000, 113_600, 'CERTIFIED', carel],
    [p3, 'PC-004', 210, 180, 10_980_000, 109_800, 'CERTIFIED', carel],
    [p3, 'PC-005', 180, 150, 12_450_000, 124_500, 'CERTIFIED', carel],
    [p3, 'PC-006', 150, 120, 13_720_000, 137_200, 'CERTIFIED', carel],
    [p3, 'PC-007', 120, 90, 12_980_000, 129_800, 'CERTIFIED', carel],
    [p3, 'PC-008', 90, 60, 14_240_000, 142_400, 'CERTIFIED', carel],
    [p3, 'PC-009', 60, 30, 15_310_000, 153_100, 'ENDORSED', carel],
    [p3, 'PC-010', 30, 3, 14_875_000, 148_750, 'DRAFT', carel],
    [p1, 'PC-001', 120, 90, 18_600_000, 186_000, 'ENDORSED', carel],
    [p1, 'PC-002', 90, 60, 22_400_000, 224_000, 'DRAFT', carel],
    [p4, 'PC-001', 380, 350, 4_120_000, 41_200, 'CERTIFIED', carel],
    [p4, 'PC-002', 350, 320, 3_845_000, 38_450, 'CERTIFIED', carel],
    [p4, 'PC-003', 320, 290, 4_510_000, 45_100, 'CERTIFIED', carel],
  ];
  for (const [pid, no, a, b, gross, ded, status, by] of certs) {
    await admin.query(
      `INSERT INTO payment_certificates (tenant_id, project_id, certificate_no, period_start, period_end,
                                         gross_value, deductions, status, domain, endorsed_by, endorsed_at, certified_at, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CONSTRUCTION_MANAGEMENT',$9,$10,$11,$12,$13)`,
      [
        T, pid, no, iso(daysAgo(a)), iso(daysAgo(b)), gross.toFixed(2), ded.toFixed(2), status, by,
        status !== 'DRAFT' ? daysAgo(b - 5) : null,
        status === 'CERTIFIED' ? daysAgo(b - 8) : null,
        thabiso, daysAgo(b),
      ],
    );
  }

  const vos = [
    [p3, 'VO-001', 'Relocation of the 400 mm steel rising main discovered during bulk excavations.', 4_200_000, 15, 'APPROVED', carel, 300],
    [p3, 'VO-002', 'Additional stormwater attenuation volume required after revised hydrology study.', 850_000, 0, 'ENDORSED', priya, 150],
    [p3, 'VO-003', 'Credit for value-engineered manhole standardisation across Precinct B.', -310_000, -3, 'PROPOSED', null, 30],
    [p1, 'VO-001', 'Extra dewatering allowance following high water table encounter at Module 3.', 1_240_000, 10, 'PROPOSED', null, 20],
  ];
  for (const [pid, no, desc, value, days, status, by, ago] of vos) {
    await admin.query(
      `INSERT INTO variation_orders (tenant_id, project_id, vo_number, description, value, time_impact_days, status, endorsed_by, approved_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [T, pid, no, desc, value.toFixed(2), days, status, by, status === 'APPROVED' ? daysAgo(ago - 10) : null, daysAgo(ago)],
    );
  }

  const tasks = [
    [p3, 'Close out punch-list items, Pump Station 2', 'CONSTRUCTION_MANAGEMENT', 'HIGH', carel, 7, 'IN_PROGRESS', 0],
    [p3, 'Compile PC-010 supporting measurement sheets', 'CONSTRUCTION_MANAGEMENT', 'MEDIUM', carel, 12, 'REVIEW', 0],
    [p3, 'Update as-built sewer layout drawings', 'PROFESSIONAL_SERVICES', 'MEDIUM', priya, 18, 'IN_PROGRESS', 0],
    [p3, 'Attenuation pond capacity check vs revised hydrology', 'PROFESSIONAL_SERVICES', 'HIGH', priya, 5, 'BACKLOG', 0],
    [p1, 'Module 3 dewatering method statement', 'CONSTRUCTION_MANAGEMENT', 'HIGH', carel, 4, 'IN_PROGRESS', 0],
    [p1, 'Sludge building foundation level survey', 'GEOTECHNICAL', 'MEDIUM', sipho, 14, 'BACKLOG', 0],
    [p1, 'Draft stage 5 gate submission pack', 'PROFESSIONAL_SERVICES', 'HIGH', priya, 9, 'REVIEW', 0],
    [p2, 'Piling trial pit logs, Basin B', 'GEOTECHNICAL', 'HIGH', sipho, 6, 'IN_PROGRESS', 0],
    [p2, 'Vibration monitoring report, rail corridor', 'GEOTECHNICAL', 'MEDIUM', sipho, 21, 'BACKLOG', 0],
    [p2, 'Foundation concept options memo', 'PROFESSIONAL_SERVICES', 'MEDIUM', priya, 25, 'BACKLOG', 0],
    [p4, 'Culvert 9 headwall reinforcement inspection', 'CONSTRUCTION_MANAGEMENT', 'LOW', carel, 30, 'DONE', 0],
    [p4, 'Handover dossier, structural certificates', 'PROFESSIONAL_SERVICES', 'HIGH', thabiso, 8, 'IN_PROGRESS', 0],
    [p5, 'Tower foundation investigation scope', 'GEOTECHNICAL', 'MEDIUM', sipho, 16, 'BACKLOG', 0],
    [p5, 'Overhead line routing constraint map', 'PROFESSIONAL_SERVICES', 'LOW', priya, 40, 'BACKLOG', 0],
    [p6, 'Refrigeration plant load analysis', 'PROFESSIONAL_SERVICES', 'MEDIUM', thabiso, 11, 'IN_PROGRESS', 0],
    [p6, 'Standby power sizing workshop', 'CONSTRUCTION_MANAGEMENT', 'LOW', carel, 22, 'BACKLOG', 0],
  ];
  for (const [pid, title, domain, priority, assignee, due, status, pos] of tasks) {
    await admin.query(
      `INSERT INTO tasks (tenant_id, project_id, title, status, priority, assignee_id, due_date, position, domain)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [T, pid, title, status, priority, assignee, iso(daysAhead(due)), pos, domain],
    );
  }

  const docs = [
    [p3, 'CONTRACT', 'Contract data & preamble, Blue Kruger Waterfront', 'contract-data-bkw.pdf', 7, 640],
    [p3, 'DRAWING', 'Bulk earthworks layout, Rev F', 'bk-earthworks-revf.dwg', 7, 320],
    [p3, 'CERTIFICATE', 'Payment certificate PC-008', 'bk-pc008.pdf', 7, 30],
    [p3, 'CLIENT_DELIVERABLE', 'Monthly progress report, August 2026', 'bk-progress-aug26.pdf', 7, 18],
    [p1, 'GEOTECH', 'Module 3 trail pit logs & indicator testing', 'mogale-pits-m3.pdf', 5, 90],
    [p1, 'DRAWING', 'Activated sludge module general arrangement', 'mogale-asga-revc.dwg', 4, 210],
    [p1, 'REPORT', 'Process design report, Phase 2', 'mogale-process-design.pdf', 4, 230],
    [p2, 'GEOTECH', 'Baseline geotechnical investigation, Phase 1', 'menlyn-agi-p1.pdf', 4, 140],
    [p2, 'REPORT', 'Rail vibration assessment', 'menlyn-vibration.pdf', 4, 96],
    [p4, 'APPROVAL', 'Culvert 9 headwall inspection sign-off', 'n4-c9-signoff.pdf', 8, 45],
    [p4, 'CLIENT_DELIVERABLE', 'Handover dossier, structures', 'n4-handover-dossier.pdf', 8, 12],
    [p5, 'REPORT', 'Grid connection pre-feasibility', 'waterberg-prefeas.pdf', 3, 40],
  ];
  for (const [pid, category, title, fileName, stage, ago] of docs) {
    await admin.query(
      `INSERT INTO documents (tenant_id, project_id, category, title, file_name, storage_key, mime_type, size_bytes, stage_index, uploaded_by, created_at)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10)`,
      [T, pid, category, title, fileName, 'application/pdf', Math.round(400_000 + Math.random() * 3_000_000), stage, thabiso, daysAgo(ago)],
    );
  }

  const audits = [
    [amara, 'ORG_ADMIN', 'project.created', 'project', p1, 'Project created, PRJ-001 Mogale Wastewater Works Upgrade', 420],
    [thabiso, 'PM', 'project.created', 'project', p3, 'Project created, PRJ-003 Blue Kruger Waterfront, Bulk Services', 640],
    [priya, 'PROFESSIONAL_SERVICES_LEAD', 'endorsement.endorsed', 'project', p3, 'Endorsed Construction (professional services), PRJ-003', 6],
    [carel, 'CONSTRUCTION_MANAGER', 'certificate.certified', 'payment_certificate', p3, 'Payment certificate PC-008 certified', 30],
    [dineo, 'CLIENT_APPROVER', 'approval.approved', 'project', p3, 'Client approved Procurement & Tender, PRJ-003', 24],
    [sipho, 'GEOTECHNICAL_LEAD', 'endorsement.endorsed', 'project', p1, 'Endorsed Preliminary Design (geotechnical), PRJ-001', 40],
    [thabiso, 'PM', 'document.uploaded', 'document', p3, 'Document uploaded, Monthly progress report, August 2026', 18],
    [amara, 'ORG_ADMIN', 'client.access_granted', 'user', dineo, 'Dineo Kruger granted standing access for Blue Kruger Developments', 600],
  ];
  for (const [actor, role, action, entity, entityId, summary, ago] of audits) {
    await audit(admin, T, actor, role, action, entity, entityId, summary, daysAgo(ago));
  }

  await admin.query('COMMIT');

  console.log(`tenant      : Molamo Bosman Consulting Engineers (${DEMO_SLUG})`);
  console.log(`staff login : thabiso@molamobosman.co.za / ${DEMO_PASSWORD}  (PM)`);
  console.log(`admin login : amara@molamobosman.co.za / ${DEMO_PASSWORD}   (ORG_ADMIN)`);
  console.log(`client login: dineo@bluekruger.co.za / ${DEMO_PASSWORD}     (CLIENT_APPROVER)`);
  await admin.end();
}

main().catch(async (err) => {
  try {
    await admin.query('ROLLBACK');
  } catch {
    /* not in a transaction */
  }
  console.error('seed failed:', err.message);
  process.exit(1);
});
