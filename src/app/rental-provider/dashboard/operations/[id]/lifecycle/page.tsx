'use client';

/**
 * Lease Lifecycle — full A–Z story of a tenancy, reconstructed PURELY from the
 * activity trail (GET /contracts/:id/lifecycle). Two parts:
 *   1) Stage summary — the pipeline stages the lease moved through, with time in
 *      stage, WHO moved it, and the countable output of each stage.
 *   2) Full event feed — every logged action in order, each expandable to its
 *      linked records (documents approved, cheque schedule, receipts, signing).
 * Nothing here is read from the contract's current-state columns.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiGet } from '@/lib/api';

type Actor = { userId: number | null; name: string | null; role: string | null; rawRole: string | null };
type Device = { os: string; browser: string; device: string; label: string };
type LEvent = {
  id: string;
  at: string;
  phase: 'lead' | 'contract';
  category: string;
  actionKey: string;
  title: string;
  actor: Actor;
  onBehalfOfRpId: number | null;
  onBehalfLabel: string | null;
  fromStage: string | null;
  toStage: string | null;
  stageKey: string | null;
  systemGenerated: boolean;
  reconstructed: boolean;
  source: string;
  device?: Device | null;
  ip?: string | null;
  detail: Record<string, unknown> | null;
};
type LStage = {
  key: string;
  label: string;
  phase: 'lead' | 'contract';
  order: number;
  enteredAt: string | null;
  exitedAt: string | null;
  durationMs: number | null;
  movedBy: Actor | null;
  actionEventIds: string[];
  figures: { label: string; value: string }[];
};
type Lifecycle = {
  header: {
    contractId: number;
    rootContractId: number;
    chainContractIds: number[];
    contractType: string | null;
    status: string | null;
    unitNumber: string | null;
    tenantName: string | null;
    rpName: string | null;
    startDate: string | null;
    endDate: string | null;
    originLeadIds: number[];
  };
  stages: LStage[];
  events: LEvent[];
  caveats: string[];
};

const ROLE_STYLES: Record<string, string> = {
  Landlord: 'bg-amber-100 text-amber-800 ring-amber-200',
  Manager: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
  Customer: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  Admin: 'bg-purple-100 text-purple-800 ring-purple-200',
  System: 'bg-slate-100 text-slate-600 ring-slate-200',
  Inspector: 'bg-cyan-100 text-cyan-800 ring-cyan-200',
};
const CAT_ICON: Record<string, string> = {
  transition: '→',
  document: '📄',
  payment: '💵',
  plan: '🧾',
  signature: '✍️',
  receipt: '🧾',
  contract: '📋',
  login: '🔑',
  note: '🗒️',
  other: '•',
};
const catIcon = (c: string) => CAT_ICON[c] ?? '•';
const deviceIcon = (d: string) => (d === 'Mobile' ? '📱' : d === 'Tablet' ? '📲' : '🖥');

function DeviceChip({ device, ip }: { device: Device; ip?: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200"
      title={ip ? `${device.label} · ${device.device} · IP ${ip}` : `${device.label} · ${device.device}`}
    >
      {deviceIcon(device.device)} {device.label}
      {ip ? <span className="text-slate-400">· {ip}</span> : null}
    </span>
  );
}

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return null;
  const cls = ROLE_STYLES[role] ?? 'bg-slate-100 text-slate-600 ring-slate-200';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${cls}`}>
      {role}
    </span>
  );
}

function fmt(at: string): { date: string; time: string } {
  const d = new Date(at);
  return {
    date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }),
  };
}
function durationText(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 0) ms = 0;
  const m = Math.floor(ms / 60000);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

export default function LeaseLifecyclePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const [data, setData] = useState<Lifecycle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    setData(null);
    setError(null);
    apiGet<Lifecycle>(`/contracts/${id}/lifecycle`, { signal: ctrl.signal })
      .then(setData)
      .catch((e: unknown) => {
        if ((e as Error)?.name !== 'AbortError') setError((e as Error)?.message ?? 'Failed to load');
      });
    return () => ctrl.abort();
  }, [id]);

  const eventsByStage = useMemo(() => {
    const m = new Map<string, LEvent[]>();
    data?.events.forEach((e) => {
      const k = e.stageKey ?? '_';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    });
    return m;
  }, [data]);

  // Fold repeated same-action rows within a stage into one grouped row, so a
  // manager entering 8 cheques doesn't flood the feed with 20 near-identical
  // lines. Transitions and signatures are always kept individual (each matters);
  // bulk data-entry actions (payments/documents) collapse by action+actor across
  // the stage, ordered by first occurrence.
  const COLLAPSIBLE = new Set(['payment', 'document']);
  const groupEvents = (evs: LEvent[]): { lead: LEvent; rest: LEvent[] }[] => {
    const groups: { lead: LEvent; rest: LEvent[] }[] = [];
    const byKey = new Map<string, { lead: LEvent; rest: LEvent[] }>();
    for (const e of evs) {
      const collapsible = COLLAPSIBLE.has(e.category) && e.category !== 'transition';
      const key = `${e.actionKey}|${e.actor.userId}`;
      if (collapsible && byKey.has(key)) {
        byKey.get(key)!.rest.push(e);
      } else {
        const g = { lead: e, rest: [] as LEvent[] };
        groups.push(g);
        if (collapsible) byKey.set(key, g);
      }
    }
    return groups;
  };

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <button onClick={() => router.back()} className="mb-4 text-sm text-slate-500 hover:text-slate-800">← Back</button>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">{error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-200" />
        <div className="mt-6 h-40 animate-pulse rounded-2xl bg-slate-100" />
        <div className="mt-4 h-96 animate-pulse rounded-2xl bg-slate-100" />
      </div>
    );
  }

  const h = data.header;
  const first = data.events[0];
  const signed = data.events.find((e) => e.actionKey === 'contract.signature' || e.actionKey === 'portal.contract.sign');
  const totalMs = first && signed ? new Date(signed.at).getTime() - new Date(first.at).getTime() : null;
  const logins = data.events.filter((e) => e.category === 'login');
  const custDevices = Array.from(
    new Map(
      data.events
        .filter((e) => e.actor.role === 'Customer' && e.device)
        .map((e) => [e.device!.label, e.device!]),
    ).values(),
  );
  const custIps = Array.from(new Set(data.events.filter((e) => e.actor.role === 'Customer' && e.ip).map((e) => e.ip as string)));

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <button onClick={() => router.push(`/rental-provider/dashboard/operations/${id}`)} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        ← Back to lease
      </button>

      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Lease Lifecycle · reconstructed from activity</div>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              Unit {h.unitNumber ?? '—'} · {h.tenantName ?? 'Tenant'}
            </h1>
            <div className="mt-1 text-sm text-slate-500">
              {h.rpName} · Contract #{h.contractId}
              {h.contractType ? <> · <span className="capitalize">{h.contractType}</span> lease</> : null}
              {h.startDate ? <> · {fmt(h.startDate).date} → {h.endDate ? fmt(h.endDate).date : ''}</> : null}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {h.status ? (
              <span className="inline-flex items-center rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                {h.status}
              </span>
            ) : null}
            {totalMs != null ? (
              <span className="text-xs text-slate-500">Lead → signed in <b className="text-slate-700">{durationText(totalMs)}</b></span>
            ) : null}
            {logins.length ? (
              <span className="text-xs text-slate-500">🔑 <b className="text-slate-700">{logins.length}</b> customer sign-in{logins.length === 1 ? '' : 's'}</span>
            ) : null}
          </div>
        </div>

        {(custDevices.length || custIps.length) ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Customer devices seen</span>
            {custDevices.map((d, i) => <DeviceChip key={i} device={d} />)}
            {custIps.map((ip, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">🌐 {ip}</span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Full event feed */}
      <h2 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wide text-slate-500">Full Activity Feed</h2>
      <div className="space-y-6">
        {data.stages.map((s) => {
          const evs = eventsByStage.get(s.key) ?? [];
          if (!evs.length) return null;
          return (
            <div key={s.key}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${s.phase === 'lead' ? 'bg-sky-400' : 'bg-violet-400'}`} />
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{s.label}</span>
                <span className="text-[11px] text-slate-400">· {durationText(s.durationMs)} in stage</span>
              </div>
              <div className="ml-1 border-l-2 border-slate-100 pl-4">
                {groupEvents(evs).map((g) => {
                  const e = g.lead;
                  const t = fmt(e.at);
                  const open = expanded[e.id] !== false; // default open — show all data
                  const count = g.rest.length + 1;
                  const grouped = g.rest.length > 0;
                  const last = grouped ? fmt(g.rest[g.rest.length - 1].at) : null;
                  const hasDetail = grouped || (e.detail && Object.keys(e.detail).length > 0);
                  return (
                    <div key={e.id} className="relative py-2">
                      <span className="absolute -left-[22px] top-3 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] ring-2 ring-slate-200">{catIcon(e.category)}</span>
                      <div
                        className={`rounded-lg border border-slate-100 bg-white px-3 py-2 ${hasDetail ? 'cursor-pointer hover:border-slate-300' : ''}`}
                        onClick={() => hasDetail && setExpanded((p) => ({ ...p, [e.id]: p[e.id] === false ? true : false }))}
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[11px] tabular-nums text-slate-400">
                            {t.date}, {t.time}{grouped && last && last.time !== t.time ? `–${last.time}` : ''}
                          </span>
                          <span className="text-sm font-medium text-slate-800">{e.title}</span>
                          {grouped ? <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white">×{count}</span> : null}
                          <RoleBadge role={e.actor.role} />
                          {e.actor.name ? <span className="text-xs text-slate-500">{e.actor.name}</span> : null}
                          {e.onBehalfLabel ? <span className="text-[11px] italic text-slate-400">{e.onBehalfLabel}</span> : null}
                          {e.device ? <DeviceChip device={e.device} ip={e.ip} /> : null}
                          {e.systemGenerated ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">system</span> : null}
                          {e.reconstructed ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600" title="Inferred from a state stamp, not a true event row">reconstructed</span> : null}
                          {hasDetail ? <span className="ml-auto text-slate-300">{open ? '▾' : '▸'}</span> : null}
                        </div>
                        {open && grouped && (e.detail as { cheques?: unknown })?.cheques ? (
                          <div className="mt-2 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                            <EventDetail detail={e.detail!} />
                            <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-400">source: {e.source} · {e.actionKey} · ×{count} actions</div>
                          </div>
                        ) : open && grouped ? (
                          <div className="mt-2 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                            <div className="mb-1 font-semibold text-slate-700">{count} occurrences:</div>
                            <ul className="space-y-0.5">
                              {[e, ...g.rest].map((x) => {
                                const docId = (x.detail as { documentId?: number } | null)?.documentId;
                                return (
                                  <li key={x.id} className="flex items-center gap-2 text-slate-500">
                                    <span className="tabular-nums">{fmt(x.at).time} — {x.title}</span>
                                    {docId ? (
                                      <a
                                        href={`/api/documents/${docId}/file`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(ev) => ev.stopPropagation()}
                                        className="rounded border border-indigo-200 bg-indigo-50 px-1.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100"
                                      >
                                        view
                                      </a>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : open && hasDetail ? (
                          <div className="mt-2 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                            <EventDetail detail={e.detail!} />
                            <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-400">source: {e.source} · {e.actionKey}</div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Caveats */}
      {data.caveats.length ? (
        <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          <div className="mb-1 font-semibold">Data provenance notes</div>
          <ul className="list-disc space-y-1 pl-4">
            {data.caveats.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type Cheque = { type: string; amount: string; status: string; dueDate: string | null; chequeNumber: string | null };

function EventDetail({ detail }: { detail: Record<string, unknown> }) {
  const docs = detail.documents as Array<{ name: string; category: string; status: string }> | undefined;
  const cheques = detail.cheques as Cheque[] | undefined;
  const documentId = detail.documentId as number | undefined;
  const hidden = ['documents', 'note', 'count', 'cheques', 'documentId', 'category'];
  return (
    <div className="space-y-2">
      {detail.note ? <div className="italic text-slate-500">{String(detail.note)}</div> : null}

      {documentId ? (
        <a
          href={`/api/documents/${documentId}/file`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(ev) => ev.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
        >
          📄 View document
        </a>
      ) : null}

      {cheques?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-slate-400">
                <th className="py-1 pr-3 font-semibold">Cheque</th>
                <th className="py-1 pr-3 font-semibold">Amount</th>
                <th className="py-1 pr-3 font-semibold">Due</th>
                <th className="py-1 pr-3 font-semibold">Status</th>
                <th className="py-1 font-semibold">No.</th>
              </tr>
            </thead>
            <tbody>
              {cheques.map((c, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 pr-3 text-slate-700">{c.type}</td>
                  <td className="py-1 pr-3 font-semibold text-slate-800">{c.amount}</td>
                  <td className="py-1 pr-3 tabular-nums text-slate-500">{c.dueDate ?? '—'}</td>
                  <td className="py-1 pr-3"><span className={c.status === 'cleared' ? 'font-semibold text-emerald-600' : 'text-amber-600'}>{c.status}</span></td>
                  <td className="py-1 tabular-nums text-slate-400">{c.chequeNumber ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {docs?.length ? (
        <div>
          <div className="mb-1 font-semibold text-slate-700">{docs.length} document{docs.length === 1 ? '' : 's'}:</div>
          <ul className="space-y-0.5">
            {docs.map((d, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-slate-700">{d.name}</span>
                <span className="rounded bg-slate-200 px-1 text-[10px] uppercase text-slate-500">{d.category}</span>
                <span className={`text-[10px] font-semibold ${d.status === 'processed' ? 'text-emerald-600' : 'text-slate-400'}`}>{d.status}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {Object.entries(detail)
        .filter(([k]) => !hidden.includes(k))
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="font-semibold capitalize text-slate-500">{k.replace(/([A-Z])/g, ' $1')}:</span>
            <span className="text-slate-700">{String(v)}</span>
          </div>
        ))}
    </div>
  );
}
