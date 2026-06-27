/**
 * RP Operations — the contract-setup worklist. Lists every non-ended, un-blessed
 * contract and lets the admin finish the setup steps and "Mark active" (which
 * locks the lease and moves it to the Leases register).
 *
 * Two views, switched by ?view: the default LIST (OperationsBoard) and a
 * drag-and-drop BOARD (OperationsKanban) whose columns are our real setup
 * pipeline (Signatures → KYC → Payment plan → PDC → Ejari → Utility → Move-in →
 * Ready). The List/Board toggle lives in each view's hero.
 */
'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import OperationsBoard from '@/components/upnow/OperationsBoard';
import OperationsKanban from '@/components/upnow/OperationsKanban';

const LIST_PATH = '/contracts/operations';
const contractHref = (id: number) => `/rental-provider/dashboard/operations/${id}`;

function RpOperationsInner() {
  const view = useSearchParams().get('view');
  return view === 'board'
    ? <OperationsKanban listPath={LIST_PATH} contractHref={contractHref} />
    : <OperationsBoard listPath={LIST_PATH} contractHref={contractHref} />;
}

export default function RpOperationsPage() {
  return (
    <Suspense fallback={null}>
      <RpOperationsInner />
    </Suspense>
  );
}
