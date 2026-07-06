/**
 * Stock imagery for the services marketplace — single source shared by the
 * landing page and /services so the two never drift.
 *
 * Precedence everywhere: admin-attached image (imageUrl from the catalog
 * API) → service-specific stock photo → category pool (cycled by index).
 * Every Unsplash ID below was downloaded and visually verified to match its
 * subject before entry — do NOT add IDs from memory without checking them.
 */

const UPH = 'https://images.unsplash.com/photo-';
const UQ = '?auto=format&fit=crop&w=800&q=60';

/** Category pools — used for category cards and as last-resort fallback. */
export const CATEGORY_IMGS: Record<string, string[]> = {
  home_cleaning:       ['1581578731548-c64695cc6952', '1563453392212-326f5e854473', '1628177142898-93e36e4e3a50', '1584622650111-993a426fbf0a'],
  ac_services:         ['1590756254933-2873d72a83b6', '1642749776312-aa42ce20c9f5', '1737012197886-7d5a52ded45b'],
  plumbing:            ['1607472586893-edb57bdc0e39', '1585704032915-c3400ca199e7'],
  electrical:          ['1621905252507-b35492cc74b4', '1544724569-5f546fd6f2b5', '1555963966-b7ae5404b6ed'],
  handyman:            ['1504148455328-c376907d081c', '1530124566582-a618bc2615dc', '1426927308491-6380b6a9936f'],
  painting:            ['1562259949-e8e7689d7828', '1717281234297-3def5ae3eee1'],
  pest_control:        ['1749030417784-f8abf669dd41'],
  car_vehicle:         ['1520340356584-f9917d1eea6f', '1607860108855-64acf2078ed9', '1601362840469-51e4d8d58785'],
  landscaping_outdoor: ['1416879595882-3373a0480b5b', '1558904541-efa843a96f01'],
  commercial_services: ['1497366216548-37526070297c', '1497366811353-6870744d04b2', '1558882224-dda166733046'],
};

/** Service-specific photos — keyed by service CODE; win over the category
    pool so e.g. Oil Change never shows a car-wash photo. */
export const SERVICE_IMGS: Record<string, string> = {
  // home cleaning
  'move-in-cleaning':       '1584622650111-993a426fbf0a', // sparkling empty bathroom
  // ac services
  'ac-inspection':          '1642749776312-aa42ce20c9f5', // techs among rooftop condensers
  'ac-cleaning':            '1737012197886-7d5a52ded45b', // opening ceiling vent grille
  'gas-refill':             '1694532438941-06bb0d95dae5', // manifold pressure gauges
  'compressor-replacement': '1590756254933-2873d72a83b6', // outdoor condenser unit
  // plumbing
  'leak-repair':            '1585704032915-c3400ca199e7', // dripping bathtub faucet
  'drain-cleaning':         '1607472586893-edb57bdc0e39', // pipe runs on brick
  'emergency-plumbing':     '1585704032915-c3400ca199e7',
  // electrical
  'light-installation':     '1583275477830-7e8e9d56d15f', // screwing bulb into pendant
  'socket-replacement':     '1751486289947-4f5f5961b3aa', // exposed wall-socket mechanism
  'electrical-diagnostics': '1544724569-5f546fd6f2b5',    // breaker panel
  // handyman
  'furniture-assembly':     '1571018400279-7f33252d0ad6', // flat-pack build in progress
  'tv-mounting':            '1521607630287-ee2e81ad3ced', // wall-mounted TV
  'general-handyman':       '1504148455328-c376907d081c', // drill on floor
  // painting
  'room-painting':          '1562259949-e8e7689d7828',    // roller mid-stroke
  'painting-touch-up':      '1717281234297-3def5ae3eee1', // painter on scaffold
  'wallpaper':              '1594100618568-1c6cd8daafdf', // smoothing floral wallpaper
  // pest control — deliberately general, no insects on any card
  'general-pest-control':   '1749030417784-f8abf669dd41', // sprayer wand in foliage
  'cockroach-treatment':    '1749030417784-f8abf669dd41',
  'termite-treatment':      '1749030417784-f8abf669dd41',
  // car & vehicle
  'exterior-wash':          '1607860108855-64acf2078ed9', // foam wash
  'oil-change':             '1487754180451-c456f719a1fc', // pouring oil via funnel
  'battery-boost':          '1597766380552-36f5c673637a', // jumper cables
  'car-ac-inspection':      '1752552055661-fbb9ef5398fe', // dashboard AC vent
};

const stock = (id: string) => `${UPH}${id}${UQ}`;

/** Image for a SERVICE card. adminUrl (catalog imageUrl) always wins. */
export function serviceImg(
  svcCode: string,
  catCode: string,
  index: number,
  adminUrl?: string | null,
): string {
  if (adminUrl) return adminUrl;
  const specific = SERVICE_IMGS[svcCode];
  if (specific) return stock(specific);
  const pool = CATEGORY_IMGS[catCode] ?? CATEGORY_IMGS.home_cleaning;
  return stock(pool[index % pool.length]);
}

/** Image for a CATEGORY card. adminUrl always wins. */
export function categoryImg(catCode: string, adminUrl?: string | null): string {
  if (adminUrl) return adminUrl;
  const pool = CATEGORY_IMGS[catCode] ?? CATEGORY_IMGS.home_cleaning;
  return stock(pool[0]);
}
