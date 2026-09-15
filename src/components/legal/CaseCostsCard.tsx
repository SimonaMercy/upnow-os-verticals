'use client';

/**
 * Costs on a case (0287) — the payments-style card on the case detail.
 *
 * The manager or lawyer picks lines from the landlord's fee book (or types a
 * custom line) → cost lines with an EXPECTED amount (percent lines computed
 * from the lease's annual rent). Marking a line PAID records the actual amount,
 * date and receipt; if the line is recoverable the backend posts a "Legal cost"
 * charge on the customer's lease ledger (`chargePaymentId`) — that is what
 * reaches the statement and the final settlement. Turning recoverable off, or
 * deleting, withdraws a still-pending charge; the backend refuses once the
 * charge is settled and its 400 message is shown inline.
 *
 * Every write returns the fresh DisputeDetail — handed to `onChanged`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, X, FileText, UploadCloud, ChevronDown, ChevronRight } from 'lucide-react';
import { openDocViewerByIds } from '@/lib/docViewer';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import {
  legalApi, FEE_PAYEE_LABELS, FEE_STAGE_LABELS, disputeStageTone,
  type DisputeDetail, type CaseCost, type FeeItem, type FeeItemInput, type FeePayee, type FeeStage,
} from '@/lib/legal';
import { card, btnSm, btnGreenSm, btnFillSm, pillCls, fmtD, money, todayIso, errText } from '@/components/legal/StartNoticeModal';

const STAGE_ORDER: FeeStage[] = ['any', 'notice_sent', 'case_filed', 'settlement', 'decision', 'enforcement'];
const PAYEES = Object.keys(FEE_PAYEE_LABELS) as FeePayee[];
const inp = 'text-[11px] px-2 py-1.5 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#1a7a52]';
const stageTone = (s: FeeStage) => (s === 'any' ? { bg: '#f1f3f1', fg: '#5b615e' } : disputeStageTone(s));
/** Mirrors the backend's expectedFrom(): a percent line is rounded to fils off the annual rent. */
const expectedOf = (item: { amount: number | null; percentOfRent: number | null }, rent: number | null | undefined) =>
  item.amount != null ? item.amount : item.percentOfRent != null && rent != null ? Math.round(rent * item.percentOfRent) / 100 : 0;

export function CaseCostsCard({ dispute, base, rp, onChanged, say }: {
  dispute: DisputeDetail; base: string; rp?: number;
  onChanged: (d: DisputeDetail) => void;
  say?: (text: string, tone?: 'ok' | 'warn') => void;
}) {
  const closed = dispute.stage === 'closed';
  const costs = dispute.costs ?? [];
  const totals = dispute.costTotals ?? { lines: costs.length, expected: 0, paid: 0, recoverableCharged: 0 };
  const [busy, setBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: number; text: string } | null>(null);
  const [paying, setPaying] = useState<CaseCost | null>(null);
  const [adding, setAdding] = useState(false);
  // Review = the Add-costs dialog opened with the fee-book lines nobody recorded pre-ticked.
  const [preselect, setPreselect] = useState<number[] | null>(null);
  const missing = dispute.missingCosts ?? [];
  const [actualDraft, setActualDraft] = useState<Record<number, string>>({});
  const docsById = useMemo(() => new Map((dispute.documents ?? []).map(x => [x.id, x])), [dispute.documents]);

  const run = async (key: string, id: number | null, fn: () => Promise<DisputeDetail>, okText: string) => {
    setBusy(key); setRowErr(null);
    try { onChanged(await fn()); say?.(okText); }
    catch (e) {
      const text = errText(e, 'Could not update the cost line.');
      if (id != null) setRowErr({ id, text }); else say?.(text, 'warn');
    } finally { setBusy(null); }
  };

  const toggleRecoverable = (c: CaseCost, on: boolean) =>
    run(`cost-${c.id}`, c.id, () => legalApi.updateCost(base, rp, dispute.id, c.id, { recoverable: on }),
      on ? (c.status === 'paid' ? 'Line marked recoverable — charged to the customer.' : 'Line marked recoverable — it is charged once paid.') : 'Line no longer recoverable.');
  const remove = (c: CaseCost) =>
    run(`cost-${c.id}`, c.id, () => legalApi.deleteCost(base, rp, dispute.id, c.id), 'Cost line removed.');
  const saveActual = (c: CaseCost) => {
    const v = (actualDraft[c.id] ?? '').trim();
    if (v === '' || Number(v) === c.actualAmount) return;
    if (!Number.isFinite(Number(v)) || Number(v) < 0) { setRowErr({ id: c.id, text: 'The actual amount must be 0 or more.' }); return; }
    void run(`cost-${c.id}`, c.id, () => legalApi.updateCost(base, rp, dispute.id, c.id, { actualAmount: Number(v) }), 'Actual amount saved.');
  };

  return (
    <div className={card + ' px-4 pt-4 pb-4'}>
      {paying && <MarkPaidModal dispute={dispute} base={base} rp={rp} cost={paying} onClose={() => setPaying(null)} onDone={(d, t) => { setPaying(null); onChanged(d); say?.(t); }} />}
      {adding && <AddCostsModal dispute={dispute} base={base} rp={rp} preselect={preselect} onClose={() => { setAdding(false); setPreselect(null); }} onDone={(d, t) => { setAdding(false); setPreselect(null); onChanged(d); say?.(t); }} />}

      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-bold">Costs · {totals.lines}</h2>
        {!closed && <button type="button" onClick={() => setAdding(true)} className={btnSm}>+ Add costs</button>}
      </div>
      {!closed && missing.length > 0 && (
        <div className="mx-4 mt-3 rounded-lg border px-3 py-2 text-[11.5px] flex items-start justify-between gap-3" style={{ background: '#fff4e0', borderColor: '#f3d9a4', color: '#8a4b00' }}>
          <span>
            <b>{missing.length} fee-book line{missing.length === 1 ? '' : 's'} not recorded</b> for stages this case has reached (≈ AED {(dispute.missingCostsTotal ?? 0).toLocaleString('en-AE')}):
            {' '}{missing.slice(0, 3).map(m => m.label).join('; ')}{missing.length > 3 ? '…' : ''}
          </span>
          <button type="button" className="shrink-0 font-semibold underline cursor-pointer" onClick={() => { setPreselect(missing.map(m => m.feeItemId)); setAdding(true); }}>Review</button>
        </div>
      )}

      {/* the three figures */}
      <div className="mt-2.5 rounded-lg bg-[#fafbfa] border border-[#eef0ee] px-3 py-1 divide-y divide-[#eef0ee]">
        <Tile label="Expected" value={totals.expected} fg="#5b615e" />
        <Tile label="Paid" value={totals.paid} fg="#b42318" />
        <Tile label="Charged to customer" value={totals.recoverableCharged} fg="#1a7a52" hint="on the lease ledger" />
      </div>

      {costs.length === 0 ? (
        <p className="text-[11.5px] text-[#8a8f8c] mt-2.5">No costs on this case yet. Add the fee-book lines that apply — each becomes an expected amount, and is charged to the customer once paid if it is recoverable.</p>
      ) : costs.map(c => {
        const t = stageTone(c.stage); const b = busy === `cost-${c.id}`; const paid = c.status === 'paid';
        const receipt = c.receiptDocumentId != null ? docsById.get(c.receiptDocumentId) ?? null : null;
        return (
          <div key={c.id} className="mt-2.5 border border-[#e6e8e6] rounded-[10px] px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={pillCls} style={{ background: t.bg, color: t.fg }}>{c.stageLabel ?? FEE_STAGE_LABELS[c.stage]}</span>
                  <span className={pillCls} style={paid ? { background: '#e7f4ee', color: '#1a7a52' } : { background: '#fdf3e3', color: '#c47a00' }}>{paid ? 'Paid' : 'Expected'}</span>
                  {c.chargePaymentId != null && <span className={pillCls} style={{ background: '#ece9fd', color: '#5b3fbf' }} title="A “Legal cost” charge sits on the customer’s lease ledger">Charged to customer</span>}
                </div>
                <div className="text-[12px] font-bold mt-1 break-words">{c.label}</div>
                <div className="text-[11px] text-[#8a8f8c]">{c.payeeLabel ?? FEE_PAYEE_LABELS[c.payee]}{paid && c.paidOn ? ` · paid ${fmtD(c.paidOn)}` : ''}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[12.5px] font-bold whitespace-nowrap">{money(paid ? c.actualAmount ?? c.expectedAmount : c.expectedAmount)}</div>
                {paid && c.actualAmount != null && c.actualAmount !== c.expectedAmount && <div className="text-[10.5px] text-[#8a8f8c] whitespace-nowrap">expected {money(c.expectedAmount)}</div>}
              </div>
            </div>

            {paid && (
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-[10.5px] text-[#8a8f8c] whitespace-nowrap">Actual</span>
                <input type="number" min={0} step="0.01" disabled={b || closed} value={actualDraft[c.id] ?? (c.actualAmount != null ? String(c.actualAmount) : '')}
                  onChange={e => setActualDraft(a => ({ ...a, [c.id]: e.target.value }))} onBlur={() => saveActual(c)} className={inp + ' w-24'} aria-label="Actual amount" />
                <span className="text-[11px] min-w-0 truncate">
                  {receipt
                    ? <button type="button" onClick={() => void openDocViewerByIds([{ id: receipt.id, caption: `Receipt · ${c.label}`, mimeType: receipt.mimeType }], 'Receipt')}
                        className="font-semibold text-[#1a7a52] hover:text-[#125a3c] underline cursor-pointer inline-flex items-center gap-1"><FileText size={11} /> Receipt</button>
                    : c.receiptDocumentId != null ? <span className="text-[#8a8f8c] inline-flex items-center gap-1"><FileText size={11} /> receipt on file</span>
                    : <span className="text-[#8a8f8c]">no receipt</span>}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 mt-2">
              <label className={`flex items-center gap-1.5 text-[11px] ${closed || b ? 'text-[#8a8f8c]' : 'cursor-pointer'}`} title="Charged to the customer's lease ledger once paid">
                <input type="checkbox" className="accent-[#1a7a52]" checked={c.recoverable} disabled={b || closed} onChange={e => void toggleRecoverable(c, e.target.checked)} />Recoverable
              </label>
              {!closed && (
                <div className="flex items-center gap-2">
                  {!paid && <button type="button" disabled={b} onClick={() => setPaying(c)} className={btnGreenSm}>Mark paid</button>}
                  <button type="button" disabled={b} onClick={() => void remove(c)} className="text-[#8a8f8c] hover:text-[#b42318] cursor-pointer disabled:opacity-40" title="Remove this line" aria-label="Remove this line">{b ? <Loader2 size={13} className="animate-spin" /> : <X size={14} />}</button>
                </div>
              )}
            </div>
            {rowErr?.id === c.id && <p className="text-[11px] text-[#b42318] mt-1.5">{rowErr.text}</p>}
          </div>
        );
      })}
    </div>
  );
}

const Tile = ({ label, value, fg, hint }: { label: string; value: number; fg: string; hint?: string }) => (
  <div className="flex items-baseline justify-between gap-2 py-1.5">
    <div className="text-[10px] font-bold tracking-[.06em] text-[#8a8f8c] uppercase">{label}{hint && <span className="font-normal tracking-normal normal-case"> · {hint}</span>}</div>
    <div className="text-[12.5px] font-extrabold whitespace-nowrap" style={{ color: fg }}>{money(value)}</div>
  </div>
);

const Shell = ({ title, sub, onClose, children, footer, wide }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; wide?: boolean }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
    <div className={`bg-white rounded-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[92vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#f1f3f1]">
        <div><h2 className="text-sm font-bold text-[#1c1f1d]">{title}</h2>{sub && <p className="text-[11px] text-[#8a8f8c] mt-0.5">{sub}</p>}</div>
        <button onClick={onClose} className="text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer" aria-label="Close"><X size={18} /></button>
      </div>
      <div className="px-5 py-4 space-y-3">{children}</div>
      <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#f1f3f1]">{footer}</div>
    </div>
  </div>
);

/* ── Mark paid: actual amount (prefilled), date (today), optional receipt ── */
function MarkPaidModal({ dispute, base, rp, cost, onClose, onDone }: {
  dispute: DisputeDetail; base: string; rp?: number; cost: CaseCost; onClose: () => void; onDone: (d: DisputeDetail, text: string) => void;
}) {
  const [amount, setAmount] = useState(String(cost.expectedAmount));
  const [date, setDate] = useState(todayIso());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const n = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(n) || n < 0) { setErr('Enter the amount actually paid (0 or more).'); return; }
    if (!date) { setErr('Enter the date it was paid.'); return; }
    setBusy(true); setErr(null);
    try {
      let receiptDocumentId: number | null = null;
      if (file) {
        const up = await uploadOwnedDocument({ ownerType: 'tenancy_dispute', ownerId: dispute.id, category: 'legal', documentKey: `cost_${cost.id}_${Date.now()}`, displayName: `Receipt · ${cost.label}`, file });
        if (!up.id) throw new Error('The receipt could not be saved.');
        receiptDocumentId = up.id;
      }
      const d = await legalApi.markCostPaid(base, rp, dispute.id, cost.id, { actualAmount: n, paidOn: date, receiptDocumentId });
      onDone(d, cost.recoverable ? `“${cost.label}” marked paid — charged to the customer’s ledger.` : `“${cost.label}” marked paid.`);
    } catch (e) { setErr(errText(e, 'Could not mark the line paid.')); }
    finally { setBusy(false); }
  };

  return (
    <Shell title={`Mark paid · ${cost.label}`} sub={`${cost.payeeLabel ?? FEE_PAYEE_LABELS[cost.payee]} · expected ${money(cost.expectedAmount)}`} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={btnSm}>Cancel</button>
        <button type="button" disabled={busy} onClick={() => void submit()} className={btnFillSm}>{busy ? 'Saving…' : 'Mark paid'}</button>
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-[#5b615e] mb-1 block" htmlFor="cost-actual">Amount paid (AED)</label>
          <input id="cost-actual" type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={inp + ' w-full text-sm'} />
        </div>
        <div>
          <label className="text-xs font-medium text-[#5b615e] mb-1 block" htmlFor="cost-paid-on">Paid on</label>
          <input id="cost-paid-on" type="date" value={date} onChange={e => setDate(e.target.value)} className={inp + ' w-full text-sm'} />
        </div>
      </div>
      <div>
        <span className="text-xs font-medium text-[#5b615e] mb-1 block">Receipt (optional)</span>
        <label className="flex items-center gap-2 text-xs text-[#5b615e] border border-dashed border-[#d8d6d0] rounded-lg px-3 py-2.5 cursor-pointer hover:bg-[#f9f8f6]">
          <UploadCloud size={14} className="text-[#1a7a52]" />{file ? file.name : 'Attach the receipt or invoice'}
          <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf" onChange={e => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        </label>
      </div>
      <p className="text-[11px] text-[#8a8f8c]">
        {cost.recoverable
          ? <>This line is <b>recoverable</b> — marking it paid posts a “Legal cost” charge of the amount paid on the customer’s lease ledger, so it reaches the statement and the final settlement.</>
          : <>This line is not recoverable — it stays a cost to you. Tick “Recoverable” on the line to charge it to the customer.</>}
      </p>
      {err && <p className="text-[11px] text-[#b42318]">{err}</p>}
    </Shell>
  );
}

/* ── Add costs: the fee book grouped by stage + one custom line ──────────── */
function AddCostsModal({ dispute, base, rp, onClose, onDone, preselect }: {
  dispute: DisputeDetail; base: string; rp?: number; onClose: () => void; onDone: (d: DisputeDetail, text: string) => void;
  /** Fee-item ids to tick on open (the "Review missing costs" path); default = the current stage's lines. */
  preselect?: number[] | null;
}) {
  const rent = dispute.lease?.annualRent ?? null;
  const [book, setBook] = useState<FeeItem[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<Set<FeeStage>>(new Set<FeeStage>([dispute.stage as FeeStage]));
  const [custom, setCustom] = useState<{ label: string; payee: FeePayee; amount: string; percent: string; recoverable: boolean }>({ label: '', payee: 'other', amount: '', percent: '', recoverable: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    legalApi.feeBook(base, rp).then(r => {
      const items = [...r.items].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || a.sortOrder - b.sortOrder);
      setBook(items);
      // The current stage's lines come pre-ticked (skipping any already on the case).
      const onCase = new Set((dispute.costs ?? []).map(c => c.feeItemId).filter((x): x is number => x != null));
      if (preselect?.length) {
        const ids = new Set(preselect.filter(id => !onCase.has(id)));
        setPicked(ids);
        setOpen(new Set<FeeStage>(items.filter(i => ids.has(i.id)).map(i => i.stage)));
      } else {
        setPicked(new Set(items.filter(i => i.stage === dispute.stage && !onCase.has(i.id)).map(i => i.id)));
      }
    }).catch(e => setLoadErr(errText(e, 'Could not load the fee book.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, rp]);

  const toggle = (id: number) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleOpen = (s: FeeStage) => setOpen(o => { const n = new Set(o); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const onCaseIds = useMemo(() => new Set((dispute.costs ?? []).map(c => c.feeItemId).filter((x): x is number => x != null)), [dispute.costs]);

  const customFilled = custom.label.trim() !== '' || custom.amount.trim() !== '' || custom.percent.trim() !== '';
  const customInput = (): FeeItemInput | null => {
    if (!customFilled) return null;
    const a = custom.amount.trim() === '' ? null : Number(custom.amount);
    const p = custom.percent.trim() === '' ? null : Number(custom.percent);
    if (!custom.label.trim()) throw new Error('Custom line: give it a name.');
    if ((a == null) === (p == null)) throw new Error('Custom line: enter EITHER an AED amount OR a percent of rent.');
    if (a != null && (!Number.isFinite(a) || a < 0)) throw new Error('Custom line: the amount must be 0 or more.');
    if (p != null && (!Number.isFinite(p) || p < 0 || p > 100)) throw new Error('Custom line: the percent must be between 0 and 100.');
    return { stage: dispute.stage as FeeStage, payee: custom.payee, label: custom.label.trim(), amount: a, percentOfRent: p, recoverable: custom.recoverable };
  };
  const selectedTotal = useMemo(() => (book ?? []).filter(i => picked.has(i.id)).reduce((a, i) => a + expectedOf(i, rent), 0), [book, picked, rent]);

  const submit = async () => {
    setErr(null);
    try {
      const c = customInput();
      const ids = [...picked];
      if (ids.length === 0 && !c) { setErr('Tick at least one line, or fill in the custom line.'); return; }
      setBusy(true);
      // One call for the picked lines, one for the custom line — the backend takes either per request.
      let d = dispute;
      if (ids.length) d = await legalApi.addCosts(base, rp, dispute.id, { feeItemIds: ids });
      if (c) d = await legalApi.addCosts(base, rp, dispute.id, { custom: c });
      const n = ids.length + (c ? 1 : 0);
      onDone(d, `${n} cost line${n === 1 ? '' : 's'} added — expected ${money((d.costTotals?.expected ?? 0))} in total.`);
    } catch (e) { setErr(errText(e, 'Could not add the costs.')); }
    finally { setBusy(false); }
  };

  return (
    <Shell title="Add costs" sub={`Pick the fee-book lines that apply to this case${rent != null ? ` · percent lines use the lease’s annual rent of ${money(rent)}` : ' · the lease has no annual rent, so percent lines come in at AED 0'}`} onClose={onClose} wide
      footer={<>
        <span className="text-[11px] text-[#8a8f8c] mr-auto">{picked.size} ticked · expected {money(selectedTotal)}{customFilled ? ' + custom line' : ''}</span>
        <button type="button" onClick={onClose} className={btnSm}>Cancel</button>
        <button type="button" disabled={busy || !book} onClick={() => void submit()} className={btnFillSm}>{busy ? 'Adding…' : 'Add selected'}</button>
      </>}>
      {loadErr && <p className="text-[11px] text-[#b42318]">{loadErr}</p>}
      {!book && !loadErr && <div className="flex items-center gap-2 text-[12px] text-[#8a8f8c] py-3"><Loader2 size={13} className="animate-spin" /> Loading the fee book…</div>}
      {book && STAGE_ORDER.map(stage => {
        const group = book.filter(i => i.stage === stage); if (group.length === 0) return null;
        const isOpen = open.has(stage); const t = stageTone(stage); const nPicked = group.filter(i => picked.has(i.id)).length;
        return (
          <div key={stage} className="border border-[#e6e8e6] rounded-[10px] overflow-hidden">
            <button type="button" onClick={() => toggleOpen(stage)} className="w-full flex items-center gap-2 px-3 py-2 bg-[#fafbfa] hover:bg-[#f4f6f4] cursor-pointer text-left">
              {isOpen ? <ChevronDown size={14} className="text-[#8a8f8c]" /> : <ChevronRight size={14} className="text-[#8a8f8c]" />}
              <span className={pillCls} style={{ background: t.bg, color: t.fg }}>{FEE_STAGE_LABELS[stage]}</span>
              {stage === dispute.stage && <span className="text-[10.5px] text-[#1a7a52] font-semibold">current stage</span>}
              <span className="text-[11px] text-[#8a8f8c] ml-auto">{nPicked ? `${nPicked} of ${group.length} ticked` : `${group.length} line${group.length === 1 ? '' : 's'}`}</span>
            </button>
            {isOpen && (
              <div className="divide-y divide-[#f1f3f1]">
                {group.map(i => {
                  const already = onCaseIds.has(i.id); const exp = expectedOf(i, rent);
                  return (
                    <label key={i.id} className={`flex items-center gap-2.5 px-3 py-2 ${already ? 'opacity-60' : 'cursor-pointer hover:bg-[#fafbfa]'}`}>
                      <input type="checkbox" className="accent-[#1a7a52]" checked={picked.has(i.id)} onChange={() => toggle(i.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="text-[12px] font-semibold block truncate">{i.label}</span>
                        <span className="text-[10.5px] text-[#8a8f8c]">{i.payeeLabel ?? FEE_PAYEE_LABELS[i.payee]}{i.recoverable ? ' · recoverable' : ''}{already ? ' · already on the case' : ''}</span>
                      </span>
                      <span className="text-[11.5px] font-semibold whitespace-nowrap text-right">
                        {i.amount != null ? money(i.amount) : <>{i.percentOfRent}% of rent <span className="text-[#8a8f8c] font-normal">= {money(exp)}</span></>}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* custom line */}
      <div className="border border-dashed border-[#d9ddda] rounded-[10px] px-3 py-2.5">
        <div className="text-[11px] font-bold text-[#5b615e] mb-1.5">Custom line <span className="font-normal text-[#8a8f8c]">· recorded at the current stage</span></div>
        <div className="grid grid-cols-[minmax(0,1.6fr)_120px] gap-2">
          <input value={custom.label} onChange={e => setCustom(c => ({ ...c, label: e.target.value }))} placeholder="What it is for" className={inp} aria-label="Custom line" />
          <select value={custom.payee} onChange={e => setCustom(c => ({ ...c, payee: e.target.value as FeePayee }))} className={inp} aria-label="Payee">
            {PAYEES.map(p => <option key={p} value={p}>{FEE_PAYEE_LABELS[p]}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-[110px_110px_1fr] gap-2 mt-2 items-center">
          <input type="number" min={0} step="1" value={custom.amount} disabled={custom.percent.trim() !== ''} onChange={e => setCustom(c => ({ ...c, amount: e.target.value }))} placeholder="AED amount" className={inp} aria-label="Amount (AED)" />
          <div className="relative">
            <input type="number" min={0} max={100} step="0.1" value={custom.percent} disabled={custom.amount.trim() !== ''} onChange={e => setCustom(c => ({ ...c, percent: e.target.value }))} placeholder="or % of rent" className={inp + ' w-full pr-5'} aria-label="Percent of rent" />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] text-[#8a8f8c]">%</span>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] cursor-pointer"><input type="checkbox" className="accent-[#1a7a52]" checked={custom.recoverable} onChange={e => setCustom(c => ({ ...c, recoverable: e.target.checked }))} />Recoverable</label>
        </div>
      </div>
      {err && <p className="text-[11px] text-[#b42318]">{err}</p>}
    </Shell>
  );
}
