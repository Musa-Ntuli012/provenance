/**
 * Append-only audit trail writer. Must be called with the same database
 * scope (and therefore the same transaction) as the change it records, so
 * an audit entry can never exist without the change: the transaction commit
 * lands both, a rollback removes both.
 */
export async function audit(db, { actorId, actorRole, action, entity, entityId, summary, detail }) {
  await db.coll('audit_events').insertOne({
    actor_id: actorId ?? null,
    actor_role: actorRole ?? null,
    action,
    entity,
    entity_id: entityId ?? null,
    summary,
    detail: detail ?? null,
    created_at: new Date(),
  });
}
