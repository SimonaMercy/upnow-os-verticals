/**
 * SP Operations — four booking pipeline trackers (Requests · Quotes · Active
 * Jobs · Closure), each a stage board, mirroring the RP /operations page. Pure
 * tracker: cards open the job's detail page where the work happens. Selected
 * tab + view persist in the URL (?tab=&view=). See SpOperationsPipelines for
 * the data + stage model.
 */
'use client';

import { Suspense } from 'react';
import SpOperationsPipelines from '@/components/upnow/SpOperationsPipelines';

export default function SpOperationsPage() {
  return (
    <Suspense fallback={null}>
      <SpOperationsPipelines />
    </Suspense>
  );
}
