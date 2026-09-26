import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, canEndorseDomain, isClientRole, STAGES, DOMAINS, ROLE_BY_DOMAIN } from '../src/lib/rbac.js';
import { clientScopeFilter } from '../src/modules/projects.service.js';
import { isDuplicateKey } from '../src/db/mongo.js';
import { passwordField, slugField } from '../src/lib/fields.js';

test('stage ladder has exactly 11 named stages', () => {
  assert.equal(STAGES.length, 11);
  assert.equal(STAGES[0], 'Multi-Year Planning');
  assert.equal(STAGES[10], 'Complete');
});

test('rbac: client roles are scoped and read-only except client approval', () => {
  assert.equal(can('CLIENT_APPROVER', 'approvals.client'), true);
  assert.equal(can('CLIENT_APPROVER', 'projects.write'), false);
  assert.equal(can('CLIENT_TEMP', 'approvals.client'), false);
  assert.equal(can('CLIENT_TEMP', 'projects.read:client'), true);
});

test('rbac: finance capabilities follow the bounded context', () => {
  assert.equal(can('PM', 'finance.certify'), true);
  assert.equal(can('MEMBER', 'finance.write'), false);
  assert.equal(can('VIEWER', 'finance.read'), true);
  assert.equal(can('CONSTRUCTION_MANAGER', 'finance.endorse'), true);
});

test("v2.1.0 §5.2: approval is exclusively client governance, leads and PMs endorse, they never approve", () => {
  // canApproveDocuments = ORG_ADMIN + CLIENT_APPROVER only.
  assert.equal(can('CLIENT_APPROVER', 'approvals.client'), true);
  assert.equal(can('ORG_ADMIN', 'approvals.client'), true);
  assert.equal(can('PM', 'approvals.client'), false);
  assert.equal(can('PROFESSIONAL_SERVICES_LEAD', 'approvals.client'), false);
  assert.equal(can('GEOTECHNICAL_LEAD', 'approvals.client'), false);
  assert.equal(can('CONSTRUCTION_MANAGER', 'approvals.client'), false);
  // …while domain leads hold the endorsement capability they exist for.
  assert.equal(can('CONSTRUCTION_MANAGER', 'endorse'), true);
  // Clients never hold write or endorsement powers.
  assert.equal(can('CLIENT_APPROVER', 'endorse'), false);
  assert.equal(can('CLIENT_TEMP', 'documents.write'), false);
});

test('endorsement: a lead may only endorse their own domain', () => {
  const geo = { role: 'GEOTECHNICAL_LEAD' };
  const admin = { role: 'ORG_ADMIN' };
  assert.equal(canEndorseDomain(geo, 'GEOTECHNICAL'), true);
  assert.equal(canEndorseDomain(geo, 'CONSTRUCTION_MANAGEMENT'), false);
  assert.equal(canEndorseDomain(admin, 'CONSTRUCTION_MANAGEMENT'), true);
  assert.equal(ROLE_BY_DOMAIN.GEOTECHNICAL, 'GEOTECHNICAL_LEAD');
});

test('client scope filter restricts client roles to their organisation', () => {
  const staff = { role: 'PM' };
  const client = { role: 'CLIENT_APPROVER', clientOrgId: '11111111-1111-1111-1111-111111111111' };
  const clientNoOrg = { role: 'CLIENT_APPROVER', clientOrgId: null };

  assert.deepEqual(clientScopeFilter(staff), {});

  assert.deepEqual(clientScopeFilter(client), {
    client_org_id: '11111111-1111-1111-1111-111111111111',
  });

  // A client user with no organisation must match nothing at all.
  const denied = clientScopeFilter(clientNoOrg);
  assert.deepEqual(denied, { $expr: false });

  assert.equal(isClientRole('CLIENT_TEMP'), true);
  assert.equal(isClientRole('PM'), false);
});

test('duplicate key detection maps the MongoDB codes the unique indexes raise', () => {
  assert.equal(isDuplicateKey({ code: 11000 }), true);
  assert.equal(isDuplicateKey({ code: 11001 }), true);
  assert.equal(isDuplicateKey({ code: 23505 }), false);
  assert.equal(isDuplicateKey(new Error('other')), false);
});

test('password policy: length plus at least one letter and digit', () => {
  assert.equal(passwordField.safeParse('short1').success, false);
  assert.equal(passwordField.safeParse('onlyletterslongenough').success, false);
  assert.equal(passwordField.safeParse('123456789012').success, false);
  assert.equal(passwordField.safeParse('Provenance!Demo1').success, true);
});

test('slug policy: lowercase alphanumerics and hyphens', () => {
  assert.equal(slugField.safeParse('mbe-demo').success, true);
  assert.equal(slugField.safeParse('Bad Slug').success, false);
  assert.equal(slugField.safeParse('-leading').success, false);
});

test('three domain sections per the spec', () => {
  assert.deepEqual(DOMAINS, ['PROFESSIONAL_SERVICES', 'GEOTECHNICAL', 'CONSTRUCTION_MANAGEMENT']);
});
