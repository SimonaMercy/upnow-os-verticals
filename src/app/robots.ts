import type { MetadataRoute } from 'next';

/**
 * While the site is private (`SITE_PRIVATE=1`) we ask crawlers to stay away
 * entirely; middleware also sets `X-Robots-Tag: noindex` on every response, so
 * a crawler that ignores robots.txt still gets the message.
 *
 * Flipping the flag back off restores normal crawling with no code change.
 */
export default function robots(): MetadataRoute.Robots {
  if (process.env.SITE_PRIVATE === '1') {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return { rules: [{ userAgent: '*', allow: '/' }] };
}
