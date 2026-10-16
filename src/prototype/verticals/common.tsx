'use client';

/**
 * PROTOTYPE ONLY — shared building blocks for vertical pack modules.
 */
import type { ReactNode } from 'react';
import { CalendarDays, User, Wrench } from 'lucide-react';
import { useProto, useWork } from '../store';
import { VERTICAL } from '../registry';
import { Badge, Button, Card, Kanban, PageHeader, StatusBadge, fmtAed, fmtDate } from '../ui';
import type { VerticalId, WorkItem } from '../types';

export function ModuleHeader({ v, title, subtitle, actions, model }: { v: VerticalId; title: string; subtitle: ReactNode; actions?: ReactNode; model?: string }) {
  const d = VERTICAL[v];
  const Icon = d.icon;
  return (
    <PageHeader
      eyebrow={<>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold" style={{ background: d.tint, color: d.accent }}><Icon className="h-3 w-3" aria-hidden />{d.label} pack</span>
        {model && <Badge tone="neutral">{model}</Badge>}
      </>}
      title={title}
      subtitle={subtitle}
      actions={actions}
    />
  );
}

export interface StageAction { to: string; label: string; msg?: string; patch?: (w: WorkItem) => Partial<WorkItem> }

export function WorkCard({ w, body, actions, onOpen }: { w: WorkItem; body?: ReactNode; actions?: ReactNode; onOpen?: () => void }) {
  return (
    <Card pad={false} className="p-3 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
      <button type="button" onClick={onOpen} disabled={!onOpen} className="w-full text-left disabled:cursor-default">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 text-[13px] font-bold leading-snug text-[var(--ink)]">{w.title}</div>
          <span className="shrink-0 text-[10.5px] font-semibold text-[#8a958e]">{w.id}</span>
        </div>
        <div className="mt-1 flex items-center gap-1 text-xs text-[var(--ink3)]"><User className="h-3 w-3" aria-hidden />{w.customer}</div>
        {w.date && <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--ink3)]"><CalendarDays className="h-3 w-3" aria-hidden />{fmtDate(w.date)}{w.time ? ` · ${w.time}` : ''}</div>}
        {w.assignee && <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--ink3)]"><Wrench className="h-3 w-3" aria-hidden />{w.assignee}</div>}
        {body}
        {!!w.amount && <div className="mt-1.5 text-[13px] font-bold text-[var(--ink)]">{fmtAed(w.amount)}</div>}
      </button>
      {actions && <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-[#eef0ef] pt-2.5">{actions}</div>}
    </Card>
  );
}

/** Stage pipeline for any work dataset; the stage list is model-specific. */
export function PipelineBoard({ dataset, stages, next, exit, body, custom, onOpen }: {
  dataset: string;
  stages: { id: string; label: string }[];
  next: Record<string, StageAction>;
  exit?: { from: string[]; to: string; label: string; msg: string };
  body?: (w: WorkItem) => ReactNode;
  custom?: (w: WorkItem) => ReactNode;
  onOpen?: (w: WorkItem) => void;
}) {
  const items = useWork(dataset);
  const { patch } = useProto();
  return (
    <Kanban
      columns={stages}
      items={items}
      render={(w) => {
        const n = next[w.stage];
        return (
          <WorkCard
            w={w}
            body={body?.(w)}
            onOpen={onOpen ? () => onOpen(w) : undefined}
            actions={(custom?.(w) || n || (exit && exit.from.includes(w.stage))) ? (
              <>
                {custom?.(w)}
                {!custom?.(w) && n && <Button size="sm" variant="subtle" onClick={() => patch('work', w.id, { stage: n.to, ...(n.patch?.(w) ?? {}) }, n.msg ?? `${n.label}`)}>{n.label}</Button>}
                {exit && exit.from.includes(w.stage) && <Button size="sm" variant="ghost" onClick={() => patch('work', w.id, { stage: exit.to }, exit.msg)}>{exit.label}</Button>}
              </>
            ) : undefined}
          />
        );
      }}
    />
  );
}

export function StageSummary({ dataset, stages }: { dataset: string; stages: string[] }) {
  const items = useWork(dataset);
  return (
    <div className="flex flex-wrap gap-2">
      {stages.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5"><StatusBadge status={s} /><span className="text-sm font-bold">{items.filter((i) => i.stage === s).length}</span></span>
      ))}
    </div>
  );
}
