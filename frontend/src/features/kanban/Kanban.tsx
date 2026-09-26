import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Avatar, Button, Card, Empty, Field, FormRow, Modal, useToast, useCelebrate } from '../../components/ui';
import { Loading, LoadError } from '../../components/animations';
import type { ProjectSummary, Task } from '../../types';
import { Board, Plus } from '../../components/icons';

const COLUMNS: { id: Task['status']; label: string }[] = [
  { id: 'BACKLOG', label: 'Backlog' },
  { id: 'IN_PROGRESS', label: 'In progress' },
  { id: 'REVIEW', label: 'Review' },
  { id: 'DONE', label: 'Done' },
];

export default function Kanban() {
  const qc = useQueryClient();
  const toast = useToast();
  const [showNew, setShowNew] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api<{ tasks: Task[] }>('/tasks') });
  const celebrate = useCelebrate();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<{ projects: ProjectSummary[] }>('/projects') });

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Task['status'] }) =>
      api(`/tasks/${id}`, { method: 'PATCH', body: { status } }),
    onMutate: async ({ id, status }) => {
      // Optimistic move, the board must not wait on the network.
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueryData<{ tasks: Task[] }>(['tasks']);
      qc.setQueryData<{ tasks: Task[] }>(['tasks'], (old) =>
        old ? { ...old, tasks: old.tasks.map((t) => (t.id === id ? { ...t, status } : t)) } : old,
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks'], ctx.prev);
      toast(e instanceof Error ? e.message : 'Move failed', 'err');
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const grouped = useMemo(() => {
    const map: Record<string, Task[]> = { BACKLOG: [], IN_PROGRESS: [], REVIEW: [], DONE: [] };
    for (const t of tasks.data?.tasks ?? []) map[t.status]?.push(t);
    for (const k of Object.keys(map)) map[k].sort((a, b) => a.position - b.position);
    return map;
  }, [tasks.data]);

  return (
    <div>
      <div className="page-head">
        <div className="title-block">
          <span className="eyebrow">Delivery</span>
          <h1 className="display">Task board</h1>
          <p className="sub">Drag cards between columns, moves are optimistic and reconciled with the server.</p>
        </div>
        <Button icon={<Plus />} onClick={() => setShowNew(true)}>New task</Button>
      </div>

      {tasks.isLoading ? (
        <Loading label="Loading board" size={150} />
      ) : tasks.isError ? (
        <Card><LoadError onRetry={() => tasks.refetch()} /></Card>
      ) : (tasks.data?.tasks.length ?? 0) === 0 ? (
        <Card><Empty icon={<Board />} title="No tasks yet" sub="Create the first task to start the board." /></Card>
      ) : (
        <div className="board">
          {COLUMNS.map((col) => (
            <div
              key={col.id}
              className={`board-col ${overCol === col.id ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (overCol !== col.id) setOverCol(col.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol((c) => (c === col.id ? null : c));
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                if (dragId) {
                  const t = tasks.data?.tasks.find((x) => x.id === dragId);
                  if (t && t.status !== col.id) move.mutate({ id: dragId, status: col.id });
                }
                setDragId(null);
              }}
            >
              <div className="col-head">
                <b>{col.label}</b>
                <span className="n">{grouped[col.id].length}</span>
              </div>
              {grouped[col.id].map((t) => (
                <article
                  key={t.id}
                  className={`task-card ${dragId === t.id ? 'dragging' : ''}`}
                  draggable
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => setDragId(null)}
                >
                  <div className="ttl">{t.title}</div>
                  <div className="row">
                    <span className="priority-dot" style={{ background: t.priority === 'HIGH' ? 'var(--clay)' : t.priority === 'MEDIUM' ? 'var(--gold)' : 'var(--sage)' }} />
                    <span className="proj">{t.project_code}</span>
                    <span className="grow" />
                    {t.due_date && (
                      <span className={new Date(t.due_date) < new Date() && t.status !== 'DONE' ? 'fine' : 'fine'} style={{ color: new Date(t.due_date) < new Date() && t.status !== 'DONE' ? 'var(--clay)' : undefined }}>
                        {new Date(t.due_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                    {t.assignee_name ? <Avatar name={t.assignee_name} /> : null}
                  </div>
                </article>
              ))}
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <NewTask
          projects={projects.data?.projects ?? []}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            celebrate('Task created');
            void qc.invalidateQueries({ queryKey: ['tasks'] });
          }}
        />
      )}
    </div>
  );
}

function NewTask({ projects, onClose, onCreated }: { projects: ProjectSummary[]; onClose: () => void; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ projectId: projects[0]?.id ?? '', title: '', priority: 'MEDIUM', dueDate: '', assigneeName: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const team = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: { id: string; full_name: string }[] }>('/users') });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const assignee = (team.data?.users ?? []).find((u) => u.full_name === f.assigneeName);
      await api('/tasks', {
        body: {
          projectId: f.projectId,
          title: f.title,
          priority: f.priority,
          dueDate: f.dueDate || undefined,
          assigneeId: assignee?.id,
        },
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  };

  return (
    <Modal title="New task" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--s4)' }}>
        {error ? <div className="form-error">{error}</div> : null}
        <Field label="Project">
          <select className="input" value={f.projectId} onChange={set('projectId')}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code}, {p.name}</option>)}
          </select>
        </Field>
        <Field label="Title"><input className="input" value={f.title} onChange={set('title')} required minLength={2} /></Field>
        <FormRow>
          <Field label="Priority">
            <select className="input" value={f.priority} onChange={set('priority')}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </Field>
          <Field label="Due date"><input className="input" type="date" value={f.dueDate} onChange={set('dueDate')} /></Field>
        </FormRow>
        <Field label="Assignee">
          <select className="input" value={f.assigneeName} onChange={set('assigneeName')}>
            <option value="">unassigned</option>
            {(team.data?.users ?? []).map((u) => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
          </select>
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !f.projectId}>{busy ? 'Creating…' : 'Create task'}</Button>
        </div>
      </form>
    </Modal>
  );
}
