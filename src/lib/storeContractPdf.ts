/**
 * Render a react-pdf document to a PDF blob and store it as a contract document
 * (presigned PUT + Document record). Used to snapshot completed artifacts —
 * Move-in / Move-out inspection checklists and the Deposit Settlement — once,
 * so the contract documents binder shows a real stored PDF instead of
 * re-rendering the live page each time.
 */
import type { ReactElement } from 'react';
import { pdf } from '@react-pdf/renderer';
import { uploadOwnedDocument } from './uploadOwnedDocument';

export async function storeContractPdf(opts: {
  contractId: number;
  documentKey: string;   // 'move_in_report' | 'move_out_report' | 'deposit_settlement'
  category: string;      // 'inspection' | 'payment'
  displayName: string;
  element: ReactElement;
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await pdf(opts.element as any).toBlob();
  const file = new File([blob], `${opts.documentKey}.pdf`, { type: 'application/pdf' });
  await uploadOwnedDocument({
    ownerType: 'tenancy_contract',
    ownerId: opts.contractId,
    documentKey: opts.documentKey,
    category: opts.category,
    displayName: opts.displayName,
    file,
  });
}
