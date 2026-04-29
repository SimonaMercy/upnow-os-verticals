import { Navbar } from '@/components/upnow/Navbar';
import { HeroSection } from '@/components/upnow/HeroSection';
import { ServiceCategories } from '@/components/upnow/ServiceCategories';
import { SpacesQuickEntry } from '@/components/upnow/SpacesQuickEntry';
import { HowItWorks } from '@/components/upnow/HowItWorks';
import { TrustSignals } from '@/components/upnow/TrustSignals';
import { ProviderCTA } from '@/components/upnow/ProviderCTA';
import { Footer } from '@/components/upnow/Footer';

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <HeroSection />
        <ServiceCategories />
        <SpacesQuickEntry />
        <HowItWorks />
        <TrustSignals />
        <ProviderCTA />
      </main>
      <Footer />
    </>
  );
}
