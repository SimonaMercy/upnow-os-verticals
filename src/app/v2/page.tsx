import { Navbar } from '@/components/upnow/Navbar';
import { Footer } from '@/components/upnow/Footer';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingMarquee } from '@/components/landing/LandingMarquee';
import { LandingServices } from '@/components/landing/LandingServices';
import { LandingBento } from '@/components/landing/LandingBento';
import { LandingSpaces } from '@/components/landing/LandingSpaces';
import { LandingHow } from '@/components/landing/LandingHow';
import { LandingTestimonials } from '@/components/landing/LandingTestimonials';
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
        <LandingMarquee />
        <LandingServices />
        <LandingBento />
        <LandingSpaces />
        <LandingHow />
        <LandingTestimonials />
        <LandingStats />
        <LandingCTA />
      </main>
      <Footer />
    </>
  );
}
