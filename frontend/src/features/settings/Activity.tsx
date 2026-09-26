import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Badge, Card, Empty, When } from '../../components/ui';
import { Loading, LoadError } from '../../components/animations';
import type { AuditEvent } from '../../types';

export default function Activity() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['audit', 'all'],
    queryFn: () => api<{ events: AuditEvent[] }>('/audit?limit=100'),
  });

  return (
    <Card>
      <div className="card-head">
        <h3 className="serif-h">Audit trail</h3>
        <span className="fine">Append-only, writes happen inside the transactions that make each change.</span>
      </div>
      <div className="card pad" style={{ paddingTop: 'var(--s3)' }}>
        {isLoading ? <Loading label="Loading audit trail" size={130} /> : isError ? <LoadError onRetry={() => refetch()} /> : (data?.events.length ?? 0) === 0 ? (
          <Empty icon={<Shield />} title="No recorded activity yet" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Summary</th></tr></thead>
              <tbody>
                {(data?.events ?? []).map((e) => (
                  <tr key={e.id}>
                    <td className="fine" style={{ whiteSpace: 'nowrap' }}><When iso={e.created_at} /></td>
                    <td>{e.actor_name ?? <span className="muted">system</span>}{e.actor_role ? <div className="fine">{e.actor_role.replaceAll('_', ' ').toLowerCase()}</div> : null}</td>
                    <td><Badge>{e.action}</Badge></td>
                    <td className="fine" style={{ color: 'var(--ink)' }}>{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

function Shield() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5 5 6v6c0 4.5 3 7.7 7 8.5 4-.8 7-4 7-8.5V6l-7-2.5Z" />
      <path d="m9.2 12 2 2 3.6-4" />
    </svg>
  );
}
