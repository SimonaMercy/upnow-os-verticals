'use client';

/**
 * Legal fee book (0287) — Settings → Legal, landlord only.
 *
 * The landlord's price book for a case: every line is a stage, a payee, a
 * label, EITHER a fixed AED amount OR a percent of the lease's annual rent, and
 * a "recoverable" flag (charged back to the customer once paid). A landlord
 * starts on the platform template (`source: 'platform'`); saving creates their
 * own book (`source: 'own'`, the PUT replaces it whole); reset drops it.
 *
 * Same field classes, cards, Save button and inline error/saved text as
 * JurisdictionSettingsForm so the two sit as one tab.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, BookOpen, X } from 'lucide-react';
import { legalApi, FEE_PAYEE_LABELS, FEE_STAGE_LABELS, type FeeItem, type FeeItemInput, type FeePayee, type FeeStage } from '@/lib/legal';

const STAGE_ORDER: FeeStage[] = ['any', 'notice_sent', 'case_filed', 'settlement', 'decision', 'enforcement'];
const PAYEES = Object.keys(FEE_PAYEE_LABELS) as FeePayee[];
const STAGE_HELP: Partial<Record<FeeStage, string>> = {
  any: 'Lines that can come up at any point — pre-ticked on every case when costs are added.',
  notice_sent: 'Serving the notice: typing, notarising, courier.',
  case_filed: 'Registering the case with the authority.',
  settlement: 'Settlement talks and the agreement.',
  decision: 'The decision and any appeal.',
  enforcement: 'Enforcing the decision.',
};

/** One editable line — strings while typing, numbers on save. */
interface Row { key: number; stage: FeeStage; payee: FeePayee; label: string; amount: string; percent: string; recoverable: boolean }

const cell = 'w-full text-[12.5px] px-2.5 py-1.5 border border-[#e4e9e5] rounded-lg bg-white focus:outline-none focus:border-[#047246]';
const GRID = 'grid grid-cols-[minmax(0,1.6fr)_136px_112px_96px_88px_28px] gap-2 items-center';
const aed = (n: number) => `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

let seq = 1;
const toRow = (f: FeeItem): Row => ({ key: seq++, stage: f.stage, payee: f.payee, label: f.label, amount: f.amount != null ? String(f.amount) : '', percent: f.percentOfRent != null ? String(f.percentOfRent) : '', recoverable: !!f.recoverable });
const blank = (stage: FeeStage): Row => ({ key: seq++, stage, payee: 'other', label: '', amount: '', percent: '', recoverable: false });
const num = (s: string) => (s.trim() === '' ? null : Number(s));
const fingerprint = (rs: Row[]) => JSON.stringify(rs.map(r => [r.stage, r.payee, r.label, r.amount, r.percent, r.recoverable]));

export function FeeBookEditor() {
  const [source, setSource] = useState<'own' | 'platform'>('platform');
  const [rows, setRows] = useState<Row[]>([]);
  const [pristine, setPristine] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const hydrate = (r: { source: 'own' | 'platform'; items: FeeItem[] }) => {
    const rs = [...r.items].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || a.sortOrder - b.sortOrder).map(toRow);
    setSource(r.source); setRows(rs); setPristine(fingerprint(rs));
  };
  useEffect(() => {
    legalApi.feeBook('/legal').then(hydrate).catch(e => setError((e as Error)?.message || 'Could not load the fee book.')).finally(() => setLoading(false));
  }, []);

  const dirty = fingerprint(rows) !== pristine;
  const touch = () => { setSaved(null); setError(null); setConfirmReset(false); };
  const patch = (key: number, p: Partial<Row>) => { setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r))); touch(); };
  const remove = (key: number) => { setRows(rs => rs.filter(r => r.key !== key)); touch(); };
  const add = (stage: FeeStage) => { setRows(rs => [...rs, blank(stage)]); touch(); };

  /** Ordered as displayed — the save uses this order as sortOrder. */
  const ordered = useMemo(() => STAGE_ORDER.flatMap(s => rows.filter(r => r.stage === s)), [rows]);

  // "What this costs": fixed total + the percent lines, and a worked example.
  const sampleRent = 100_000;
  const summary = useMemo(() => {
    let fixed = 0; const pcts: number[] = [];
    for (const r of ordered) {
      const a = num(r.amount); const p = num(r.percent);
      if (a != null && Number.isFinite(a)) fixed += a;
      else if (p != null && Number.isFinite(p)) pcts.push(p);
    }
    const pctSum = pcts.reduce((x, y) => x + y, 0);
    return { fixed, pcts, example: fixed + Math.round(sampleRent * pctSum) / 100, recoverable: ordered.filter(r => r.recoverable).length };
  }, [ordered]);

  function validate(): FeeItemInput[] {
    const out: FeeItemInput[] = [];
    ordered.forEach((r, i) => {
      const a = num(r.amount); const p = num(r.percent);
      const where = `${FEE_STAGE_LABELS[r.stage]} · line ${i + 1}`;
      if (!r.label.trim()) throw new Error(`${where}: give the line a name.`);
      if ((a == null) === (p == null)) throw new Error(`"${r.label.trim()}": enter EITHER a fixed AED amount OR a percent of rent — not both, not neither.`);
      if (a != null && (!Number.isFinite(a) || a < 0)) throw new Error(`"${r.label.trim()}": the amount must be 0 or more.`);
      if (p != null && (!Number.isFinite(p) || p < 0 || p > 100)) throw new Error(`"${r.label.trim()}": the percent must be between 0 and 100.`);
      out.push({ stage: r.stage, payee: r.payee, label: r.label.trim(), amount: a, percentOfRent: p, recoverable: r.recoverable, sortOrder: (i + 1) * 10 });
    });
    return out;
  }

  async function onSave() {
    setError(null); setSaved(null); setSaving(true);
    try {
      const items = validate();
      hydrate(await legalApi.saveFeeBook(items)); setSaved('Saved — this is now your own fee book.');
    } catch (e) { setError((e as Error)?.message || 'Could not save the fee book.'); }
    finally { setSaving(false); }
  }
  async function onReset() {
    setError(null); setSaved(null); setSaving(true);
    try { hydrate(await legalApi.resetFeeBook()); setConfirmReset(false); setSaved('Back on the platform template.'); }
    catch (e) { setError((e as Error)?.message || 'Could not reset the fee book.'); }
    finally { setSaving(false); }
  }

  if (loading) {
    return <div className="flex items-center gap-3 py-16 justify-center text-[#5f6b63]"><Loader2 size={16} className="animate-spin" /><span className="text-sm">Loading…</span></div>;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="px-4 py-3 rounded-[12px] border text-[12px]" style={source === 'own' ? { background: '#e6f4ef', borderColor: '#bfe3d3', color: '#125a3c' } : { background: '#fbfbf8', borderColor: '#e4e9e5', color: '#5f6b63' }}>
        {source === 'own'
          ? <><b>Your own fee book</b> — these lines are what a manager or lawyer picks from when adding costs to a case.</>
          : <>You are on the <b>platform template</b> — edit and save to keep your own book. The template stays as the fallback.</>}
      </div>

      {STAGE_ORDER.map(stage => {
        const group = rows.filter(r => r.stage === stage);
        return (
          <div key={stage} className="p-5 rounded-[14px] border border-[#e4e9e5] bg-white">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
              <h3 className="text-[13px] font-semibold text-[#14201a]">{FEE_STAGE_LABELS[stage]} <span className="font-normal text-[#8a948d]">· {group.length} line{group.length === 1 ? '' : 's'}</span></h3>
              <button type="button" onClick={() => add(stage)} disabled={saving} className="text-[11px] font-semibold text-[#047246] hover:text-[#125a3c] cursor-pointer disabled:opacity-50">+ Add line</button>
            </div>
            <p className="text-[11px] text-[#5f6b63] mb-3">{STAGE_HELP[stage] ?? ''}</p>
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <div className={GRID + ' text-[10px] font-bold tracking-[.08em] text-[#8a948d] pb-1.5 border-b border-[#eee]'}>
                  <span>LINE</span><span>PAYEE</span><span>AMOUNT (AED)</span><span>% OF RENT</span><span>RECOVERABLE</span><span />
                </div>
                {group.length === 0 && <p className="text-[11.5px] text-[#8a948d] py-3">No lines at this stage.</p>}
                {group.map(r => {
                  const hasA = r.amount.trim() !== ''; const hasP = r.percent.trim() !== '';
                  const both = hasA && hasP; const neither = !hasA && !hasP;
                  return (
                    <div key={r.key} className={GRID + ' py-2 border-b border-[#f3f2ee] last:border-0'}>
                      <input value={r.label} onChange={e => patch(r.key, { label: e.target.value })} placeholder="e.g. Typing the notice" className={cell} aria-label="Line" />
                      <select value={r.payee} onChange={e => patch(r.key, { payee: e.target.value as FeePayee })} className={cell} aria-label="Payee">
                        {PAYEES.map(p => <option key={p} value={p}>{FEE_PAYEE_LABELS[p]}</option>)}
                      </select>
                      <input type="number" min={0} step="1" value={r.amount} onChange={e => patch(r.key, { amount: e.target.value })} placeholder="—" aria-label="Amount (AED)"
                        className={cell + (both || neither ? ' border-[#e0a0a0]' : '')} disabled={hasP && !hasA} />
                      <div className="relative">
                        <input type="number" min={0} max={100} step="0.1" value={r.percent} onChange={e => patch(r.key, { percent: e.target.value })} placeholder="—" aria-label="Percent of rent"
                          className={cell + ' pr-6' + (both || neither ? ' border-[#e0a0a0]' : '')} disabled={hasA && !hasP} />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-[#8a948d]">%</span>
                      </div>
                      <label className="flex items-center justify-center cursor-pointer" title="Charged to the customer once paid">
                        <input type="checkbox" className="accent-[#047246]" checked={r.recoverable} onChange={e => patch(r.key, { recoverable: e.target.checked })} aria-label="Recoverable" />
                      </label>
                      <button type="button" onClick={() => remove(r.key)} className="text-[#8a948d] hover:text-red-600 cursor-pointer grid place-items-center" title="Remove line" aria-label="Remove line"><X size={14} /></button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      {/* what this costs */}
      <div className="p-5 rounded-[14px] border border-[#e4e9e5] bg-[#fbfbf8]">
        <div className="flex items-center gap-2 mb-1"><BookOpen size={15} className="text-[#047246]" /><h3 className="text-[13px] font-semibold text-[#14201a]">What this costs</h3></div>
        <p className="text-[12px] text-[#14201a]">
          Fixed lines: <b>{aed(summary.fixed)}</b>
          {summary.pcts.length > 0 && <span className="text-[#5f6b63]"> + {summary.pcts.map(p => `${p}% of rent`).join(' + ')}</span>}
        </p>
        <p className="text-[11px] text-[#5f6b63] mt-1">
          Worked example — a lease at AED {sampleRent.toLocaleString('en-AE')}/yr, every line applied: <b className="text-[#14201a]">{aed(summary.example)}</b>
          {' '}· {summary.recoverable} of {ordered.length} line{ordered.length === 1 ? '' : 's'} recoverable from the customer once paid. A case only carries the lines you pick for it.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[11px] text-[#8a948d]">{dirty ? 'Unsaved changes — save to keep them.' : ''}</span>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          {saved && !saving && <p className="text-[11px] text-[#047246]">{saved}</p>}
          {source === 'own' && !confirmReset && (
            <button type="button" onClick={() => setConfirmReset(true)} disabled={saving} className="px-3 py-2 rounded-xl text-xs font-medium border border-[#e4e9e5] bg-white text-[#5f6b63] cursor-pointer disabled:opacity-50">Reset to platform template</button>
          )}
          {source === 'own' && confirmReset && (
            <span className="flex items-center gap-2 text-[11px] text-[#5f6b63]">Drop your book and go back to the template?
              <button type="button" onClick={() => void onReset()} disabled={saving} className="px-3 py-1.5 rounded-xl text-xs font-medium border border-[#e0a0a0] bg-white text-red-600 cursor-pointer disabled:opacity-50">Yes, reset</button>
              <button type="button" onClick={() => setConfirmReset(false)} className="text-xs text-[#8a948d] hover:text-[#14201a] cursor-pointer">Keep</button>
            </span>
          )}
          <button type="button" onClick={() => void onSave()} disabled={saving} className="px-4 py-2 rounded-xl text-xs font-medium text-white cursor-pointer disabled:opacity-50" style={{ background: '#047246' }}>{saving ? 'Saving…' : 'Save fee book'}</button>
        </div>
      </div>
    </div>
  );
}
