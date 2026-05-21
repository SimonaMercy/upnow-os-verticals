import { HomeRedirect } from '@/components/HomeRedirect';
import { Navbar } from '@/components/upnow/Navbar';
import { HeroSection } from '@/components/upnow/HeroSection';
import { ServiceCategories } from '@/components/upnow/ServiceCategories';
import { SpacesQuickEntry } from '@/components/upnow/SpacesQuickEntry';
import { FeaturedListings } from '@/components/upnow/FeaturedListings';
import { HowItWorks } from '@/components/upnow/HowItWorks';
import { TrustSignals } from '@/components/upnow/TrustSignals';
import { ProviderCTA } from '@/components/upnow/ProviderCTA';
import { SignupChoice } from '@/components/upnow/SignupChoice';
import { Footer } from '@/components/upnow/Footer';

export default function Home() {
  return (
    <>
      <HomeRedirect />
      <Navbar />
      <main>
        <HeroSection />
        <FeaturedListings />
        <ServiceCategories />
        <SpacesQuickEntry />
        <HowItWorks />
        <TrustSignals />
        <SignupChoice />
        <ProviderCTA />
      </main>
      <Footer />
    </>
  );
}
