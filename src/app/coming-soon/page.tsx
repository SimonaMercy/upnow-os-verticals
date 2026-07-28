/**
 * Holding page shown to anonymous visitors while `SITE_PRIVATE=1`.
 *
 * Reached by rewrite from middleware (with a 503), so the visitor keeps the URL
 * they asked for. Markup and motion follow the approved design (UpNow Coming
 * Soon Final) exactly; the desktop and mobile frames become one responsive page
 * that re-orders at 900px. Styles live in comingSoon.module.css.
 */
import type { Metadata } from 'next';
import { Outfit, DM_Mono } from 'next/font/google';
import { SiteBackdrop } from '@/components/upnow/SiteBackdrop';
import { LoginPopupLink } from './LoginPopupLink';
import styles from './comingSoon.module.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-dm-mono',
});

export const metadata: Metadata = {
  title: 'UpNow — Coming soon',
  robots: { index: false, follow: false },
};

/**
 * Rendered per request so the copyright year is always current — a statically
 * prerendered page would freeze the year at build time until the next deploy.
 */
export const dynamic = 'force-dynamic';

/** The wordmark animates in letter by letter, 80ms apart. */
const WORDMARK = ['U', 'p', 'N', 'o', 'w'];

export default function ComingSoonPage() {
  const year = new Date().getFullYear();

  return (
    <main className={`${styles.page} ${outfit.className} ${dmMono.variable}`}>
      <SiteBackdrop />

      <div className={styles.shell}>
        <div className={styles.left}>
          <div className={styles.copy}>
            <div className={styles.badge}>
              <span className={styles.badgeDot} />
              <span className={styles.badgeText}>Rebuild in progress</span>
            </div>

            <h1 className={styles.title}>
              Something
              <br />
              better is
              <br />
              <span className={styles.titleAccent}>on the way.</span>
            </h1>

            <p className={styles.ledeDesktop}>
              We&rsquo;re rebuilding UpNow from the ground up &mdash; one platform to run
              your rentals and services, without the spreadsheet gymnastics.
            </p>
            <p className={styles.lede}>
              One platform to run your rentals and services &mdash; rebuilt from the
              ground up.
            </p>
          </div>

          <div className={styles.actions}>
            <a href="mailto:support@upnow.ae" className={styles.cta}>
              Talk to us
              <span className={styles.ctaArrow}>&#8599;</span>
            </a>
            <LoginPopupLink className={styles.loginLink} />
          </div>
        </div>

        <div className={styles.brand}>
          <div className={styles.orb}>
            <div className={styles.orbGlow} />
            <div className={styles.ring1} />
            <div className={styles.ring2} />
            <div className={styles.ring3} />
            <span className={styles.mark}>
              U
              <span className={styles.shine} />
            </span>
          </div>

          <span className={styles.wordmark}>
            {WORDMARK.map((letter, i) => (
              <span key={letter} style={{ animationDelay: `${0.45 + i * 0.08}s` }}>
                {letter}
              </span>
            ))}
          </span>
        </div>

        <div className={styles.footer}>
          <span className={styles.supportMobile}>
            <a href="mailto:support@upnow.ae">support@upnow.ae</a>
          </span>
          <span>
            &copy; {year} UpNow<span className={styles.rightsLong}>. All rights reserved.</span>
          </span>
          <span className={styles.supportDesktop}>
            Support &middot; <a href="mailto:support@upnow.ae">support@upnow.ae</a>
          </span>
        </div>
      </div>
    </main>
  );
}
