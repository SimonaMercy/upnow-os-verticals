#!/usr/bin/env python3
"""Patch the contract detail page:
1. Insert tlStages / tlCurrent component-level computation after hasDepositRecorded
2. Remove the IIFE timeline block + signing badge from the body
3. Widen the grid to 380px
4. Add Timeline card + Cheque List card to the right sidebar
"""

import re
import sys

FILE = "/Users/muhammadzeeshan/Documents/UpNow/upnow-frontend/src/app/rental-provider/dashboard/contracts/[id]/page.tsx"

with open(FILE, "r", encoding="utf-8") as f:
    src = f.read()

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 1: Insert component-level stage computation after hasDepositRecorded
# ─────────────────────────────────────────────────────────────────────────────
ANCHOR_1 = "  const hasDepositRecorded = payments.some(p => p.paymentType === 'security_deposit');\n\n  return ("

INSERTED_CONSTS = """\
  const hasDepositRecorded = payments.some(p => p.paymentType === 'security_deposit');

  // ── Contract lifecycle timeline stages ───────────────────────────────────
  const tl_s        = contract.status;
  const tl_isActive  = tl_s === 'active';
  const tl_isPending = tl_s === 'pending';
  const tl_isIssued  = tl_s === 'issued';
  const tl_isExpired = tl_s === 'expired';
  const tl_isTerm    = tl_s === 'terminated';
  const tl_hasEjari  = !!contract.ejariStatus &&
    contract.ejariStatus !== 'pending' && contract.ejariStatus !== 'not_required';
  const tl_isSigned  = !!signedMode;

  type TLStageState = 'done' | 'current' | 'upcoming';
  type TLStage = { label: string; note: string; checklist: { text: string; done: boolean }[]; state: TLStageState };

  const tlNewStages: TLStage[] = [
    { label: 'Lead & Offer', note: 'Tenant identified and offer agreed',
      checklist: [{ text: 'Tenant shortlisted', done: true }, { text: 'Offer confirmed', done: true }],
      state: 'done' },
    { label: 'Reservation', note: (hasAdminFeePaid || tl_isActive) ? 'Admin fee collected' : 'Awaiting admin fee',
      checklist: [
        { text: 'Admin fee collected', done: hasAdminFeePaid || tl_isActive },
        { text: 'Deposit received', done: hasDepositRecorded || tl_isActive },
      ],
      state: tl_isPending ? 'current' : 'done' },
    { label: 'Contract Signed', note: tl_isSigned ? 'Signed by landlord' : 'Pending signature',
      checklist: [
        { text: 'Contract issued to tenant', done: tl_isIssued || tl_isActive },
        { text: 'Landlord signed', done: tl_isSigned },
      ],
      state: !tl_isIssued && !tl_isActive ? 'upcoming' : tl_isSigned ? 'done' : 'current' },
    { label: 'Ejari Reg.', note: tl_hasEjari ? 'Registered with DLD' : 'Pending Ejari',
      checklist: [
        { text: 'Filed with DLD', done: tl_hasEjari },
        { text: 'Certificate issued', done: tl_hasEjari },
      ],
      state: !tl_isIssued && !tl_isActive ? 'upcoming' : tl_hasEjari ? 'done' : 'current' },
    { label: 'Move-In', note: tl_isActive ? 'Unit handed over' : 'Pending move-in',
      checklist: [
        { text: 'Inspection done', done: tl_isActive },
        { text: 'Keys handed over', done: tl_isActive },
      ],
      state: !tl_isActive ? 'upcoming' : 'done' },
    { label: 'Active', note: tl_isActive ? `Until ${fmtDate(contract.endDate)}` : tl_isExpired ? 'Ended' : 'Not started',
      checklist: [
        { text: 'Cheques collected', done: tl_isActive || tl_isExpired },
        { text: 'Maintenance managed', done: tl_isActive || tl_isExpired },
      ],
      state: tl_isActive ? 'current' : tl_isExpired || tl_isTerm ? 'done' : 'upcoming' },
    { label: 'Renewal/Exit', note: tl_isExpired ? 'Pending renewal/exit' : tl_isTerm ? 'Terminated' : 'Future',
      checklist: [
        { text: 'Notice issued', done: tl_isExpired || tl_isTerm },
        { text: 'Deposit settled', done: tl_isTerm },
      ],
      state: tl_isTerm ? 'done' : tl_isExpired ? 'current' : 'upcoming' },
  ];

  const tlRenewalStages: TLStage[] = [
    { label: 'Renewal Notice', note: 'Triggered 90 days before expiry',
      checklist: [{ text: 'Notice sent', done: true }, { text: 'Tenant confirmed', done: true }],
      state: 'done' },
    { label: 'Terms Agreed', note: tl_isPending ? 'Awaiting confirmation' : 'New rent agreed',
      checklist: [
        { text: 'New rent agreed', done: !tl_isPending },
        { text: 'Duration confirmed', done: !tl_isPending },
      ],
      state: tl_isPending ? 'current' : 'done' },
    { label: 'Contract Signed', note: tl_isSigned ? 'Renewal signed' : 'Pending signature',
      checklist: [
        { text: 'Renewal issued', done: tl_isIssued || tl_isActive },
        { text: 'Landlord signed', done: tl_isSigned },
      ],
      state: !tl_isIssued && !tl_isActive ? 'upcoming' : tl_isSigned ? 'done' : 'current' },
    { label: 'Ejari Updated', note: tl_hasEjari ? 'Ejari renewed' : 'Pending Ejari renewal',
      checklist: [
        { text: 'Submitted to DLD', done: tl_hasEjari },
        { text: 'New cert received', done: tl_hasEjari },
      ],
      state: !tl_isIssued && !tl_isActive ? 'upcoming' : tl_hasEjari ? 'done' : 'current' },
    { label: 'Active Renewal', note: tl_isActive ? `Until ${fmtDate(contract.endDate)}` : tl_isExpired ? 'Ended' : 'Not started',
      checklist: [
        { text: 'Cheques collected', done: tl_isActive || tl_isExpired },
        { text: 'Tenant continues', done: tl_isActive || tl_isExpired },
      ],
      state: tl_isActive ? 'current' : tl_isExpired || tl_isTerm ? 'done' : 'upcoming' },
    { label: 'Exit/Re-Renew', note: tl_isExpired ? 'Pending exit' : tl_isTerm ? 'Ended' : 'Future',
      checklist: [
        { text: 'Notice issued', done: tl_isExpired || tl_isTerm },
        { text: 'Deposit settled', done: tl_isTerm },
      ],
      state: tl_isTerm ? 'done' : tl_isExpired ? 'current' : 'upcoming' },
  ];

  const tlStages = isRenewalContract ? tlRenewalStages : tlNewStages;
  const tlCurrentIdx = tlStages.findIndex(st => st.state === 'current');
  const tlCurrent = tlStages[tlCurrentIdx]
    ?? tlStages[tlStages.findIndex(st => st.state === 'done') + 1]
    ?? tlStages[tlStages.length - 1];

  return ("""

if ANCHOR_1 not in src:
    print("ERROR: PATCH 1 anchor not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(ANCHOR_1, INSERTED_CONSTS, 1)
print("PATCH 1: OK - inserted tlStages at component level")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 2: Remove the IIFE block + signing badge, widen grid
# Strategy: find the comment that starts the IIFE, then find the grid line after.
# We'll use line-by-line processing to excise the range.
# ─────────────────────────────────────────────────────────────────────────────
lines = src.split('\n')

iife_start = None  # first line to remove
iife_end = None    # last line to remove (inclusive)
grid_line = None   # line with the grid div (to modify)

i = 0
while i < len(lines):
    line = lines[i]
    # Find the IIFE comment start
    if iife_start is None and '── Tenancy Lifecycle Timeline ──' in line and 'moved to right sidebar' in line:
        iife_start = i
    # Find the grid line after the IIFE (first grid line after iife_start)
    if iife_start is not None and iife_end is None and "grid lg:grid-cols-[1fr_320px]" in line:
        iife_end = i - 1  # just before the grid line
        grid_line = i
        break
    i += 1

if iife_start is None or iife_end is None:
    print(f"ERROR: PATCH 2 - could not find IIFE bounds. iife_start={iife_start}, iife_end={iife_end}", file=sys.stderr)
    sys.exit(1)

print(f"PATCH 2: Removing lines {iife_start}-{iife_end} (IIFE + signing badge), updating grid at line {grid_line}")

# Widen the grid
lines[grid_line] = lines[grid_line].replace("grid lg:grid-cols-[1fr_320px]", "grid lg:grid-cols-[1fr_380px]")

# Remove lines iife_start to iife_end inclusive
new_lines = lines[:iife_start] + lines[iife_end + 1:]
src = '\n'.join(new_lines)
print("PATCH 2: OK")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 3: Add Timeline card + Cheque List card to the right sidebar
# ─────────────────────────────────────────────────────────────────────────────
SIDEBAR_ANCHOR = '            {/* Contract Summary */}\n            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">'

SIDEBAR_INSERT = """\
            {/* ── Contract Activation Timeline ── */}
            <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-[#f0ede8] flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9b9890]">
                    {isRenewalContract ? 'Renewal Lifecycle' : 'New Tenancy Lifecycle'}
                  </p>
                  <p className="text-[10px] text-[#6b6860] mt-0.5">{tlCurrent.note}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    isRenewalContract ? 'bg-[#f0f4ff] border-[#c7d2fe] text-[#4338ca]' : 'bg-[#f0faf6] border-[#c5e8df] text-[#2e9f82]'
                  }`}>{isRenewalContract ? 'Renewal' : 'New'}</span>
                  {tl_isSigned && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#f0faf6] border border-[#c5e8df]">
                      <BadgeCheck size={11} className="text-[#2e9f82]" />
                      <span className="text-[10px] font-semibold text-[#2e9f82]">Signed</span>
                    </div>
                  )}
                </div>
              </div>
              {/* Vertical stepper */}
              <div className="px-4 py-3">
                {tlStages.map((step, i) => (
                  <div key={i} className="flex gap-2.5">
                    <div className="flex flex-col items-center">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 text-[10px] font-bold shrink-0 ${
                        step.state === 'done'    ? 'bg-[#2e9f82] border-[#2e9f82] text-white' :
                        step.state === 'current' ? 'bg-white border-[#2e9f82] text-[#2e9f82]' :
                                                   'bg-white border-[#e8e6e0] text-[#c0bdb8]'
                      }`}>{step.state === 'done' ? '✓' : i + 1}</div>
                      {i < tlStages.length - 1 && (
                        <div className={`w-0.5 flex-1 min-h-[18px] mt-0.5 ${step.state === 'done' ? 'bg-[#2e9f82]' : 'bg-[#e8e6e0]'}`} />
                      )}
                    </div>
                    <div className="pb-2.5 flex-1 min-w-0">
                      <p className={`text-xs font-semibold leading-tight ${
                        step.state === 'done'    ? 'text-[#2e9f82]' :
                        step.state === 'current' ? 'text-[#1a1916]' : 'text-[#c0bdb8]'
                      }`}>{step.label}</p>
                      {step.state === 'current' && (
                        <div className="mt-1 space-y-1">
                          {step.checklist.map((item, ci) => (
                            <div key={ci} className="flex items-center gap-1.5">
                              <span className={`w-3 h-3 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${item.done ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>
                                {item.done ? '✓' : '○'}
                              </span>
                              <span className={`text-[10px] leading-tight ${item.done ? 'text-[#2e9f82]' : 'text-[#9b9890]'}`}>{item.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Payment Tracker / Cheque List ── */}
            {payments.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-[#f0ede8] flex items-center gap-2">
                  <ListChecks size={14} className="text-[#9b9890]" />
                  <span className="text-xs font-bold text-[#1a1916] uppercase tracking-wide">Payment Tracker</span>
                </div>
                <div className="divide-y divide-[#f4f3ef]">
                  {payments.map((p, i) => {
                    const isReceived = !p.chequeStatus && (p.paymentMethod === 'cash' || p.paymentMethod === 'bank_transfer');
                    const statusColor =
                      p.chequeStatus === 'cleared' || isReceived ? 'bg-[#f0faf6] border-[#c5e8df] text-[#2e9f82]' :
                      p.chequeStatus === 'bounced'               ? 'bg-[#fef2f2] border-[#fecaca] text-[#dc2626]' :
                      p.chequeStatus === 'cancelled'             ? 'bg-[#f4f3ef] border-[#c8c6be] text-[#6b6860]' :
                                                                    'bg-[#fff7e6] border-[#fcd891] text-[#b45309]';
                    const statusLabel =
                      p.chequeStatus === 'cleared' || isReceived ? '✓ Received' :
                      p.chequeStatus === 'bounced'               ? '✕ Bounced' :
                      p.chequeStatus === 'cancelled'             ? 'Cancelled' :
                                                                    'Pending';
                    const typeLabel =
                      p.paymentType === 'admin_fee'        ? 'Admin Fee' :
                      p.paymentType === 'security_deposit' ? 'Security Deposit' :
                      p.paymentType === 'rental_income'    ? 'Rent' :
                      p.paymentType === 'maintenance_fee'  ? 'Maintenance' :
                      p.description ?? p.paymentType?.replace(/_/g, ' ') ?? 'Payment';
                    return (
                      <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#1a1916] truncate">{typeLabel}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <span className="text-[10px] text-[#9b9890]">{fmtAed(p.amount)}</span>
                            {p.chequeNumber && (
                              <span className="text-[10px] text-[#9b9890]">#{p.chequeNumber}</span>
                            )}
                          </div>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {/* Totals footer */}
                {(() => {
                  const collected = payments
                    .filter(p => p.chequeStatus === 'cleared' || (!p.chequeStatus && (p.paymentMethod === 'cash' || p.paymentMethod === 'bank_transfer')))
                    .reduce((a, p) => a + p.amount, 0);
                  const pending = payments
                    .filter(p => !p.chequeStatus && p.paymentMethod !== 'cash' && p.paymentMethod !== 'bank_transfer' || p.chequeStatus === 'pending')
                    .reduce((a, p) => a + p.amount, 0);
                  return (
                    <div className="px-4 py-2.5 bg-[#f7f6f2] flex justify-between">
                      <span className="text-[10px] font-semibold text-[#2e9f82]">Collected: {fmtAed(collected)}</span>
                      <span className="text-[10px] font-semibold text-[#b45309]">Pending: {fmtAed(pending)}</span>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Contract Summary */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">"""

if SIDEBAR_ANCHOR not in src:
    print("ERROR: PATCH 3 sidebar anchor not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(SIDEBAR_ANCHOR, SIDEBAR_INSERT, 1)
print("PATCH 3: OK - added Timeline + Cheque List to sidebar")

# ─────────────────────────────────────────────────────────────────────────────
# Write patched file
# ─────────────────────────────────────────────────────────────────────────────
with open(FILE, "w", encoding="utf-8") as f:
    f.write(src)

print("Done. File written successfully.")
