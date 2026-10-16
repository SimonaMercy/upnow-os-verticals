/**
 * PROTOTYPE ONLY — UpNow OS multi-vertical demo.
 * Everything under /prototype runs on mock data held in the browser tab and
 * makes no API calls. Source lives in src/prototype/.
 *
 * Visual theme: MarketSpace provider dashboard (fonts + tokens in src/prototype/theme.css).
 */
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, DM_Serif_Display } from 'next/font/google';
import { PrototypeProvider } from '@/prototype/store';
import { PrototypeBanner, PrototypeToaster } from '@/prototype/shell';
import '@/prototype/theme.css';

const sans = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--ms-sans', display: 'swap' });
const serif = DM_Serif_Display({ subsets: ['latin'], weight: '400', variable: '--ms-serif', display: 'swap' });

export const metadata: Metadata = {
  title: 'UpNow OS — Multi-vertical prototype',
  description: 'Clickable prototype of the multi-vertical UpNow OS (mock data only).',
  robots: { index: false, follow: false },
};

export default function PrototypeLayout({ children }: { children: React.ReactNode }) {
  return (
    <PrototypeProvider>
      <div className={`ms ${sans.variable} ${serif.variable} min-h-screen`}>
        <PrototypeBanner />
        {children}
        <PrototypeToaster />
      </div>
    </PrototypeProvider>
  );
}
