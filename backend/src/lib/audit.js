/** Append-only audit trail writer. Must be called inside the same tenant
 *  transaction as the change it records, so an audit row can never exist
 *  without the change (and vice versa: a rollback removes both). */
export async function audit(client, { actorId, actorRole, action, entity, entityId, summary, detail }) {
  await client.query(
    `INSERT INTO audit_events (actor_id, actor_role, action, entity, entity_id, summary, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorId ?? null, actorRole ?? null, action, entity, entityId ?? null, summary, detail ? JSON.stringify(detail) : null],
  );
}
