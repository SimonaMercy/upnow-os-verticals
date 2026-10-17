import { Suspense } from 'react';
import { HomeRedirect } from '@/components/HomeRedirect';
import { MarketplaceHome } from '@/components/marketplace/MarketplaceHome';

// The MarketSpace homepage on real data. The previous landing page
// (src/components/upnow/LandingPageV2.tsx) is kept in the repo until the owner
// signs off on the swap; restoring it is a one-line change here.
export default function Home() {
  return (
    <>
      <HomeRedirect />
      <Suspense>
        <MarketplaceHome />
      </Suspense>
    </>
  );
}
