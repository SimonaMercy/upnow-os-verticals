/**
 * Full-page document workspace (opens in a new tab from the contract's "View
 * all"). Two panes: KYC / customer documents (left) and the contract documents
 * in lifecycle sequence (right). Everything is PREVIEWED inline — uploaded files
 * as image/PDF, generated docs (Agreement, Receipts, Move-in/out, Settlement) as
 * embedded print views, and the Offer Receipt as the offered plan.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { Loader2, FileText } from 'lucide-react';
import type { OfferPlan } from '@/components/upnow/OfferReceiptModal';

interface Doc { id: number; documentKey: string; displayName: string | null; fileUrl: string; status: string; ownerType: string; category: string }
interface Contract {
  ref: string; contractType: 'new' | 'renewal'; status: string;
  pdcConfirmed?: boolean; contractActive?: boolean; vacateAtEnd?: boolean;
  originLeadId?: number | null; offerPlan?: OfferPlan | null;
  termination?: { response?: string | null } | null;
  documents?: Doc[];
}

const KEY_ALIASES: Record<string, string[]> = {
  ejari_certificate: ['ejari', 'contract_registration', 'tenancy_contract_registration', 'ejari_registration'],
  payment_advice: ['pdc', 'post_dated_cheques', 'cheque_copies_pdc', 'cheque_copies', 'cheques', 'cheque', 'rent_cheques'],
  utility_registration: ['utility_proof_of_payment', 'utility_proof', 'utility_activation'],
  utility_final_bill: ['final_bill'],
};
const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const aed = (fils: number) => `AED ${Math.round((fils ?? 0) / 100).toLocaleString('en-AE')}`;
const fmtD = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', color: '#6b6860' }}>{children}</div>;
}

function Preview({ url, caption }: { url: string; caption: string }) {
  const isPdf = (url || '').toLowerCase().split('?')[0].endsWith('.pdf');
  return (
    <div style={{ border: '1px solid #e3e0d9', borderRadius: 10, overflow: 'hidden', marginBottom: 14, background: '#fff' }}>
      <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600, color: '#1a1916', background: '#faf9f7', borderBottom: '1px solid #efece6' }}>{caption}</div>
      {isPdf
        ? <iframe src={`${url}#toolbar=0&navpanes=0&view=FitH`} title={caption} style={{ width: '100%', height: 560, border: 0, display: 'block' }} />
        : <img src={url} alt={caption} style={{ width: '100%', display: 'block', background: '#f4f3ef' }} />}
    </div>
  );
}

function FrameBlock({ label, href }: { label: string; href: string }) {
  return (
    <div style={{ border: '1px solid #e3e0d9', borderRadius: 10, overflow: 'hidden', marginBottom: 14, background: '#fff' }}>
      <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600, color: '#1a1916', background: '#faf9f7', borderBottom: '1px solid #efece6', display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#1f6f54', textDecoration: 'none', fontWeight: 600 }}>Open ↗</a>
      </div>
      <iframe src={href} title={label} style={{ width: '100%', height: 620, border: 0, display: 'block' }} />
    </div>
  );
}

function Missing({ label }: { label: string }) {
  return (
    <div style={{ border: '1px dashed #d8d4cc', borderRadius: 10, padding: '14px 16px', marginBottom: 14, color: '#9b9890', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
      <FileText size={14} /> {label} — not yet available
    </div>
  );
}

function OfferBlock({ plan }: { plan: OfferPlan }) {
  const lines: { label: string; fils: number }[] = [
    { label: `Annual rent${(plan.rentVatFils ?? 0) > 0 ? ' (incl. VAT)' : ''}`, fils: plan.rentFils + (plan.rentVatFils ?? 0) },
  ];
  if (plan.adminFeeFils > 0) lines.push({ label: 'Admin fee', fils: plan.adminFeeFils + (plan.adminFeeVatFils ?? 0) });
  if (plan.ejariFils > 0) lines.push({ label: 'Ejari fee', fils: plan.ejariFils + (plan.ejariVatFils ?? 0) });
  if (plan.commissionFils > 0) lines.push({ label: 'Commission', fils: plan.commissionFils + (plan.commissionVatFils ?? 0) });
  (plan.customFees ?? []).forEach(f => lines.push({ label: f.label, fils: f.netFils + f.vatFils }));
  if (plan.securityDepositFils > 0) lines.push({ label: 'Security deposit', fils: plan.securityDepositFils });
  const items = [...(plan.items ?? [])].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  return (
    <div style={{ border: '1px solid #e3e0d9', borderRadius: 10, overflow: 'hidden', marginBottom: 14, background: '#fff' }}>
      <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600, color: '#1a1916', background: '#faf9f7', borderBottom: '1px solid #efece6' }}>Offer Receipt · what was offered at the lead phase</div>
      <div style={{ padding: '12px 14px', display: 'grid', gap: 5 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#334155' }}><span>{l.label}</span><span style={{ fontWeight: 600 }}>{aed(l.fils)}</span></div>
        ))}
        <div style={{ borderTop: '2px solid #c5e8df', margin: '4px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800, color: '#15803d' }}><span>Total offered</span><span>{aed(plan.totalAmountFils)}</span></div>
      </div>
      {items.length > 0 && (
        <div style={{ borderTop: '1px solid #efece6', padding: '8px 14px 12px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890', margin: '4px 0 6px' }}>Schedule · {plan.installmentCount} installment{plan.installmentCount === 1 ? '' : 's'}</div>
          {items.map((it, i) => (
            <div key={it.index ?? i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#334155', padding: '3px 0' }}>
              <span>#{i + 1} · {it.description ?? `Payment ${i + 1}`} · {fmtD(it.dueDate)}</span>
              <span style={{ fontWeight: 600 }}>{aed(it.amountFils)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pane({ title, border, children }: { title: string; border?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ borderRight: border ? undefined : '1px solid #e3e0d9', overflowY: 'auto', padding: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890', margin: '0 0 10px' }}>{title}</div>
      {children}
    </div>
  );
}

export default function ContractDocumentsPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname() ?? '';
  const id = params?.id;
  const contractBase = pathname.replace(/\/documents$/, '');
  const receiptBase = `${contractBase}/print/receipt`;
  const [c, setC] = useState<Contract | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    fetch(`/api/contracts/${id}`, { credentials: 'include', signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error('Error ' + r.status); return r.json() as Promise<Contract>; })
      .then(d => setC(d))
      .catch(e => { if (!ctrl.signal.aborted) setErr(e instanceof Error ? e.message : 'Failed to load'); });
    return () => ctrl.abort();
  }, [id]);

  if (err) return <Center>Failed to load documents: {err}</Center>;
  if (!c) return <Center><Loader2 className="animate-spin" size={32} /></Center>;

  const all = (c.documents ?? []).filter(d => !!d.fileUrl);
  const matchDocs = (key: string): Doc[] => {
    const accepted = [key, ...(KEY_ALIASES[key] ?? [])];
    const base = (d: Doc) => norm(d.documentKey).replace(/_\d{10,}$/, '');
    return all.filter(d => accepted.includes(base(d)) || accepted.includes(norm(d.displayName))).sort((a, b) => b.id - a.id);
  };
  const isRenewal = c.contractType === 'renewal';
  const moveOut = c.status === 'terminated' || c.termination?.response === 'accepted' || !!c.vacateAtEnd;
  const receiptsReady = !!c.pdcConfirmed || c.status === 'active' || !!c.contractActive;

  type Slot =
    | { kind: 'doc'; key: string; label: string }
    | { kind: 'frame'; key: string; label: string; href: string }
    | { kind: 'offer'; key: string; label: string };
  const seq: Slot[] = [
    { kind: 'offer', key: 'offer', label: 'Offer Receipt' },
    { kind: 'doc', key: 'payment_advice', label: 'Payment Advice' },
  ];
  if (receiptsReady) seq.push({ kind: 'frame', key: 'receipts', label: 'Receipts', href: `${receiptBase}?kind=contract` });
  seq.push({ kind: 'frame', key: 'agreement', label: 'Agreement', href: `${contractBase}/print` });
  seq.push({ kind: 'doc', key: 'ejari_certificate', label: 'Ejari' });
  if (!isRenewal) {
    seq.push({ kind: 'doc', key: 'utility_registration', label: 'Utility Proof of Payment' });
    seq.push({ kind: 'frame', key: 'movein', label: 'Move-in', href: `${contractBase}/inspection?type=move_in` });
  }
  if (moveOut) {
    seq.push({ kind: 'frame', key: 'moveout', label: 'Move-out', href: `${contractBase}/inspection?type=move_out` });
    seq.push({ kind: 'doc', key: 'utility_final_bill', label: 'Utility Final Bill' });
    seq.push({ kind: 'frame', key: 'settlement', label: 'Final Settlement', href: `${contractBase}/settlement` });
  }
  const seqIds = new Set(seq.flatMap(s => (s.kind === 'doc' ? matchDocs(s.key).map(d => d.id) : [])));
  const kyc = all.filter(d => !seqIds.has(d.id));

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f4f3ef', display: 'flex', flexDirection: 'column', zIndex: 50 }}>
      <header style={{ padding: '14px 20px', background: '#fff', borderBottom: '1px solid #e3e0d9', display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#1a1916' }}>All documents</span>
        <span style={{ fontSize: 12.5, color: '#9b9890' }}>{c.ref}</span>
      </header>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <Pane title="KYC documents">
          {kyc.length === 0 ? <p style={{ fontSize: 13, color: '#9b9890' }}>No customer documents on file.</p>
            : kyc.map(d => <Preview key={'k' + d.id} url={d.fileUrl} caption={d.displayName ?? d.documentKey.replace(/_/g, ' ')} />)}
        </Pane>
        <Pane title="Documents · in order" border>
          {seq.map(s => {
            if (s.kind === 'offer') return c.offerPlan ? <OfferBlock key="offer" plan={c.offerPlan} /> : <Missing key="offer" label="Offer Receipt" />;
            if (s.kind === 'frame') return <FrameBlock key={s.key} label={s.label} href={s.href} />;
            const docs = matchDocs(s.key);
            if (!docs.length) return <Missing key={s.key} label={s.label} />;
            return docs.map((d, i) => <Preview key={s.key + d.id} url={d.fileUrl} caption={`${s.label}${docs.length > 1 ? ` · ${i + 1} of ${docs.length}` : ''}`} />);
          })}
        </Pane>
      </div>
    </div>
  );
}
