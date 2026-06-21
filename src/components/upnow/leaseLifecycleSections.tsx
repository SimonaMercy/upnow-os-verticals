'use client';

/**
 * leaseLifecycleSections — presentational building blocks shared by the
 * Security-Deposit popup (DepositDetailModal) and the Ended-Leases lifecycle
 * popup (EndedLeaseDetailModal). One source of truth for how a move-in /
 * move-out inspection, a settlement and deposit documents are rendered, so both
 * popups read a lease's lifecycle identically.
 *
 * All blocks are pure/presentational. Document + photo viewing always goes
 * through the inline-only `openDocViewer` (no download), per the doc-viewer rule.
 */

import { useRef, useState } from 'react';
import {
  FileText, ExternalLink, Loader2, Camera, ClipboardList, Upload, CheckCircle2, Eye,
} from 'lucide-react';
import { openDocViewer } from '@/lib/docViewer';

// ─── Shared types (the lifecycle bundle shapes) ─────────────────────────────

export interface ProofDoc {
  documentKey: string;
  displayName: string | null;
  mimeType: string | null;
  fileUrl: string | null;
}
export interface InspectionView {
  contractId: number;
  inspectionDate: string | null;
  inspectorName: string | null;
  generalNotes: string | null;
  tenantSigned: boolean;
  rpSigned: boolean;
  photos: { url: string; caption: string | null }[];
  areas: { name: string; remarks: string | null; items: { name: string; inCondition: string | null; outCondition: string | null; remarks: string | null }[] }[];
}
export interface SettlementView {
  contractId: number;
  status: string;
  depositHeld: number;
  chargesTotal: number;
  paymentsReceivedTotal: number;
  balance: number;
  refundAmount: number | null;
  notes: string | null;
  rpSigned: boolean;
  tenantSigned: boolean;
  lines: { label: string; amount: number; type: string }[];
  payments: { amount: number; method: string; reference: string | null; receivedOn: string | null }[];
  sentAt: string | null;
  agreedAt: string | null;
  paidAt: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function fmtAed(v: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(v);
}
export function condText(c: string | null) {
  if (c === 'G') return { label: 'Good', cls: 'text-[#16a34a]' };
  if (c === 'F') return { label: 'Fair', cls: 'text-[#f59e0b]' };
  if (c === 'D') return { label: 'Damaged', cls: 'text-[#dc2626]' };
  return { label: '—', cls: 'text-[#9b9890]' };
}

// ─── Small primitives ───────────────────────────────────────────────────────

export function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-[#2e9f82]">{icon}</span>
      <h3 className="text-sm font-bold text-[#1a1916]">{children}</h3>
    </div>
  );
}

/** One inline label/value column for a compact details row card. */
export function DetailCol({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-[#1a1916] capitalize truncate">{value}</p>
    </div>
  );
}

export function Row({ label, value, bold, valueClass }: { label: string; value: string; bold?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className={`text-[#6b6860] ${bold ? 'font-semibold text-[#1a1916]' : ''}`}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold' : 'font-semibold'} ${valueClass ?? 'text-[#1a1916]'}`}>{value}</span>
    </div>
  );
}

export function PhotoGrid({ photos }: { photos: { url: string; caption: string | null }[] }) {
  if (!photos.length) return null;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
      {photos.map((p, i) => (
        <button key={i} type="button"
          onClick={() => openDocViewer({ fileUrl: p.url, caption: p.caption ?? undefined, mimeType: 'image/jpeg' })}
          className="block rounded-lg border border-[#e8e6e0] overflow-hidden hover:border-[#2e9f82] transition-colors cursor-pointer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt={p.caption ?? `Photo ${i + 1}`} className="w-full h-20 object-cover bg-[#f4f3ef]" />
        </button>
      ))}
    </div>
  );
}

function ConditionSummary({ data, mode }: { data: InspectionView; mode: 'in' | 'out' }) {
  // Only areas that actually have a recorded condition for this side.
  const areas = data.areas
    .map(a => ({ ...a, items: a.items.filter(it => (mode === 'out' ? (it.outCondition || it.inCondition) : it.inCondition)) }))
    .filter(a => a.items.length || a.remarks);
  if (!areas.length) {
    return <p className="text-xs text-[#9b9890] italic">No item conditions were recorded.</p>;
  }
  return (
    <div className="space-y-3">
      {areas.map((a, ai) => (
        <div key={ai} className="rounded-xl border border-[#f0ede8] overflow-hidden">
          <div className="bg-[#f4f3ef] px-3 py-1.5 text-xs font-semibold text-[#3d3b35]">{a.name || 'Area'}</div>
          <div className="divide-y divide-[#f4f3ef]">
            {a.items.map((it, ii) => {
              const inC = condText(it.inCondition);
              const outC = condText(it.outCondition);
              return (
                <div key={ii} className="flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="text-[#3d3b35]">{it.name}</span>
                  {mode === 'out' ? (
                    <span className="flex items-center gap-1.5 font-semibold">
                      <span className={inC.cls}>{inC.label}</span>
                      <span className="text-[#9b9890]">→</span>
                      <span className={outC.cls}>{outC.label}</span>
                    </span>
                  ) : (
                    <span className={`font-semibold ${inC.cls}`}>{inC.label}</span>
                  )}
                </div>
              );
            })}
            {a.remarks && <div className="px-3 py-1.5 text-[11px] text-[#6b6860] bg-[#fcfcfa]">{a.remarks}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Move-in / move-out card: photos when present, else a condition summary. */
export function InspectionSection({ title, data, mode }: { title: string; data: InspectionView | null; mode: 'in' | 'out' }) {
  return (
    <div className="bg-white rounded-2xl border border-[#f0ede8] p-4">
      <SectionTitle icon={<ClipboardList size={15} />}>{title}</SectionTitle>
      {!data ? (
        <div className="bg-[#f4f3ef] rounded-xl p-3">
          <p className="text-xs text-[#6b6860]">No {title.toLowerCase()} inspection was recorded for this lease.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#9b9890]">
            {data.inspectionDate && <span>Inspected {data.inspectionDate}</span>}
            {data.inspectorName && <span>By {data.inspectorName}</span>}
            <span className={data.tenantSigned ? 'text-[#1a7a5a] font-medium' : ''}>
              {data.tenantSigned ? '✓ Customer signed' : 'Customer not signed'}
            </span>
            <span className={data.rpSigned ? 'text-[#1a7a5a] font-medium' : ''}>
              {data.rpSigned ? '✓ Landlord signed' : 'Landlord not signed'}
            </span>
          </div>
          {data.photos.length > 0 && (
            <div>
              <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide mb-1.5 flex items-center gap-1">
                <Camera size={11} /> Photos ({data.photos.length})
              </p>
              <PhotoGrid photos={data.photos} />
            </div>
          )}
          <div>
            <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide mb-1.5">Condition summary</p>
            <ConditionSummary data={data} mode={mode} />
          </div>
          {data.generalNotes && (
            <div className="bg-[#f4f3ef] rounded-xl p-3">
              <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide mb-1">General notes</p>
              <p className="text-xs text-[#3d3b35] whitespace-pre-wrap">{data.generalNotes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Documents ──────────────────────────────────────────────────────────────

function proofCaption(p: ProofDoc, fallback: string) {
  return p.displayName || fallback;
}

/** Pick a file and run it through `onPick`, showing an inline spinner. */
export function AttachButton({ onPick }: { onPick: (f: File) => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={ref} type="file" className="hidden" accept="image/*,application/pdf"
        onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return;
          setBusy(true);
          try { await onPick(f); } catch (err) { alert((err as Error)?.message || 'Upload failed.'); }
          finally { setBusy(false); if (ref.current) ref.current.value = ''; }
        }} />
      <button type="button" disabled={busy} onClick={() => ref.current?.click()}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2e9f82] hover:underline disabled:opacity-50 cursor-pointer">
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} Attach
      </button>
    </>
  );
}

export function DocsBucket({ title, docs, empty, action, onAttach }: { title: string; docs: ProofDoc[]; empty: string; action?: React.ReactNode; onAttach?: (f: File) => Promise<void> }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide">{title}</p>
        {onAttach && <AttachButton onPick={onAttach} />}
      </div>
      {docs.length === 0 ? (
        <div className="bg-[#f4f3ef] rounded-xl p-2.5">
          <p className="text-[11px] text-[#9b9890]">{empty}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {docs.map((d, i) => {
            const isImg = (d.mimeType ?? '').startsWith('image/');
            const cap = proofCaption(d, title);
            return (
              <button key={i} type="button"
                onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: cap, mimeType: d.mimeType, documentKey: d.documentKey })}
                className="block w-full text-left rounded-xl border border-[#e8e6e0] overflow-hidden hover:border-[#2e9f82] transition-colors cursor-pointer">
                {isImg && d.fileUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.fileUrl} alt={cap} className="w-full h-24 object-cover bg-[#f4f3ef]" />
                ) : (
                  <div className="w-full h-24 flex items-center justify-center bg-[#f4f3ef] text-[#9b9890]"><FileText size={26} /></div>
                )}
                <div className="px-2.5 py-1.5">
                  <p className="text-[11px] font-semibold text-[#1a1916] truncate">{cap}</p>
                  <p className="text-[10px] text-[#2e9f82] flex items-center gap-1"><ExternalLink size={10} /> View</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ─── Flat document rows (matches the contract page's .docitem) ──────────────

/** A viewable document. Superset of ProofDoc (+ optional status) so lease,
 *  deposit and customer docs all render through one row. */
export interface DocLink {
  documentKey: string;
  displayName: string | null;
  mimeType: string | null;
  fileUrl: string | null;
  status?: string | null;
}

/** A small uppercase group subheader (e.g. "CID-302 · 2025… → 2026…"), with an
 *  optional right-aligned action — mirrors the contract page's doc subheaders. */
export function DocGroupLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-[#9b9890] truncate flex items-center gap-1.5 min-w-0">{children}</p>
      {right}
    </div>
  );
}

/** One flat document row, status-coloured, with an inline-view action — the
 *  exact anatomy the contract detail page uses (icon · name · status · View). */
export function DocItem({ doc, label }: { doc: DocLink; label: string }) {
  const st = (doc.status ?? '').toLowerCase();
  const viewable = !!doc.fileUrl;
  let box = 'bg-[#f3faf7] border-[#cfe9df]', tone = 'text-[#1a7a5a]', statusText = 'On file';
  if (!viewable) { box = 'bg-white border-[#f1d9a8] border-dashed'; tone = 'text-[#92400e]'; statusText = st === 'requested' ? 'Requested' : 'Not on file'; }
  else if (st === 'pending' || st === 'pending_review') { box = 'bg-[#fef9ec] border-[#f1d9a8]'; tone = 'text-[#92400e]'; statusText = 'Pending review'; }
  else if (st === 'rejected') { box = 'bg-[#fdf0f0] border-[#f3c9c9]'; tone = 'text-[#b91c1c]'; statusText = 'Rejected'; }
  return (
    <div className={`flex items-center gap-2.5 border rounded-[9px] px-2.5 py-1.5 min-h-[34px] ${box}`}>
      <FileText size={14} className={`shrink-0 ${tone}`} />
      <div className="flex items-baseline gap-2 min-w-0 flex-1">
        <span className="text-[12.5px] font-semibold text-[#1a1916] truncate">{label}</span>
        <span className={`text-[10.5px] font-bold shrink-0 ${tone}`}>{statusText}</span>
      </div>
      {viewable && (
        <button type="button"
          onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: label, mimeType: doc.mimeType, documentKey: doc.documentKey })}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[#2e9f82] hover:underline cursor-pointer">
          <Eye size={12} /> View
        </button>
      )}
    </div>
  );
}

/** A flat list of DocItem rows (no collapsing). Renders nothing when empty. */
export function DocList({ docs, labelFor }: { docs: DocLink[]; labelFor: (d: DocLink) => string }) {
  if (!docs.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {docs.map((d, i) => <DocItem key={`${d.documentKey}-${i}`} doc={d} label={labelFor(d)} />)}
    </div>
  );
}

/** Open every viewable doc in one inline gallery — the "View all" affordance. */
export function ViewAllDocs({ docs, labelFor, title }: { docs: DocLink[]; labelFor: (d: DocLink) => string; title: string }) {
  const viewable = docs.filter(d => !!d.fileUrl);
  if (viewable.length < 2) return null;
  return (
    <button type="button"
      onClick={() => openDocViewer(viewable.map(d => ({ fileUrl: d.fileUrl, caption: labelFor(d), mimeType: d.mimeType, documentKey: d.documentKey })), title)}
      className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[#2e9f82] hover:underline cursor-pointer">
      <Eye size={12} /> View all ({viewable.length})
    </button>
  );
}

// ─── Settlement ─────────────────────────────────────────────────────────────

/** The settlement money table (deposit held → deductions → payments → balance)
 *  + optional attachments / notes / "open settlement" link. Pure renderer used
 *  by every popup that has a settled deposit. */
export function SettlementLines({ s, attachments, openHref }: { s: SettlementView; attachments?: ProofDoc[]; openHref?: string | null }) {
  const refund = s.balance > 0;
  const owes = s.balance < 0;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-full text-[11px] font-semibold px-2.5 py-0.5 bg-[#eef2ff] text-[#3730a3] capitalize">{s.status}</span>
        {s.tenantSigned && <span className="text-[11px] text-[#1a7a5a] font-medium flex items-center gap-1"><CheckCircle2 size={12} /> Customer agreed</span>}
      </div>
      <div className="rounded-xl border border-[#f0ede8] divide-y divide-[#f4f3ef] text-sm">
        <Row label="Deposit held" value={fmtAed(s.depositHeld)} />
        {s.lines.map((l, i) => (
          <Row key={i} label={l.label} value={`− ${fmtAed(l.amount)}`} valueClass="text-[#b91c1c]" />
        ))}
        {s.paymentsReceivedTotal > 0 && <Row label="Payments received from customer" value={`+ ${fmtAed(s.paymentsReceivedTotal)}`} valueClass="text-[#1a7a5a]" />}
        <Row
          label={refund ? 'Refund due to customer' : owes ? 'Customer still owes' : 'Settled — no balance'}
          value={fmtAed(Math.abs(s.balance))}
          bold
          valueClass={refund ? 'text-[#1a7a5a]' : owes ? 'text-[#b91c1c]' : 'text-[#1a1916]'}
        />
      </div>
      {attachments && attachments.length > 0 && (
        <DocsBucket title="Settlement attachments" docs={attachments} empty="" />
      )}
      {s.notes && (
        <div className="bg-[#f4f3ef] rounded-xl p-3">
          <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide mb-1">Settlement notes</p>
          <p className="text-xs text-[#3d3b35] whitespace-pre-wrap">{s.notes}</p>
        </div>
      )}
      {openHref && (
        <a href={openHref} className="text-xs text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1">
          <ExternalLink size={11} /> Open settlement
        </a>
      )}
    </div>
  );
}
