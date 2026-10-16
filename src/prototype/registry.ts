/**
 * PROTOTYPE ONLY — vertical / subcategory registry.
 *
 * Mirrors the taxonomy in upnow-marketspace `data/listings.js` (VORDER and the
 * per-offer basis / action / flow / permit config). In production this would be
 * served by a backend registry; here it is static config that drives the nav,
 * the listing wizard and the operating-model hand-off.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Building2, Wrench, Compass, BadgeCheck, GraduationCap, HeartPulse, ShieldCheck,
} from 'lucide-react';
import type { FlowKind, OperatingModel, Subcategory, VerticalId } from './types';

export interface VerticalDef {
  id: VerticalId;
  label: string;
  short: string;
  icon: LucideIcon;
  /** Brand green (MarketSpace --g7 / --g1): packs share one colour and are told apart by icon + name. */
  accent: string;
  tint: string;
  blurb: string;
  regulators: string;
}

export const VERTICALS: VerticalDef[] = [
  { id: 'spaces', label: 'Spaces', short: 'Spaces', icon: Building2, accent: '#047246', tint: '#eef7f2', blurb: 'Homes, offices, warehouses, land, holiday homes, venues, courts and yachts.', regulators: 'RERA · DLD · DTCM · Maritime' },
  { id: 'services', label: 'Services', short: 'Services', icon: Wrench, accent: '#047246', tint: '#eef7f2', blurb: 'Cleaning, AC, salons, photography, design and more.', regulators: 'Trade licence · Freelance permit' },
  { id: 'experiences', label: 'Experiences', short: 'Experiences', icon: Compass, accent: '#047246', tint: '#eef7f2', blurb: 'Safaris, workshops and tours.', regulators: 'DTCM' },
  { id: 'memberships', label: 'Memberships', short: 'Memberships', icon: BadgeCheck, accent: '#047246', tint: '#eef7f2', blurb: 'Gyms and credit packages.', regulators: 'DSC · REPs' },
  { id: 'programs', label: 'Programs', short: 'Programs', icon: GraduationCap, accent: '#047246', tint: '#eef7f2', blurb: 'Nurseries, schools, universities, courses, camps and academies.', regulators: 'KHDA · CAA' },
  { id: 'health', label: 'Health', short: 'Health', icon: HeartPulse, accent: '#047246', tint: '#eef7f2', blurb: 'Doctors, dentists, physio, diagnostics and care.', regulators: 'DHA' },
  { id: 'insurance', label: 'Protection', short: 'Protection', icon: ShieldCheck, accent: '#047246', tint: '#eef7f2', blurb: 'Motor, health and property cover.', regulators: 'CBUAE' },
];

export const VERTICAL: Record<VerticalId, VerticalDef> = Object.fromEntries(
  VERTICALS.map((v) => [v.id, v]),
) as Record<VerticalId, VerticalDef>;

export const MODEL_INFO: Record<OperatingModel, { label: string; flow: FlowKind; summary: string }> = {
  lease: { label: 'Long-term lease', flow: 'operational', summary: 'Viewing → application → KYC → cheque plan → contract → Ejari → move-in → renewal' },
  stay: { label: 'Nightly stay', flow: 'booking', summary: 'Dates held → host confirms → check-in → check-out → review' },
  venue: { label: 'Quoted event booking', flow: 'lead', summary: 'Enquiry → quote → site visit → deposit → event day' },
  slot: { label: 'Time-slot reservation', flow: 'booking', summary: 'Slot held → confirmed → play → review' },
  charter: { label: 'Charter', flow: 'booking', summary: 'Enquiry → deposit → guest manifest → trip → settlement' },
  appointment: { label: 'Appointment', flow: 'booking', summary: 'Request → confirmed → appointment → paid → review' },
  field_job: { label: 'Field-service job', flow: 'operational', summary: 'Request → assess/quote → scheduled → on site → completed' },
  project_quote: { label: 'Quoted project', flow: 'lead', summary: 'Brief → quote → accepted → delivery → closed' },
  session: { label: 'Scheduled session', flow: 'booking', summary: 'Seat reserved → guest details → attend → review' },
  subscription: { label: 'Subscription', flow: 'operational', summary: 'Free visit → terms signed → access → renewal' },
  credits: { label: 'Credit entitlement', flow: 'operational', summary: 'Package bought → credits issued → sessions booked → expiry' },
  admission: { label: 'Admission', flow: 'lead', summary: 'Tour → application → assessment → offer → enrolment' },
  enrolment: { label: 'Enrolment', flow: 'operational', summary: 'Enrol → consent → timetable → attendance → certificate' },
  clinical: { label: 'Clinical appointment', flow: 'booking', summary: 'Appointment → intake & consent → consultation → follow-up' },
  insurance_quote: { label: 'Quote & policy', flow: 'lead', summary: 'Quote request → details → comparison → application → policy' },
};

type F = Subcategory['fields'][number];
const sel = (id: string, label: string, options: string[]): F => ({ id, label, type: 'select', options });
const num = (id: string, label: string): F => ({ id, label, type: 'number' });
const txt = (id: string, label: string): F => ({ id, label, type: 'text' });

function sub(
  vertical: VerticalId, id: string, label: string, model: OperatingModel,
  priceBasis: string, priceUnit: string, cta: string, flow: string[],
  fields: F[], extra: Partial<Subcategory> = {},
): Subcategory {
  return {
    key: `${vertical}.${id}`, id, vertical, label, model, priceBasis, priceUnit, cta, flow, fields,
    minPhotos: vertical === 'insurance' ? 0 : vertical === 'spaces' || vertical === 'experiences' ? 5 : 3,
    ...extra,
  };
}

export const SUBCATEGORIES: Subcategory[] = [
  // ── Spaces ─────────────────────────────────────────────────────────────
  sub('spaces', 'residential', 'Residential', 'lease', 'AED / year or month', '/year', 'Request a viewing',
    ['Enquiry', 'Viewing', 'Offer & cheques', 'Ejari & contract', 'Move-in'],
    [sel('ptype', 'Property type', ['Apartment', 'Villa', 'Townhouse', 'Penthouse', 'Duplex']), num('beds', 'Bedrooms'), num('size', 'Size (sqft)'), sel('cheques', 'Cheques accepted', ['1', '2', '4', '6', '12'])],
    { regulator: 'RERA / DLD' }),
  sub('spaces', 'commercial', 'Commercial', 'lease', 'AED / year · per sqft', '/year', 'Request a viewing',
    ['Enquiry', 'Site visit', 'Heads of terms', 'Lease & Ejari', 'Fit-out & handover'],
    [sel('ctype', 'Space type', ['Office', 'Retail', 'Showroom', 'Coworking', 'F&B', 'Clinic']), num('size', 'Size (sqft)'), sel('zone', 'Zone', ['Mainland (DED)', 'Free zone'])],
    { regulator: 'RERA / DLD' }),
  sub('spaces', 'industrial', 'Industrial', 'lease', 'AED / year · per sqft', '/year', 'Request a site visit',
    ['Enquiry', 'Site visit', 'Offer', 'Lease & Ejari', 'Handover'],
    [sel('itype', 'Space type', ['Warehouse', 'Factory', 'Workshop', 'Cold storage', 'Yard']), num('size', 'Size (sqft)'), num('power', 'Power (kW)')],
    { regulator: 'RERA / DLD · Civil Defence' }),
  sub('spaces', 'land', 'Land', 'lease', 'AED / year', '/year', 'Enquire about plot',
    ['Enquiry', 'Site visit', 'Due diligence', 'Land lease agreement', 'Handover'],
    [sel('landuse', 'Land use', ['Residential', 'Commercial', 'Industrial', 'Agricultural']), num('size', 'Plot size (sqft)'), num('termYrs', 'Minimum term (years)')],
    { regulator: 'DLD', minPhotos: 3 }),
  sub('spaces', 'holiday', 'Holiday homes', 'stay', 'AED / night', '/night', 'Check availability',
    ['Enquiry', 'Host confirms dates', 'Payment', 'Check-in', 'Review'],
    [sel('ptype', 'Property type', ['Apartment', 'Studio', 'Villa', 'Penthouse']), num('maxGuests', 'Max guests'), num('minNights', 'Minimum nights'), sel('cancellation', 'Cancellation', ['Flexible', 'Moderate', 'Strict'])],
    { licenceGate: 'DTCM holiday home permit', regulator: 'DTCM' }),
  sub('spaces', 'venue', 'Venues', 'venue', 'AED / hour or day', '/hour', 'Request a quote',
    ['Enquiry', 'Quote', 'Site visit', 'Deposit', 'Event day'],
    [sel('venueType', 'Venue type', ['Ballroom', 'Rooftop', 'Meeting room', 'Garden', 'Studio', 'Restaurant']), num('capacity', 'Guest capacity'), sel('catering', 'Catering', ['In-house', 'External allowed', 'None'])],
    { licenceGate: 'Venue activity licence', regulator: 'DET' }),
  sub('spaces', 'court', 'Sports courts', 'slot', 'AED / hour', '/hour', 'Check slot availability',
    ['Enquiry', 'Slot confirmed', 'Pay at venue', 'Play', 'Review'],
    [sel('sport', 'Sport', ['Padel', 'Tennis', 'Football 5-a-side', 'Basketball', 'Pickleball', 'Badminton']), num('courts', 'Number of courts'), sel('surface', 'Indoor / outdoor', ['Indoor', 'Outdoor', 'Covered'])],
    { regulator: 'Trade licence', minPhotos: 3 }),
  sub('spaces', 'yacht', 'Yachts', 'charter', 'AED / hour or day', '/hour', 'Check availability',
    ['Enquiry', 'Deposit', 'Guest list', 'Trip', 'Settlement'],
    [sel('ytype', 'Vessel type', ['Motor yacht', 'Catamaran', 'Sailing', 'Speed boat']), num('length', 'Length (ft)'), num('capacity', 'Guest capacity'), num('minHours', 'Minimum hours')],
    { licenceGate: 'Marine craft licence', regulator: 'Dubai Maritime Authority' }),
  // ── Services ───────────────────────────────────────────────────────────
  sub('services', 'cleaning', 'Cleaning', 'field_job', 'One-time or recurring', '/hour', 'Request a booking',
    ['Enquiry', 'Slot confirmed', 'Visit', 'Photo evidence', 'Payment'],
    [sel('service', 'Service', ['Regular clean', 'Deep clean', 'Move-in / move-out', 'Sofa & carpet']), num('team', 'Team size'), num('minHours', 'Minimum hours')]),
  sub('services', 'ac', 'AC maintenance', 'field_job', 'One-time or annual contract', '/unit', 'Request a quote',
    ['Enquiry', 'Assessment', 'Quote', 'Work order', 'Completion'],
    [sel('model', 'Model', ['One-off', 'Annual contract (AMC)']), sel('acType', 'AC type', ['Split', 'Ducted / central', 'Window', 'Cassette'])],
    { regulator: 'Licensed only' }),
  sub('services', 'haircut', 'Haircut', 'appointment', 'AED / appointment', '/appointment', 'Request an appointment',
    ['Enquiry', 'Confirmation', 'Appointment', 'Pay at salon', 'Review'],
    [sel('treatment', 'Treatment', ["Men's cut", "Women's cut & style", 'Colour', 'Blow-dry', 'Kids cut', 'Beard trim']), num('duration', 'Duration (min)')]),
  sub('services', 'photography', 'Photography', 'project_quote', 'AED / session', '/session', 'Ask for a quote',
    ['Brief', 'Quote', 'Shoot', 'Delivery'],
    [sel('shoot', 'Shoot type', ['Portrait', 'Wedding', 'Event', 'Product', 'Real estate', 'Video']), num('duration', 'Duration (hours)')],
    { minPhotos: 6, regulator: 'Freelance permit' }),
  sub('services', 'design', 'Design', 'project_quote', 'AED / project', '/project', 'Ask for a quote',
    ['Brief', 'Quote', 'Milestones', 'Handover'],
    [sel('dtype', 'Design type', ['Interior design', 'Fit-out design', 'Graphic design', 'Branding', 'Web design'])],
    { minPhotos: 6, regulator: 'Freelance permit' }),
  sub('services', 'makeup', 'Make-up artist', 'appointment', 'AED / look', '/look', 'Ask about a date',
    ['Enquiry', 'Date confirmed', 'Appointment', 'Review'],
    [sel('occasion', 'Occasion', ['Bridal', 'Party', 'Photoshoot', 'Henna & make-up'])],
    { minPhotos: 6, regulator: 'Freelance permit' }),
  sub('services', 'handyman', 'Handyman', 'field_job', 'AED / visit', '/visit', 'Request a quote',
    ['Enquiry', 'Quote', 'Visit', 'Completion'],
    [sel('job', 'Job type', ['Plumbing', 'Electrical', 'Carpentry', 'Painting', 'Furniture assembly', 'TV mounting'])],
    { regulator: 'Licensed only' }),
  // ── Experiences ────────────────────────────────────────────────────────
  sub('experiences', 'safari', 'Desert safari', 'session', 'AED / person / day', '/person', 'Check availability',
    ['Enquiry', 'Guest details', 'Payment', 'Pickup', 'Review'],
    [sel('session', 'Session', ['Morning', 'Evening', 'Overnight']), num('groupMax', 'Group maximum'), sel('pickup', 'Hotel pickup', ['Included', 'Extra', 'Not offered'])],
    { licenceGate: 'Desert safari permit', regulator: 'DTCM' }),
  sub('experiences', 'workshop', 'Workshop', 'session', 'AED / session', '/session', 'Check availability',
    ['Enquiry', 'Seat confirmed', 'Reminder', 'Attend', 'Certificate'],
    [sel('topic', 'Topic', ['Pottery', 'Painting', 'Cooking', 'Perfume making', 'Photography', 'Calligraphy']), num('groupMax', 'Group maximum'), num('duration', 'Duration (hours)')]),
  sub('experiences', 'tour', 'Tour', 'session', 'AED / person / day', '/person', 'Check availability',
    ['Enquiry', 'Confirmation', 'Meet guide', 'Tour', 'Review'],
    [txt('meeting', 'Meeting point'), num('groupMax', 'Group maximum'), sel('language', 'Language', ['English', 'Arabic', 'Russian', 'Mandarin'])],
    { regulator: 'DTCM — licensed guides' }),
  // ── Memberships ────────────────────────────────────────────────────────
  sub('memberships', 'gym', 'Gym plan', 'subscription', 'AED / month or year', '/month', 'Book a free visit',
    ['Enquiry', 'Free visit', 'Sign terms', 'Access card', 'Renewal'],
    [sel('access', 'Access', ['Single club', 'Multi-club', 'All clubs']), sel('billing', 'Billing', ['Monthly', 'Annual'])],
    { licenceGate: 'REPs trainer registration', regulator: 'DSC' }),
  sub('memberships', 'credits', 'Credit package', 'credits', 'AED / package', '/package', 'Enquire about package',
    ['Enquiry', 'Purchase', 'Credits issued', 'Book sessions', 'Expiry'],
    [sel('activity', 'Activity', ['Fitness classes', 'Padel', 'Swimming', 'Spa & wellness', 'Yoga']), num('credits', 'Credits in package'), num('validity', 'Validity (months)')]),
  // ── Programs ───────────────────────────────────────────────────────────
  sub('programs', 'nursery', 'Nursery', 'admission', 'AED / term, month or day', '/term', 'Request a tour',
    ['Enquiry', 'Tour', 'Application', 'Consent', 'Enrolment'],
    [sel('curriculum', 'Curriculum', ['EYFS', 'Montessori', 'Reggio Emilia', 'IB PYP']), txt('ages', 'Age range')],
    { regulator: 'KHDA', minPhotos: 5 }),
  sub('programs', 'school', 'School', 'admission', 'AED / term or year', '/year', 'Enquire about admission',
    ['Enquiry', 'School tour', 'Assessment', 'Offer', 'Enrolment'],
    [sel('curriculum', 'Curriculum', ['British', 'American', 'IB', 'CBSE', 'French', 'UAE MoE']), sel('khda', 'KHDA rating', ['Outstanding', 'Very good', 'Good', 'Acceptable'])],
    { regulator: 'KHDA', minPhotos: 5 }),
  sub('programs', 'higher', 'Higher education', 'admission', 'AED / course, term or year', '/year', 'Enquire about admission',
    ['Application', 'Eligibility', 'Offer', 'Enrolment', 'Completion'],
    [sel('qualification', 'Qualification', ['Foundation', 'Bachelor', 'Master', 'Executive']), sel('accreditation', 'Accreditation', ['CAA', 'KHDA'])],
    { regulator: 'CAA / KHDA' }),
  sub('programs', 'course', 'Course', 'enrolment', 'AED / course', '/course', 'Enquire to enrol',
    ['Enquiry', 'Enrolment', 'Payment', 'Timetable', 'Certificate'],
    [sel('subject', 'Subject', ['Coding', 'UX Design', 'Data & AI', 'Arabic', 'English / IELTS', 'Business']), num('weeks', 'Length (weeks)')],
    { regulator: 'KHDA-approved centre' }),
  sub('programs', 'camp', 'Camp', 'enrolment', 'AED / day or package', '/day', 'Enquire to enrol',
    ['Enquiry', 'Consent form', 'Payment', 'Drop-off', 'Completion'],
    [sel('activity', 'Activity', ['Sports', 'Arts & crafts', 'STEM & robotics', 'Multi-activity', 'Swimming']), txt('ages', 'Age range')],
    { minPhotos: 5 }),
  sub('programs', 'academy', 'Academy', 'enrolment', 'AED / term', '/term', 'Book an assessment',
    ['Enquiry', 'Assessment', 'Placement', 'Term', 'Progress report'],
    [sel('sport', 'Sport', ['Football', 'Swimming', 'Tennis', 'Basketball', 'Martial arts', 'Gymnastics']), txt('ages', 'Age range')],
    { regulator: 'DSC' }),
  // ── Health ─────────────────────────────────────────────────────────────
  sub('health', 'doctor', 'Doctor consultation', 'clinical', 'AED / consultation', '/consultation', 'Request an appointment',
    ['Appointment', 'Intake & consent', 'Eligibility / payment', 'Consultation', 'Follow-up'],
    [sel('specialty', 'Specialty', ['Family medicine', 'Paediatrics', 'Dermatology', 'Gynaecology', 'Cardiology', 'ENT']), sel('insurance', 'Insurance accepted', ['Daman', 'AXA', 'Bupa', 'MetLife', 'Cigna', 'Self-pay only'])],
    { regulator: 'DHA' }),
  sub('health', 'dental', 'Dental', 'clinical', 'AED / consultation or treatment', '/consultation', 'Request an appointment',
    ['Enquiry', 'Appointment', 'Patient form', 'Consultation', 'Treatment plan'],
    [sel('treatment', 'Treatment', ['Check-up & cleaning', 'Whitening', 'Aligners & braces', 'Implants', 'Root canal', 'Kids dentistry'])],
    { regulator: 'DHA' }),
  sub('health', 'physio', 'Physiotherapy', 'clinical', 'AED / session or package', '/session', 'Request an assessment',
    ['Assessment', 'Treatment plan', 'Authorisation', 'Sessions', 'Discharge'],
    [sel('session', 'Session length', ['30 min', '45 min', '60 min'])],
    { regulator: 'DHA' }),
  sub('health', 'diagnostics', 'Diagnostics', 'clinical', 'AED / test or package', '/test', 'Request a test',
    ['Order', 'Eligibility / payment', 'Collection', 'Result', 'Practitioner review'],
    [sel('test', 'Test', ['Full body check-up', 'Blood panel', 'Vitamin & hormones', 'MRI / CT', 'X-ray & ultrasound'])],
    { regulator: 'DHA' }),
  sub('health', 'mental', 'Mental health', 'clinical', 'AED / session', '/session', 'Request a session',
    ['Appointment', 'Consent', 'Assessment', 'Care plan', 'Follow-up'],
    [sel('format', 'Format', ['In person', 'Video'])],
    { regulator: 'DHA' }),
  sub('health', 'homecare', 'Home healthcare', 'clinical', 'AED / visit or care plan', '/visit', 'Request care',
    ['Request', 'Clinical assessment', 'Authorisation', 'Care visits', 'Review'],
    [sel('care', 'Care type', ['Nursing', 'Elderly care', 'Post-operative', 'Physio at home'])],
    { regulator: 'DHA' }),
  // ── Protection (id: insurance) ─────────────────────────────────────────
  sub('insurance', 'motor', 'Motor', 'insurance_quote', 'Quoted annual premium', '/year', 'Get a quote',
    ['Quote request', 'Eligibility check', 'Comparison', 'Application', 'Policy issued'],
    [sel('cover', 'Cover', ['Comprehensive', 'Third party']), num('deductible', 'Deductible (AED)')],
    { regulator: 'CBUAE' }),
  sub('insurance', 'health', 'Health', 'insurance_quote', 'Quoted annual premium', '/year', 'Get a quote',
    ['Quote request', 'Health details', 'Comparison', 'Application', 'Policy issued'],
    [sel('network', 'Network', ['Basic', 'Enhanced', 'Premium']), num('copay', 'Co-pay (%)')],
    { regulator: 'CBUAE · DHA (EBP)' }),
  sub('insurance', 'property', 'Property', 'insurance_quote', 'Quoted annual premium', '/year', 'Get a quote',
    ['Quote request', 'Risk details', 'Comparison', 'Application', 'Policy issued'],
    [sel('cover', 'Cover', ['Contents', 'Building', 'Landlord']), num('deductible', 'Deductible (AED)')],
    { regulator: 'CBUAE' }),
];

export const SUB: Record<string, Subcategory> = Object.fromEntries(SUBCATEGORIES.map((s) => [s.key, s]));

export const subsOf = (v: VerticalId) => SUBCATEGORIES.filter((s) => s.vertical === v);
