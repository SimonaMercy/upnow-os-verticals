'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

/**
 * AMC & Vendor Management — shared view used by both the rental-provider portal
 * (base="/amc") and the manager portal (base="/manager/amc" with ?rp=<landlord>).
 *
 * AMC contracts with vendor, expiry status, PDF attachments, and an editable
 * maintenance plan (done/pending). Add-AMC supports picking an existing vendor
 * (auto-prefills a renewal for next year) or creating a new vendor, with notes.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Wrench, FileText, ExternalLink, ChevronDown, Loader2, Building2,
  CheckCircle2, Circle, ShieldCheck, Users, CalendarClock, Plus, X, UploadCloud,
} from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { openDocsTogether } from '@/lib/openDocsTogether';
import { openDocViewer } from '@/lib/docViewer';

const CATEGORIES = ['elevator','cleaning','security','insurance','waste','electricity_water','fire_safety','maintenance','renovation','landscaping','pest_control','government','other'];

type Status = 'active' | 'expiring' | 'expired' | 'unknown';
interface AmcDoc { id: number; documentKey: string; displayName: string | null; fileUrl: string; status: string }
interface AmcContract {
  id: number; vendorId: number; vendorName: string; serviceCategory: string | null;
  isGovernment: boolean; contractType: string | null; frequency: string | null;
  modeOfPayment: string | null; numberOfPayments: number | null;
  startDate: string | null; endDate: string | null; status: Status;
  propertyId: number | null; propertyName: string | null; notes: string | null;
  documents: AmcDoc[]; tasks: { total: number; done: number; pending: number };
}
interface Vendor { id: number; name: string; email: string | null; serviceCategory: string | null; isGovernment: boolean; contractCount: number; documentCount: number }
interface Task { id: number; title: string; dueDate: string | null; status: string; completedAt: string | null; notes: string | null }
interface PropertyOpt { id: number; buildingName?: string | null; name?: string | null }
interface VendorOpt { id: number; name: string; serviceCategory: string | null }
interface PlanRow { title: string; dueDate: string; notes: string }

const STATUS_STYLE: Record<Status, { bg: string; fg: string; label: string }> = {
  active:   { bg: '#dcfce7', fg: '#15803d', label: 'Active' },
  expiring: { bg: '#fef3c7', fg: '#b45309', label: 'Expiring soon' },
  expired:  { bg: '#fee2e2', fg: '#b91c1c', label: 'Expired' },
  unknown:  { bg: '#f4f3ef', fg: '#6b6860', label: 'No expiry' },
};
const cap = (s?: string | null) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—');
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const FREQ_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annually: 12 };
const addMonths = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const addYears = (iso: string, n: number) => addMonths(iso, n * 12);
const amcUrl = (base: string, rp: number | null | undefined, path: string) =>
  rp != null ? `${base}${path}${path.includes('?') ? '&' : '?'}rp=${rp}` : `${base}${path}`;

function buildPlan(start: string, end: string, frequency: string, category: string): PlanRow[] {
  if (!start || !end) return [];
  const cat = (category || 'maintenance').replace(/_/g, ' ');
  const months = FREQ_MONTHS[frequency];
  if (!months) return [{ title: `${cat} service`, dueDate: start, notes: '' }];
  const rows: PlanRow[] = []; let due = start, i = 0;
  while (due <= end && i < 60) { rows.push({ title: `${cat} maintenance`, dueDate: due, notes: '' }); due = addMonths(due, months); i++; }
  return rows;
}

export function AmcView({ base, rp, propertiesUrl }: { base: string; rp?: number | null; propertiesUrl: string }) {
  const [tab, setTab] = useState<'contracts' | 'vendors'>('contracts');
  const [contracts, setContracts] = useState<AmcContract[] | null>(null);
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet<AmcContract[]>(amcUrl(base, rp, '/contracts')).catch(() => []),
      apiGet<Vendor[]>(amcUrl(base, rp, '/vendors')).catch(() => []),
    ]).then(([c, v]) => { setContracts(c); setVendors(v); }).finally(() => setLoading(false));
  }, [base, rp]);
  useEffect(() => { load(); }, [load]);

  const kpi = {
    active: contracts?.filter(c => c.status === 'active').length ?? 0,
    expiring: contracts?.filter(c => c.status === 'expiring').length ?? 0,
    expired: contracts?.filter(c => c.status === 'expired').length ?? 0,
    vendors: vendors?.length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">AMC &amp; Vendor Management</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Annual maintenance contracts, vendor records, and the maintenance plan.</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl text-white" style={{ background: '#2e9f82' }}>
          <Plus size={13} /> Add AMC
        </button>
      </div>

      {showAdd && <AddAmcModal base={base} rp={rp} propertiesUrl={propertiesUrl} existingContracts={contracts ?? []} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Active AMCs', value: kpi.active, color: '#15803d' },
          { label: 'Expiring ≤60d', value: kpi.expiring, color: '#b45309' },
          { label: 'Expired', value: kpi.expired, color: '#b91c1c' },
          { label: 'Vendors', value: kpi.vendors, color: '#1a1916' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-[#e8e6e0] rounded-2xl px-4 py-3.5">
            <p className="text-xs text-[#6b6860]">{k.label}</p>
            <p className="text-2xl font-bold mt-0.5" style={{ color: k.color }}>{loading ? '…' : k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5">
        {([['contracts', 'AMC Contracts', FileText], ['vendors', 'Vendors', Users]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className="flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-full font-medium transition-colors"
            style={tab === key ? { background: '#1a1916', color: '#fff' } : { background: '#fff', color: '#6b6860', border: '1px solid #e8e6e0' }}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#9b9890]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      ) : tab === 'contracts' ? (
        !contracts?.length
          ? <Empty icon={Wrench} msg="No AMC contracts yet." />
          : <div className="space-y-3">{contracts.map(c => <ContractCard key={c.id} base={base} rp={rp} c={c} onTasksChanged={load} />)}</div>
      ) : (
        !vendors?.length
          ? <Empty icon={Users} msg="No vendors yet." />
          : <div className="grid sm:grid-cols-2 gap-3">{vendors.map(v => <VendorCard key={v.id} v={v} />)}</div>
      )}
    </div>
  );
}

function Empty({ icon: Icon, msg }: { icon: React.ComponentType<{ size?: number; className?: string }>; msg: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 text-center">
      <Icon size={28} className="mx-auto mb-2 text-[#c5c3bc]" />
      <p className="text-sm text-[#9b9890]">{msg}</p>
    </div>
  );
}

function ContractCard({ base, rp, c, onTasksChanged }: { base: string; rp?: number | null; c: AmcContract; onTasksChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const ss = STATUS_STYLE[c.status];
  const pct = c.tasks.total ? Math.round((c.tasks.done / c.tasks.total) * 100) : 0;

  const toggleOpen = () => {
    const next = !open; setOpen(next);
    if (next && tasks === null) {
      setLoadingTasks(true);
      apiGet<Task[]>(amcUrl(base, rp, `/contracts/${c.id}/tasks`)).then(setTasks).catch(() => setTasks([])).finally(() => setLoadingTasks(false));
    }
  };
  const toggleTask = async (t: Task) => {
    const status = t.status === 'done' ? 'pending' : 'done';
    setBusy(t.id);
    try {
      await apiPatch(amcUrl(base, rp, `/tasks/${t.id}`), { status });
      setTasks(prev => prev?.map(x => x.id === t.id ? { ...x, status } : x) ?? null);
      onTasksChanged();
    } finally { setBusy(null); }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-[#1a1916]">{c.vendorName}</span>
              {c.isGovernment && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#eef2ff] text-[#4338ca] font-medium">Govt</span>}
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f0faf6] text-[#1a7a5a] font-medium">{cap(c.serviceCategory)}</span>
            </div>
            <p className="text-xs text-[#6b6860] mt-1 flex items-center gap-3 flex-wrap">
              {c.propertyName && <span className="flex items-center gap-1"><Building2 size={11} /> {c.propertyName}</span>}
              {c.frequency && <span className="flex items-center gap-1"><CalendarClock size={11} /> {cap(c.frequency)}</span>}
              {c.modeOfPayment && <span>{cap(c.modeOfPayment)}</span>}
            </p>
          </div>
          <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 shrink-0" style={{ backgroundColor: ss.bg, color: ss.fg }}>{ss.label}</span>
        </div>

        <div className="flex items-center gap-4 mt-3 text-xs text-[#6b6860] flex-wrap">
          <span>Start: <b className="text-[#1a1916]">{fmt(c.startDate)}</b></span>
          <span>Expiry: <b style={{ color: c.status === 'expired' ? '#b91c1c' : c.status === 'expiring' ? '#b45309' : '#1a1916' }}>{fmt(c.endDate)}</b></span>
        </div>

        {c.notes && <p className="text-xs text-[#6b6860] mt-2 italic">{c.notes}</p>}

        {c.documents.length > 0 && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {c.documents.map(d => (
              <button key={d.id} type="button" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: d.displayName ?? d.documentKey, documentKey: d.documentKey })}
                className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg bg-[#f7f6f2] text-[#2e9f82] hover:bg-[#eef0ec] cursor-pointer">
                <FileText size={11} /> {cap(d.displayName ?? d.documentKey)}
              </button>
            ))}
            {c.documents.length > 1 && (
              <button onClick={() => openDocsTogether(c.documents)} className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg text-[#6b6860] hover:bg-[#f7f6f2]">
                <ExternalLink size={11} /> View all
              </button>
            )}
          </div>
        )}

        <button onClick={toggleOpen} className="w-full mt-3 pt-3 border-t border-[#f4f3ef] flex items-center gap-3">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-[#1a1916]">Maintenance plan</span>
              <span className="text-[11px] text-[#6b6860]">{c.tasks.done}/{c.tasks.total} done · {c.tasks.pending} pending</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#f0eee9] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#2e9f82' }} />
            </div>
          </div>
          <ChevronDown size={16} className="text-[#9b9890]" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
        </button>
      </div>

      {open && (
        <div className="px-4 pb-4 bg-[#fafaf8] border-t border-[#f4f3ef]">
          {loadingTasks ? (
            <p className="text-xs text-[#9b9890] py-4 text-center">Loading plan…</p>
          ) : !tasks?.length ? (
            <p className="text-xs text-[#9b9890] py-4 text-center">No scheduled maintenance for this contract.</p>
          ) : (
            <div className="pt-3 space-y-1">
              {tasks.map(t => {
                const done = t.status === 'done';
                return (
                  <button key={t.id} onClick={() => toggleTask(t)} disabled={busy === t.id}
                    className="w-full flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-white text-left">
                    {busy === t.id ? <Loader2 size={15} className="animate-spin text-[#9b9890]" />
                      : done ? <CheckCircle2 size={15} className="text-[#16a34a] shrink-0" />
                      : <Circle size={15} className="text-[#c5c3bc] shrink-0" />}
                    <span className="flex-1 min-w-0">
                      <span className={`text-xs block ${done ? 'line-through text-[#9b9890]' : 'text-[#1a1916]'}`}>{cap(t.title)}</span>
                      {t.notes && <span className="text-[11px] text-[#9b9890]">{t.notes}</span>}
                    </span>
                    <span className="text-[11px] text-[#9b9890] shrink-0">{fmt(t.dueDate)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VendorCard({ v }: { v: Vendor }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#f0faf6] flex items-center justify-center shrink-0">
          <Wrench size={16} className="text-[#2e9f82]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[#1a1916] truncate">{v.name}</span>
            {v.isGovernment && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#eef2ff] text-[#4338ca] font-medium">Govt</span>}
          </div>
          {v.email && <p className="text-xs text-[#9b9890] truncate">{v.email}</p>}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f0faf6] text-[#1a7a5a] font-medium">{cap(v.serviceCategory)}</span>
            <span className="text-[11px] text-[#6b6860]">{v.contractCount} contract{v.contractCount !== 1 ? 's' : ''}</span>
            <span className="text-[11px] text-[#6b6860] flex items-center gap-1"><ShieldCheck size={11} /> {v.documentCount} docs</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddAmcModal({ base, rp, propertiesUrl, existingContracts, onClose, onSaved }: {
  base: string; rp?: number | null; propertiesUrl: string; existingContracts: AmcContract[]; onClose: () => void; onSaved: () => void;
}) {
  const [allVendors, setAllVendors] = useState<VendorOpt[]>([]);
  const [props, setProps] = useState<PropertyOpt[]>([]);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [vendorId, setVendorId] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newCat, setNewCat] = useState('maintenance');
  const [newGov, setNewGov] = useState(false);
  const [propertyId, setPropertyId] = useState('');
  const [contractType, setContractType] = useState('new');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [frequency, setFrequency] = useState('annually');
  const [modeOfPayment, setModeOfPayment] = useState('');
  const [numberOfPayments, setNumberOfPayments] = useState('');
  const [notes, setNotes] = useState('');
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [planDirty, setPlanDirty] = useState(false);
  const [category, setCategory] = useState('maintenance');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<VendorOpt[]>(amcUrl(base, rp, '/vendors/all')).then(setAllVendors).catch(() => setAllVendors([]));
    apiGet<PropertyOpt[]>(propertiesUrl).then(setProps).catch(() => setProps([]));
  }, [base, rp, propertiesUrl]);

  function onPickVendor(id: string) {
    setVendorId(id);
    const v = allVendors.find(x => String(x.id) === id);
    setCategory(v?.serviceCategory ?? 'maintenance');
    const prev = existingContracts.filter(c => String(c.vendorId) === id).sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''))[0];
    if (prev) {
      const newStart = prev.endDate ? addMonths(prev.endDate, 0) : '';
      const newEnd = newStart ? addYears(newStart, 1) : '';
      setContractType('renewal');
      if (prev.frequency) setFrequency(prev.frequency);
      if (prev.modeOfPayment) setModeOfPayment(prev.modeOfPayment);
      if (prev.numberOfPayments != null) setNumberOfPayments(String(prev.numberOfPayments));
      if (prev.propertyId != null) setPropertyId(String(prev.propertyId));
      if (newStart) { setStartDate(newStart); setEndDate(newEnd); }
      setPlanDirty(false);
    }
  }

  useEffect(() => { if (!planDirty) setPlan(buildPlan(startDate, endDate, frequency, category)); }, [startDate, endDate, frequency, category, planDirty]);

  const editRow = (i: number, patch: Partial<PlanRow>) => { setPlanDirty(true); setPlan(p => p.map((r, j) => j === i ? { ...r, ...patch } : r)); };
  const removeRow = (i: number) => { setPlanDirty(true); setPlan(p => p.filter((_, j) => j !== i)); };
  const addRow = () => { setPlanDirty(true); setPlan(p => [...p, { title: `${category.replace(/_/g, ' ')} visit`, dueDate: endDate || startDate || '', notes: '' }]); };
  const regenerate = () => { setPlanDirty(false); setPlan(buildPlan(startDate, endDate, frequency, category)); };

  async function submit() {
    setError(null);
    if (mode === 'existing' && !vendorId) { setError('Pick a vendor or add a new one.'); return; }
    if (mode === 'new' && !newName.trim()) { setError('Enter the new vendor name.'); return; }
    if (!startDate) { setError('Start date is required.'); return; }
    setSaving(true);
    try {
      let spId = Number(vendorId);
      if (mode === 'new') {
        const v = await apiPost<{ id: number }>(amcUrl(base, rp, '/vendors'), { name: newName.trim(), email: newEmail.trim() || undefined, serviceCategory: newCat, isGovernment: newGov });
        spId = v.id;
      }
      const contract = await apiPost<{ id: number }>(amcUrl(base, rp, '/contracts'), {
        serviceProviderId: spId,
        propertyId: propertyId ? Number(propertyId) : null,
        contractType, startDate, endDate: endDate || null, frequency,
        modeOfPayment: modeOfPayment || null,
        numberOfPayments: numberOfPayments ? Number(numberOfPayments) : null,
        notes: notes.trim() || null,
        tasks: plan.filter(r => r.title.trim()).map(r => ({ title: r.title.trim(), dueDate: r.dueDate || null, notes: r.notes.trim() || null })),
      });
      if (file) await uploadContractPdf(contract.id, file);
      onSaved();
    } catch (e) { setError((e as Error)?.message || 'Could not create the AMC.'); }
    finally { setSaving(false); }
  }

  async function uploadContractPdf(contractId: number, f: File) {
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'service_provider_contract', ownerId: contractId, documentKey: 'sp_contract', originalName: f.name, mimeType: f.type }),
    });
    if (!urlRes.ok) return;
    const { uploadUrl, fileUrl, fileKey } = await urlRes.json();
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    await fetch(target, { method: 'PUT', body: f, headers: { 'Content-Type': f.type } });
    await fetch('/api/documents', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'service_provider_contract', ownerId: contractId, documentKey: 'sp_contract', category: 'contract', displayName: 'Contract Attachment', fileUrl, mimeType: f.type, s3Key: fileKey }),
    });
  }

  const field = 'w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:outline-none focus:border-[#2e9f82]';
  const lbl = 'text-xs font-medium text-[#6b6860] mb-1 block';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f4f3ef] sticky top-0 bg-white">
          <h2 className="text-sm font-bold text-[#1a1916]">Add AMC contract</h2>
          <button onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916]"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className={lbl}>Vendor</span>
              <div className="flex gap-1 text-[11px]">
                <button onClick={() => setMode('existing')} className="px-2 py-0.5 rounded-full" style={mode==='existing'?{background:'#1a1916',color:'#fff'}:{color:'#6b6860'}}>Existing</button>
                <button onClick={() => { setMode('new'); setCategory(newCat); }} className="px-2 py-0.5 rounded-full" style={mode==='new'?{background:'#1a1916',color:'#fff'}:{color:'#6b6860'}}>New vendor</button>
              </div>
            </div>
            {mode === 'existing' ? (
              <>
                <select className={field} value={vendorId} onChange={e => onPickVendor(e.target.value)}>
                  <option value="">Select a vendor…</option>
                  {allVendors.map(v => <option key={v.id} value={v.id}>{v.name}{v.serviceCategory ? ` · ${v.serviceCategory.replace(/_/g,' ')}` : ''}</option>)}
                </select>
                {vendorId && contractType === 'renewal' && <p className="text-[11px] text-[#2e9f82] mt-1">Prefilled as a renewal for next year — adjust as needed.</p>}
              </>
            ) : (
              <div className="space-y-2">
                <input className={field} placeholder="Vendor name" value={newName} onChange={e => setNewName(e.target.value)} />
                <input className={field} placeholder="Email (optional)" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
                <div className="flex gap-2">
                  <select className={field} value={newCat} onChange={e => { setNewCat(e.target.value); setCategory(e.target.value); }}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g,' ')}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-[#6b6860] shrink-0 px-2">
                    <input type="checkbox" checked={newGov} onChange={e => setNewGov(e.target.checked)} /> Govt
                  </label>
                </div>
              </div>
            )}
          </div>

          <div><span className={lbl}>Property (optional)</span>
            <select className={field} value={propertyId} onChange={e => setPropertyId(e.target.value)}>
              <option value="">— none —</option>
              {props.map(p => <option key={p.id} value={p.id}>{p.buildingName ?? p.name ?? `Property #${p.id}`}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><span className={lbl}>Start date</span><input type="date" className={field} value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
            <div><span className={lbl}>End date (expiry)</span><input type="date" className={field} value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
            <div><span className={lbl}>Frequency</span>
              <select className={field} value={frequency} onChange={e => setFrequency(e.target.value)}>
                <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option><option value="one_time">One-time</option>
              </select>
            </div>
            <div><span className={lbl}>Contract type</span>
              <select className={field} value={contractType} onChange={e => setContractType(e.target.value)}>
                <option value="new">New</option><option value="renewal">Renewal</option>
              </select>
            </div>
            <div><span className={lbl}>Mode of payment</span>
              <select className={field} value={modeOfPayment} onChange={e => setModeOfPayment(e.target.value)}>
                <option value="">—</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option>
              </select>
            </div>
            <div><span className={lbl}># Payments</span><input type="number" min="1" className={field} value={numberOfPayments} onChange={e => setNumberOfPayments(e.target.value)} /></div>
          </div>

          <div><span className={lbl}>Contract PDF (optional)</span>
            <label className="flex items-center gap-2 text-xs text-[#6b6860] border border-dashed border-[#d8d6d0] rounded-lg px-3 py-2.5 cursor-pointer hover:bg-[#f9f8f6]">
              <UploadCloud size={14} className="text-[#2e9f82]" />
              {file ? file.name : 'Attach contract PDF'}
              <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className={lbl}>Maintenance plan ({plan.length})</span>
              <button type="button" onClick={regenerate} className="text-[11px] text-[#2e9f82] font-medium">Regenerate from frequency</button>
            </div>
            <div className="border border-[#e8e6e0] rounded-lg divide-y divide-[#f4f3ef] max-h-52 overflow-y-auto">
              {plan.length === 0 && <p className="text-[11px] text-[#9b9890] px-3 py-3 text-center">Set start &amp; end dates to generate the plan.</p>}
              {plan.map((r, i) => (
                <div key={i} className="p-2 flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    <div className="flex gap-2">
                      <input className="flex-1 text-xs px-2 py-1 border border-[#e8e6e0] rounded" value={r.title} onChange={e => editRow(i, { title: e.target.value })} placeholder="Task" />
                      <input type="date" className="text-xs px-2 py-1 border border-[#e8e6e0] rounded" value={r.dueDate} onChange={e => editRow(i, { dueDate: e.target.value })} />
                    </div>
                    <input className="w-full text-xs px-2 py-1 border border-[#e8e6e0] rounded" value={r.notes} onChange={e => editRow(i, { notes: e.target.value })} placeholder="Note (optional)" />
                  </div>
                  <button type="button" onClick={() => removeRow(i)} className="text-[#c5c3bc] hover:text-[#b91c1c] mt-1"><X size={14} /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addRow} className="text-[11px] text-[#2e9f82] font-medium mt-1 flex items-center gap-1"><Plus size={11} /> Add task</button>
          </div>

          <div><span className={lbl}>Notes (optional)</span>
            <textarea className={field} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about this AMC…" />
          </div>

          {error && <p className="text-xs text-[#b91c1c] bg-[#fef2f2] rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-[#f4f3ef] flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="text-xs font-medium px-4 py-2 rounded-xl border border-[#e8e6e0] text-[#6b6860]">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-60" style={{ background: '#2e9f82' }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create AMC
          </button>
        </div>
      </div>
    </div>
  );
}
