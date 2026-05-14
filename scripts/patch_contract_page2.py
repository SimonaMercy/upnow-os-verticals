#!/usr/bin/env python3
"""
Patch 2 of contract page redesign:
1. Replace the tlStages data section with new 6-step (new) / 4-step (renewal) design
2. Replace the entire right sidebar content (remove Payment Tracker + Fee Collection,
   replace timeline card with the new actionable version)
"""
import sys, re

FILE = "/Users/muhammadzeeshan/Documents/UpNow/upnow-frontend/src/app/rental-provider/dashboard/contracts/[id]/page.tsx"

with open(FILE, "r", encoding="utf-8") as f:
    src = f.read()

# ─────────────────────────────────────────────────────────────────────────────
# PATCH A: Replace the tlStages derived-data section
# From "// ── Contract lifecycle timeline stages" to end of "tlCurrent ="
# ─────────────────────────────────────────────────────────────────────────────
OLD_STAGES_START = "  // ── Contract lifecycle timeline stages ───────────────────────────────────\n"
OLD_STAGES_END   = "    ?? tlStages[tlStages.length - 1];\n"

idx_start = src.find(OLD_STAGES_START)
idx_end   = src.find(OLD_STAGES_END, idx_start)
if idx_start == -1 or idx_end == -1:
    print(f"ERROR PATCH A: bounds not found. start={idx_start}, end={idx_end}", file=sys.stderr)
    sys.exit(1)

idx_end += len(OLD_STAGES_END)

NEW_STAGES = """\
  // ── Contract activation timeline (6-step new / 4-step renewal) ──────────
  const tl_s         = contract.status;
  const tl_isActive  = tl_s === 'active';
  const tl_isPending = tl_s === 'pending';
  const tl_isIssued  = tl_s === 'issued';
  const tl_isTerm    = tl_s === 'terminated';
  const tl_hasEjari  = !!contract.ejariStatus && contract.ejariStatus === 'registered';
  const tl_isSigned  = !!signedMode;
  const tl_isIssued_or_active = tl_isIssued || tl_isActive;

  const allPaymentsDone = hasAdminFeePaid && hasDepositRecorded && hasEjariFeePaid;
  const allSigsDone     = tl_isSigned && hasTenantSigned;

  // Step state helpers
  const st1Done = tl_isIssued_or_active;
  const st2Done = isRenewalContract ? true : allPaymentsDone;       // renewal skips payment step
  const st3Done = allSigsDone;
  const st4Done = tl_hasEjari;
  const st5Done = tl_isActive;

  type TLStep = 'done' | 'current' | 'upcoming';
  function stepState(prevDone: boolean, thisDone: boolean): TLStep {
    if (!prevDone) return 'upcoming';
    if (thisDone)  return 'done';
    return 'current';
  }

  // For the new contract: 6 steps (no renewal/exit when active)
  // For renewal: 4 steps
  const tlIsRenewal = isRenewalContract;

"""

src = src[:idx_start] + NEW_STAGES + src[idx_end:]
print("PATCH A: OK - replaced tlStages data section")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH B: Replace the entire right sidebar div contents
# (from the opening comment to just before the closing </div> of the column)
# ─────────────────────────────────────────────────────────────────────────────
OLD_SIDEBAR_START = '          {/* Right: Timeline + Summary + Financials + Fee Collection + Cheque List */}\n          <div className="space-y-4 lg:sticky lg:top-20 self-start">\n'
OLD_SIDEBAR_END   = '            {/* Created at */}\n            <p className="text-[10px] text-center text-[#b0ada8]">\n              Created {fmtDate(contract.createdAt)}\n            </p>\n          </div>'

idx_sb_start = src.find(OLD_SIDEBAR_START)
idx_sb_end   = src.find(OLD_SIDEBAR_END, idx_sb_start)
if idx_sb_start == -1 or idx_sb_end == -1:
    print(f"ERROR PATCH B: sidebar bounds not found. start={idx_sb_start}, end={idx_sb_end}", file=sys.stderr)
    sys.exit(1)
idx_sb_end += len(OLD_SIDEBAR_END)

NEW_SIDEBAR = '''\
          {/* Right column: Activation Timeline + Contract Summary */}
          <div className="space-y-4 lg:sticky lg:top-20 self-start">

            {/* ── Tenancy Activation Timeline ── */}
            <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden">
              {/* Header */}
              <div className="px-4 py-3 border-b border-[#f0ede8] flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9b9890]">
                    {tlIsRenewal ? 'Renewal Workflow' : 'Tenancy Activation'}
                  </p>
                  <p className="text-[10px] text-[#6b6860] mt-0.5">
                    {tl_isActive
                      ? `Active · ends ${fmtDate(contract.endDate)}`
                      : tl_isTerm
                        ? 'Contract terminated'
                        : 'Track & take action on each step'}
                  </p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  tl_isActive  ? 'bg-[#f0faf6] border-[#c5e8df] text-[#2e9f82]' :
                  tl_isTerm    ? 'bg-[#fef2f2] border-[#fecaca] text-[#dc2626]' :
                                  'bg-[#fff7e6] border-[#fcd891] text-[#b45309]'
                }`}>{tl_s.charAt(0).toUpperCase() + tl_s.slice(1)}</span>
              </div>

              {/* Steps */}
              <div className="px-4 pt-3 pb-2">
                {!tlIsRenewal ? (
                  /* ── NEW CONTRACT: 6 steps ── */
                  <>
                    {/* Step 1: Contract Issued */}
                    {(()=>{ const state: TLStep = stepState(true, st1Done); return (
                    <StepRow num={1} label="Contract Issued" state={state} last={false}>
                      {state === 'current' && (
                        <p className="text-[10px] text-[#9b9890] mt-0.5">Waiting for contract to be issued to tenant.</p>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 2: Payment Collection */}
                    {(()=>{ const state: TLStep = stepState(st1Done, st2Done); return (
                    <StepRow num={2} label="Payment Collection" state={state} last={false}>
                      <p className="text-[10px] text-[#9b9890] mt-0.5">Security deposit · Admin fee · Ejari fee</p>
                      {state === 'current' && (
                        <div className="mt-2 space-y-2">
                          {feeError && (
                            <div className="flex items-center gap-1.5 text-[10px] text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5 border border-red-200">
                              <AlertCircle size={11} />{feeError}
                            </div>
                          )}

                          {/* Security Deposit */}
                          {hasDepositRecorded ? (
                            <div className="flex items-center gap-1.5 text-[10px] text-[#2e9f82] font-medium">
                              <span className="w-3.5 h-3.5 rounded-full bg-[#2e9f82] text-white flex items-center justify-center text-[7px] shrink-0">✓</span>
                              Security Deposit received
                            </div>
                          ) : (
                            <div className="rounded-lg border border-[#e8e6e0] p-2.5 space-y-1.5">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-semibold text-[#1a1916]">Security Deposit</span>
                                <span className="text-[10px] text-[#9b9890]">{contract.securityDepositAmount ? fmtAed(contract.securityDepositAmount) : '—'}</span>
                              </div>
                              <select value={depositMethod} onChange={e => setDepositMethod(e.target.value as 'cheque'|'cash'|'bank_transfer')}
                                className="w-full text-[10px] px-2 py-1 border border-[#e8e6e0] rounded-md bg-white focus:border-[#2e9f82] focus:outline-none">
                                <option value="cheque">Cheque (PDC)</option>
                                <option value="cash">Cash</option>
                                <option value="bank_transfer">Bank Transfer</option>
                              </select>
                              {depositMethod === 'cheque' && (
                                <input type="text" value={depositChequeNo} onChange={e => setDepositChequeNo(e.target.value)}
                                  placeholder="Cheque no." className="w-full font-mono text-[10px] px-2 py-1 border border-[#e8e6e0] rounded-md focus:border-[#2e9f82] focus:outline-none placeholder:text-[#c0bdb8]" />
                              )}
                              <button onClick={() => recordFee('security_deposit')}
                                disabled={!!recordingFee || (depositMethod === 'cheque' && !depositChequeNo.trim())}
                                className="w-full text-[10px] font-semibold py-1.5 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50 flex items-center justify-center gap-1">
                                {recordingFee === 'security_deposit' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
                                Mark Received
                              </button>
                            </div>
                          )}

                          {/* Admin Fee */}
                          {hasAdminFeePaid ? (
                            <div className="flex items-center gap-1.5 text-[10px] text-[#2e9f82] font-medium">
                              <span className="w-3.5 h-3.5 rounded-full bg-[#2e9f82] text-white flex items-center justify-center text-[7px] shrink-0">✓</span>
                              Admin Fee collected
                            </div>
                          ) : (
                            <div className="rounded-lg border border-[#e8e6e0] p-2.5 space-y-1.5">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-semibold text-[#1a1916]">Admin Fee</span>
                                <span className="text-[10px] text-[#9b9890]">{fmtAed(contract.adminFeeFils)}</span>
                              </div>
                              <select value={adminFeeMethod} onChange={e => setAdminFeeMethod(e.target.value as 'cash'|'bank_transfer'|'cheque')}
                                className="w-full text-[10px] px-2 py-1 border border-[#e8e6e0] rounded-md bg-white focus:border-[#2e9f82] focus:outline-none">
                                <option value="cash">Cash</option>
                                <option value="bank_transfer">Bank Transfer</option>
                                <option value="cheque">Cheque</option>
                              </select>
                              {adminFeeMethod === 'cheque' && (
                                <input type="text" value={adminFeeChequeNo} onChange={e => setAdminFeeChequeNo(e.target.value)}
                                  placeholder="Cheque no." className="w-full font-mono text-[10px] px-2 py-1 border border-[#e8e6e0] rounded-md focus:border-[#2e9f82] focus:outline-none placeholder:text-[#c0bdb8]" />
                              )}
                              <button onClick={() => recordFee('admin_fee')}
                                disabled={!!recordingFee || (adminFeeMethod === 'cheque' && !adminFeeChequeNo.trim())}
                                className="w-full text-[10px] font-semibold py-1.5 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50 flex items-center justify-center gap-1">
                                {recordingFee === 'admin_fee' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
                                Mark Collected
                              </button>
                            </div>
                          )}

                          {/* Ejari Fee */}
                          {hasEjariFeePaid ? (
                            <div className="flex items-center gap-1.5 text-[10px] text-[#2e9f82] font-medium">
                              <span className="w-3.5 h-3.5 rounded-full bg-[#2e9f82] text-white flex items-center justify-center text-[7px] shrink-0">✓</span>
                              Ejari Fee collected
                            </div>
                          ) : (
                            <div className="rounded-lg border border-[#e8e6e0] p-2.5 space-y-1.5">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-semibold text-[#1a1916]">Ejari Fee</span>
                                <span className="text-[10px] text-[#9b9890]">{fmtAed(contract.ejariFeeFils)}</span>
                              </div>
                              <select value={ejariMethod} onChange={e => setEjariMethod(e.target.value as 'cash'|'bank_transfer'|'cheque')}
                                className="w-full text-[10px] px-2 py-1 border border-[#e8e6e0] rounded-md bg-white focus:border-[#2e9f82] focus:outline-none">
                                <option value="cash">Cash</option>
                                <option value="bank_transfer">Bank Transfer</option>
                                <option value="cheque">Cheque</option>
                              </select>
                              {ejariMethod === 'cheque' && (
                                <input type="text" value={ejariChequeNo} onChange={e => setEjariChequeNo(e.target.value)}
                                  placeholder="Cheque no." className="w-full font-mono text-[10px] px-2 py-1 border border-[#e8e6e0] rounded-md focus:border-[#2e9f82] focus:outline-none placeholder:text-[#c0bdb8]" />
                              )}
                              <button onClick={() => recordFee('ejari_fee')}
                                disabled={!!recordingFee || (ejariMethod === 'cheque' && !ejariChequeNo.trim())}
                                className="w-full text-[10px] font-semibold py-1.5 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50 flex items-center justify-center gap-1">
                                {recordingFee === 'ejari_fee' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
                                Mark Collected
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 3: Signatures */}
                    {(()=>{ const state: TLStep = stepState(st2Done, st3Done); return (
                    <StepRow num={3} label="Signatures" state={state} last={false}>
                      {state !== 'upcoming' && (
                        <div className="mt-1.5 space-y-1.5">
                          {/* Landlord */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${tl_isSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>{tl_isSigned ? '✓' : '○'}</span>
                              <span className="text-[10px] text-[#6b6860]">Landlord signed</span>
                            </div>
                            {!tl_isSigned && state === 'current' && (
                              <button onClick={() => setShowSignModal(true)}
                                className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-[#2e9f82] text-white hover:bg-[#27896f]">
                                Sign Now
                              </button>
                            )}
                          </div>
                          {/* Tenant */}
                          <div className="flex items-center gap-1.5">
                            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${hasTenantSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>{hasTenantSigned ? '✓' : '○'}</span>
                            <span className="text-[10px] text-[#6b6860]">Tenant signed</span>
                            {!hasTenantSigned && <span className="text-[9px] text-[#9b9890] ml-1">(tenant signs via their portal)</span>}
                          </div>
                        </div>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 4: Ejari Registration */}
                    {(()=>{ const state: TLStep = stepState(st3Done, st4Done); return (
                    <StepRow num={4} label="Ejari Registration" state={state} last={false}>
                      {state === 'current' && (
                        <div className="mt-2">
                          <p className="text-[10px] text-[#9b9890] mb-1.5">File with Dubai Land Department, then mark as registered.</p>
                          <button onClick={markEjariRegistered} disabled={markingStep === 'ejari'}
                            className="w-full text-[10px] font-semibold py-1.5 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50 flex items-center justify-center gap-1">
                            {markingStep === 'ejari' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
                            Mark Ejari Registered
                          </button>
                        </div>
                      )}
                      {state === 'done' && (
                        <p className="text-[10px] text-[#2e9f82] mt-0.5">Registered with DLD ✓</p>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 5: Move-In & DEWA */}
                    {(()=>{ const state: TLStep = stepState(st4Done, st5Done); return (
                    <StepRow num={5} label="Move-In & DEWA" state={state} last={false}>
                      {state === 'current' && (
                        <div className="mt-2 space-y-2">
                          {feeError && (
                            <div className="flex items-center gap-1.5 text-[10px] text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5 border border-red-200">
                              <AlertCircle size={11} />{feeError}
                            </div>
                          )}
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={moveInConfirmed} onChange={e => setMoveInConfirmed(e.target.checked)}
                              className="rounded border-[#c8c6be] text-[#2e9f82] focus:ring-[#2e9f82]" />
                            <span className="text-[10px] text-[#6b6860]">Move-in inspection done & keys handed over</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={dewaConfirmed} onChange={e => setDewaConfirmed(e.target.checked)}
                              className="rounded border-[#c8c6be] text-[#2e9f82] focus:ring-[#2e9f82]" />
                            <span className="text-[10px] text-[#6b6860]">DEWA account activation verified</span>
                          </label>
                          <button onClick={doActivateContract}
                            disabled={!moveInConfirmed || !dewaConfirmed || markingStep === 'activate'}
                            className="w-full text-[10px] font-semibold py-1.5 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50 flex items-center justify-center gap-1 mt-1">
                            {markingStep === 'activate' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
                            Activate Contract
                          </button>
                        </div>
                      )}
                      {state === 'done' && (
                        <p className="text-[10px] text-[#2e9f82] mt-0.5">Unit handed over · DEWA active ✓</p>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 6: Active Tenancy */}
                    {(()=>{ const state: TLStep = tl_isActive ? 'current' : 'upcoming'; return (
                    <StepRow num={6} label="Active Tenancy" state={state} last={true}>
                      {tl_isActive && (
                        <div className="mt-1">
                          <p className="text-[10px] text-[#2e9f82] font-medium">Contract is live</p>
                          <p className="text-[10px] text-[#9b9890] mt-0.5">Ends {fmtDate(contract.endDate)} · {contract.numberOfCheques ?? '—'} cheques</p>
                          <p className="text-[10px] text-[#9b9890] mt-0.5">Renewal / termination will appear here when initiated.</p>
                        </div>
                      )}
                    </StepRow>
                    );})()}
                  </>
                ) : (
                  /* ── RENEWAL CONTRACT: 4 steps ── */
                  <>
                    {/* Step 1: Terms Agreed */}
                    {(()=>{ const state: TLStep = 'done'; return (
                    <StepRow num={1} label="Renewal Terms Agreed" state={state} last={false}>
                      <p className="text-[10px] text-[#2e9f82] mt-0.5">New rent & duration confirmed ✓</p>
                    </StepRow>
                    );})()}

                    {/* Step 2: Signatures */}
                    {(()=>{ const state: TLStep = stepState(true, st3Done); return (
                    <StepRow num={2} label="Signatures" state={state} last={false}>
                      {state !== 'upcoming' && (
                        <div className="mt-1.5 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${tl_isSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>{tl_isSigned ? '✓' : '○'}</span>
                              <span className="text-[10px] text-[#6b6860]">Landlord signed</span>
                            </div>
                            {!tl_isSigned && state === 'current' && (
                              <button onClick={() => setShowSignModal(true)}
                                className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-[#2e9f82] text-white hover:bg-[#27896f]">
                                Sign Now
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${hasTenantSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>{hasTenantSigned ? '✓' : '○'}</span>
                            <span className="text-[10px] text-[#6b6860]">Tenant signed</span>
                          </div>
                        </div>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 3: Ejari Renewal */}
                    {(()=>{ const state: TLStep = stepState(st3Done, st4Done); return (
                    <StepRow num={3} label="Ejari Renewal" state={state} last={false}>
                      {state === 'current' && (
                        <div className="mt-2">
                          <button onClick={markEjariRegistered} disabled={markingStep === 'ejari'}
                            className="w-full text-[10px] font-semibold py-1.5 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50 flex items-center justify-center gap-1">
                            {markingStep === 'ejari' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
                            Mark Ejari Renewed
                          </button>
                        </div>
                      )}
                      {state === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">Ejari renewed with DLD ✓</p>}
                    </StepRow>
                    );})()}

                    {/* Step 4: Active Renewal */}
                    {(()=>{ const state: TLStep = stepState(st4Done, st5Done); return (
                    <StepRow num={4} label="Active Renewal" state={state} last={true}>
                      {tl_isActive && (
                        <div className="mt-1">
                          <p className="text-[10px] text-[#2e9f82] font-medium">Renewal is live</p>
                          <p className="text-[10px] text-[#9b9890] mt-0.5">Until {fmtDate(contract.endDate)}</p>
                          <p className="text-[10px] text-[#9b9890] mt-0.5">Termination / re-renewal will appear when initiated.</p>
                        </div>
                      )}
                      {state === 'current' && !tl_isActive && (
                        <div className="mt-2">
                          <button onClick={doActivateContract}
                            disabled={!moveInConfirmed || !dewaConfirmed || markingStep === 'activate'}
                            className="w-full text-[10px] font-semibold py-1.5 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50 flex items-center justify-center gap-1">
                            {markingStep === 'activate' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
                            Activate Renewal
                          </button>
                        </div>
                      )}
                    </StepRow>
                    );})()}
                  </>
                )}

                {/* Global error */}
                {feeError && !tl_isActive && (
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5 border border-red-200">
                    <AlertCircle size={11} />{feeError}
                  </div>
                )}
              </div>
            </div>

            {/* Contract Summary */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4" style={{ background: '#2e9f82' }}>
                <div className="flex items-center gap-2">
                  <FileText size={15} className="text-white/80" />
                  <span className="text-sm font-bold text-white">Contract Summary</span>
                </div>
                <p className="text-xs text-white/70 mt-1">{contract.ref}</p>
              </div>
              <div className="px-5 py-4 space-y-0">
                <div className="flex justify-between py-2.5 border-b border-[#f4f3ef]">
                  <span className="text-xs text-[#9b9890]">Status</span>
                  <StatusBadge status={contract.status} />
                </div>
                <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                  <span className="text-xs text-[#9b9890]">Period</span>
                  <span className="text-xs font-semibold text-[#1a1916] text-right">
                    {fmtDate(contract.startDate)}<br />→ {fmtDate(contract.endDate)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                  <span className="text-xs text-[#9b9890]">Annual Rent</span>
                  <span className="text-sm font-bold text-[#1a1916]">{fmtAed(contract.annualRent)}</span>
                </div>
                {contract.contractValue != null && (
                  <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                    <span className="text-xs text-[#9b9890]">Contract Value</span>
                    <span className="text-xs font-semibold text-[#1a1916]">{fmtAed(contract.contractValue)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                  <span className="text-xs text-[#9b9890]">Security Deposit</span>
                  <span className="text-xs font-semibold text-[#1a1916]">
                    {isRenewalContract
                      ? 'Extended from prior'
                      : contract.securityDepositAmount != null ? `${fmtAed(contract.securityDepositAmount)} (PDC)` : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                  <span className="text-xs text-[#9b9890]">Admin Fee</span>
                  <span className="text-xs font-semibold text-[#1a1916]">{fmtAed(contract.adminFeeFils)}</span>
                </div>
                <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                  <span className="text-xs text-[#9b9890]">Ejari Fee</span>
                  <span className="text-xs font-semibold text-[#1a1916]">{fmtAed(contract.ejariFeeFils)}</span>
                </div>
                {contract.numberOfCheques != null && (
                  <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                    <span className="text-xs text-[#9b9890]">No. of Cheques</span>
                    <span className="text-xs font-semibold text-[#1a1916]">{contract.numberOfCheques}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-3 pb-1">
                  <span className="text-xs font-bold text-[#6b6860]">Due at Signing <span className="font-normal text-[#9b9890] text-[10px]">(excl. PDC)</span></span>
                  <span className="text-base font-bold" style={{ color: '#2e9f82' }}>{fmtAed(totalAtSigning)}</span>
                </div>
              </div>
            </div>

            {/* Download PDF */}
            <Link
              href={`/rental-provider/dashboard/contracts/${contract.id}/print`}
              target="_blank"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] hover:border-[#c5c2bc] transition-colors bg-white"
            >
              <Download size={15} /> Download PDF
            </Link>

            {/* Created at */}
            <p className="text-[10px] text-center text-[#b0ada8]">
              Created {fmtDate(contract.createdAt)}
            </p>
          </div>'''

src = src[:idx_sb_start] + NEW_SIDEBAR + src[idx_sb_end:]
print("PATCH B: OK - replaced sidebar JSX")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH C: Add hasEjariFeePaid derived constant after hasDepositRecorded
# ─────────────────────────────────────────────────────────────────────────────
OLD_C = "  const hasDepositRecorded = payments.some(p => p.paymentType === 'security_deposit');\n"
NEW_C = (
    "  const hasDepositRecorded = payments.some(p => p.paymentType === 'security_deposit');\n"
    "  const hasEjariFeePaid = payments.some(\n"
    "    p => p.description?.toLowerCase().includes('ejari'));\n"
)
if OLD_C not in src:
    print("ERROR PATCH C: anchor not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(OLD_C, NEW_C, 1)
print("PATCH C: OK - added hasEjariFeePaid")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH D: Add StepRow helper component before the main component export
# We find "export default function ContractDetailPage"
# ─────────────────────────────────────────────────────────────────────────────
STEP_ROW_ANCHOR = "export default function ContractDetailPage"
STEP_ROW_COMPONENT = """\
// ── Reusable vertical timeline step row ──────────────────────────────────────
type TLStepState = 'done' | 'current' | 'upcoming';
function StepRow({ num, label, state, last, children }: {
  num: number; label: string; state: TLStepState; last: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 text-[10px] font-bold shrink-0 ${
          state === 'done'    ? 'bg-[#2e9f82] border-[#2e9f82] text-white' :
          state === 'current' ? 'bg-white border-[#2e9f82] text-[#2e9f82]' :
                                 'bg-white border-[#e8e6e0] text-[#c0bdb8]'
        }`}>{state === 'done' ? '✓' : num}</div>
        {!last && <div className={`w-0.5 flex-1 min-h-[16px] mt-0.5 mb-0.5 ${state === 'done' ? 'bg-[#2e9f82]' : 'bg-[#e8e6e0]'}`} />}
      </div>
      <div className={`flex-1 min-w-0 ${last ? 'pb-1' : 'pb-2.5'}`}>
        <p className={`text-xs font-semibold leading-tight ${
          state === 'done'    ? 'text-[#2e9f82]' :
          state === 'current' ? 'text-[#1a1916]' : 'text-[#c0bdb8]'
        }`}>{label}</p>
        {children}
      </div>
    </div>
  );
}

"""

if STEP_ROW_ANCHOR not in src:
    print("ERROR PATCH D: export default not found", file=sys.stderr)
    sys.exit(1)
src = src.replace(STEP_ROW_ANCHOR, STEP_ROW_COMPONENT + STEP_ROW_ANCHOR, 1)
print("PATCH D: OK - added StepRow helper component")

# Write
with open(FILE, "w", encoding="utf-8") as f:
    f.write(src)
print("Done. File written successfully.")
