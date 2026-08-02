'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { Save, Send, X, Loader2, Plus, Percent, RotateCcw, Camera, Globe, Mail, Phone, MapPin, FileText, Building2, User, Users, CreditCard, Flag, Lock, Bell, ShieldCheck } from 'lucide-react';
import { TeamPanel, PERM_GROUPS, metaDefaults } from '@/components/dashboard/rp/TeamPanel';
import { KycDocumentsPanel } from '@/components/dashboard/KycDocumentsPanel';
import { INSTALLMENT_PLANS, installmentLabel } from '@/lib/installmentPlans';
import { categoryDisplayLabel } from '@/components/upnow/PropertyFormModal';

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
type FeeType = 'ejari_fee' | 'admin_fee' | 'commission' | 'security_deposit' | 'rent_vat';
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
const FEE_CATEGORIES = ['residential', 'commercial', 'industrial', 'land', 'mixed_use'] as const;
type FeeCategory = (typeof FEE_CATEGORIES)[number];
// A mixed-use building holds BOTH residential and commercial units, so it has no
// single fee/VAT rate — each unit is priced PER UNIT against the Residential or
// Commercial rules below (resolved server-side from the unit type). There is no
// separate "Mixed-use" rate to configure, so it is not shown as its own tab. The
// type + defaults are kept only for back-compat with any rules saved before this.
const FEE_TAB_CATEGORIES = FEE_CATEGORIES.filter((c) => c !== 'mixed_use');
const FEE_ORDER: FeeType[] = ['ejari_fee', 'admin_fee', 'commission', 'security_deposit', 'rent_vat'];

const FEE_META: Record<FeeType, { title: string; description: string; tag: string; tagStyle: 'default' | 'green'; refundable?: boolean; newOnly?: boolean }> = {
  ejari_fee:        { title: 'Contract Registration Fee',        description: 'Government Contract Registration charge',          tag: 'UAE default',  tagStyle: 'green' },
  admin_fee:        { title: 'Admin Fee',         description: 'Processing fee charged by your company',        tag: 'Customisable', tagStyle: 'default' },
  commission:       { title: 'Commission',        description: 'Brokerage commission on annual contract value',  tag: 'Customisable', tagStyle: 'default' },
  security_deposit: { title: 'Security Deposit',  description: 'Refundable deposit held for contract duration',  tag: 'Refundable',   tagStyle: 'green', refundable: true, newOnly: true },
  rent_vat:         { title: 'VAT on Rent',       description: 'UAE 5% VAT on rent — exempt for residential, applies to commercial & industrial. Added to each rent cheque and tracked separately.', tag: 'Tax', tagStyle: 'default' },
};

const UAE_DEFAULTS: Record<FeeCategory, CategoryMap> = {
  residential: {
    ejari_fee:        { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 250,  vatApplicable: false, vatRate: 0, isActive: true },
    admin_fee:        { feeType: 'admin_fee',         valueType: 'fixed_aed',  value: 1000, vatApplicable: true,  vatRate: 5, isActive: true },
    commission:       { feeType: 'commission',        valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    security_deposit: { feeType: 'security_deposit',  valueType: 'percentage', value: 5,    vatApplicable: false, vatRate: 0, isActive: true },
    rent_vat:         { feeType: 'rent_vat',          valueType: 'percentage', value: 0,    vatApplicable: false, vatRate: 0, isActive: true },
  },
  commercial: {
    ejari_fee:        { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 500,  vatApplicable: false, vatRate: 0, isActive: true },
    admin_fee:        { feeType: 'admin_fee',         valueType: 'fixed_aed',  value: 2000, vatApplicable: true,  vatRate: 5, isActive: true },
    commission:       { feeType: 'commission',        valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    security_deposit: { feeType: 'security_deposit',  valueType: 'percentage', value: 10,   vatApplicable: false, vatRate: 0, isActive: true },
    rent_vat:         { feeType: 'rent_vat',          valueType: 'percentage', value: 0,    vatApplicable: true,  vatRate: 5, isActive: true },
  },
  industrial: {
    ejari_fee:        { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 500,  vatApplicable: false, vatRate: 0, isActive: true },
    admin_fee:        { feeType: 'admin_fee',         valueType: 'fixed_aed',  value: 2500, vatApplicable: true,  vatRate: 5, isActive: true },
    commission:       { feeType: 'commission',        valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    security_deposit: { feeType: 'security_deposit',  valueType: 'percentage', value: 10,   vatApplicable: false, vatRate: 0, isActive: true },
    rent_vat:         { feeType: 'rent_vat',          valueType: 'percentage', value: 0,    vatApplicable: true,  vatRate: 5, isActive: true },
  },
  // Bare land lease — no rent VAT (treated like residential for VAT). Fees mirror commercial.
  land: {
    ejari_fee:        { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 500,  vatApplicable: false, vatRate: 0, isActive: true },
    admin_fee:        { feeType: 'admin_fee',         valueType: 'fixed_aed',  value: 2000, vatApplicable: true,  vatRate: 5, isActive: true },
    commission:       { feeType: 'commission',        valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    security_deposit: { feeType: 'security_deposit',  valueType: 'percentage', value: 10,   vatApplicable: false, vatRate: 0, isActive: true },
    rent_vat:         { feeType: 'rent_vat',          valueType: 'percentage', value: 0,    vatApplicable: false, vatRate: 0, isActive: true },
  },
  // Mixed-use — mirrors commercial, incl. 5% rent VAT applicable.
  mixed_use: {
    ejari_fee:        { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 500,  vatApplicable: false, vatRate: 0, isActive: true },
    admin_fee:        { feeType: 'admin_fee',         valueType: 'fixed_aed',  value: 2000, vatApplicable: true,  vatRate: 5, isActive: true },
    commission:       { feeType: 'commission',        valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    security_deposit: { feeType: 'security_deposit',  valueType: 'percentage', value: 10,   vatApplicable: false, vatRate: 0, isActive: true },
    rent_vat:         { feeType: 'rent_vat',          valueType: 'percentage', value: 0,    vatApplicable: true,  vatRate: 5, isActive: true },
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

  // Rent VAT is special: it is the VAT itself (a % charged ON the rent), not a
  // fee that carries its own VAT. Render a focused Exempt / rate control that
  // maps to vatApplicable + vatRate (what computeFees reads on the backend).
  if (rule.feeType === 'rent_vat') {
    const on = rule.isActive && rule.vatApplicable;
    const vatOnRent = on ? Math.round((rent * rule.vatRate) / 100) : 0;
    const setOn = (v: boolean) => onChange({
      ...rule, isActive: true, valueType: 'percentage', value: 0,
      vatApplicable: v, vatRate: v ? (rule.vatRate || 5) : 0,
    });
    return (
      <div className={`grid grid-cols-1 xl:grid-cols-[minmax(220px,1fr)_auto] gap-4 py-[18px] px-6 border-b border-[#eef1ee] last:border-b-0 transition-opacity ${on ? '' : 'opacity-[0.82]'}`}
        style={on ? undefined : { background: 'repeating-linear-gradient(135deg,#fff 0 8px,#fcfcfb 8px 16px)' }}>
        <div className="flex gap-3.5 items-start">
          <Toggle value={on} onChange={setOn} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-bold text-[15px] whitespace-nowrap ${on ? 'text-[#0e1a16]' : 'text-[#6b7a74]'}`}>{meta.title}</span>
              <span className="inline-flex items-center text-[10.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border text-[#6b7a74] bg-[#f6f7f4] border-[#e6ebe7]">{meta.tag}</span>
            </div>
            <p className="text-[12.5px] text-[#6b7a74] mt-0.5 leading-[1.4]">{meta.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 justify-end flex-wrap xl:justify-end">
          <div className={`inline-flex items-stretch border border-[#e6ebe7] rounded-[9px] overflow-hidden bg-white ${on ? '' : 'opacity-40 pointer-events-none'}`}>
            <input
              type="text"
              inputMode="decimal"
              value={rule.vatRate}
              onChange={e => onChange({ ...rule, isActive: true, valueType: 'percentage', value: 0, vatApplicable: true, vatRate: parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0 })}
              className="w-16 border-0 py-[7px] px-2.5 text-[14px] font-semibold outline-none text-right bg-transparent"
            />
            <span className="px-2.5 bg-[#f6f7f4] text-[#6b7a74] text-[12px] font-semibold flex items-center tracking-wide">% of rent</span>
          </div>
          <div className="min-w-[110px] text-right tabular-nums">
            <div className="text-[17px] font-bold text-[#0e1a16]">{on ? `AED ${fmtN(vatOnRent)}` : 'Exempt'}</div>
            <div className="text-[11px] text-[#6b7a74] mt-0.5">{on ? `${rule.vatRate}% × AED ${fmtN(rent)}` : 'No VAT on rent'}</div>
          </div>
        </div>
      </div>
    );
  }

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
  // Rent VAT is recurring on each rent cheque (not a one-off upfront fee), so it
  // is configured in its own row but excluded from this upfront-cost breakdown.
  const lines = FEE_ORDER.filter(ft => ft !== 'rent_vat').map(ft => {
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

          {/* Recurring rent VAT note (charged on each rent cheque, not upfront) */}
          {rules.rent_vat?.isActive && rules.rent_vat?.vatApplicable && rules.rent_vat?.vatRate > 0 && (
            <div className="mt-1.5 p-2.5 bg-[#f6f7f4] rounded-[10px] grid grid-cols-[1fr_auto] items-baseline gap-2.5 border border-[#e6ebe7]">
              <span className="text-[12px] font-semibold text-[#2b3a34]">
                + {rules.rent_vat.vatRate}% VAT on rent
                <span className="block text-[11px] text-[#6b7a74] font-medium mt-0.5">Added to each rent cheque</span>
              </span>
              <span className="text-[14px] font-bold text-[#0e1a16] tabular-nums">
                AED {fmtN(Math.round((rent * rules.rent_vat.vatRate) / 100))}/yr
              </span>
            </div>
          )}

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
        These defaults reflect typical UAE practice (Contract Registration, agency commission, 5% VAT on services). Always verify with your accountant for jurisdiction-specific rules.
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main page
───────────────────────────────────────────────────────────── */
type MainTab = 'general' | 'fee_rules' | 'team' | 'notifications';

// POA document keys — surfaced inline in the POA card and excluded from the
// general KYC Documents card so they aren't shown twice.
const POA_DOC_KEYS = ['poa_document', 'poa_holder_emirates_id', 'poa_holder_passport', 'poa_holder_visa'];

// Default permissions pre-selected when inviting a POA holder as a manager.
// The landlord can edit every flag inline before sending.
const POA_INVITE_DEFAULTS: Record<string, boolean> = {
  ...metaDefaults,
  can_act_as_poa: true,
  can_sign_documents: true,
  can_manage_documents: true,
  can_manage_agreements: true,
};

type BankAccount = { id: string; accountName: string; bankName: string; iban: string; accountNumber: string };
const newBankAccount = (): BankAccount => ({
  id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `bank_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  accountName: '', bankName: '', iban: '', accountNumber: '',
});

const EMIRATES_LIST = ['Dubai','Abu Dhabi','Sharjah','Ajman','Ras Al Khaimah','Fujairah','Umm Al Quwain'] as const;

// ── Penalty Rules engine (SCRUM-578) ────────────────────────────────────────
// Five RP-configurable penalties (alongside the bounced-cheque rule) surfaced as
// suggested settlement deductions + cross-verify flags. Each mirrors the
// bounced-cheque rule: a toggle plus a flat AED fee and/or a % — the seeded line
// is the greater of the two. Amounts are applied literally; the % resolves
// against the contract's annual rent.
type PenaltyRuleKey =
  | 'bouncedChequePenalty'
  | 'chequeHoldPenalty'
  | 'lateRenewalPenalty'
  | 'earlyTerminationPenalty'
  | 'lateMoveoutPenalty'
  | 'unauthorizedSharingPenalty'
  | 'accessCardReplacement'
  | 'contractNameChange'
  | 'unitTransfer';

// How a rule's amount is expressed. 'aed'/'pct' map to the backend _fee/_pct
// columns; 'months' (Early Termination) and 'daily' (Late Move-out) are the
// purpose-built modes that map to _months / _daily and override _fee/_pct.
type PenaltyValueType = 'aed' | 'pct' | 'months' | 'daily';

// pctLabel = what a % is taken of (annual rent for most; the cheque's face value
// for the bounced-cheque rule). modes = the allowed value types (first is the
// default).
type PenaltyRuleCfg = {
  key: PenaltyRuleKey;
  title: string;
  description: string;
  pctLabel?: string;
  modes?: PenaltyValueType[];
};

const PENALTY_RULES: PenaltyRuleCfg[] = [
  { key: 'bouncedChequePenalty', title: 'Bounced Cheque Penalty', description: 'Charge for each bounced rent cheque. Auto-added as an editable deduction at move-out settlement.', pctLabel: '% of cheque' },
  { key: 'chequeHoldPenalty', title: 'Cheque Hold / Replacement', description: 'Charge when a rent cheque is held or replaced. Auto-fills the "Cheque replacement" fee on a contract; also an editable deduction at move-out settlement.' },
  { key: 'lateRenewalPenalty', title: 'Late Renewal', description: 'Charge when the tenant renews after the renewal window.' },
  { key: 'earlyTerminationPenalty', title: 'Early Termination', description: 'Charge when the tenant ends the lease early — typically a number of months of annual rent. Auto-added as an editable deduction at settlement.', modes: ['months', 'pct', 'aed'] },
  { key: 'lateMoveoutPenalty', title: 'Late Move-out', description: 'Charge when the tenant overstays past the lease end date — typically pro-rated per day of delay. Auto-added as an editable deduction at settlement.', modes: ['daily', 'aed', 'pct'] },
  { key: 'unauthorizedSharingPenalty', title: 'Sharing without notice / NOC', description: 'Charge when the unit is shared without notice or an NOC.' },
  { key: 'accessCardReplacement', title: 'Access Card / Remote Replacement', description: 'Charge to replace a lost or damaged access card and/or remote.' },
  { key: 'contractNameChange', title: 'Contract Name Change', description: 'Charge to change the tenant name on an existing contract.' },
  { key: 'unitTransfer', title: 'Unit Transfer', description: 'Charge to transfer a tenant to a different unit.' },
];

// A rule carries a single value + its type. The backend keeps separate
// _fee / _pct / _months / _daily columns; we map the active one and null the rest
// on save. 'daily' needs no value (computed from the overstay at settlement).
type PenaltyState = { enabled: boolean; valueType: PenaltyValueType; value: string };
const EMPTY_PENALTY: PenaltyState = { enabled: false, valueType: 'aed', value: '' };

// Pill label per mode ('pct' is overridden by cfg.pctLabel where set).
const PENALTY_MODE_LABEL: Record<PenaltyValueType, string> = {
  aed: 'Fixed',
  pct: '% of rent',
  months: 'Months of rent',
  daily: 'Daily prorate',
};
const penaltyModes = (cfg: PenaltyRuleCfg): PenaltyValueType[] => cfg.modes ?? ['aed', 'pct'];

function PenaltyRuleCard({ cfg, state, saving, saved, error, onChange, onSave }: {
  cfg: PenaltyRuleCfg;
  state: PenaltyState;
  saving: boolean;
  saved: boolean;
  error: string | null;
  onChange: (s: PenaltyState) => void;
  onSave: () => void;
}) {
  const { enabled, valueType, value } = state;
  const modes = penaltyModes(cfg);
  const modeLabel = (m: PenaltyValueType) => (m === 'pct' ? (cfg.pctLabel ?? '% of rent') : PENALTY_MODE_LABEL[m]);
  const setVal = (patch: Partial<PenaltyState>) => onChange({ ...state, ...patch });
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-semibold text-base text-[#1a1916]">{cfg.title}</h2>
          <p className="text-xs text-[#9b9890] mt-0.5">{cfg.description}</p>
        </div>
        <Toggle value={enabled} onChange={(v) => setVal({ enabled: v })} />
      </div>

      {enabled && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {/* Mode pills — one per allowed value type */}
          {modes.length > 1 && (
            <div className="inline-flex bg-[#f6f7f4] rounded-[9px] p-[3px] border border-[#e6ebe7]">
              {modes.map((m) => (
                <button key={m} type="button" onClick={() => setVal({ valueType: m })}
                  className={`px-2.5 py-1.5 rounded-[6px] text-[12.5px] font-semibold cursor-pointer whitespace-nowrap transition-all ${valueType === m ? 'bg-white text-[#0e1a16] shadow-sm' : 'text-[#6b7a74]'}`}>{modeLabel(m)}</button>
              ))}
            </div>
          )}
          {/* Value input — 'daily' is computed at settlement, so it shows a note instead */}
          {valueType === 'daily' ? (
            <p className="text-[12.5px] text-[#6b7a74] font-medium">Annual rent ÷ 365 × days overstayed, billed at move-out settlement.</p>
          ) : (
            <div className="inline-flex items-stretch border border-[#e6ebe7] rounded-[9px] overflow-hidden bg-white">
              {valueType === 'aed' && <span className="px-2.5 bg-[#f6f7f4] text-[#6b7a74] text-[12px] font-semibold flex items-center tracking-wide">AED</span>}
              <input type="text" inputMode="decimal" value={value}
                onChange={(e) => setVal({ value: e.target.value.replace(/[^0-9.]/g, '') })}
                placeholder="0"
                className="w-24 border-0 py-[7px] px-2.5 text-[14px] font-semibold outline-none text-right bg-transparent tabular-nums" />
              {valueType === 'pct' && <span className="px-2.5 bg-[#f6f7f4] text-[#6b7a74] text-[12px] font-semibold flex items-center tracking-wide">%</span>}
              {valueType === 'months' && <span className="px-2.5 bg-[#f6f7f4] text-[#6b7a74] text-[12px] font-semibold flex items-center tracking-wide">months</span>}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        {error && <p className="text-xs text-red-600 flex-1">{error}</p>}
        {saved && !saving && <p className="text-xs text-[#2e9f82] flex-1">Saved.</p>}
        <button
          type="button" onClick={onSave} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white cursor-pointer disabled:opacity-50 ml-auto"
          style={{ background: '#2e9f82' }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

const MAIN_TABS: MainTab[] = ['general', 'fee_rules', 'team', 'notifications'];

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const [mainTab, setMainTab] = useState<MainTab>('general');

  // Persist the active tab in the URL (?tab=) so it survives a page refresh and
  // stays shareable. Restore from the query param on mount (default: general).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && (MAIN_TABS as string[]).includes(t)) setMainTab(t as MainTab);
  }, []);

  // Switch tab + reflect it in the URL (replaceState — no history spam / no back-
  // button tab cycling; a refresh lands back on the same tab).
  const selectTab = (t: MainTab) => {
    setMainTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState(null, '', url.toString());
  };

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
  // Bumped after a successful profile save so the KYC documents panel re-fetches
  // its checklist — picks up POA documents the moment "POA assigned" is saved.
  const [docsReloadKey, setDocsReloadKey]   = useState(0);
  // Additional landlord-profile fields (merged from the standalone Profile page)
  const [authorizedSignatoryName, setAuthorizedSignatoryName] = useState('');
  const [legalNoticesAddress, setLegalNoticesAddress] = useState('');
  const [hasPoa, setHasPoa]                 = useState(false);
  const [poaPersonPhone, setPoaPersonPhone] = useState('');
  const [poaPersonEmail, setPoaPersonEmail] = useState('');
  // Authorized Signatory & POA — own card, own save
  const [savingPoa, setSavingPoa]           = useState(false);
  const [poaSaved, setPoaSaved]             = useState(false);
  const [poaError, setPoaError]             = useState<string | null>(null);
  const [poaInviteOpen, setPoaInviteOpen]   = useState(false);
  const [sendingPoaInvite, setSendingPoaInvite] = useState(false);
  const [poaPerms, setPoaPerms]             = useState<Record<string, boolean>>(POA_INVITE_DEFAULTS);
  const [inviteMsg, setInviteMsg]           = useState<string | null>(null);
  // Banking — own card, own save, supports multiple accounts
  const [bankAccounts, setBankAccounts]     = useState<BankAccount[]>([]);
  const [savingBank, setSavingBank]         = useState(false);
  const [bankSaved, setBankSaved]           = useState(false);
  const [bankError, setBankError]           = useState<string | null>(null);

  // ── Contract date config ─────────────────────────────────────
  const [preferredDays,    setPreferredDays]    = useState<number[]>([]);
  const [daysSaving,       setDaysSaving]       = useState(false);
  const [daysSaved,        setDaysSaved]        = useState(false);
  const [daysError,        setDaysError]        = useState<string | null>(null);
  const [chequeDays,       setChequeDays]       = useState<number[]>([]);
  const [chequeSaving,     setChequeSaving]     = useState(false);
  const [chequeSaved,      setChequeSaved]      = useState(false);
  const [chequeError,      setChequeError]      = useState<string | null>(null);

  // ── Renewal defaults (Phase 6) ──────────────────────────────
  // Default % bump applied to the previous annual rent when proposing a
  // renewal. Pre-fills the "New Annual Rent" field on the renewal modal.
  const [renewalIncPct,    setRenewalIncPct]    = useState<string>('');
  const [renewalIncSaving, setRenewalIncSaving] = useState(false);
  const [renewalIncSaved,  setRenewalIncSaved]  = useState(false);
  const [renewalIncError,  setRenewalIncError]  = useState<string | null>(null);

  // ── Penalty Rules engine (Rules, SCRUM-578) ─────────────────
  // Six configurable penalties (Bounced Cheque + five more). One save at a time
  // (savingKey/savedKey/errorKey track which card is active).
  const [penalties, setPenalties] = useState<Record<PenaltyRuleKey, PenaltyState>>(
    () => Object.fromEntries(
      PENALTY_RULES.map(cfg => [cfg.key, { ...EMPTY_PENALTY, valueType: penaltyModes(cfg)[0] }]),
    ) as Record<PenaltyRuleKey, PenaltyState>,
  );
  const [penaltySavingKey, setPenaltySavingKey] = useState<PenaltyRuleKey | null>(null);
  const [penaltySavedKey,  setPenaltySavedKey]  = useState<PenaltyRuleKey | null>(null);
  const [penaltyErrorKey,  setPenaltyErrorKey]  = useState<PenaltyRuleKey | null>(null);
  const [penaltyErrorMsg,  setPenaltyErrorMsg]  = useState<string | null>(null);

  // ── Allowed installment plans (Rules) ───────────────────────
  // Subset of [1,2,3,4,6,12] cheque counts this RP offers. Empty = all allowed.
  const [allowedInst,    setAllowedInst]    = useState<number[]>([]);
  // Rent VAT collection mode (per-RP): 'installment' (one VAT cheque per rent
  // cheque — quarterly filing) or 'annual' (one VAT cheque for the year).
  const [vatMode,   setVatMode]   = useState<'annual' | 'installment'>('installment');
  const [vatSaving, setVatSaving] = useState(false);
  const [vatSaved,  setVatSaved]  = useState(false);
  const [instSaving,     setInstSaving]     = useState(false);
  const [instSaved,      setInstSaved]      = useState(false);
  const [instError,      setInstError]      = useState<string | null>(null);

  const [notifs, setNotifs] = useState<Record<NotifKey, boolean>>({
    newInquiry: true, chequeReminder: true, renewalAlert: true,
    maintenanceUpdate: false, promotional: false,
  });

  // ── Correspondence (CC) ──────────────────────────────────────
  // Addresses copied on every customer-facing email, so the RP holds the same
  // email — same payment plan, same renewal terms — the customer received.
  // `ccDraft` is the not-yet-added text in the input.
  const [ccEmails,   setCcEmails]   = useState<string[]>([]);
  const [ccDraft,    setCcDraft]    = useState('');
  const [ccSaving,   setCcSaving]   = useState(false);
  const [ccSaved,    setCcSaved]    = useState(false);
  const [ccError,    setCcError]    = useState<string | null>(null);

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
    land:        { ...UAE_DEFAULTS.land },
    mixed_use:   { ...UAE_DEFAULTS.mixed_use },
  });
  const [previewRent, setPreviewRent]   = useState(120_000);
  const [feesSaving, setFeesSaving]     = useState(false);
  const [feesSaved, setFeesSaved]       = useState(false);
  const [feesError, setFeesError]       = useState<string | null>(null);

  // Phone lives on the auth/user record (editable here, saved via /auth/me)
  const [phone, setPhone] = useState('');

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
        setAuthorizedSignatoryName((p.authorizedSignatoryName as string) ?? '');
        setLegalNoticesAddress((p.legalNoticesAddress as string) ?? '');
        setHasPoa(Boolean(p.hasPoa));
        setPoaPersonPhone((p.poaPersonPhone as string) ?? '');
        setPoaPersonEmail((p.poaPersonEmail as string) ?? '');
        // Banking — backend returns bankAccounts (synthesised from legacy single
        // columns when needed). Fall back to an empty starter row if none.
        const accts = Array.isArray(p.bankAccounts) ? (p.bankAccounts as Array<Record<string, unknown>>) : [];
        setBankAccounts(
          accts.length
            ? accts.map(a => ({
                id: (a.id as string) || newBankAccount().id,
                accountName: (a.accountName as string) ?? '',
                bankName: (a.bankName as string) ?? '',
                iban: (a.iban as string) ?? '',
                accountNumber: (a.accountNumber as string) ?? '',
              }))
            : [],
        );
        if (Array.isArray(p.preferredStartDays)) setPreferredDays(p.preferredStartDays as number[]);
        if (Array.isArray(p.preferredChequeDays)) setChequeDays(p.preferredChequeDays as number[]);
        if (p.renewalRentIncrementPct != null) setRenewalIncPct(String(p.renewalRentIncrementPct));
        if (Array.isArray(p.ccEmails)) setCcEmails(p.ccEmails as string[]);
        // Penalty Rules engine — round-trip each rule to its stored mode. Months
        // (Early Termination) and Daily (Late Move-out) take precedence when set;
        // then % → 'pct', flat fee → 'aed'; nothing yet → the rule's default mode.
        const seedPenalty = (cfg: PenaltyRuleCfg): PenaltyState => {
          const key = cfg.key;
          const modes = penaltyModes(cfg);
          const fee = p[`${key}Fee`];
          const pct = p[`${key}Pct`];
          const months = p[`${key}Months`];
          const daily = p[`${key}Daily`];
          const enabled = Boolean(p[`${key}Enabled`]);
          if (modes.includes('months') && months != null && Number(months) > 0) {
            return { enabled, valueType: 'months', value: String(months) };
          }
          if (modes.includes('daily') && Boolean(daily)) {
            return { enabled, valueType: 'daily', value: '' };
          }
          if (pct != null && (fee == null || Number(fee) <= 0)) {
            return { enabled, valueType: 'pct', value: String(pct) };
          }
          if (fee != null) {
            return { enabled, valueType: 'aed', value: String(fee) };
          }
          return { enabled, valueType: modes[0], value: '' };
        };
        setPenalties(
          Object.fromEntries(PENALTY_RULES.map(cfg => [cfg.key, seedPenalty(cfg)])) as Record<PenaltyRuleKey, PenaltyState>,
        );
        if (Array.isArray(p.allowedInstallments)) setAllowedInst(p.allowedInstallments as number[]);
        if (p.rentVatMode === 'annual' || p.rentVatMode === 'installment') setVatMode(p.rentVatMode);
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

  // Keep the editable phone field in sync with the auth session
  useEffect(() => { setPhone(user?.phone ?? ''); }, [user?.phone]);

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
          land:        rowsToMap(data.land         ?? [], 'land'),
          mixed_use:   rowsToMap(data.mixed_use    ?? [], 'mixed_use'),
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
      // Legal notices address stays on the profile form.
      payload.legalNoticesAddress = legalNoticesAddress || null;
      // Authorized Signatory & POA are saved from their own card (handleSavePoa).
      // Banking is saved from its own card (handleSaveBank) — not here.
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      // Phone is an auth/user field (not on the RP entity) — persist it
      // separately when changed. Backend validates uniqueness and resets phone
      // verification (phoneVerified = false) on change.
      if (phone.trim() !== (user?.phone ?? '').trim()) {
        const pRes = await fetch('/api/auth/me', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone.trim() }),
        });
        if (!pRes.ok) {
          const body = await pRes.json().catch(() => ({}));
          setBizError(typeof body.message === 'string' ? body.message : 'Failed to update phone number');
          setSavingBiz(false);
          return;
        }
      }
      // Re-fetch auth session so sidebar + header reflect any name changes
      await refresh();
      setBizSaved(true);
      // Refresh the documents checklist so a POA toggle change is reflected
      setDocsReloadKey(k => k + 1);
    } catch {
      setBizError('Failed to save. Please try again.');
    } finally {
      setSavingBiz(false);
    }
  };

  const handleSaveBank = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBank(true);
    setBankError(null);
    setBankSaved(false);
    try {
      // Drop fully-empty rows so a blank starter doesn't get persisted.
      const clean = bankAccounts
        .map(b => ({
          id: b.id,
          accountName: b.accountName.trim(),
          bankName: b.bankName.trim(),
          iban: b.iban.trim(),
          accountNumber: b.accountNumber.trim() || undefined,
        }))
        .filter(b => b.accountName || b.bankName || b.iban);
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccounts: clean }),
      });
      if (!res.ok) throw new Error(await res.text());
      setBankSaved(true);
    } catch {
      setBankError('Failed to save. Please try again.');
    } finally {
      setSavingBank(false);
    }
  };

  const handleSavePoa = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPoa(true);
    setPoaError(null);
    setPoaSaved(false);
    try {
      const payload: Record<string, unknown> = {
        hasPoa,
        authorizedSignatoryName: authorizedSignatoryName || null,
        poaPersonName: authorizedSignatoryName || null,
        poaPersonPhone: hasPoa ? (poaPersonPhone || null) : null,
        poaPersonEmail: hasPoa ? (poaPersonEmail || null) : null,
      };
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setPoaSaved(true);
      // Refresh the inline POA documents (they're server-gated on hasPoa).
      setDocsReloadKey(k => k + 1);
    } catch {
      setPoaError('Failed to save. Please try again.');
    } finally {
      setSavingPoa(false);
    }
  };

  // Toggling POA persists the flag immediately so the documents checklist
  // (which the backend gates on hasPoa) populates right away — no need to hit
  // "Save" first just to see the required documents.
  const toggleHasPoa = async (v: boolean) => {
    setHasPoa(v);
    setPoaSaved(false);
    setInviteMsg(null);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasPoa: v }),
      });
      if (!res.ok) throw new Error(await res.text());
      // Refresh the inline documents panel now that the server knows hasPoa.
      setDocsReloadKey(k => k + 1);
    } catch {
      setPoaError('Could not update the Power of Attorney setting. Please try again.');
    }
  };

  // Send the POA-holder manager invite with whatever permissions the landlord
  // selected in the inline editor. Reuses the name / phone / email above.
  const handleSendPoaInvite = async () => {
    const email = poaPersonEmail.trim();
    if (!email) { setInviteMsg('Enter the POA holder’s email above first.'); return; }
    if (!Object.values(poaPerms).some(Boolean)) { setInviteMsg('Select at least one permission.'); return; }
    setSendingPoaInvite(true);
    setInviteMsg(null);
    try {
      const full = (authorizedSignatoryName.trim() || email.split('@')[0]).trim();
      const [firstName, ...rest] = full.split(/\s+/).filter(Boolean);
      const res = await fetch('/api/invitations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          firstName: firstName || 'POA',
          lastName: rest.join(' ') || undefined,
          phone: poaPersonPhone.trim() || undefined,
          role: 'manager',
          metadata: poaPerms,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setInviteMsg('Invitation sent. Once they accept, their Emirates ID, Passport & Visa appear here and on their own account — shared.');
      setPoaInviteOpen(false);
    } catch {
      setInviteMsg('Could not send the invitation. Please try again.');
    } finally {
      setSendingPoaInvite(false);
    }
  };

  const handleSaveDays = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const handleSaveChequeDays = async (e: React.FormEvent) => {
    e.preventDefault();
    setChequeSaving(true);
    setChequeError(null);
    setChequeSaved(false);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredChequeDays: chequeDays }),
      });
      if (!res.ok) throw new Error(await res.text());
      setChequeSaved(true);
    } catch {
      setChequeError('Failed to save. Please try again.');
    } finally {
      setChequeSaving(false);
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

  const updatePenalty = (key: PenaltyRuleKey, s: PenaltyState) => {
    setPenalties(prev => ({ ...prev, [key]: s }));
    setPenaltySavedKey(k => (k === key ? null : k));
    setPenaltyErrorKey(k => (k === key ? null : k));
  };

  async function savePenaltyRule(key: PenaltyRuleKey) {
    const st = penalties[key];
    const cfg = PENALTY_RULES.find(r => r.key === key)!;
    const modes = penaltyModes(cfg);
    setPenaltyErrorKey(null);
    setPenaltyErrorMsg(null);
    setPenaltySavedKey(null);
    const isDaily = st.valueType === 'daily';
    const num = st.value.trim() === '' ? null : Number(st.value);
    // 'daily' is computed at settlement and carries no configured value, so it
    // skips the amount checks and can be enabled with no number.
    if (!isDaily) {
      if (num !== null && (Number.isNaN(num) || num < 0)) {
        setPenaltyErrorKey(key); setPenaltyErrorMsg('Enter a valid amount (0 or more).'); return;
      }
      if (st.valueType === 'pct' && num !== null && num > 100) {
        setPenaltyErrorKey(key); setPenaltyErrorMsg('Enter a percentage between 0 and 100.'); return;
      }
      if (st.valueType === 'months' && num !== null && num > 12) {
        setPenaltyErrorKey(key); setPenaltyErrorMsg('Enter a number of months between 0 and 12.'); return;
      }
      if (st.enabled && (num == null || num <= 0)) {
        setPenaltyErrorKey(key); setPenaltyErrorMsg('Set an amount before enabling.'); return;
      }
    }
    // Map the single value onto the backend's _fee / _pct / _months / _daily
    // columns, nulling the inactive ones. Only send _months / _daily for rules
    // that support them (the API rejects unknown properties).
    const body: Record<string, unknown> = {
      [`${key}Enabled`]: st.enabled,
      [`${key}Fee`]: st.valueType === 'aed' ? num : null,
      [`${key}Pct`]: st.valueType === 'pct' ? num : null,
    };
    if (modes.includes('months')) body[`${key}Months`] = st.valueType === 'months' ? num : null;
    if (modes.includes('daily')) body[`${key}Daily`] = isDaily;
    setPenaltySavingKey(key);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setPenaltySavedKey(key);
    } catch {
      setPenaltyErrorKey(key); setPenaltyErrorMsg('Failed to save. Please try again.');
    } finally {
      setPenaltySavingKey(null);
    }
  }

  async function saveAllowedInstallments() {
    setInstSaving(true);
    setInstError(null);
    setInstSaved(false);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Empty selection ⇒ null ⇒ "no restriction" on the backend.
        body: JSON.stringify({ allowedInstallments: allowedInst.length ? [...allowedInst].sort((a, b) => a - b) : null }),
      });
      if (!res.ok) throw new Error(await res.text());
      setInstSaved(true);
    } catch {
      setInstError('Failed to save. Please try again.');
    } finally {
      setInstSaving(false);
    }
  }

  async function saveVatMode(next: 'annual' | 'installment') {
    setVatMode(next);
    setVatSaved(false);
    setVatSaving(true);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentVatMode: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      setVatSaved(true);
    } catch {
      /* keep the UI selection; a transient failure just won't persist */
    } finally {
      setVatSaving(false);
    }
  }

  const CC_MAX = 5;

  /** Add the drafted address as a chip. Returns the resulting list, or null if
   *  the draft was rejected (invalid, duplicate, or over the cap). */
  function addCcDraft(): string[] | null {
    const value = ccDraft.trim().toLowerCase();
    if (!value) return ccEmails;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setCcError('Enter a valid email address.');
      return null;
    }
    if (ccEmails.includes(value)) {
      setCcError('That address is already on the list.');
      return null;
    }
    if (ccEmails.length >= CC_MAX) {
      setCcError(`You can copy at most ${CC_MAX} addresses.`);
      return null;
    }
    const next = [...ccEmails, value];
    setCcEmails(next);
    setCcDraft('');
    setCcError(null);
    setCcSaved(false);
    return next;
  }

  async function saveCcEmails() {
    // Save whatever is typed but not yet added as a chip, so a half-finished
    // entry isn't silently dropped by clicking Save.
    const list = addCcDraft();
    if (list === null) return;
    setCcSaving(true);
    setCcError(null);
    setCcSaved(false);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ccEmails: list.length ? list : null }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCcSaved(true);
    } catch {
      setCcError('Failed to save. Please try again.');
    } finally {
      setCcSaving(false);
    }
  }

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
        <p className="text-sm text-[#6b6860] mt-0.5">Manage your business details, rules, and preferences.</p>
      </div>

      {/* Top-level tabs */}
      <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm border border-[#e8e6e0] mb-6 w-fit">
        <button
          onClick={() => selectTab('general')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
            mainTab === 'general' ? 'bg-[#2e9f82] text-white' : 'text-[#6b6860] hover:bg-[#f4f3ef]'
          }`}
        >
          <User size={14} /> Profile
        </button>
        <button
          onClick={() => selectTab('fee_rules')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
            mainTab === 'fee_rules' ? 'bg-[#2e9f82] text-white' : 'text-[#6b6860] hover:bg-[#f4f3ef]'
          }`}
        >
          <Percent size={14} /> Rules
        </button>
        <button
          onClick={() => selectTab('team')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
            mainTab === 'team' ? 'bg-[#2e9f82] text-white' : 'text-[#6b6860] hover:bg-[#f4f3ef]'
          }`}
        >
          <Users size={14} /> Team
        </button>
        <button
          onClick={() => selectTab('notifications')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
            mainTab === 'notifications' ? 'bg-[#2e9f82] text-white' : 'text-[#6b6860] hover:bg-[#f4f3ef]'
          }`}
        >
          <Bell size={14} /> Notifications
        </button>
      </div>

      {/* ── Team tab ───────────────────────────────────────────── */}
      {mainTab === 'team' && <TeamPanel />}

      {/* ── Notifications tab ──────────────────────────────────── */}
      {mainTab === 'notifications' && (
        <div className="space-y-6">
        {/* Correspondence — who gets copied on customer email */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-base text-[#1a1916] mb-1">Customer Correspondence</h2>
          <p className="text-xs text-[#9b9890] mb-4">
            Emails to your customers are sent by UpNow from <strong>noreply@upnow.ae</strong>. Add
            addresses here and they are copied on every email your customers receive — payment
            plans, renewal offers, contracts, settlements — so you hold exactly what they hold.
            Customers can see the CC line and reply to all.
          </p>

          <label className="block text-xs font-medium text-[#6b6860] mb-1.5">
            CC on customer emails <span className="text-[#9b9890] font-normal">(up to {CC_MAX})</span>
          </label>

          {ccEmails.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2.5">
              {ccEmails.map(addr => (
                <span
                  key={addr}
                  className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-[#e7f5f0] text-[#1f7e66] text-xs font-medium"
                >
                  {addr}
                  <button
                    type="button"
                    aria-label={`Remove ${addr}`}
                    onClick={() => { setCcEmails(ccEmails.filter(a => a !== addr)); setCcSaved(false); setCcError(null); }}
                    className="rounded-full p-0.5 hover:bg-[#c9e8dc] transition-colors cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
              <input
                type="email"
                value={ccDraft}
                onChange={e => { setCcDraft(e.target.value); setCcSaved(false); setCcError(null); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCcDraft(); }
                }}
                disabled={ccEmails.length >= CC_MAX}
                className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82] disabled:bg-[#f4f3ef] disabled:cursor-not-allowed"
                placeholder={ccEmails.length >= CC_MAX ? `Limit of ${CC_MAX} reached` : 'leasing@yourcompany.ae — press Enter to add'}
              />
            </div>
            {user?.email && !ccEmails.includes(user.email.toLowerCase()) && ccEmails.length < CC_MAX && (
              <button
                type="button"
                onClick={() => { setCcEmails([...ccEmails, user.email!.toLowerCase()]); setCcSaved(false); setCcError(null); }}
                className="px-3 py-2 rounded-lg text-sm font-semibold border border-[#e8e6e0] text-[#6b6860] hover:border-[#2e9f82] hover:text-[#2e9f82] transition-colors cursor-pointer"
              >
                Add my account email
              </button>
            )}
            <button
              type="button"
              onClick={saveCcEmails}
              disabled={ccSaving}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#2e9f82] text-white hover:bg-[#26856d] transition-colors cursor-pointer disabled:opacity-60"
            >
              {ccSaving ? 'Saving…' : 'Save'}
            </button>
          </div>

          <div className="min-h-4 mt-2">
            {ccError && <p className="text-xs text-[#c0392b]">{ccError}</p>}
            {ccSaved && !ccError && (
              <p className="text-xs text-[#2e9f82]">
                {ccEmails.length
                  ? `Saved. ${ccEmails.length === 1 ? 'This address' : 'These addresses'} will be copied on every customer email.`
                  : 'Cleared. You will no longer receive a copy of customer emails.'}
              </p>
            )}
            {!ccSaved && !ccError && !ccEmails.length && !profileLoading && (
              <p className="text-xs text-[#9b9890]">No copies — you currently do not receive the emails your customers are sent.</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-base text-[#1a1916] mb-1">Notification Preferences</h2>
          <p className="text-xs text-[#9b9890] mb-4">Choose which updates you want to be notified about.</p>
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
        </div>
      )}

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
                    companyType === 'brokerage'  ? 'Property Management'       :
                    companyType === 'agents'     ? 'Property Management Agent' :
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
                        Phone
                      </label>
                      <div className="relative">
                        <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
                        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+971 50 123 4567" className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" />
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
                        Phone
                      </label>
                      <div className="relative">
                        <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
                        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+971 50 123 4567" className="w-full border border-[#e8e6e0] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" />
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

              {/* Legal Notices Address — general profile field (Authorized
                  Signatory & POA now live in their own card below). */}
              <div className="mt-6 pt-5 border-t border-[#eef0ec]">
                <label className="text-xs font-medium text-[#6b6860] block mb-1">Legal Notices Address</label>
                <input value={legalNoticesAddress} onChange={e => { setLegalNoticesAddress(e.target.value); setBizSaved(false); }} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="Address where legal correspondence should be sent" />
              </div>

              <div className="flex items-center gap-3 mt-5 flex-wrap">
                {bizError && <p className="text-xs text-red-600 flex-1">{bizError}</p>}
                {bizSaved && !savingBiz && <p className="text-xs text-[#2e9f82] flex-1">Profile saved.</p>}
                <p className="text-xs text-[#9b9890] flex items-center gap-1">
                  <Lock size={11} /> Email changes require account verification.
                </p>
                <SaveButton saving={savingBiz} label="Save Profile" />
              </div>
            </div>}
          </form>

          {/* KYC Documents — landlord / rental-provider identity, licensing,
              banking and (when assigned) Power of Attorney documents. Reuses the
              shared KycDocumentsPanel which drives the presigned-S3 upload flow.
              Remounts via docsReloadKey after a profile save so a POA toggle is
              picked up immediately. */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#eaf5f0] flex items-center justify-center flex-shrink-0">
                <ShieldCheck size={18} className="text-[#166651]" />
              </div>
              <div>
                <h2 className="font-semibold text-base text-[#1a1916]">KYC Documents</h2>
                <p className="text-xs text-[#9b9890] mt-0.5">
                  Upload your identity and licensing documents for verification.
                  {hasPoa && ' Power of Attorney documents are attached in the Authorized Signatory & POA section below.'}
                </p>
              </div>
            </div>
            <KycDocumentsPanel
              key={docsReloadKey}
              profileApiPath="/profiles/rental-provider/me"
              ownerType="rental_provider"
              compact
              excludeKeys={POA_DOC_KEYS}
            />
          </div>

          {/* Authorized Signatory & Power of Attorney — its own card, saved
              independently. When a POA holder acts on the landlord's behalf, the
              required POA documents can be attached right here. */}
          <form onSubmit={handleSavePoa} className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#eaf5f0] flex items-center justify-center flex-shrink-0">
                <FileText size={18} className="text-[#166651]" />
              </div>
              <div className="flex-1">
                <h2 className="font-semibold text-base text-[#1a1916]">Authorized Signatory &amp; Power of Attorney</h2>
                <p className="text-xs text-[#9b9890] mt-0.5">Record who signs on your behalf and attach their Power of Attorney documents.</p>
              </div>
            </div>

            {/* Switch */}
            <div className="flex items-center justify-between gap-3 py-2.5 px-3.5 rounded-xl border border-[#e8e6e0] bg-[#fbfbf8]">
              <p className="text-sm font-medium text-[#3d3b35]">A Power of Attorney holder acts on my behalf</p>
              <Toggle value={hasPoa} onChange={toggleHasPoa} />
            </div>

            {hasPoa && (
              <div className="space-y-4 mt-4 pl-3.5 border-l-2 border-[#e7f5f0]">
                <div>
                  <label className="text-xs font-medium text-[#6b6860] block mb-1">Authorized Signatory Name</label>
                  <input value={authorizedSignatoryName} onChange={e => { setAuthorizedSignatoryName(e.target.value); setPoaSaved(false); }} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="Person who signs on your behalf" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-[#6b6860] block mb-1">POA Holder Phone</label>
                    <input value={poaPersonPhone} onChange={e => { setPoaPersonPhone(e.target.value); setPoaSaved(false); }} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="+971 50 123 4567" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#6b6860] block mb-1">POA Holder Email</label>
                    <input value={poaPersonEmail} onChange={e => { setPoaPersonEmail(e.target.value); setPoaSaved(false); }} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="signatory@example.com" />
                  </div>
                </div>

                {/* Invite the holder to act on the landlord's behalf inside the app */}
                <div className="p-4 rounded-xl border border-[#dbeee6] bg-[#f4fbf8]">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Users size={18} className="text-[#166651] mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1a1916]">Let them act on your behalf</p>
                        <p className="text-xs text-[#6b6860] mt-0.5">Invite as a manager — a popup lets you review and edit their permissions (POA pre-selected) before sending. Their ID documents stay shared.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setInviteMsg(null); setPoaInviteOpen(true); }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white cursor-pointer flex-shrink-0"
                      style={{ background: '#2e9f82' }}
                    >
                      <Send size={14} /> Invite as manager
                    </button>
                  </div>
                  {inviteMsg && <p className="text-xs text-[#166651] mt-2">{inviteMsg}</p>}
                </div>

                {/* POA documents — attached directly here */}
                <div className="pt-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#9b9890] mb-2">Required Documents</p>
                  <KycDocumentsPanel
                    key={`poa-${docsReloadKey}`}
                    profileApiPath="/profiles/rental-provider/me"
                    ownerType="rental_provider"
                    compact
                    onlyKeys={POA_DOC_KEYS}
                  />
                  <p className="text-[11px] text-[#9b9890] mt-2">The holder’s Emirates ID, Passport &amp; Visa are shared with their manager account once they’re invited and linked.</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 mt-5 flex-wrap">
              {poaError && <p className="text-xs text-red-600 flex-1">{poaError}</p>}
              {poaSaved && !savingPoa && <p className="text-xs text-[#2e9f82] flex-1">Saved.</p>}
              <SaveButton saving={savingPoa} label="Save Signatory & POA" />
            </div>
          </form>

          {/* Banking Details — its own card; a landlord may hold multiple
              accounts. Saved independently of the profile form. */}
          <form onSubmit={handleSaveBank} className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#eaf5f0] flex items-center justify-center flex-shrink-0">
                <CreditCard size={18} className="text-[#166651]" />
              </div>
              <div className="flex-1">
                <h2 className="font-semibold text-base text-[#1a1916]">Banking Details</h2>
                <p className="text-xs text-[#9b9890] mt-0.5">Accounts you collect rent into. You can add more than one — the first is treated as your primary account.</p>
              </div>
            </div>

            {bankAccounts.length === 0 && (
              <p className="text-sm text-[#9b9890] py-3">No bank accounts added yet.</p>
            )}

            <div className="space-y-3">
              {bankAccounts.map((acct, i) => {
                const update = (patch: Partial<BankAccount>) => {
                  setBankAccounts(prev => prev.map(b => b.id === acct.id ? { ...b, ...patch } : b));
                  setBankSaved(false);
                };
                return (
                  <div key={acct.id} className="rounded-xl border border-[#e8e6e0] p-4 relative">
                    <div className="flex items-center justify-between mb-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#166651]">
                        Account {i + 1}
                        {i === 0 && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#e7f5f0] text-[#1f7e66]">Primary</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => { setBankAccounts(prev => prev.filter(b => b.id !== acct.id)); setBankSaved(false); }}
                        className="text-[#9b9890] hover:text-[#b91c1c] cursor-pointer"
                        aria-label="Remove account"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-[#6b6860] block mb-1">Account Holder Name</label>
                        <input value={acct.accountName} onChange={e => update({ accountName: e.target.value })} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="Name on bank account" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-[#6b6860] block mb-1">Bank Name</label>
                        <input value={acct.bankName} onChange={e => update({ bankName: e.target.value })} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="e.g. Emirates NBD" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-[#6b6860] block mb-1">IBAN</label>
                        <input value={acct.iban} onChange={e => update({ iban: e.target.value })} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#2e9f82]" placeholder="AE07 0331 2345 6789 0123 456" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-[#6b6860] block mb-1">Account No. <span className="text-[#c9c7c1]">(optional)</span></label>
                        <input value={acct.accountNumber} onChange={e => update({ accountNumber: e.target.value })} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#2e9f82]" placeholder="1234567890" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => { setBankAccounts(prev => [...prev, newBankAccount()]); setBankSaved(false); }}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[#2e9f82] cursor-pointer hover:underline"
            >
              <Plus size={15} /> Add bank account
            </button>

            <div className="flex items-center gap-3 mt-5 flex-wrap">
              {bankError && <p className="text-xs text-red-600 flex-1">{bankError}</p>}
              {bankSaved && !savingBank && <p className="text-xs text-[#2e9f82] flex-1">Banking details saved.</p>}
              <SaveButton saving={savingBank} label="Save Banking Details" />
            </div>
          </form>

        </div>
      )}

      {/* ── Fee Rules tab ───────────────────────────────────────── */}
      {mainTab === 'fee_rules' && (
        <div>
          {/* Contract scheduling — moved from General */}
          <div className="space-y-6 mb-5">
            {/* Contract Date Configuration */}
            <form onSubmit={handleSaveDays} className="bg-white rounded-2xl p-6 shadow-sm">
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
            </form>
  
            {/* Cheque / Installment Due Days */}
            <form onSubmit={handleSaveChequeDays} className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="font-semibold text-base text-[#1a1916]">Cheque Due Days</h2>
                <p className="text-xs text-[#9b9890] mt-0.5">
                  Select the days of the month your cheque / installment payments should fall on (e.g. 1st, 10th, 25th). Auto-generated payment plans snap each recurring cheque to the nearest of these days, so collections land on a consistent day every period. Leave empty to use the contract start day.
                </p>
              </div>
  
              <div className="flex flex-wrap gap-2 mb-4">
                {Array.from({ length: 28 }, (_, i) => i + 1).map(day => {
                  const active = chequeDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => {
                        setChequeDays(prev =>
                          prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b),
                        );
                        setChequeSaved(false);
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
  
              {chequeDays.length > 0 && (
                <p className="text-xs text-[#2e9f82] mb-3">
                  Cheques due on the {chequeDays.map(d => `${d}${['st','nd','rd'][((d%10)-1)]||'th'}`).join(', ')} of each period
                </p>
              )}
  
              <div className="flex items-center gap-3 flex-wrap">
                {chequeError && <p className="text-xs text-red-600 flex-1">{chequeError}</p>}
                {chequeSaved && !chequeSaving && <p className="text-xs text-[#2e9f82] flex-1">Saved.</p>}
                {chequeDays.length > 0 && (
                  <button type="button" onClick={() => { setChequeDays([]); setChequeSaved(false); }}
                    className="text-xs text-[#9b9890] hover:text-[#3d3b35] cursor-pointer">
                    Clear all
                  </button>
                )}
                <SaveButton saving={chequeSaving} label="Save Cheque Days" />
              </div>
            </form>

            {/* Penalty & charge rules — 2 configurations per row. Early Termination
                (months of rent) and Late Move-out (daily prorate) carry purpose-built
                modes; the access-card / name-change / unit-transfer rules are flat/%. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {PENALTY_RULES.map(cfg => (
              <PenaltyRuleCard
                key={cfg.key}
                cfg={cfg}
                state={penalties[cfg.key]}
                saving={penaltySavingKey === cfg.key}
                saved={penaltySavedKey === cfg.key}
                error={penaltyErrorKey === cfg.key ? penaltyErrorMsg : null}
                onChange={(s) => updatePenalty(cfg.key, s)}
                onSave={() => savePenaltyRule(cfg.key)}
              />
            ))}
            </div>

            {/* Payment Installment Plans */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="font-semibold text-base text-[#1a1916]">Payment Installment Plans</h2>
                <p className="text-xs text-[#9b9890] mt-0.5">
                  Choose which cheque-split plans you offer. Only the selected plans appear wherever a
                  payment schedule is set up — your contract forms, the customer booking flow and the
                  public listing. Select none to allow every plan.
                </p>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                {INSTALLMENT_PLANS.map(p => {
                  const active = allowedInst.includes(p.value);
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => {
                        setAllowedInst(prev =>
                          prev.includes(p.value) ? prev.filter(v => v !== p.value) : [...prev, p.value].sort((a, b) => a - b),
                        );
                        setInstSaved(false);
                      }}
                      className={`px-3.5 py-2 rounded-lg text-sm font-semibold border transition-colors cursor-pointer
                        ${active
                          ? 'bg-[#2e9f82] border-[#2e9f82] text-white'
                          : 'bg-white border-[#e8e6e0] text-[#6b6860] hover:border-[#2e9f82] hover:text-[#2e9f82]'}`}
                    >
                      {p.value} · {p.label}
                    </button>
                  );
                })}
              </div>

              <p className={`text-xs mb-3 ${allowedInst.length ? 'text-[#2e9f82]' : 'text-[#9b9890]'}`}>
                {allowedInst.length === 0
                  ? 'All plans available — no restriction.'
                  : `Offered: ${allowedInst.map(v => installmentLabel(v)).join(', ')}.`}
              </p>

              <div className="flex items-center gap-3 flex-wrap">
                {instError && <p className="text-xs text-red-600 flex-1">{instError}</p>}
                {instSaved && !instSaving && <p className="text-xs text-[#2e9f82] flex-1">Saved.</p>}
                {allowedInst.length > 0 && (
                  <button type="button" onClick={() => { setAllowedInst([]); setInstSaved(false); }}
                    className="text-xs text-[#9b9890] hover:text-[#3d3b35] cursor-pointer">
                    Clear all
                  </button>
                )}
                <button
                  type="button" onClick={saveAllowedInstallments} disabled={instSaving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white cursor-pointer disabled:opacity-50 ml-auto"
                  style={{ background: '#2e9f82' }}
                >
                  {instSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {instSaving ? 'Saving…' : 'Save Plans'}
                </button>
              </div>
            </div>

            {/* Rent VAT collection */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="font-semibold text-base text-[#1a1916]">Rent VAT collection</h2>
                <p className="text-xs text-[#9b9890] mt-0.5">
                  How the 5% VAT on VATable (commercial / industrial) rent is collected. Rent and fee
                  cheques are always <strong>net</strong> — VAT is a separate cheque. Rent VAT follows
                  this setting; fee VAT (admin / Contract Registration / commission) is always one separate cheque.
                  Applies to new contracts and renewals; VAT-exempt (residential) leases are unaffected.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {([
                  { value: 'installment' as const, label: 'One VAT cheque per rent cheque', sub: 'Matches quarterly VAT filing' },
                  { value: 'annual'      as const, label: 'One annual VAT cheque',          sub: 'Single annual tax invoice' },
                ]).map(opt => {
                  const active = vatMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={vatSaving}
                      onClick={() => saveVatMode(opt.value)}
                      className={`px-3.5 py-2 rounded-lg text-sm font-semibold border transition-colors cursor-pointer disabled:opacity-60 text-left
                        ${active
                          ? 'bg-[#2e9f82] border-[#2e9f82] text-white'
                          : 'bg-white border-[#e8e6e0] text-[#6b6860] hover:border-[#2e9f82] hover:text-[#2e9f82]'}`}
                    >
                      {opt.label}
                      <span className={`block text-[10px] font-normal ${active ? 'text-white/80' : 'text-[#9b9890]'}`}>{opt.sub}</span>
                    </button>
                  );
                })}
              </div>
              <div className="h-4">
                {vatSaving && <p className="text-xs text-[#9b9890]">Saving…</p>}
                {vatSaved && !vatSaving && <p className="text-xs text-[#2e9f82]">Saved.</p>}
              </div>
            </div>
          </div>

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
                    {FEE_TAB_CATEGORIES.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => { setFeeTab(cat); setFeesSaved(false); }}
                        className={`px-3.5 py-[7px] rounded-[7px] text-[13px] font-semibold cursor-pointer flex items-center gap-1.5 transition-all ${
                          feeTab === cat ? 'bg-[#0e1a16] text-white' : 'text-[#6b7a74] hover:text-[#0e1a16]'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full opacity-50 ${feeTab === cat ? 'bg-white' : 'bg-current'}`} />
                        {categoryDisplayLabel(cat)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Mixed-use explainer — there is no separate mixed-use rate; a
                  mixed-use building's units are priced per unit against these
                  Residential / Commercial rules (resolved from the unit type). */}
              <div className="mx-6 mt-3.5 flex gap-3 items-start p-3.5 rounded-[12px] border border-[#dbe7e2]" style={{ background: '#f4f9f7' }}>
                <span className="flex-shrink-0 w-[22px] h-[22px] rounded-full flex items-center justify-center font-extrabold text-[12px] text-[#1f7a5e]" style={{ background: '#cdeadf' }}>i</span>
                <p className="text-[13px] text-[#2b4a40] leading-[1.45]">
                  <strong className="text-[#194437]">Mixed-use buildings</strong> use these rules per unit — a residential unit follows your <strong>Residential</strong> rates (rent VAT-exempt) and a commercial unit follows your <strong>Commercial</strong> rates (5% rent VAT). There is no separate mixed-use rate to set.
                </p>
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

      {/* POA holder invite popup — editable permissions */}
      {poaInviteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-black/40" onClick={() => setPoaInviteOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#eef0ec]">
              <h3 className="font-semibold text-base text-[#1a1916]">Invite to act as manager</h3>
              <button type="button" onClick={() => setPoaInviteOpen(false)} aria-label="Close" className="text-[#9b9890] hover:text-[#3d3b35] cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 max-h-[68vh] overflow-y-auto">
              {/* Recipient */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                <div>
                  <label className="text-xs font-medium text-[#6b6860] block mb-1">Name</label>
                  <input value={authorizedSignatoryName} onChange={e => { setAuthorizedSignatoryName(e.target.value); setPoaSaved(false); }} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="Person who signs on your behalf" />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#6b6860] block mb-1">Email</label>
                  <input value={poaPersonEmail} onChange={e => { setPoaPersonEmail(e.target.value); setPoaSaved(false); }} className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" placeholder="signatory@example.com" />
                </div>
              </div>

              {/* Permissions */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-semibold text-[#1a1916]">Permissions</p>
                <button type="button" onClick={() => setPoaPerms({ ...POA_INVITE_DEFAULTS })} className="text-[11px] text-[#2e9f82] underline cursor-pointer hover:text-[#1f7e66]">
                  Reset to POA defaults
                </button>
              </div>
              <div className="space-y-4">
                {PERM_GROUPS.map(group => (
                  <div key={group.label}>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#9b9890] mb-1.5">{group.label}</p>
                    <div className="space-y-2">
                      {group.perms.map(perm => (
                        <div key={perm.key} className="flex items-center justify-between gap-3">
                          <span className="text-[13px] text-[#3d3b35]">{perm.label}</span>
                          <Toggle value={!!poaPerms[perm.meta]} onChange={v => setPoaPerms(p => ({ ...p, [perm.meta]: v }))} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#eef0ec]">
              {inviteMsg && <p className="text-xs text-red-600 mr-auto">{inviteMsg}</p>}
              {!Object.values(poaPerms).some(Boolean) && <p className="text-[11px] text-[#9b9890] mr-auto">Select at least one permission.</p>}
              <button type="button" onClick={() => setPoaInviteOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium border border-[#e8e6e0] text-[#3d3b35] cursor-pointer hover:bg-[#f4f3ef]">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendPoaInvite}
                disabled={sendingPoaInvite || !poaPersonEmail.trim() || !Object.values(poaPerms).some(Boolean)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#2e9f82' }}
              >
                {sendingPoaInvite ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {sendingPoaInvite ? 'Sending…' : 'Send invitation'}
              </button>
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
