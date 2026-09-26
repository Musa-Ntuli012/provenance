import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Badge, Card, Empty } from '../../components/ui';
import { Loading, LoadError } from '../../components/animations';
import type { Task } from '../../types';
import { Calendar, Chevron } from '../../components/icons';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CalendarScreen() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['tasks'], queryFn: () => api<{ tasks: Task[] }>('/tasks') });

  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of data?.tasks ?? []) {
      if (!t.due_date) continue;
      const arr = map.get(t.due_date) ?? [];
      arr.push(t);
      map.set(t.due_date, arr);
    }
    return map;
  }, [data]);

  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const days: { iso: string; day: number; out: boolean }[] = [];
    const start = new Date(first);
    start.setDate(first.getDate() - startOffset);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push({
        iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        day: d.getDate(),
        out: d.getMonth() !== cursor.getMonth(),
      });
    }
    return days;
  }, [cursor]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const monthLabel = cursor.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
  const selectedTasks = selected ? byDate.get(selected) ?? [] : [];

  return (
    <div>
      <div className="page-head">
        <div className="title-block">
          <span className="eyebrow">Delivery</span>
          <h1 className="display">Calendar</h1>
          <p className="sub">Task due dates across the portfolio.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="icon-btn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month" style={{ transform: 'rotate(180deg)' }}><Chevron /></button>
          <b style={{ minWidth: 150, textAlign: 'center' }}>{monthLabel}</b>
          <button className="icon-btn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month"><Chevron /></button>
          <button className="btn secondary sm" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button>
        </div>
      </div>

      <div className="cal">
        <Card pad>
          {isLoading ? (
            <Loading label="Loading calendar" size={150} />
          ) : isError ? (
            <LoadError onRetry={() => refetch()} />
          ) : (
            <>
              <div className="cal-grid" style={{ marginBottom: 4 }}>
                {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
              </div>
              <div className="cal-grid">
                {grid.map((d) => (
                  <button
                    key={d.iso}
                    className={`cal-day ${d.out ? 'out' : ''} ${d.iso === todayIso ? 'today' : ''}`}
                    style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
                    onClick={() => setSelected(d.iso)}
                  >
                    <span className="d">{d.day}</span>
                    {(byDate.get(d.iso) ?? []).slice(0, 3).map((t) => (
                      <span key={t.id} className={`cal-task ${new Date(t.due_date!) < new Date(todayIso) && t.status !== 'DONE' ? 'overdue' : ''}`} title={t.title}>
                        {t.title}
                      </span>
                    ))}
                    {(byDate.get(d.iso)?.length ?? 0) > 3 ? <span className="fine" style={{ fontSize: 9.5 }}>+{(byDate.get(d.iso) ?? []).length - 3} more</span> : null}
                  </button>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card pad style={{ alignContent: 'start' }}>
          <h3 className="serif-h">{selected ? new Date(selected).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Pick a day'}</h3>
          <div className="hr" />
          {selectedTasks.length === 0 ? (
            <Empty icon={<Calendar />} title="No due tasks" sub={selected ? 'Nothing due on this day.' : 'Select a day to see its tasks.'} />
          ) : (
            selectedTasks.map((t) => (
              <div className="approval-row" key={t.id}>
                <span className="priority-dot" style={{ background: t.priority === 'HIGH' ? 'var(--clay)' : t.priority === 'MEDIUM' ? 'var(--gold)' : 'var(--sage)' }} />
                <span style={{ display: 'grid', gap: 2 }}>
                  <b style={{ fontSize: 'var(--text-sm)' }}>{t.title}</b>
                  <span className="fine">{t.project_code} · {t.assignee_name ?? 'unassigned'}</span>
                </span>
                <Badge tone={t.status === 'DONE' ? 'sage' : t.status === 'REVIEW' ? 'gold' : 'terracotta'}>{t.status.toLowerCase().replaceAll('_', ' ')}</Badge>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}
