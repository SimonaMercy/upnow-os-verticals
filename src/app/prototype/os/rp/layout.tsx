/**
 * PROTOTYPE bridge — every page under /prototype/os/rp is a production
 * rental-provider page (re-exported unchanged) shown inside the new OS shell
 * with real data. See src/prototype/liveBridge.tsx.
 */
import { Suspense } from 'react';
import { BridgeFrame } from '@/prototype/bridgeFrame';

export default function BridgeLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <BridgeFrame>{children}</BridgeFrame>
    </Suspense>
  );
}
