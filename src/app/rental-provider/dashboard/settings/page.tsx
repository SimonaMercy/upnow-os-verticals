'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Settings, Save, Send, X, Loader2, Plus, Percent, RotateCcw, Camera, Globe, Mail, Phone, MapPin, FileText, Building2, User, CreditCard, Flag, Lock } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────
   General settings types
───────────────────────────────────────────────────────────── */
type NotifKey = 'newInquiry' | 'chequeReminder' | 'renewalAlert' | 'maintenanceUpdate' | 'promotional';

const NOTIF_LABELS: Record<NotifKey, { title: string; description: string }> = {
  newInquiry:        { title: 'New Inquiries',       description: 'Notify when a new lead or inquiry is received' },
  chequeReminder:    { title: 'Cheque Reminders',    description: 'Remind 3 days before a cheque payment is due' },
  renewalAlert:      { title: 'Renewal Alerts',      description: 'Alert when a lease is within 90 days of expiry' },
  maintenanceUpdate: { title: 'Maintenance Updates', description: 'Notify on maintenance request status changes' },
  promotional:       { title: 'Platform News',       description: 'Product updates and feature announcements from UpNow' },
};
const NOTIF_KEYS: NotifKey[] = ['newInquiry', 'chequeReminder', 'renewalAlert', 'maintenanceUpdate', 'promotional'];

/* ─────────────────────────────────────────────────────────────
   Fee rules types
───────────────────────────────────────────────────────────── */
type FeeType = 'ejari_fee' | 'admin_fee' | 'commission' | 'security_deposit';
type FeeValueType = 'fixed_aed' | 'percentage';
type ContractType = 'new' | 'renewal';

interface FeeRuleDto {
  feeType: FeeType;
  valueType: FeeValueType;
  value: number;
  vatApplicable: boolean;
  vatRate: number;
  isActive: boolean;
}

type CategoryMap = Record<FeeType, FeeRuleDto>;
const FEE_CATEGORIES = ['residential', 'commercial', 'industrial'] as const;
type FeeCategory = (typeof FEE_CATEGORIES)[number];
const FEE_ORDER: FeeType[] = ['ejari_fee', 'admin_fee', 'commission', 'security_deposit'];

const FEE_META: Record<FeeType, { title: string; description: string; tag: string; tagStyle: 'default' | 'green'; refundable?: boolean; newOnly?: boolean }> = {
  ejari_fee:        { title: 'Ejari Fee',        description: 'Government Ejari registration charge',          tag: 'UAE default',  tagStyle: 'green' },
  admin_fee:        { title: 'Admin Fee',         description: 'Processing fee charged by your company',        tag: 'Customisable', tagStyle: 'default' },
  commission:       { title: 'Commission',        description: 'Brokerage commission on annual contract value',  tag: 'Customisable', tagStyle: 'default' },
  security_deposit: { title: 'Security Deposit',  description: 'Refundable deposit held for contract duration',  tag: 'Refundable',   tagStyle: 'green', refundable: true, newOnly: true },
};

const UAE_DEFAULTS: Record<FeeCategory, CategoryMap> = {
  residential: {
    ejari_fee:        { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 250,  vatApplicable: false, vatRate: 0, isActive: true },
    admin_fee:        { feeType: 'admin_fee',         valueType: 'fixed_aed',  value: 1000, vatApplicable: true,  vatRate: 5, isActive: true },
    commission:       { feeType: 'commission',        valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    security_deposit: { feeType: 'security_deposit',  valueType: 'percentage', value: 5,    vatApplicable: false, vatRate: 0, isActive: true },
  },
  commercial: {
    ejari_fee:        { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 500,  vatApplicable: false, vatRate: 0, isActive: true },
    admin_fee:        { feeType: 'admin_fee',         valueType: 'fixed_aed',  value: 2000, vatApplicable: true,  vatRate: 5, isActive: true },
    commission:       { feeType: 'commission',        valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    security_deposit: { feeType: 'security_deposit',  valueType: 'percentage', value: 10,   vatApplicable: false, vatRate: 0, isActive: true },
  },
  industrial: {
    ejari_fee:        { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 500,  vatApplicable: false, vatRate: 0, isActive: true },
    admin_fee:        { feeType: 'admin_fee',         valueType: 'fixed_aed',  value: 2500, vatApplicable: true,  vatRate: 5, isActive: true },
    commission:       { feeType: 'commission',        valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    security_deposit: { feeType: 'security_deposit',  valueType: 'percentage', value: 10,   vatApplicable: false, vatRate: 0, isActive: true },
  },
};

function rowsToMap(rows: FeeRuleDto[], category: FeeCategory): CategoryMap {
  const m: CategoryMap = { ...UAE_DEFAULTS[category] };
  for (const r of rows) m[r.feeType] = { ...r };
  return m;
}

function fmtN(n: number) {
  return Number(Math.round(n)).toLocaleString('en-AE');
}

/* ─────────────────────────────────────────────────────────────
   Shared components
───────────────────────────────────────────────────────────── */
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative inline-flex rounded-full transition-colors cursor-pointer flex-shrink-0 ${value ? 'bg-[#2e9f82]' : 'bg-[#c9c7c1]'}`}
      style={{ height: 22, width: 40 }}
    >
      <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform absolute top-[3px] ${value ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
    </button>
  );
}

function SaveButton({ saving, label = 'Save Changes' }: { saving: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={saving}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white cursor-pointer disabled:opacity-50 ml-auto"
      style={{ background: '#2e9f82' }}
    >
      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
      {saving ? 'Saving…' : label}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────
   Fee row (new design)
───────────────────────────────────────────────────────────── */
function FeeRow({ rule, rent, onChange, isRenewal }: {
  rule: FeeRuleDto;
  rent: number;
  onChange: (r: FeeRuleDto) => void;
  isRenewal: boolean;
}) {
  const meta     = FEE_META[rule.feeType];
  const disabled = !!meta.newOnly && isRenewal;
  const off      = !rule.isActive || disabled;

  const base   = rule.valueType === 'fixed_aed' ? rule.value : Math.round((rent * rule.value) / 100);
  const vatAmt = rule.vatApplicable ? Math.round((base * rule.vatRate) / 100) : 0;
  const total  = base + vatAmt;

  return (
    <div
      className={`grid grid-cols-1 xl:grid-cols-[minmax(220px,1fr)_auto] gap-4 py-[18px] px-6 border-b border-[#eef1ee] last:border-b-0 transition-opacity ${off ? 'opacity-[0.82]' : ''}`}
      style={off ? { background: 'repeating-linear-gradient(135deg,#fff 0 8px,#fcfcfb 8px 16px)' } : undefined}
    >
      {/* Left: toggle + name block */}
      <div className="flex gap-3.5 items-start">
        <Toggle
          value={rule.isActive && !disabled}
          onChange={v => !disabled && onChange({ ...rule, isActive: v })}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-bold text-[15px] whitespace-nowrap ${off ? 'text-[#6b7a74]' : 'text-[#0e1a16]'}`}>
              {meta.title}
            </span>
            {meta.refundable && !disabled && (
              <span className="inline-flex items-center text-[10.5px] font-bold uppercase tracking-wide text-[#1f7e66] bg-[#e7f5f0] px-2 py-0.5 rounded-full">
                Refundable
              </span>
            )}
            {!meta.refundable && (
              <span className={`inline-flex items-center text-[10.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                meta.tagStyle === 'green'
                  ? 'text-[#1f7e66] bg-[#e7f5f0] border-transparent'
                  : 'text-[#6b7a74] bg-[#f6f7f4] border-[#e6ebe7]'
              }`}>
                {meta.tag}
              </span>
            )}
            {disabled && (
              <span className="inline-flex items-center text-[10.5px] font-bold uppercase tracking-wide text-[#a85b15] bg-[#fdf3e3] px-2 py-0.5 rounded-full">
                Not applied to renewals
              </span>
            )}
          </div>
          <p className="text-[12.5px] text-[#6b7a74] mt-0.5 leading-[1.4]">
            {disabled
              ? 'Not collected on renewals — the original deposit carries forward.'
              : meta.description}
          </p>
        </div>
      </div>

      {/* Right: controls + result */}
      <div className={`flex items-center gap-4 justify-end flex-wrap xl:justify-end ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Type pill */}
          <div className="inline-flex bg-[#f6f7f4] rounded-[9px] p-[3px] border border-[#e6ebe7]">
            <button
              type="button"
              onClick={() => onChange({ ...rule, valueType: 'fixed_aed' })}
              className={`px-2.5 py-1.5 rounded-[6px] text-[12.5px] font-semibold cursor-pointer whitespace-nowrap transition-all ${
                rule.valueType === 'fixed_aed' ? 'bg-white text-[#0e1a16] shadow-sm' : 'text-[#6b7a74]'
              }`}
            >AED</button>
            <button
              type="button"
              onClick={() => onChange({ ...rule, valueType: 'percentage' })}
              className={`px-2.5 py-1.5 rounded-[6px] text-[12.5px] font-semibold cursor-pointer whitespace-nowrap transition-all ${
                rule.valueType === 'percentage' ? 'bg-white text-[#0e1a16] shadow-sm' : 'text-[#6b7a74]'
              }`}
            >% of rent</button>
          </div>

          {/* Value input */}
          <div className="inline-flex items-stretch border border-[#e6ebe7] rounded-[9px] overflow-hidden bg-white">
            {rule.valueType === 'fixed_aed' && (
              <span className="px-2.5 bg-[#f6f7f4] text-[#6b7a74] text-[12px] font-semibold flex items-center tracking-wide">AED</span>
            )}
            <input
              type="text"
              inputMode="decimal"
              value={rule.value}
              onChange={e => onChange({ ...rule, value: parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0 })}
              className="w-20 border-0 py-[7px] px-2.5 text-[14px] font-semibold outline-none text-right bg-transparent"
            />
            {rule.valueType === 'percentage' && (
              <span className="px-2.5 bg-[#f6f7f4] text-[#6b7a74] text-[12px] font-semibold flex items-center tracking-wide">%</span>
            )}
          </div>

          {/* VAT pill */}
          <div className="inline-flex bg-[#f6f7f4] rounded-[9px] p-[3px] border border-[#e6ebe7]">
            <button
              type="button"
              onClick={() => onChange({ ...rule, vatApplicable: false, vatRate: 0 })}
              className={`px-2.5 py-1.5 rounded-[6px] text-[12.5px] font-semibold cursor-pointer whitespace-nowrap transition-all ${
                !rule.vatApplicable ? 'bg-white text-[#0e1a16] shadow-sm' : 'text-[#6b7a74]'
              }`}
            >No VAT</button>
            <button
              type="button"
              onClick={() => onChange({ ...rule, vatApplicable: true, vatRate: 5 })}
              className={`px-2.5 py-1.5 rounded-[6px] text-[12.5px] font-semibold cursor-pointer whitespace-nowrap transition-all ${
                rule.vatApplicable ? 'bg-white text-[#0e1a16] shadow-sm' : 'text-[#6b7a74]'
              }`}
            >+5% VAT</button>
          </div>
        </div>

        {/* Result */}
        <div className="min-w-[110px] text-right tabular-nums">
          <div className="text-[17px] font-bold text-[#0e1a16]">
            {off ? '—' : `AED ${fmtN(total)}`}
          </div>
          <div className="text-[11px] text-[#6b7a74] mt-0.5">
            {off ? '—' : rule.valueType === 'fixed_aed'
              ? `AED ${fmtN(base)}${rule.vatApplicable ? ` + AED ${fmtN(vatAmt)} VAT` : ''}`
              : `${rule.value}% × AED ${fmtN(rent)}${rule.vatApplicable ? ` + ${rule.vatRate}% VAT` : ''}`
            }
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Fee preview panel (sticky right column)
───────────────────────────────────────────────────────────── */
function FeePreviewPanel({ rules, rent, setRent, contractType, propertyType, onSave, onLoadDefaults, saving, saved, error }: {
  rules: CategoryMap;
  rent: number;
  setRent: (v: number) => void;
  contractType: ContractType;
  propertyType: FeeCategory;
  onSave: () => void;
  onLoadDefaults: () => void;
  saving: boolean;
  saved: boolean;
  error: string | null;
}) {
  const lines = FEE_ORDER.map(ft => {
    const rule = rules[ft];
    const meta = FEE_META[ft];
    const renewalDeposit = contractType === 'renewal' && !!meta.newOnly;
    const base   = renewalDeposit || !rule.isActive ? 0 : (rule.valueType === 'fixed_aed' ? rule.value : Math.round((rent * rule.value) / 100));
    const vatAmt = (!renewalDeposit && rule.isActive && rule.vatApplicable) ? Math.round((base * rule.vatRate) / 100) : 0;
    return { ft, rule, meta, renewalDeposit, base, vatAmt, total: base + vatAmt };
  });

  const dueNow    = lines.reduce((s, l) => !l.renewalDeposit && l.rule.isActive && !l.meta.refundable ? s + l.total : s, 0);
  const refundable = lines.reduce((s, l) => !l.renewalDeposit && l.rule.isActive && !!l.meta.refundable ? s + l.total : s, 0);
  const total     = dueNow + refundable;

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <div>
      <div className="bg-white border border-[#e6ebe7] rounded-[14px] overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center px-[18px] py-3.5 border-b border-[#eef1ee]">
          <span className="font-bold text-[13px] tracking-[.04em] uppercase text-[#2b3a34]">Live preview</span>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[#1f7e66] font-semibold">
            <span className="w-[7px] h-[7px] rounded-full bg-[#2e9f82] animate-pulse" />
            Updates as you type
          </span>
        </div>

        <div className="p-[18px]">
          {/* Annual rent input */}
          <div className="mb-3.5">
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-[11.5px] font-semibold text-[#6b7a74] uppercase tracking-[.04em]">Annual rent</span>
              <span className="text-[11px] text-[#6b7a74]">of the lease being signed</span>
            </div>
            <div className="flex items-center border border-[#e6ebe7] rounded-[10px] overflow-hidden bg-white">
              <span className="px-3 bg-[#f6f7f4] text-[#6b7a74] text-[12px] font-bold tracking-[.04em]" style={{ height: 46, display: 'flex', alignItems: 'center' }}>AED</span>
              <input
                type="text"
                inputMode="numeric"
                value={rent.toLocaleString('en-US')}
                onChange={e => setRent(parseInt(e.target.value.replace(/\D/g, '')) || 0)}
                className="flex-1 border-0 px-3 text-[18px] font-bold outline-none bg-transparent tabular-nums"
                style={{ height: 46, letterSpacing: '-0.01em' }}
              />
            </div>
          </div>

          {/* Context rows */}
          <div>
            <div className="flex justify-between items-center text-[12px] py-1.5 border-b border-dashed border-[#eef1ee]">
              <span className="font-semibold text-[#2b3a34]">Contract</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${contractType === 'new' ? 'bg-[#e7f5f0] text-[#1f7e66]' : 'bg-[#0e1a16] text-white'}`}>
                {contractType === 'new' ? 'New contract' : 'Renewal'}
              </span>
            </div>
            <div className="flex justify-between items-center text-[12px] py-1.5">
              <span className="font-semibold text-[#2b3a34]">Property type</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#f6f7f4] border border-[#e6ebe7] text-[#2b3a34]">
                {cap(propertyType)}
              </span>
            </div>
          </div>

          {/* Breakdown */}
          <div className="mt-3.5 border-t border-[#eef1ee] pt-2">
            {lines.map(l => (
              <div key={l.ft} className={`grid grid-cols-[1fr_auto] gap-2.5 items-baseline py-2 tabular-nums ${l.renewalDeposit ? 'opacity-40' : ''}`}>
                <div>
                  <span className={`text-[13px] ${l.meta.refundable && !l.renewalDeposit && l.rule.isActive ? 'text-[#1f7e66]' : 'text-[#2b3a34]'}`}>
                    {l.meta.title}
                  </span>
                  {l.meta.refundable && !l.renewalDeposit && <span className="block text-[11px] text-[#6b7a74] font-medium mt-0.5">Refundable at end of contract</span>}
                  {l.renewalDeposit && <span className="block text-[11px] text-[#6b7a74] font-medium mt-0.5">Not charged on renewal</span>}
                  {!l.renewalDeposit && !l.rule.isActive && <span className="block text-[11px] text-[#6b7a74] font-medium mt-0.5">Disabled</span>}
                  {!l.renewalDeposit && l.rule.isActive && l.rule.vatApplicable && <span className="block text-[11px] text-[#6b7a74] font-medium mt-0.5">incl. {l.rule.vatRate}% VAT</span>}
                </div>
                <div className={`text-[14px] font-semibold ${l.meta.refundable && !l.renewalDeposit && l.rule.isActive ? 'text-[#1f7e66]' : 'text-[#0e1a16]'} ${l.renewalDeposit ? 'line-through' : ''}`}>
                  {l.renewalDeposit || !l.rule.isActive ? '—' : `AED ${fmtN(l.total)}`}
                </div>
              </div>
            ))}
          </div>

          {/* Total card */}
          <div className="mt-1.5 p-3.5 bg-[#e7f5f0] rounded-[10px] grid grid-cols-[1fr_auto] items-baseline gap-2.5">
            <div>
              <span className="text-[12px] font-bold uppercase tracking-[.06em] text-[#1f7e66]">Total billed to customer</span>
              <span className="block text-[11px] text-[#1f7e66] opacity-85 mt-0.5 font-medium">
                {refundable > 0 ? `Incl. AED ${fmtN(refundable)} refundable deposit` : 'No refundable amount'}
              </span>
            </div>
            <span className="text-[22px] font-extrabold text-[#1f7e66] tabular-nums" style={{ letterSpacing: '-0.015em' }}>
              AED {fmtN(total)}
            </span>
          </div>

          {/* Actions */}
          <div className="mt-3.5 grid gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="flex items-center justify-center gap-2 w-full px-3.5 py-3 rounded-[9px] text-[14px] font-semibold text-white cursor-pointer disabled:opacity-50"
              style={{ background: '#2e9f82' }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : `Save ${cap(propertyType)} · ${contractType === 'new' ? 'New' : 'Renewal'}`}
            </button>
            <button
              type="button"
              onClick={onLoadDefaults}
              className="flex items-center justify-center gap-2 w-full px-3.5 py-3 rounded-[9px] text-[14px] font-semibold border border-[#e6ebe7] text-[#0e1a16] bg-white cursor-pointer hover:border-[#0e1a16]"
            >
              <RotateCcw size={14} /> Load UAE defaults
            </button>
            {error && <p className="text-xs text-red-600 text-center">{error}</p>}
            {saved && !saving && <p className="text-xs text-[#2e9f82] text-center font-semibold">✓ Saved</p>}
          </div>
        </div>
      </div>

      {/* Help card */}
      <div className="mt-3.5 bg-white border border-[#e6ebe7] rounded-[12px] p-3.5 text-[12.5px] text-[#2b3a34] leading-[1.5]">
        <h4 className="text-[12px] uppercase tracking-[.06em] text-[#6b7a74] font-bold mb-1.5">Need help?</h4>
        These defaults reflect typical UAE practice (Ejari, agency commission, 5% VAT on services). Always verify with your accountant for jurisdiction-specific rules.
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main page
───────────────────────────────────────────────────────────── */
type MainTab = 'general' | 'fee_rules';

const EMIRATES_LIST = ['Dubai','Abu Dhabi','Sharjah','Ajman','Ras Al Khaimah','Fujairah','Umm Al Quwain'] as const;

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const [mainTab, setMainTab] = useState<MainTab>('general');

  // ── Business profile state ──────────────────────────────────
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileType, setProfileType]       = useState<'individual' | 'company'>('company');
  const [avatarPreview, setAvatarPreview]   = useState<string | null>(null);
  const avatarInputRef                      = useRef<HTMLInputElement>(null);
  // Shared editable (RP entity fields — phone/email are read-only from auth)
  const [bizEmirate, setBizEmirate]         = useState('');
  const [bizAddress, setBizAddress]         = useState('');
  const [bizDesc, setBizDesc]               = useState('');
  // Individual only
  const [ownerName, setOwnerName]           = useState('');
  const [emiratesId, setEmiratesId]         = useState('');
  const [nationality, setNationality]       = useState('');
  // Company only
  const [bizName, setBizName]               = useState('');
  const [tradeLicense, setTradeLicense]     = useState('');
  const [bizWebsite, setBizWebsite]         = useState('');
  // Company sub-type (locked in from onboarding) + agents-specific parent
  const [companyType, setCompanyType]       = useState<'landlord' | 'brokerage' | 'agents' | null>(null);
  const [parentBrokerageName, setParentBrokerageName] = useState('');
  const [savingBiz, setSavingBiz]           = useState(false);
  const [bizSaved, setBizSaved]             = useState(false);
  const [bizError, setBizError]             = useState<string | null>(null);

  // ── Contract date config ─────────────────────────────────────
  const [preferredDays,    setPreferredDays]    = useState<number[]>([]);
  const [daysSaving,       setDaysSaving]       = useState(false);
  const [daysSaved,        setDaysSaved]        = useState(false);
  const [daysError,        setDaysError]        = useState<string | null>(null);

  // ── Renewal defaults (Phase 6) ──────────────────────────────
  // Default % bump applied to the previous annual rent when proposing a
  // renewal. Pre-fills the "New Annual Rent" field on the renewal modal.
  const [renewalIncPct,    setRenewalIncPct]    = useState<string>('');
  const [renewalIncSaving, setRenewalIncSaving] = useState(false);
  const [renewalIncSaved,  setRenewalIncSaved]  = useState(false);
  const [renewalIncError,  setRenewalIncError]  = useState<string | null>(null);

  const [notifs, setNotifs] = useState<Record<NotifKey, boolean>>({
    newInquiry: true, chequeReminder: true, renewalAlert: true,
    maintenanceUpdate: false, promotional: false,
  });

  const [showInvite, setShowInvite]     = useState(false);
  const [invName, setInvName]           = useState('');
  const [invEmail, setInvEmail]         = useState('');
  const [invRole, setInvRole]           = useState('asset_manager');
  const [invNote, setInvNote]           = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  // ── Fee rules state ─────────────────────────────────────────
  const [feesLoading, setFeesLoading]   = useState(false);
  const [feeTab, setFeeTab]             = useState<FeeCategory>('residential');
  const [contractType, setContractType] = useState<ContractType>('new');
  const [allRules, setAllRules]         = useState<Record<FeeCategory, CategoryMap>>({
    residential: { ...UAE_DEFAULTS.residential },
    commercial:  { ...UAE_DEFAULTS.commercial },
    industrial:  { ...UAE_DEFAULTS.industrial },
  });
  const [previewRent, setPreviewRent]   = useState(120_000);
  const [feesSaving, setFeesSaving]     = useState(false);
  const [feesSaved, setFeesSaved]       = useState(false);
  const [feesError, setFeesError]       = useState<string | null>(null);

  // Load KYC profile on mount
  useEffect(() => {
    fetch('/api/profiles/rental-provider/me', { credentials: 'include' })
      .then(r => r.json())
      .then((data: { profile: Record<string, unknown> }) => {
        const p = data.profile;
        setProfileType((p.entityType as string) === 'company' ? 'company' : 'individual');
        setBizName((p.companyName as string) ?? '');
        setTradeLicense((p.tradeLicenseNumber as string) ?? '');
        setEmiratesId((p.emiratesIdNumber as string) ?? '');
        setNationality((p.nationality as string) ?? '');
        setOwnerName(user?.name ?? '');
        const ct = p.companyType as 'landlord' | 'brokerage' | 'agents' | null | undefined;
        if (ct) setCompanyType(ct);
        if (p.parentBrokerageName) setParentBrokerageName(p.parentBrokerageName as string);
        if (Array.isArray(p.preferredStartDays)) setPreferredDays(p.preferredStartDays as number[]);
        if (p.renewalRentIncrementPct != null) setRenewalIncPct(String(p.renewalRentIncrementPct));
        // Parse contactAddress into emirate + street
        const addr = (p.contactAddress as string) ?? '';
        const matched = EMIRATES_LIST.find(e => addr.endsWith(`, ${e}`) || addr === e);
        if (matched) {
          setBizEmirate(matched);
          setBizAddress(addr.slice(0, addr.lastIndexOf(`, ${matched}`)).trim());
        } else {
          setBizAddress(addr);
        }
      })
      .catch(() => undefined)
      .finally(() => setProfileLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mainTab !== 'fee_rules' || feesLoading) return;
    setFeesLoading(true);
    fetch('/api/fee-rules', { credentials: 'include' })
      .then(r => r.json())
      .then((data: Record<string, FeeRuleDto[]>) => {
        setAllRules({
          residential: rowsToMap(data.residential ?? [], 'residential'),
          commercial:  rowsToMap(data.commercial  ?? [], 'commercial'),
          industrial:  rowsToMap(data.industrial  ?? [], 'industrial'),
        });
      })
      .catch(() => undefined)
      .finally(() => setFeesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  const feeRules = allRules[feeTab];

  const setRule = (feeType: FeeType, r: FeeRuleDto) => {
    setAllRules(prev => ({ ...prev, [feeTab]: { ...prev[feeTab], [feeType]: r } }));
    setFeesSaved(false);
  };

  const loadDefaults = () => {
    setAllRules(prev => ({ ...prev, [feeTab]: { ...UAE_DEFAULTS[feeTab] } }));
    setFeesSaved(false);
  };

  const handleSaveFees = async () => {
    setFeesSaving(true);
    setFeesError(null);
    try {
      const res = await fetch('/api/fee-rules', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceCategory: feeTab, rules: FEE_ORDER.map(ft => feeRules[ft]) }),
      });
      if (!res.ok) throw new Error(await res.text());
      setFeesSaved(true);
    } catch {
      setFeesError('Failed to save. Please try again.');
    } finally {
      setFeesSaving(false);
    }
  };

  // ── General handlers ────────────────────────────────────────
  const handleSaveBiz = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBiz(true);
    setBizError(null);
    setBizSaved(false);
    try {
      const contactAddress = [bizAddress, bizEmirate].filter(Boolean).join(', ') || null;
      const payload: Record<string, unknown> = { entityType: profileType, contactAddress };
      if (profileType === 'company') {
        payload.companyName = bizName || null;
        payload.tradeLicenseNumber = tradeLicense || null;
        // Preserve the company sub-type + parent brokerage chosen during onboarding
        if (companyType) payload.companyType = companyType;
        if (companyType === 'agents') payload.parentBrokerageName = parentBrokerageName || null;
      } else {
        payload.emiratesIdNumber = emiratesId || null;
        payload.nationality = nationality || null;
      }
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      // Re-fetch auth session so sidebar + header reflect any name changes
      await refresh();
      setBizSaved(true);
    } catch {
      setBizError('Failed to save. Please try again.');
    } finally {
      setSavingBiz(false);
    }
  };

  const handleSaveDays = async () => {
    setDaysSaving(true);
    setDaysError(null);
    setDaysSaved(false);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredStartDays: preferredDays }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDaysSaved(true);
    } catch {
      setDaysError('Failed to save. Please try again.');
    } finally {
      setDaysSaving(false);
    }
  }

  async function saveRenewalIncrement() {
    setRenewalIncSaving(true);
    setRenewalIncError(null);
    setRenewalIncSaved(false);
    try {
      const raw = renewalIncPct.trim();
      const parsed = raw === '' ? null : Number(raw);
      if (parsed !== null && (Number.isNaN(parsed) || parsed < 0 || parsed > 100)) {
        setRenewalIncError('Enter a percentage between 0 and 100.');
        return;
      }
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renewalRentIncrementPct: parsed }),
      });
      if (!res.ok) throw new Error(await res.text());
      setRenewalIncSaved(true);
    } catch {
      setRenewalIncError('Failed to save. Please try again.');
    } finally {
      setRenewalIncSaving(false);
    }
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invName.trim() || !invEmail.trim()) return;
    setSendingInvite(true);
    await new Promise(r => setTimeout(r, 600));
    setSendingInvite(false);
    setShowInvite(false);
    setInvName(''); setInvEmail(''); setInvNote('');
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1a1916]">Settings</h1>
        <p className="text-sm text-[#6b6860] mt-0.5">Manage your business details, fee rules, and preferences.</p>
      </div>

      {/* Top-level tabs */}
      <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm border border-[#e8e6e0] mb-6 w-fit">
        <button
          onClick={() => setMainTab('general')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
            mainTab === 'general' ? 'bg-[#2e9f82] text-white' : 'text-[#6b6860] hover:bg-[#f4f3ef]'
          }`}
        >
          <Settings size={14} /> General
        </button>
        <button
          onClick={() => setMainTab('fee_rules')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
            mainTab === 'fee_rules' ? 'bg-[#2e9f82] text-white' : 'text-[#6b6860] hover:bg-[#f4f3ef]'
          }`}
        >
          <Percent size={14} /> Fee Rules
        </button>
      </div>

      {/* ── General tab ────────────────────────────────────────── */}
      {mainTab === 'general' && (
        <div className="space-y-6">
          {/* Profile */}
          <form onSubmit={handleSaveBiz} className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {profileLoading && (
              <div className="flex items-center justify-center gap-3 py-16 text-[#6b6860]">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm">Loading profile…</span>
              </div>
            )}
            {/* Cover */}
            {!profileLoading && <div className="h-24 w-full" style={{ background: 'linear-gradient(135deg, #d8f2e8 0%, #b4e4d0 100%)' }} />}

            {!profileLoading && <div className="px-6 pb-6">
              {/* Avatar + name + type toggle row */}
              <div className="flex items-end justify-between gap-4 -mt-10 mb-5 flex-wrap">
                <div className="flex items-end gap-4">
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <div
                      className="w-20 h-20 rounded-2xl border-4 border-white shadow-md flex items-center justify-center overflow-hidden"
                      style={{ background: avatarPreview ? 'transparent' : '#2e9f82' }}
                    >
                      {avatarPreview
                        ? <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" />
                        : profileType === 'company'
                          ? <Building2 size={32} className="text-white" />
                          : <User size={32} className="text-white" />
                      }
                    </div>
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white border border-[#e8e6e0] shadow flex items-center justify-center cursor-pointer hover:bg-[#f4f3ef] transition-colors"
                    >
                      <Camera size={12} className="text-[#6b6860]" />
                    </button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) setAvatarPreview(URL.createObjectURL(file));
                      }}
                    />
                  </div>
                  <div className="pb-1">
                    <p className="font-bold text-lg text-[#1a1916] leading-tight">
                      {profileType === 'company' ? (bizName || 'Your Company') : (ownerName || 'Your Name')}
                    </p>
                    <p className="text-xs text-[#9b9890]">{bizEmirate || 'UAE'}</p>
                  </div>
                </div>

                {/* Account type — locked in during onboarding, displayed read-only here */}
                {(() => {
                  const label =
                    profileType === 'individual' ? 'Individual Landlord' :
                    companyType === 'brokerage'  ? 'Brokerage Company'   :
                    companyType === 'agents'     ? 'Agents Company'      :
                                                   'Landlord Company';
                  const Ico = profileType === 'individual' ? User : Building2;
                  return (
                    <div className="inline-flex items-center gap-2 bg-[#eaf5f0] text-[#166651] px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide uppercase">
                      <Ico size={13} />
                      {label}
                      <span className="flex items-center gap-1 text-[10px] text-[#166651]/70 normal-case font-medium ml-1 pl-2 border-l border-[#166651]/20">
                        <Lock size={9} /> Set during onboarding
                      </span>
                    </div>
                  );
                })()}
              </div>

              {/* ── Individual fields ── */}
              {profileType === 'individual' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-[#6b6860] block mb-1 flex items-center gap-1">
                        Full Name <Lock size={10} className="text-[#c9c7c1]" />
                      </label>
                      <div className="relative">
                        <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c9c7c1]" />
                        <input readOnly value={user?.name ?? ''} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm bg-[#f9f8f6] text-[#9b9890] cursor-not-allowed" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[#6b6860] block mb-1">Emirates ID No.</label>
                      <div className="relative">
                        <CreditCard size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
                        <input value={emiratesId} onChange={e => setEmiratesId(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm font-mono focus:outline-none focus:border-[#2e9f82]" placeholder="784-XXXX-XXXXXXX-X" />
                      </div>
                    </div>
                  </div>
                  {/* Read-only account fields from auth */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-[#6b6860] block mb-1 flex items-center gap-1">
                        Phone <Lock size={10} className="text-[#c9c7c1]" />
                      </label>
                      <div className="relative">
                        <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c9c7c1]" />
                        <input readOnly value={user?.phone ?? ''} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm bg-[#f9f8f6] text-[#9b9890] cursor-not-allowed" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[#6b6860] block mb-1 flex items-center gap-1">
                        Email <Lock size={10} className="text-[#c9c7c1]" />
                      </label>
                      <div className="relative">
                        <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c9c7c1]" />
                        <input readOnly value={user?.email ?? ''} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm bg-[#f9f8f6] text-[#9b9890] cursor-not-allowed" />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-[#6b6860] block mb-1">Nationality</label>
                      <div className="relative">
                        <Flag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
                        <input value={nationality} onChange={e => setNationality(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="Emirati" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[#6b6860] block mb-1">Emirate</label>
                      <div className="relative">
                        <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
                        <select value={bizEmirate} onChange={e => setBizEmirate(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2e9f82] cursor-pointer">
                          <option value="">Select emirate…</option>
                          {['Dubai','Abu Dhabi','Sharjah','Ajman','Ras Al Khaimah','Fujairah','Umm Al Quwain'].map(e => <option key={e}>{e}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#6b6860] block mb-1">Address</label>
                    <div className="relative">
                      <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
                      <input value={bizAddress} onChange={e => setBizAddress(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="Building, Street, Area" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#6b6860] block mb-1">About</label>
                    <textarea value={bizDesc} onChange={e => setBizDesc(e.target.value)} rows={3} maxLength={500} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#2e9f82]" placeholder="Brief note about your portfolio, areas you manage, etc." />
                    <p className="text-right text-xs text-[#9b9890] mt-1">{bizDesc.length}/500</p>
                  </div>
                </div>
              )}

              {/* ── Company fields ── */}
              {profileType === 'company' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-[#6b6860] block mb-1">Company Name</label>
                      <div className="relative">
                        <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
                        <input value={bizName} onChange={e => setBizName(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="UpNow Real Estate LLC" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[#6b6860] block mb-1">Trade License No.</label>
                      <div className="relative">
                        <FileText size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
                        <input value={tradeLicense} onChange={e => setTradeLicense(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="DED-XXXXXXXX" />
                      </div>
                    </div>
                  </div>
                  {/* Parent brokerage — only for Agents Company */}
                  {companyType === 'agents' && (
                    <div>
                      <label className="text-xs font-medium text-[#6b6860] block mb-1">Parent Brokerage</label>
                      <div className="relative">
                        <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
                        <input
                          value={parentBrokerageName}
                          onChange={e => setParentBrokerageName(e.target.value)}
                          className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]"
                          placeholder="The brokerage you operate under"
                        />
                      </div>
                    </div>
                  )}
                  {/* Read-only account fields from auth */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-[#6b6860] block mb-1 flex items-center gap-1">
                        Phone <Lock size={10} className="text-[#c9c7c1]" />
                      </label>
                      <div className="relative">
                        <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c9c7c1]" />
                        <input readOnly value={user?.phone ?? ''} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm bg-[#f9f8f6] text-[#9b9890] cursor-not-allowed" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[#6b6860] block mb-1 flex items-center gap-1">
                        Business Email <Lock size={10} className="text-[#c9c7c1]" />
                      </label>
                      <div className="relative">
                        <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c9c7c1]" />
                        <input readOnly value={user?.email ?? ''} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm bg-[#f9f8f6] text-[#9b9890] cursor-not-allowed" />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-[#6b6860] block mb-1">Website</label>
                      <div className="relative">
                        <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
                        <input value={bizWebsite} onChange={e => setBizWebsite(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="www.company.ae" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[#6b6860] block mb-1">Emirate</label>
                      <div className="relative">
                        <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
                        <select value={bizEmirate} onChange={e => setBizEmirate(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2e9f82] cursor-pointer">
                          <option value="">Select emirate…</option>
                          {['Dubai','Abu Dhabi','Sharjah','Ajman','Ras Al Khaimah','Fujairah','Umm Al Quwain'].map(e => <option key={e}>{e}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#6b6860] block mb-1">Office Address</label>
                    <div className="relative">
                      <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
                      <input value={bizAddress} onChange={e => setBizAddress(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="Building, Street, Area" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#6b6860] block mb-1">About the Company</label>
                    <textarea value={bizDesc} onChange={e => setBizDesc(e.target.value)} rows={3} maxLength={500} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#2e9f82]" placeholder="Brief description of your company, specialisations, and areas served…" />
                    <p className="text-right text-xs text-[#9b9890] mt-1">{bizDesc.length}/500</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 mt-5 flex-wrap">
                {bizError && <p className="text-xs text-red-600 flex-1">{bizError}</p>}
                {bizSaved && !savingBiz && <p className="text-xs text-[#2e9f82] flex-1">Profile saved.</p>}
                <p className="text-xs text-[#9b9890] flex items-center gap-1">
                  <Lock size={11} /> Phone &amp; email changes require account verification.
                </p>
                <SaveButton saving={savingBiz} label="Save Profile" />
              </div>
            </div>}
          </form>

          {/* Notification Preferences */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-base text-[#1a1916] mb-4">Notification Preferences</h2>
            <div className="space-y-4">
              {NOTIF_KEYS.map(key => (
                <div key={key} className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-[#1a1916]">{NOTIF_LABELS[key].title}</p>
                    <p className="text-xs text-[#9b9890]">{NOTIF_LABELS[key].description}</p>
                  </div>
                  <Toggle value={notifs[key]} onChange={v => setNotifs(prev => ({ ...prev, [key]: v }))} />
                </div>
              ))}
            </div>
          </div>

          {/* Contract Date Configuration */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="font-semibold text-base text-[#1a1916]">Contract Start Days</h2>
              <p className="text-xs text-[#9b9890] mt-0.5">
                Select the days of the month when contracts can start. Customers will only be able to pick these days in the booking calendar. Leave empty to allow any date.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {Array.from({ length: 28 }, (_, i) => i + 1).map(day => {
                const active = preferredDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      setPreferredDays(prev =>
                        prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b),
                      );
                      setDaysSaved(false);
                    }}
                    className={`w-9 h-9 rounded-lg text-sm font-semibold border transition-colors cursor-pointer
                      ${active
                        ? 'bg-[#2e9f82] border-[#2e9f82] text-white'
                        : 'bg-white border-[#e8e6e0] text-[#6b6860] hover:border-[#2e9f82] hover:text-[#2e9f82]'}`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            {preferredDays.length > 0 && (
              <p className="text-xs text-[#2e9f82] mb-3">
                Selected: {preferredDays.map(d => `${d}${['st','nd','rd'][((d%10)-1)]||'th'}`).join(', ')} of each month
              </p>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              {daysError  && <p className="text-xs text-red-600 flex-1">{daysError}</p>}
              {daysSaved  && !daysSaving && <p className="text-xs text-[#2e9f82] flex-1">Saved.</p>}
              {preferredDays.length > 0 && (
                <button type="button" onClick={() => { setPreferredDays([]); setDaysSaved(false); }}
                  className="text-xs text-[#9b9890] hover:text-[#3d3b35] cursor-pointer">
                  Clear all
                </button>
              )}
              <SaveButton saving={daysSaving} label="Save Start Days" />
            </div>
          </div>

          {/* Team Management */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-base text-[#1a1916]">Team Management</h2>
              <button
                onClick={() => setShowInvite(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white cursor-pointer"
                style={{ background: '#2e9f82' }}
              >
                <Plus size={13} /> Invite User
              </button>
            </div>
            <p className="text-sm text-[#6b6860]">
              Manage your managers and team members from the{' '}
              <a href="/rental-provider/dashboard/team" className="text-[#2e9f82] underline">Team page</a>.
            </p>
          </div>
        </div>
      )}

      {/* ── Fee Rules tab ───────────────────────────────────────── */}
      {mainTab === 'fee_rules' && (
        <div>
          {/* Contract type switcher */}
          <div className="grid grid-cols-2 gap-2 p-1.5 bg-white border border-[#e6ebe7] rounded-[14px] mb-5">
            {([
              { value: 'new'     as ContractType, label: 'New contract',     tag: 'All fees',  desc: 'First-time lease for a unit. Includes the refundable security deposit.' },
              { value: 'renewal' as ContractType, label: 'Renewal contract', tag: 'No deposit', desc: 'Renewing an existing lease. Security deposit carries over — only fees apply.' },
            ]).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setContractType(opt.value)}
                className={`flex gap-3 items-start text-left px-4 py-3.5 rounded-[10px] cursor-pointer transition-colors ${contractType === opt.value ? 'bg-[#e7f5f0]' : 'hover:bg-[#f6f7f4]'}`}
              >
                <span className={`flex-shrink-0 w-[18px] h-[18px] rounded-full border flex items-center justify-center mt-0.5 transition-colors ${contractType === opt.value ? 'border-[#2e9f82] bg-[#2e9f82]' : 'border-[#e6ebe7] bg-white'}`}>
                  {contractType === opt.value && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                </span>
                <span>
                  <span className={`font-bold text-[14.5px] flex items-center gap-2 flex-wrap ${contractType === opt.value ? 'text-[#1f7e66]' : 'text-[#0e1a16]'}`}>
                    {opt.label}
                    <span className="text-[10.5px] font-bold uppercase tracking-[.05em] px-1.5 py-0.5 rounded-full border border-[#e6ebe7] bg-white text-[#1f7e66]">
                      {opt.tag}
                    </span>
                  </span>
                  <span className="block text-[12.5px] text-[#6b7a74] mt-0.5 leading-[1.4]">{opt.desc}</span>
                </span>
              </button>
            ))}
          </div>

          {/* Two-column layout */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_380px] gap-5 items-start">
            {/* Left: fees card */}
            <div className="bg-white border border-[#e6ebe7] rounded-[14px] overflow-hidden">
              {/* Card header */}
              <div className="flex justify-between items-center gap-4 px-6 py-[18px] border-b border-[#eef1ee] flex-wrap">
                <div>
                  <h2 className="font-bold text-[16px] text-[#0e1a16]" style={{ letterSpacing: '-0.01em' }}>
                    {contractType === 'new' ? 'New Contract Fees' : 'Renewal Contract Fees'}
                  </h2>
                  <p className="text-[13px] text-[#6b7a74] mt-0.5">Customise each fee — UpNow defaults follow standard UAE practice.</p>
                </div>
                {/* Property type segmented */}
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[13px] font-semibold text-[#2b3a34]">Property type</span>
                  <div className="inline-flex p-[3px] bg-white border border-[#e6ebe7] rounded-[10px] gap-px">
                    {FEE_CATEGORIES.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => { setFeeTab(cat); setFeesSaved(false); }}
                        className={`px-3.5 py-[7px] rounded-[7px] text-[13px] font-semibold cursor-pointer capitalize flex items-center gap-1.5 transition-all ${
                          feeTab === cat ? 'bg-[#0e1a16] text-white' : 'text-[#6b7a74] hover:text-[#0e1a16]'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full opacity-50 ${feeTab === cat ? 'bg-white' : 'bg-current'}`} />
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Renewal banner */}
              {contractType === 'renewal' && (
                <div className="mx-6 mt-3.5 flex gap-3 items-start p-3.5 rounded-[12px] border border-[#f3e1bc]" style={{ background: 'linear-gradient(180deg,#fdf3e3 0%,#fef9ec 100%)' }}>
                  <span className="flex-shrink-0 w-[22px] h-[22px] rounded-full flex items-center justify-center font-extrabold text-[12px] text-[#a85b15]" style={{ background: '#f3d08a' }}>!</span>
                  <p className="text-[13px] text-[#76480f] leading-[1.45]">
                    <strong className="text-[#5a3608]">Renewal logic:</strong> the refundable security deposit is collected once on the original contract and carries forward, so it&apos;s excluded here. Update only the fees that should re-charge on renewal.
                  </p>
                </div>
              )}

              {/* Phase 6 — Annual rent increment default. Pre-fills the New
                  Annual Rent field on the Propose Renewal modal. RP can still
                  override per renewal. Lives here (Fee Rules → Renewal) because
                  that's where every other renewal-only knob lives. */}
              {contractType === 'renewal' && (
                <div className="mx-6 mt-3.5 p-4 rounded-[12px] border border-[#e8e6e0] bg-[#fbfbf8]">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-[220px]">
                      <h3 className="text-[13px] font-semibold text-[#1a1916]">Annual rent increment</h3>
                      <p className="text-[11px] text-[#6b6860] mt-0.5 leading-snug">
                        When you open Propose Renewal, the New Annual Rent field starts at the previous rent bumped by this percentage.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <input
                          id="renewal-inc-pct"
                          type="number"
                          min={0}
                          max={100}
                          step="0.5"
                          value={renewalIncPct}
                          onChange={e => { setRenewalIncPct(e.target.value); setRenewalIncSaved(false); }}
                          placeholder="0"
                          className="w-24 text-sm pl-3 pr-8 py-2 border border-[#e8e6e0] rounded-xl bg-white focus:outline-none focus:border-[#2e9f82]"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#9b9890]">%</span>
                      </div>
                      <button
                        type="button"
                        onClick={saveRenewalIncrement}
                        disabled={renewalIncSaving}
                        className="px-3 py-2 rounded-xl text-xs font-medium text-white cursor-pointer disabled:opacity-50"
                        style={{ background: '#2e9f82' }}
                      >
                        {renewalIncSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
                    {renewalIncPct && !Number.isNaN(Number(renewalIncPct)) && Number(renewalIncPct) > 0 ? (
                      <p className="text-[11px] text-[#6b6860]">
                        Preview: AED {previewRent.toLocaleString('en-AE')} →{' '}
                        <b className="text-[#1a1916]">AED {Math.round(previewRent * (1 + Number(renewalIncPct) / 100)).toLocaleString('en-AE')}</b>
                      </p>
                    ) : <span />}
                    {renewalIncError && <p className="text-[11px] text-red-600">{renewalIncError}</p>}
                    {renewalIncSaved && !renewalIncSaving && <p className="text-[11px] text-[#2e9f82]">Saved.</p>}
                  </div>
                </div>
              )}

              {/* Fee rows */}
              {feesLoading ? (
                <div className="flex items-center gap-3 py-10 justify-center text-[#6b7a74]">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">Loading…</span>
                </div>
              ) : (
                <div className={contractType === 'renewal' ? 'mt-3.5' : ''}>
                  {FEE_ORDER.map(ft => (
                    <FeeRow
                      key={ft}
                      rule={feeRules[ft]}
                      rent={previewRent}
                      onChange={r => setRule(ft, r)}
                      isRenewal={contractType === 'renewal'}
                    />
                  ))}
                </div>
              )}

              {/* Footer */}
              <div className="flex justify-between items-center gap-3 px-6 py-3.5 border-t border-[#eef1ee] flex-wrap" style={{ background: '#fcfcfa' }}>
                <span className="text-[12px] text-[#6b7a74]">
                  Changes apply to future contracts only — existing leases are unaffected.
                </span>
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={loadDefaults}
                    className="flex items-center gap-2 px-3.5 py-2.5 rounded-[9px] text-[13.5px] font-semibold text-[#2b3a34] bg-transparent cursor-pointer hover:bg-[#f6f7f4] transition-colors"
                  >
                    <RotateCcw size={13} /> Reset to UAE defaults
                  </button>
                  <button
                    type="button"
                    disabled={feesSaving}
                    onClick={handleSaveFees}
                    className="flex items-center gap-2 px-3.5 py-2.5 rounded-[9px] text-[13.5px] font-semibold text-white cursor-pointer disabled:opacity-50"
                    style={{ background: '#2e9f82' }}
                  >
                    {feesSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    {feesSaving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            </div>

            {/* Right: preview panel */}
            <div className="xl:sticky xl:top-6">
              <FeePreviewPanel
                rules={feeRules}
                rent={previewRent}
                setRent={setPreviewRent}
                contractType={contractType}
                propertyType={feeTab}
                onSave={handleSaveFees}
                onLoadDefaults={loadDefaults}
                saving={feesSaving}
                saved={feesSaved}
                error={feesError}
              />
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowInvite(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-lg text-[#1a1916]">Invite Team Member</h3>
              <button onClick={() => setShowInvite(false)} className="cursor-pointer text-[#6b6860]"><X size={20} /></button>
            </div>
            <form onSubmit={handleSendInvite} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-[#6b6860] block mb-1">Full Name</label>
                <input value={invName} onChange={e => setInvName(e.target.value)} required className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm" placeholder="Jane Smith" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#6b6860] block mb-1">Email</label>
                <input type="email" value={invEmail} onChange={e => setInvEmail(e.target.value)} required className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm" placeholder="jane@company.ae" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#6b6860] block mb-1">Role</label>
                <select value={invRole} onChange={e => setInvRole(e.target.value)} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="asset_manager">Asset Manager</option>
                  <option value="viewing_agent">Viewing Agent</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#6b6860] block mb-1">Note (optional)</label>
                <textarea value={invNote} onChange={e => setInvNote(e.target.value)} rows={2} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm resize-none" placeholder="Responsible for Marina cluster" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowInvite(false)} className="flex-1 border border-[#e8e6e0] text-[#3d3b35] rounded-lg py-2.5 text-sm font-medium cursor-pointer hover:bg-[#f4f3ef]">Cancel</button>
                <button type="submit" disabled={sendingInvite} className="flex-1 flex items-center justify-center gap-2 text-sm text-white rounded-lg py-2.5 font-medium cursor-pointer disabled:opacity-50" style={{ background: '#2e9f82' }}>
                  {sendingInvite ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {sendingInvite ? 'Sending…' : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
