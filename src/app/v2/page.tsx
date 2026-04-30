import { Navbar } from '@/components/upnow/Navbar';
import { Footer } from '@/components/upnow/Footer';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingServices } from '@/components/landing/LandingServices';
import { LandingSpaces } from '@/components/landing/LandingSpaces';
import { LandingHow } from '@/components/landing/LandingHow';
import { LandingStats } from '@/components/landing/LandingStats';
import { LandingCTA } from '@/components/landing/LandingCTA';

export const metadata = {
  title: 'UpNow — UAE Property & Services Marketplace',
  description: 'Find and book rental spaces, home services and more across UAE.',
};

export default function LandingV2() {
  return (
    <>
      <Navbar />
      <main>
        <LandingHero />
        <LandingServices />
        <LandingSpaces />
        <LandingHow />
        <LandingStats />
        <LandingCTA />
      </main>
      <Footer />
    </>
  );
}
