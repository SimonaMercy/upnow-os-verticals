import Link from 'next/link';

const LinkedInIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
    <rect x="2" y="9" width="4" height="12"/>
    <circle cx="4" cy="4" r="2"/>
  </svg>
);

const InstagramIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
  </svg>
);

const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

// SERVICES + SPACES mirror the real catalog codes the landing rails use
// (GET /api/catalog/public + SPACE_CAT_DEFS). Links to pages that are not yet
// built point to '#' rather than a dead route.
const cols = [
  {
    label: 'SERVICES',
    links: [
      { text: 'Home Cleaning', href: '/services?category=home_cleaning' },
      { text: 'AC Services',   href: '/services?category=ac_services' },
      { text: 'Plumbing',      href: '/services?category=plumbing' },
      { text: 'Electrical',    href: '/services?category=electrical' },
      { text: 'Handyman',      href: '/services?category=handyman' },
      { text: 'View all services →', href: '/services' },
    ],
  },
  {
    label: 'SPACES',
    links: [
      { text: 'Residential', href: '/listings?category=residential' },
      { text: 'Commercial',  href: '/listings?category=commercial' },
      { text: 'Industrial',  href: '/listings?category=industrial' },
      { text: 'Land',        href: '/listings?category=land' },
      { text: 'Mixed-use',   href: '/listings?category=mixed_use' },
      { text: 'View all spaces →', href: '/listings' },
    ],
  },
  {
    label: 'PROVIDERS',
    links: [
      { text: 'Provider Login',            href: '/login' },
      { text: 'Become a Service Provider', href: '/register/service-provider' },
      { text: 'Become a Space Provider',   href: '/register/rental-provider' },
    ],
  },
  {
    label: 'COMPANY',
    links: [
      { text: 'About',            href: '#' },
      { text: 'Help Center',      href: '#' },
      { text: 'Contact',          href: '#' },
      { text: 'Terms of Service', href: '#' },
      { text: 'Privacy Policy',   href: '#' },
    ],
  },
];

const socials = [
  { Icon: LinkedInIcon,  label: 'LinkedIn' },
  { Icon: InstagramIcon, label: 'Instagram' },
  { Icon: XIcon,         label: 'X (Twitter)' },
];

export function Footer() {
  return (
    <footer style={{ backgroundColor: 'var(--neutral-900)', paddingTop: 64, paddingBottom: 40 }}>
      <div className="container">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-12">
          {/* Brand */}
          <div>
            <span className="font-bold text-xl" style={{ color: 'var(--primary)' }}>UpNow</span>
            <p className="text-sm mt-2" style={{ color: 'var(--neutral-500)' }}>
              Services and spaces, simplified.
            </p>
            <div className="flex gap-3 mt-4">
              {socials.map(({ Icon, label }) => (
                <Link
                  key={label}
                  href="#"
                  aria-label={label}
                  title={label}
                  className="flex items-center justify-center transition-colors duration-200"
                  style={{
                    width: 36, height: 36,
                    backgroundColor: 'rgba(255,255,255,0.10)',
                    borderRadius: '50%',
                    color: 'rgba(255,255,255,0.70)',
                  }}
                >
                  <Icon />
                </Link>
              ))}
            </div>
          </div>

          {cols.map((col) => (
            <div key={col.label}>
              <p className="text-xs uppercase font-[500] mb-4" style={{ color: 'var(--neutral-500)', letterSpacing: '0.05em' }}>
                {col.label}
              </p>
              {col.links.map((link) => (
                <Link
                  key={link.text}
                  href={link.href}
                  className="block text-sm mb-2 transition-colors hover:text-white"
                  style={{ color: 'rgba(255,255,255,0.70)' }}
                >
                  {link.text}
                </Link>
              ))}
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div
          className="flex flex-col sm:flex-row justify-between mt-8 pt-6"
          style={{ borderTop: '1px solid rgba(255,255,255,0.10)' }}
        >
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
            © {new Date().getFullYear()} UpNow. All rights reserved.
          </span>
        </div>
      </div>
    </footer>
  );
}
