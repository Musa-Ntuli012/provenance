import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth, isClientRole } from '../../auth/AuthContext';
import { Badge, Card, Empty } from '../../components/ui';
import { Loading, LoadError } from '../../components/animations';
import { STAGE_NAMES } from '../../types';
import type { PendingApproval } from '../../types';
import { Shield, Stamp } from '../../components/icons';

export default function Approvals() {
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: () => api<{ pending: PendingApproval[] }>('/projects/approvals/pending'),
  });

  const client = isClientRole(user?.role);

  return (
    <div>
      <div className="page-head">
        <div className="title-block">
          <span className="eyebrow">Sign-off queue</span>
          <h1 className="display">Approvals</h1>
          <p className="sub">
            {client
              ? 'Stage gates that have been fully endorsed by the firm and now await your formal approval.'
              : 'Stage gates on your domain awaiting endorsement, and gates awaiting the client.'}
          </p>
        </div>
      </div>

      <Card>
        {isLoading ? (
          <Loading label="Loading approvals" size={130} />
        ) : isError ? (
          <LoadError onRetry={() => refetch()} />
        ) : (data?.pending.length ?? 0) === 0 ? (
          <Empty
            icon={client ? <Stamp /> : <Shield />}
            title="Nothing awaiting sign-off"
            sub={client
              ? 'When the firm completes the endorsement chain on a stage, it will arrive here for your decision.'
              : 'Gates appear here when a project stage is in progress and your domain has not yet endorsed.'}
          />
        ) : (
          <div className="card pad" style={{ padding: 'var(--s2) var(--s5) var(--s4)' }}>
            {data!.pending.map((p) => (
              <div className="approval-row" key={p.id}>
                <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <Link to={`../projects/${p.id}`} style={{ fontWeight: 600 }}>{p.name}</Link>
                  <span className="fine">
                    <span className="mono">{p.code}</span>
                    {p.client_name ? <> · {p.client_name}</> : null}
                    {' '}· Stage {p.pending_stage}, {STAGE_NAMES[p.pending_stage - 1]}
                  </span>
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Badge tone={p.status === 'PENDING_CLIENT' ? 'gold' : 'terracotta'} dot>
                    {p.status === 'PENDING_CLIENT' ? 'awaiting client' : 'awaiting endorsement'}
                  </Badge>
                  <Link className="btn sm secondary" to={`../projects/${p.id}`}>Open</Link>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
