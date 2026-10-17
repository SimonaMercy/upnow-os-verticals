/**
 * Homepage words and pictures. Headlines and hero images are taken from upnow-marketspace
 * data/home.js; the "How it works" steps are adapted to what the OS actually does today
 * (viewings / book-now for Spaces, online booking for Services, tracking in the customer account).
 */
import type { MsVerticalId } from '@/lib/catalog';

export type HomeTab = 'all' | MsVerticalId;

export const HEADLINES: Record<HomeTab, [string, string]> = {
  all: ['Everything Dubai, one search.', 'Spaces, services, experiences, memberships, programs, health and protection — from verified providers.'],
  spaces: ['Find a space you can trust.', 'Homes, offices, warehouses, land, holiday homes, venues, courts and yachts. Connect with verified owners, agents and operators.'],
  services: ['Book a service you can trust.', 'Cleaning, AC, salons, photographers, designers and handymen. Licensed, reviewed and ready to reply on WhatsApp.'],
  experiences: ['Discover experiences worth remembering.', 'Tours, workshops and desert safaris from DTCM-licensed operators.'],
  memberships: ['Join places that fit your life.', 'Compare plans, benefits, access and locations before you join.'],
  programs: ['Find the right program to grow.', 'Nurseries, schools, universities, courses, camps and academies with clear admissions and schedules.'],
  health: ['Care you can count on.', 'Doctors, dentists, physio, diagnostics, mental health and home care from DHA-licensed providers.'],
  insurance: ['Protect what matters to you.', 'Motor, health and property quotes from CBUAE-licensed insurers.'],
};

const IMG = (n: string) => `/marketspace/images/${n}`;

/** Hero background per subcategory id ("all" = the All tab). */
export const HERO_IMAGES: Record<string, string> = {
  all: IMG('hero.jpg'),
  residential: IMG('hero.jpg'), commercial: IMG('office1.jpg'), industrial: IMG('wh3.jpg'), land: IMG('aerial1.jpg'),
  holiday: IMG('villa1.jpg'), venue: IMG('venue2.jpg'), court: IMG('padel1.jpg'), yacht: IMG('yacht2.jpg'),
  cleaning: IMG('clean1.jpg'), ac: IMG('ac1.jpg'), haircut: IMG('salon1.jpg'), photography: IMG('workshop2.jpg'),
  design: IMG('office3.jpg'), makeup: IMG('salon2.jpg'), handyman: IMG('ac2.jpg'),
  safari: IMG('desert2.jpg'), workshop: IMG('workshop1.jpg'), tour: IMG('desert1.jpg'),
  gym: IMG('fit2.jpg'), credits: IMG('fit1.jpg'),
  nursery: IMG('nursery1.jpg'), school: IMG('school1.jpg'), higher: IMG('uni1.jpg'), course: IMG('office2.jpg'),
  camp: IMG('school2.jpg'), academy: IMG('padel2.jpg'),
  doctor: IMG('doctor1.jpg'), dental: IMG('dental1.jpg'), physio: IMG('physio1.jpg'), diagnostics: IMG('lab1.jpg'),
  mental: IMG('therapy1.jpg'), homecare: IMG('homecare1.jpg'),
};

export const STEPS: [string, string][] = [
  ['Find what you need', 'Choose a category, then search with the filters that matter.'],
  ['Compare verified providers', 'Every provider and every listing is reviewed by UpNow before it goes live.'],
  ['Request a viewing or book', 'Ask for a viewing on a space, or book a service online in a few steps.'],
  ['Track it in your account', 'Viewings, contracts, documents and bookings stay in one place.'],
];

export const BUDGETS: { label: string; min: string; max: string }[] = [
  { label: 'Any budget', min: '', max: '' },
  { label: 'Up to AED 30K / yr', min: '', max: '30000' },
  { label: 'AED 30K – 60K / yr', min: '30000', max: '60000' },
  { label: 'AED 60K – 120K / yr', min: '60000', max: '120000' },
  { label: 'AED 120K – 250K / yr', min: '120000', max: '250000' },
  { label: 'AED 250K – 500K / yr', min: '250000', max: '500000' },
  { label: 'AED 500K+ / yr', min: '500000', max: '' },
];
