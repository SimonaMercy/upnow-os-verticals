/**
 * PROTOTYPE ONLY — dummy data.
 *
 * Every name, licence number and amount below is fictional. The prototype's
 * "today" is fixed so screens render identically for every viewer and in
 * every presentation (no Date.now()).
 */
import type {
  AuditEvent, Customer, Deposit, Invoice, Lead, Listing, Org, Payout, ProviderApplication, WorkItem,
} from './types';

export const TODAY = '2026-10-15';
/** Monday of the demo week. */
export const WEEK_START = '2026-10-12';
export const DEMO_PERSON = { name: 'Layla Haddad', email: 'layla@alnoor.ae', initials: 'LH' };

export const ORGS: Org[] = [
  {
    id: 'o1', name: 'Al Noor Holdings', legalName: 'Al Noor Holdings LLC', entityType: 'company',
    tradeLicence: 'DED-1042871', emirate: 'Dubai', status: 'verified', initials: 'AN', colour: '#1f7a5c',
    branches: [
      { id: 'b1', name: 'Head office', area: 'Business Bay', verticals: ['spaces', 'services'] },
      { id: 'b2', name: 'Marina Sports Club', area: 'Dubai Marina', verticals: ['spaces'] },
      { id: 'b3', name: 'Desert Camp', area: 'Al Marmoom', verticals: ['experiences'] },
    ],
    verticals: [
      { vertical: 'spaces', status: 'approved', businessType: 'Landlord company', requestedAt: '2026-03-02',
        subcategories: ['spaces.residential', 'spaces.commercial', 'spaces.holiday', 'spaces.venue', 'spaces.court', 'spaces.yacht'],
        licences: [
          { name: 'Trade licence', number: 'DED-1042871', expires: '2027-04-30', status: 'valid' },
          { name: 'DTCM holiday home permit', number: 'HH-55120', expires: '2026-11-20', status: 'expiring' },
          { name: 'Marine craft licence', number: 'DMA-7781', expires: '2027-02-14', status: 'valid' },
          { name: 'Venue activity licence', number: 'VEN-3310', expires: '2027-06-01', status: 'valid' },
        ] },
      { vertical: 'services', status: 'approved', businessType: 'Services company', requestedAt: '2026-05-18',
        subcategories: ['services.cleaning', 'services.ac', 'services.handyman', 'services.haircut', 'services.photography'],
        licences: [{ name: 'Trade licence', number: 'DED-1042871', expires: '2027-04-30', status: 'valid' }] },
      { vertical: 'experiences', status: 'approved', businessType: 'Tour operator', requestedAt: '2026-07-01',
        subcategories: ['experiences.safari', 'experiences.tour', 'experiences.workshop'],
        licences: [
          { name: 'DTCM tour operator licence', number: 'TO-22918', expires: '2027-01-10', status: 'valid' },
          { name: 'Desert safari permit', number: 'DS-4410', expires: '2027-01-10', status: 'valid' },
        ] },
      { vertical: 'memberships', status: 'submitted', businessType: 'Gym / club', requestedAt: '2026-10-09',
        subcategories: ['memberships.gym', 'memberships.credits'],
        licences: [{ name: 'DSC sports facility licence', number: 'DSC-9081', expires: '2027-09-30', status: 'valid' },
          { name: 'REPs trainer registration', number: '', expires: '', status: 'missing' }] },
    ],
    members: [
      { id: 'm1', name: 'Layla Haddad', email: 'layla@alnoor.ae', role: 'owner', branch: 'All branches', packs: ['spaces', 'services', 'experiences'], status: 'active' },
      { id: 'm2', name: 'Omar Siddiqui', email: 'omar@alnoor.ae', role: 'leasing_agent', branch: 'Head office', packs: ['spaces'], status: 'active' },
      { id: 'm3', name: 'Priya Nair', email: 'priya@alnoor.ae', role: 'accountant', branch: 'All branches', packs: ['spaces', 'services', 'experiences'], status: 'active' },
      { id: 'm4', name: 'Karim Fares', email: 'karim@alnoor.ae', role: 'front_desk', branch: 'Marina Sports Club', packs: ['spaces'], status: 'active' },
      { id: 'm5', name: 'Hana Yousef', email: 'hana@alnoor.ae', role: 'front_desk', branch: 'Desert Camp', packs: ['experiences'], status: 'invited' },
    ],
    documents: [
      { name: 'Trade licence', status: 'verified', expires: '2027-04-30' },
      { name: 'Memorandum of association', status: 'verified' },
      { name: 'Owner Emirates ID', status: 'verified', expires: '2029-02-11' },
      { name: 'VAT certificate', status: 'verified' },
      { name: 'Bank account letter', status: 'verified' },
      { name: 'DTCM holiday home permit', status: 'expiring', expires: '2026-11-20' },
    ],
  },
  {
    id: 'o2', name: 'Marina Health & Wellness', legalName: 'Marina Health & Wellness Centre LLC', entityType: 'company',
    tradeLicence: 'DED-2210934', emirate: 'Dubai', status: 'verified', initials: 'MH', colour: '#c0394b',
    branches: [
      { id: 'b4', name: 'Marina Clinic', area: 'Dubai Marina', verticals: ['health'] },
      { id: 'b5', name: 'JLT Fitness Studio', area: 'JLT', verticals: ['memberships'] },
    ],
    verticals: [
      { vertical: 'health', status: 'approved', businessType: 'Healthcare facility', requestedAt: '2026-02-11',
        subcategories: ['health.doctor', 'health.dental', 'health.physio', 'health.mental'],
        licences: [{ name: 'DHA facility licence', number: 'DHA-F-88213', expires: '2027-03-31', status: 'valid' }] },
      { vertical: 'memberships', status: 'approved', businessType: 'Gym / club', requestedAt: '2026-04-20',
        subcategories: ['memberships.gym', 'memberships.credits'],
        licences: [{ name: 'DSC sports facility licence', number: 'DSC-7720', expires: '2027-05-15', status: 'valid' }] },
    ],
    members: [
      { id: 'm6', name: 'Layla Haddad', email: 'layla@alnoor.ae', role: 'owner', branch: 'All branches', packs: ['health', 'memberships'], status: 'active' },
      { id: 'm7', name: 'Dr. Sameer Khan', email: 'sameer@marinahw.ae', role: 'front_desk', branch: 'Marina Clinic', packs: ['health'], status: 'active' },
      { id: 'm8', name: 'Nadia Rahman', email: 'nadia@marinahw.ae', role: 'accountant', branch: 'All branches', packs: ['health', 'memberships'], status: 'active' },
    ],
    documents: [
      { name: 'Trade licence', status: 'verified', expires: '2027-01-31' },
      { name: 'DHA facility licence', status: 'verified', expires: '2027-03-31' },
      { name: 'Medical malpractice insurance', status: 'verified', expires: '2027-01-31' },
      { name: 'Owner Emirates ID', status: 'verified', expires: '2029-02-11' },
    ],
  },
  {
    id: 'o3', name: 'Bright Futures Education', legalName: 'Bright Futures Education Centre LLC', entityType: 'company',
    tradeLicence: 'DED-3381200', emirate: 'Dubai', status: 'verified', initials: 'BF', colour: '#a0782a',
    branches: [
      { id: 'b6', name: 'Al Barsha Campus', area: 'Al Barsha', verticals: ['programs'] },
      { id: 'b7', name: 'Dubai Hills Sports Academy', area: 'Dubai Hills', verticals: ['programs'] },
    ],
    verticals: [
      { vertical: 'programs', status: 'approved', businessType: 'Training centre & academy', requestedAt: '2026-01-15',
        subcategories: ['programs.nursery', 'programs.course', 'programs.camp', 'programs.academy'],
        licences: [
          { name: 'KHDA early childhood centre permit', number: 'KHDA-ECC-1190', expires: '2027-08-31', status: 'valid' },
          { name: 'KHDA training institute permit', number: 'KHDA-TI-5521', expires: '2027-08-31', status: 'valid' },
        ] },
    ],
    members: [
      { id: 'm9', name: 'Layla Haddad', email: 'layla@alnoor.ae', role: 'owner', branch: 'All branches', packs: ['programs'], status: 'active' },
      { id: 'm10', name: 'Grace Okafor', email: 'grace@brightfutures.ae', role: 'front_desk', branch: 'Al Barsha Campus', packs: ['programs'], status: 'active' },
    ],
    documents: [
      { name: 'Trade licence', status: 'verified', expires: '2027-02-28' },
      { name: 'KHDA permits', status: 'verified', expires: '2027-08-31' },
      { name: 'Safeguarding policy', status: 'pending' },
    ],
  },
  {
    id: 'o4', name: 'Gulf Shield Brokers', legalName: 'Gulf Shield Insurance Brokers LLC', entityType: 'company',
    tradeLicence: 'DED-4409127', emirate: 'Dubai', status: 'verified', initials: 'GS', colour: '#33618a',
    branches: [{ id: 'b8', name: 'DIFC office', area: 'DIFC', verticals: ['insurance'] }],
    verticals: [
      { vertical: 'insurance', status: 'approved', businessType: 'Insurance broker', requestedAt: '2026-06-03',
        subcategories: ['insurance.motor', 'insurance.health', 'insurance.property'],
        licences: [{ name: 'CBUAE broker licence', number: 'CB-BRK-0442', expires: '2027-06-30', status: 'valid' }] },
    ],
    members: [
      { id: 'm11', name: 'Layla Haddad', email: 'layla@alnoor.ae', role: 'owner', branch: 'DIFC office', packs: ['insurance'], status: 'active' },
      { id: 'm12', name: 'Ravi Menon', email: 'ravi@gulfshield.ae', role: 'leasing_agent', branch: 'DIFC office', packs: ['insurance'], status: 'active' },
    ],
    documents: [
      { name: 'Trade licence', status: 'verified', expires: '2027-03-31' },
      { name: 'CBUAE broker licence', status: 'verified', expires: '2027-06-30' },
      { name: 'Professional indemnity cover', status: 'verified', expires: '2027-06-30' },
    ],
  },
];

export const LISTINGS: Listing[] = [
  { id: 'L-1001', orgId: 'o1', subKey: 'spaces.residential', title: '2BR apartment · Marina Gate 1', asset: 'Marina Gate 1 · Unit 1804', price: 145000, status: 'published', updated: '2026-10-02', photos: 12, attributes: { ptype: 'Apartment', beds: '2', size: '1,320', cheques: '4' } },
  { id: 'L-1002', orgId: 'o1', subKey: 'spaces.commercial', title: 'Fitted office · Bay Square 7', asset: 'Bay Square 7 · Office 402', price: 210000, status: 'published', updated: '2026-09-20', photos: 8, attributes: { ctype: 'Office', size: '1,850', zone: 'Mainland (DED)' } },
  { id: 'L-1003', orgId: 'o1', subKey: 'spaces.holiday', title: 'Sea-view studio · JBR', asset: 'Sadaf 4 · Unit 2203', price: 650, status: 'published', updated: '2026-10-10', photos: 14, attributes: { ptype: 'Studio', maxGuests: '2', minNights: '2', cancellation: 'Moderate' } },
  { id: 'L-1004', orgId: 'o1', subKey: 'spaces.holiday', title: '3BR villa with pool · Jumeirah', asset: 'Jumeirah Villa 12', price: 2400, status: 'awaiting_licence', updated: '2026-10-13', photos: 9, attributes: { ptype: 'Villa', maxGuests: '8', minNights: '3', cancellation: 'Strict' }, reviewNote: 'DTCM permit for this unit not yet uploaded.' },
  { id: 'L-1005', orgId: 'o1', subKey: 'spaces.venue', title: 'Rooftop terrace · Business Bay', asset: 'Bay Square 7 · Rooftop', price: 1800, status: 'published', updated: '2026-09-11', photos: 10, attributes: { venueType: 'Rooftop', capacity: '180', catering: 'External allowed' } },
  { id: 'L-1006', orgId: 'o1', subKey: 'spaces.court', title: 'Padel courts · Marina Sports Club', asset: 'Marina Sports Club · Courts 1–4', price: 240, status: 'published', updated: '2026-08-28', photos: 6, attributes: { sport: 'Padel', courts: '4', surface: 'Covered' } },
  { id: 'L-1007', orgId: 'o1', subKey: 'spaces.yacht', title: '62ft motor yacht · Sea Breeze', asset: 'Sea Breeze (62ft)', price: 1500, status: 'in_review', updated: '2026-10-14', photos: 11, attributes: { ytype: 'Motor yacht', length: '62', capacity: '25', minHours: '3' } },
  { id: 'L-1008', orgId: 'o1', subKey: 'spaces.residential', title: '1BR apartment · JVC Bloom Towers', asset: 'Bloom Towers · Unit 911', price: 78000, status: 'changes_requested', updated: '2026-10-08', photos: 4, attributes: { ptype: 'Apartment', beds: '1', size: '780', cheques: '6' }, reviewNote: 'Minimum 5 photos required for Spaces listings. Add the bathroom and kitchen.' },
  { id: 'L-1009', orgId: 'o1', subKey: 'services.cleaning', title: 'Deep clean · apartments & villas', asset: 'Cleaning crew A', price: 45, status: 'published', updated: '2026-09-01', photos: 5, attributes: { service: 'Deep clean', team: '3', minHours: '3' } },
  { id: 'L-1010', orgId: 'o1', subKey: 'services.ac', title: 'AC annual maintenance contract', asset: 'Technical team', price: 180, status: 'published', updated: '2026-08-15', photos: 4, attributes: { model: 'Annual contract (AMC)', acType: 'Split' } },
  { id: 'L-1011', orgId: 'o1', subKey: 'services.haircut', title: 'Marina Barbers · cuts & grooming', asset: 'Marina Barbers', price: 90, status: 'in_review', updated: '2026-10-12', photos: 6, attributes: { treatment: "Men's cut", duration: '45' } },
  { id: 'L-1012', orgId: 'o1', subKey: 'services.photography', title: 'Real estate photography & video', asset: 'Studio team', price: 950, status: 'draft', updated: '2026-10-11', photos: 2, attributes: { shoot: 'Real estate', duration: '3' } },
  { id: 'L-1013', orgId: 'o1', subKey: 'experiences.safari', title: 'Evening desert safari with BBQ', asset: 'Desert Camp', price: 295, status: 'published', updated: '2026-09-30', photos: 15, attributes: { session: 'Evening', groupMax: '40', pickup: 'Included' } },
  { id: 'L-1014', orgId: 'o1', subKey: 'experiences.workshop', title: 'Perfume-making workshop', asset: 'Al Quoz Studio', price: 380, status: 'in_review', updated: '2026-10-13', photos: 7, attributes: { topic: 'Perfume making', groupMax: '12', duration: '2' } },
  { id: 'L-1015', orgId: 'o2', subKey: 'health.doctor', title: 'Family medicine consultation', asset: 'Marina Clinic', price: 350, status: 'published', updated: '2026-09-14', photos: 4, attributes: { specialty: 'Family medicine', insurance: 'Daman' } },
  { id: 'L-1016', orgId: 'o2', subKey: 'health.dental', title: 'Check-up & hygiene clean', asset: 'Marina Clinic', price: 420, status: 'published', updated: '2026-09-14', photos: 5, attributes: { treatment: 'Check-up & cleaning' } },
  { id: 'L-1017', orgId: 'o2', subKey: 'health.physio', title: 'Sports physiotherapy', asset: 'Marina Clinic', price: 400, status: 'in_review', updated: '2026-10-14', photos: 3, attributes: { session: '45 min' } },
  { id: 'L-1018', orgId: 'o2', subKey: 'memberships.gym', title: 'JLT Fitness · monthly membership', asset: 'JLT Fitness Studio', price: 450, status: 'published', updated: '2026-07-01', photos: 9, attributes: { access: 'Single club', billing: 'Monthly' } },
  { id: 'L-1019', orgId: 'o2', subKey: 'memberships.credits', title: '20-class pack · yoga & pilates', asset: 'JLT Fitness Studio', price: 1200, status: 'published', updated: '2026-07-01', photos: 6, attributes: { activity: 'Yoga', credits: '20', validity: '4' } },
  { id: 'L-1020', orgId: 'o3', subKey: 'programs.nursery', title: 'Little Stars Nursery · EYFS', asset: 'Al Barsha Campus', price: 14500, status: 'published', updated: '2026-06-01', photos: 10, attributes: { curriculum: 'EYFS', ages: '18 months – 4 years' } },
  { id: 'L-1021', orgId: 'o3', subKey: 'programs.course', title: 'Data & AI bootcamp (12 weeks)', asset: 'Al Barsha Campus', price: 9800, status: 'published', updated: '2026-08-20', photos: 4, attributes: { subject: 'Data & AI', weeks: '12' } },
  { id: 'L-1022', orgId: 'o3', subKey: 'programs.academy', title: 'Junior football academy', asset: 'Dubai Hills Sports Academy', price: 2600, status: 'in_review', updated: '2026-10-12', photos: 2, attributes: { sport: 'Football', ages: '6 – 14' } },
  { id: 'L-1023', orgId: 'o4', subKey: 'insurance.motor', title: 'Comprehensive motor cover', asset: 'Panel of 6 insurers', price: 1450, status: 'published', updated: '2026-08-05', photos: 0, attributes: { cover: 'Comprehensive', deductible: '500' } },
  { id: 'L-1024', orgId: 'o4', subKey: 'insurance.health', title: 'Family health plans (EBP compliant)', asset: 'Panel of 4 insurers', price: 4800, status: 'published', updated: '2026-08-05', photos: 0, attributes: { network: 'Enhanced', copay: '10' } },
  { id: 'L-1025', orgId: 'o4', subKey: 'insurance.property', title: 'Landlord property insurance', asset: 'Panel of 3 insurers', price: 900, status: 'in_review', updated: '2026-10-14', photos: 0, attributes: { cover: 'Landlord', deductible: '1000' } },
];

export const LEADS: Lead[] = [
  { id: 'Q-501', orgId: 'o1', subKey: 'spaces.residential', customer: 'Ahmed Al Mansoori', phone: '+971 50 214 7781', source: 'Bayut', listing: '2BR apartment · Marina Gate 1', received: '2026-10-15 09:12', stage: 'new', assignee: 'Omar Siddiqui', message: 'Interested in a 4-cheque option, family of 3, moving in November.' },
  { id: 'Q-502', orgId: 'o1', subKey: 'spaces.holiday', customer: 'Sophie Laurent', phone: '+33 6 12 44 90 11', source: 'UpNow', listing: 'Sea-view studio · JBR', received: '2026-10-15 08:40', stage: 'new', assignee: 'Karim Fares', message: '4 nights from 22 Oct, 2 adults.' },
  { id: 'Q-503', orgId: 'o1', subKey: 'spaces.venue', customer: 'Northwind Consulting', phone: '+971 4 388 1200', source: 'Email', listing: 'Rooftop terrace · Business Bay', received: '2026-10-14 16:05', stage: 'contacted', assignee: 'Omar Siddiqui', message: 'Corporate year-end dinner, ~120 guests, 12 Dec, evening.' },
  { id: 'Q-504', orgId: 'o1', subKey: 'spaces.court', customer: 'Daniel Costa', phone: '+971 55 902 1188', source: 'Instagram', listing: 'Padel courts · Marina Sports Club', received: '2026-10-14 19:30', stage: 'new', assignee: 'Karim Fares', message: 'Weekly Tuesday 8pm court for 4 players, from next week.' },
  { id: 'Q-505', orgId: 'o1', subKey: 'spaces.yacht', customer: 'Fatima Al Suwaidi', phone: '+971 52 771 4402', source: 'WhatsApp', listing: '62ft motor yacht · Sea Breeze', received: '2026-10-14 11:18', stage: 'qualified', assignee: 'Layla Haddad', message: 'Birthday cruise for 18 guests, Saturday 24 Oct, 4 hours.' },
  { id: 'Q-506', orgId: 'o1', subKey: 'spaces.commercial', customer: 'Tamimi Trading FZE', phone: '+971 4 455 9012', source: 'Property Finder', listing: 'Fitted office · Bay Square 7', received: '2026-10-13 10:02', stage: 'qualified', assignee: 'Omar Siddiqui', message: 'Need 1,800 sqft for 15 staff, mainland licence, from January.' },
  { id: 'Q-507', orgId: 'o1', subKey: 'services.ac', customer: 'Mariam Qasim', phone: '+971 50 330 2290', source: 'UpNow', listing: 'AC annual maintenance contract', received: '2026-10-15 07:55', stage: 'new', assignee: 'Layla Haddad', message: 'Villa in Arabian Ranches, 6 split units, wants an annual contract.' },
  { id: 'Q-508', orgId: 'o1', subKey: 'services.cleaning', customer: 'James Whitfield', phone: '+971 58 112 6609', source: 'Phone', listing: 'Deep clean · apartments & villas', received: '2026-10-14 14:22', stage: 'contacted', assignee: 'Layla Haddad', message: 'Move-out deep clean for a 2BR in JLT, Monday.' },
  { id: 'Q-509', orgId: 'o1', subKey: 'experiences.safari', customer: 'Chen Wei', phone: '+86 138 0013 2201', source: 'UpNow', listing: 'Evening desert safari with BBQ', received: '2026-10-15 06:30', stage: 'new', assignee: 'Hana Yousef', message: 'Group of 6, Saturday evening, hotel pickup from Downtown.' },
  { id: 'Q-510', orgId: 'o1', subKey: 'services.photography', customer: 'Emaar Holiday Lets', phone: '+971 4 220 9000', source: 'Email', listing: 'Real estate photography & video', received: '2026-10-12 12:10', stage: 'qualified', assignee: 'Layla Haddad', message: '12 units to shoot across Downtown, need video walkthroughs.' },
  { id: 'Q-511', orgId: 'o2', subKey: 'health.doctor', customer: 'Patient (restricted)', phone: 'Hidden', source: 'UpNow', listing: 'Family medicine consultation', received: '2026-10-15 08:05', stage: 'new', assignee: 'Dr. Sameer Khan', message: 'Appointment request — details visible to clinical staff only.' },
  { id: 'Q-512', orgId: 'o2', subKey: 'memberships.gym', customer: 'Lucas Martins', phone: '+971 54 776 3021', source: 'Instagram', listing: 'JLT Fitness · monthly membership', received: '2026-10-14 18:44', stage: 'contacted', assignee: 'Nadia Rahman', message: 'Wants a free visit this weekend before signing up.' },
  { id: 'Q-513', orgId: 'o3', subKey: 'programs.nursery', customer: 'Aisha & Rashid Al Hammadi', phone: '+971 50 991 2043', source: 'UpNow', listing: 'Little Stars Nursery · EYFS', received: '2026-10-14 09:15', stage: 'new', assignee: 'Grace Okafor', message: 'Tour request for their 2-year-old, January intake.' },
  { id: 'Q-514', orgId: 'o3', subKey: 'programs.course', customer: 'Kavya Iyer', phone: '+971 56 401 7765', source: 'Email', listing: 'Data & AI bootcamp (12 weeks)', received: '2026-10-13 20:01', stage: 'contacted', assignee: 'Grace Okafor', message: 'Can I join the evening cohort while working full time?' },
  { id: 'Q-515', orgId: 'o4', subKey: 'insurance.motor', customer: 'Yousef Badr', phone: '+971 55 210 4499', source: 'UpNow', listing: 'Comprehensive motor cover', received: '2026-10-15 10:20', stage: 'new', assignee: 'Ravi Menon', message: '2024 Toyota Land Cruiser, renewal due 1 Nov.' },
  { id: 'Q-516', orgId: 'o4', subKey: 'insurance.health', customer: 'Elena Petrova', phone: '+971 52 600 1187', source: 'WhatsApp', listing: 'Family health plans (EBP compliant)', received: '2026-10-14 15:40', stage: 'qualified', assignee: 'Ravi Menon', message: 'Family of 4, needs maternity cover.' },
];

export const CUSTOMERS: Customer[] = [
  { id: 'C-01', name: 'Ahmed Al Mansoori', email: 'ahmed.m@mail.ae', phone: '+971 50 214 7781', since: '2024-01-12', tags: ['spaces', 'services'], lifetimeValue: 312000 },
  { id: 'C-02', name: 'Sophie Laurent', email: 'sophie.l@mail.fr', phone: '+33 6 12 44 90 11', since: '2026-10-15', tags: ['spaces'], lifetimeValue: 0 },
  { id: 'C-03', name: 'Northwind Consulting', email: 'events@northwind.ae', phone: '+971 4 388 1200', since: '2025-11-02', tags: ['spaces'], lifetimeValue: 21600 },
  { id: 'C-04', name: 'Daniel Costa', email: 'dcosta@mail.com', phone: '+971 55 902 1188', since: '2026-02-18', tags: ['spaces', 'experiences'], lifetimeValue: 5520 },
  { id: 'C-05', name: 'Fatima Al Suwaidi', email: 'fatima.s@mail.ae', phone: '+971 52 771 4402', since: '2025-06-09', tags: ['spaces', 'experiences'], lifetimeValue: 14900 },
  { id: 'C-06', name: 'Tamimi Trading FZE', email: 'admin@tamimi.ae', phone: '+971 4 455 9012', since: '2026-10-13', tags: ['spaces'], lifetimeValue: 0 },
  { id: 'C-07', name: 'Mariam Qasim', email: 'mariam.q@mail.ae', phone: '+971 50 330 2290', since: '2025-03-30', tags: ['services'], lifetimeValue: 3240 },
  { id: 'C-08', name: 'James Whitfield', email: 'jwhitfield@mail.co.uk', phone: '+971 58 112 6609', since: '2023-09-01', tags: ['spaces', 'services'], lifetimeValue: 248500 },
  { id: 'C-09', name: 'Chen Wei', email: 'chen.wei@mail.cn', phone: '+86 138 0013 2201', since: '2026-10-15', tags: ['experiences'], lifetimeValue: 0 },
  { id: 'C-10', name: 'Hessa Al Ketbi', email: 'hessa.k@mail.ae', phone: '+971 50 118 2290', since: '2022-07-15', tags: ['spaces'], lifetimeValue: 540000 },
  { id: 'C-11', name: 'Rohan Kapoor', email: 'rohan.k@mail.in', phone: '+971 56 223 9081', since: '2025-12-01', tags: ['spaces', 'services', 'experiences'], lifetimeValue: 96400 },
  { id: 'C-12', name: 'Lucas Martins', email: 'lucas.m@mail.br', phone: '+971 54 776 3021', since: '2026-10-14', tags: ['memberships'], lifetimeValue: 0 },
  { id: 'C-13', name: 'Aisha Al Hammadi', email: 'aisha.h@mail.ae', phone: '+971 50 991 2043', since: '2026-10-14', tags: ['programs'], lifetimeValue: 0 },
  { id: 'C-14', name: 'Yousef Badr', email: 'yousef.b@mail.ae', phone: '+971 55 210 4499', since: '2024-11-01', tags: ['insurance'], lifetimeValue: 1450 },
];

export const INVOICES: Invoice[] = [
  { id: 'INV-24051', orgId: 'o1', vertical: 'spaces', customer: 'Hessa Al Ketbi', description: 'Rent cheque 2/4 · Marina Gate 1 #1804', amount: 36250, due: '2026-10-15', status: 'issued', method: 'Cheque (PDC)' },
  { id: 'INV-24052', orgId: 'o1', vertical: 'spaces', customer: 'Rohan Kapoor', description: 'Rent cheque 3/6 · Bloom Towers #911', amount: 13000, due: '2026-10-01', status: 'overdue', method: 'Cheque (PDC)' },
  { id: 'INV-24053', orgId: 'o1', vertical: 'spaces', customer: 'Fatima Al Suwaidi', description: 'Charter deposit · Sea Breeze 24 Oct', amount: 3000, due: '2026-10-16', status: 'issued', method: 'Card' },
  { id: 'INV-24054', orgId: 'o1', vertical: 'spaces', customer: 'Northwind Consulting', description: 'Venue deposit (30%) · Rooftop 12 Dec', amount: 6480, due: '2026-10-20', status: 'draft', method: 'Bank transfer' },
  { id: 'INV-24055', orgId: 'o1', vertical: 'spaces', customer: 'Daniel Costa', description: 'Padel court · Court 2 · 13 Oct 20:00', amount: 240, due: '2026-10-13', status: 'paid', method: 'Card' },
  { id: 'INV-24056', orgId: 'o1', vertical: 'services', customer: 'James Whitfield', description: 'Move-out deep clean · JLT 2BR', amount: 720, due: '2026-10-19', status: 'issued', method: 'Card' },
  { id: 'INV-24057', orgId: 'o1', vertical: 'services', customer: 'Mariam Qasim', description: 'AC service visit · 6 units', amount: 1080, due: '2026-10-08', status: 'paid', method: 'Card' },
  { id: 'INV-24058', orgId: 'o1', vertical: 'experiences', customer: 'Rohan Kapoor', description: 'Evening safari · 4 guests', amount: 1180, due: '2026-10-11', status: 'refunded', method: 'Card' },
  { id: 'INV-24059', orgId: 'o1', vertical: 'experiences', customer: 'Daniel Costa', description: 'Perfume workshop · 2 seats', amount: 760, due: '2026-10-17', status: 'paid', method: 'Card' },
  { id: 'INV-24060', orgId: 'o1', vertical: 'spaces', customer: 'Ahmed Al Mansoori', description: 'Holiday stay · Sadaf 4 #2203 · 3 nights', amount: 1950, due: '2026-10-09', status: 'paid', method: 'Card' },
  { id: 'INV-30011', orgId: 'o2', vertical: 'memberships', customer: 'Lucas Martins', description: 'Monthly membership · Oct', amount: 450, due: '2026-10-18', status: 'draft', method: 'Card' },
  { id: 'INV-30012', orgId: 'o2', vertical: 'health', customer: 'Patient #P-2210', description: 'Consultation · insurer claim (Daman)', amount: 350, due: '2026-10-14', status: 'issued', method: 'Bank transfer' },
  { id: 'INV-40021', orgId: 'o3', vertical: 'programs', customer: 'Kavya Iyer', description: 'Data & AI bootcamp · instalment 1/2', amount: 4900, due: '2026-10-25', status: 'issued', method: 'Bank transfer' },
  { id: 'INV-50031', orgId: 'o4', vertical: 'insurance', customer: 'Gulf Insurance Co.', description: 'Broker commission · September', amount: 18400, due: '2026-10-10', status: 'paid', method: 'Bank transfer' },
];

export const DEPOSITS: Deposit[] = [
  { id: 'DEP-881', orgId: 'o1', vertical: 'spaces', customer: 'Hessa Al Ketbi', reference: 'Lease · Marina Gate 1 #1804', amount: 7250, status: 'held' },
  { id: 'DEP-882', orgId: 'o1', vertical: 'spaces', customer: 'Rohan Kapoor', reference: 'Lease · Bloom Towers #911', amount: 3900, status: 'held' },
  { id: 'DEP-883', orgId: 'o1', vertical: 'spaces', customer: 'Fatima Al Suwaidi', reference: 'Charter · Sea Breeze · 24 Oct', amount: 3000, status: 'held' },
  { id: 'DEP-884', orgId: 'o1', vertical: 'spaces', customer: 'Ahmed Al Mansoori', reference: 'Stay · Sadaf 4 #2203 · damage deposit', amount: 1000, status: 'released' },
  { id: 'DEP-885', orgId: 'o1', vertical: 'spaces', customer: 'James Whitfield', reference: 'Lease ended · Al Quoz WH-3', amount: 15000, status: 'partially_released' },
];

export const PAYOUTS: Payout[] = [
  { id: 'PO-7781', orgId: 'o1', period: '1–15 Oct 2026', gross: 18450, fees: 1290, status: 'scheduled' },
  { id: 'PO-7702', orgId: 'o1', period: '16–30 Sep 2026', gross: 22310, fees: 1560, status: 'paid' },
  { id: 'PO-7650', orgId: 'o1', period: '1–15 Sep 2026', gross: 19980, fees: 1400, status: 'paid' },
  { id: 'PO-8810', orgId: 'o2', period: '1–15 Oct 2026', gross: 31200, fees: 2180, status: 'scheduled' },
];

export const AUDIT: AuditEvent[] = [
  { id: 'A-1', at: '2026-10-15 09:14', actor: 'Omar Siddiqui', context: 'Al Noor Holdings', action: 'Viewed enquiry', entity: 'Q-501' },
  { id: 'A-2', at: '2026-10-14 17:02', actor: 'UpNow Admin · Sara', context: 'Admin', action: 'Requested changes on listing', entity: 'L-1008' },
  { id: 'A-3', at: '2026-10-14 11:40', actor: 'Layla Haddad', context: 'Al Noor Holdings', action: 'Submitted listing for review', entity: 'L-1007' },
  { id: 'A-4', at: '2026-10-13 15:20', actor: 'Priya Nair', context: 'Al Noor Holdings', action: 'Marked cheque 1/4 cleared', entity: 'INV-23990' },
  { id: 'A-5', at: '2026-10-09 10:05', actor: 'Layla Haddad', context: 'Al Noor Holdings', action: 'Requested access to Memberships', entity: 'memberships' },
];

export const APPLICATIONS: ProviderApplication[] = [
  { id: 'APP-301', orgName: 'Palm Stays Holiday Homes', entityType: 'company', vertical: 'spaces', businessType: 'Holiday home operator', submitted: '2026-10-14', status: 'pending_review', contact: 'Reem Al Nuaimi', emirate: 'Dubai',
    documents: [{ name: 'Trade licence', ok: true }, { name: 'DTCM holiday home operator licence', ok: true }, { name: 'Owner Emirates ID', ok: true }, { name: 'Bank account letter', ok: false }] },
  { id: 'APP-302', orgName: 'Sparkle Home Services', entityType: 'company', vertical: 'services', businessType: 'Services company', submitted: '2026-10-13', status: 'pending_review', contact: 'Joseph Mathew', emirate: 'Sharjah',
    documents: [{ name: 'Trade licence', ok: true }, { name: 'Owner Emirates ID', ok: true }, { name: 'Public liability insurance', ok: true }] },
  { id: 'APP-303', orgName: 'Nadia Karim (Make-up artist)', entityType: 'individual', vertical: 'services', businessType: 'Freelancer (UAE permit)', submitted: '2026-10-12', status: 'pending_review', contact: 'Nadia Karim', emirate: 'Dubai',
    documents: [{ name: 'Freelance permit', ok: true }, { name: 'Emirates ID', ok: true }, { name: 'Portfolio (6 photos)', ok: true }] },
  { id: 'APP-304', orgName: 'Dune Riders Adventures', entityType: 'company', vertical: 'experiences', businessType: 'Tour operator', submitted: '2026-10-10', status: 'changes_requested', contact: 'Ali Hassan', emirate: 'Dubai', note: 'Desert safari permit expired 30 Sep — upload the renewed permit.',
    documents: [{ name: 'Trade licence', ok: true }, { name: 'DTCM tour operator licence', ok: true }, { name: 'Desert safari permit', ok: false }] },
  { id: 'APP-305', orgName: 'Smile Republic Dental', entityType: 'company', vertical: 'health', businessType: 'Healthcare facility', submitted: '2026-10-11', status: 'pending_review', contact: 'Dr. Lina Saab', emirate: 'Dubai',
    documents: [{ name: 'Trade licence', ok: true }, { name: 'DHA facility licence', ok: true }, { name: 'Malpractice insurance', ok: true }, { name: 'Medical director DHA licence', ok: true }] },
  { id: 'APP-306', orgName: 'Crescent Insurance Agency', entityType: 'company', vertical: 'insurance', businessType: 'Insurance agency', submitted: '2026-10-09', status: 'pending_review', contact: 'Imran Qureshi', emirate: 'Abu Dhabi',
    documents: [{ name: 'Trade licence', ok: true }, { name: 'CBUAE agent licence', ok: true }, { name: 'Agency agreement with insurer', ok: false }] },
];

// ── Static operational reference data (read-only in the prototype) ─────────
export const STAY_UNITS = [
  { id: 'su1', name: 'Sadaf 4 · Studio 2203', rate: 650 },
  { id: 'su2', name: 'Marina Gate 2 · 1BR 905', rate: 820 },
  { id: 'su3', name: 'Jumeirah Villa 12 · 3BR', rate: 2400 },
];
export const COURTS = ['Court 1', 'Court 2', 'Court 3', 'Court 4'];
export const COURT_HOURS = [7, 8, 9, 10, 16, 17, 18, 19, 20, 21, 22];
export const VESSELS = [
  { id: 'v1', name: 'Sea Breeze', type: '62ft motor yacht', capacity: 25, rate: 1500, crew: 'Capt. Marco Silva + 2' },
  { id: 'v2', name: 'Pearl Runner', type: '42ft catamaran', capacity: 14, rate: 900, crew: 'Capt. Faisal Omar + 1' },
  { id: 'v3', name: 'Blue Fin', type: '28ft speed boat', capacity: 6, rate: 600, crew: 'Capt. Ivan Petrov' },
];
export const SERVICE_STAFF = ['Ali (barber)', 'Rosa (barber)', 'Tom (stylist)'];
export const TECHNICIANS = ['Rahul Verma', 'Joel Fernandes', 'Sajid Ali', 'Mark Tan'];
export const PRACTITIONERS = [
  { id: 'p1', name: 'Dr. Sameer Khan', specialty: 'Family medicine', licence: 'DHA-P-0021345', expires: '2027-02-28', days: 'Sun–Thu' },
  { id: 'p2', name: 'Dr. Hala Mourad', specialty: 'Dentistry', licence: 'DHA-P-0039912', expires: '2026-12-15', days: 'Mon–Sat' },
  { id: 'p3', name: 'Ben Carter', specialty: 'Physiotherapy', licence: 'DHA-P-0051177', expires: '2027-07-01', days: 'Mon–Fri' },
  { id: 'p4', name: 'Dr. Noor Aziz', specialty: 'Clinical psychology', licence: 'DHA-P-0062290', expires: '2027-04-10', days: 'Tue–Sat' },
];
export const MEMBERSHIP_PLANS = [
  { id: 'pl1', name: 'Monthly', price: 450, unit: '/month', benefits: ['Gym floor access', '4 group classes / month', 'Locker'], members: 142 },
  { id: 'pl2', name: 'Annual', price: 4200, unit: '/year', benefits: ['Unlimited classes', '2 guest passes / month', 'Free towel service', '1 PT session / quarter'], members: 96 },
  { id: 'pl3', name: '20-class pack', price: 1200, unit: '/package', benefits: ['20 class credits', 'Valid 4 months', 'Yoga, pilates, HIIT'], members: 58 },
];
export const LEARNERS = ['Zayed A.', 'Mira K.', 'Omar S.', 'Leah P.', 'Yusuf R.', 'Ava T.', 'Ibrahim H.', 'Sana M.'];
export const ATTENDANCE_DAYS = ['Mon 12', 'Tue 13', 'Wed 14', 'Thu 15'];

const w = (
  id: string, orgId: string, dataset: string, title: string, customer: string, stage: string,
  rest: Partial<WorkItem> = {},
): WorkItem => ({ id, orgId, dataset, title, customer, stage, meta: {}, ...rest });

export const WORK: WorkItem[] = [
  // Spaces · holiday stays (meta.unit, meta.nights)
  w('ST-01', 'o1', 'stays', '3 nights', 'Ahmed Al Mansoori', 'checked_out', { date: '2026-10-06', amount: 1950, meta: { unit: 'su1', nights: 3, guests: 2 } }),
  w('ST-02', 'o1', 'stays', '4 nights', 'Grace Lim', 'checked_in', { date: '2026-10-13', amount: 3280, meta: { unit: 'su2', nights: 4, guests: 3 } }),
  w('ST-03', 'o1', 'stays', '2 nights', 'Marco Bianchi', 'confirmed', { date: '2026-10-16', amount: 1300, meta: { unit: 'su1', nights: 2, guests: 2 } }),
  w('ST-04', 'o1', 'stays', '5 nights', 'The Okonkwo family', 'requested', { date: '2026-10-19', amount: 12000, meta: { unit: 'su3', nights: 5, guests: 7 } }),
  w('ST-05', 'o1', 'stays', '3 nights', 'Hannah Becker', 'confirmed', { date: '2026-10-22', amount: 2460, meta: { unit: 'su2', nights: 3, guests: 2 } }),
  // Spaces · venue events
  w('EV-01', 'o1', 'venue_events', 'Year-end dinner · 120 guests', 'Northwind Consulting', 'quote_sent', { date: '2026-12-12', amount: 21600, meta: { venue: 'Rooftop terrace', slot: '19:00–23:00' } }),
  w('EV-02', 'o1', 'venue_events', 'Product launch · 80 guests', 'Lumen Tech', 'deposit_paid', { date: '2026-10-29', amount: 9800, meta: { venue: 'Rooftop terrace', slot: '18:00–22:00' } }),
  w('EV-03', 'o1', 'venue_events', 'Wedding reception · 160 guests', 'Al Shamsi family', 'enquiry', { date: '2027-02-14', amount: 0, meta: { venue: 'Rooftop terrace', slot: 'Full day' } }),
  w('EV-04', 'o1', 'venue_events', 'Board offsite · 24 guests', 'Gulf Ports Co.', 'site_visit', { date: '2026-11-05', amount: 4200, meta: { venue: 'Meeting suite', slot: '09:00–17:00' } }),
  w('EV-05', 'o1', 'venue_events', 'Charity gala · 150 guests', 'Hope Foundation', 'completed', { date: '2026-10-03', amount: 18000, meta: { venue: 'Rooftop terrace', slot: '19:00–00:00' } }),
  // Spaces · court bookings (meta.court, meta.hour) — demo day TODAY
  w('CB-01', 'o1', 'courts', 'Padel · 4 players', 'Daniel Costa', 'confirmed', { date: TODAY, meta: { court: 'Court 2', hour: 20, recurring: 'Weekly' } }),
  w('CB-02', 'o1', 'courts', 'Padel · 4 players', 'Rohan Kapoor', 'confirmed', { date: TODAY, meta: { court: 'Court 1', hour: 18, recurring: 'One-off' } }),
  w('CB-03', 'o1', 'courts', 'Coaching session', 'Marina Padel Academy', 'confirmed', { date: TODAY, meta: { court: 'Court 3', hour: 9, recurring: 'Weekly' } }),
  w('CB-04', 'o1', 'courts', 'Padel · 2 players', 'Sara Lindqvist', 'held', { date: TODAY, meta: { court: 'Court 1', hour: 19, recurring: 'One-off' } }),
  w('CB-05', 'o1', 'courts', 'League match', 'Dubai Padel League', 'confirmed', { date: TODAY, meta: { court: 'Court 4', hour: 21, recurring: 'Weekly' } }),
  w('CB-06', 'o1', 'courts', 'Padel · 4 players', 'Omar Haddad', 'confirmed', { date: TODAY, meta: { court: 'Court 2', hour: 7, recurring: 'One-off' } }),
  // Spaces · charters
  w('CH-01', 'o1', 'charters', 'Birthday cruise · 4h', 'Fatima Al Suwaidi', 'deposit_paid', { date: '2026-10-24', time: '16:00', amount: 6000, meta: { vessel: 'Sea Breeze', guests: 18, manifest: 11 } }),
  w('CH-02', 'o1', 'charters', 'Sunset cruise · 2h', 'Hiroshi Tanaka', 'manifest_complete', { date: '2026-10-17', time: '17:30', amount: 1800, meta: { vessel: 'Pearl Runner', guests: 8, manifest: 8 } }),
  w('CH-03', 'o1', 'charters', 'Fishing trip · 4h', 'Liam O’Connor', 'enquiry', { date: '2026-10-25', time: '06:00', amount: 2400, meta: { vessel: 'Blue Fin', guests: 4, manifest: 0 } }),
  w('CH-04', 'o1', 'charters', 'Corporate cruise · 3h', 'Lumen Tech', 'completed', { date: '2026-10-10', time: '18:00', amount: 4500, meta: { vessel: 'Sea Breeze', guests: 22, manifest: 22 } }),
  // Services · field jobs
  w('JB-01', 'o1', 'jobs', 'AC service · 6 split units', 'Mariam Qasim', 'scheduled', { date: '2026-10-16', time: '10:00', amount: 1080, assignee: 'Rahul Verma', meta: { area: 'Arabian Ranches', sub: 'AC maintenance' } }),
  w('JB-02', 'o1', 'jobs', 'Move-out deep clean · 2BR', 'James Whitfield', 'quoted', { date: '2026-10-19', time: '09:00', amount: 720, meta: { area: 'JLT', sub: 'Cleaning' } }),
  w('JB-03', 'o1', 'jobs', 'Leaking kitchen tap', 'Hessa Al Ketbi', 'in_progress', { date: TODAY, time: '11:30', amount: 250, assignee: 'Joel Fernandes', meta: { area: 'Dubai Marina', sub: 'Handyman' } }),
  w('JB-04', 'o1', 'jobs', 'TV mounting · 2 screens', 'Rohan Kapoor', 'request', { date: '2026-10-18', amount: 0, meta: { area: 'JVC', sub: 'Handyman' } }),
  w('JB-05', 'o1', 'jobs', 'Regular clean · weekly', 'Ahmed Al Mansoori', 'completed', { date: '2026-10-12', time: '14:00', amount: 180, assignee: 'Sajid Ali', meta: { area: 'Dubai Marina', sub: 'Cleaning' } }),
  w('JB-06', 'o1', 'jobs', 'AC not cooling · urgent', 'Tamimi Trading FZE', 'request', { date: TODAY, amount: 0, meta: { area: 'Business Bay', sub: 'AC maintenance' } }),
  // Services · appointments (meta.staff, meta.hour)
  w('AP-01', 'o1', 'appointments', "Men's cut", 'Karim N.', 'confirmed', { date: TODAY, meta: { staff: 'Ali (barber)', hour: 10, duration: 45 } }),
  w('AP-02', 'o1', 'appointments', 'Beard trim', 'Rohan Kapoor', 'confirmed', { date: TODAY, meta: { staff: 'Ali (barber)', hour: 12, duration: 30 } }),
  w('AP-03', 'o1', 'appointments', 'Kids cut', 'Daniel Costa', 'requested', { date: TODAY, meta: { staff: 'Rosa (barber)', hour: 11, duration: 30 } }),
  w('AP-04', 'o1', 'appointments', 'Colour', 'Elena Petrova', 'confirmed', { date: TODAY, meta: { staff: 'Tom (stylist)', hour: 14, duration: 90 } }),
  w('AP-05', 'o1', 'appointments', "Men's cut", 'Walk-in', 'completed', { date: TODAY, meta: { staff: 'Rosa (barber)', hour: 9, duration: 45 } }),
  // Services · quoted projects
  w('PR-01', 'o1', 'projects', '12-unit photo & video shoot', 'Emaar Holiday Lets', 'brief', { amount: 0, date: '2026-10-28', meta: { sub: 'Photography' } }),
  w('PR-02', 'o1', 'projects', 'Office fit-out photography', 'Bay Square Mgmt', 'quote_sent', { amount: 4500, date: '2026-10-22', meta: { sub: 'Photography' } }),
  w('PR-03', 'o1', 'projects', 'Villa listing shoot', 'Hessa Al Ketbi', 'accepted', { amount: 950, date: '2026-10-17', meta: { sub: 'Photography' } }),
  w('PR-04', 'o1', 'projects', 'Brochure photography', 'Lumen Tech', 'delivered', { amount: 3200, date: '2026-10-05', meta: { sub: 'Photography' } }),
  // Experiences · sessions (meta.capacity, meta.booked)
  w('SE-01', 'o1', 'sessions', 'Evening desert safari', 'Desert Camp', 'scheduled', { date: TODAY, time: '15:30', amount: 295, assignee: 'Guide: Saeed', meta: { capacity: 40, booked: 34, sub: 'Desert safari' } }),
  w('SE-02', 'o1', 'sessions', 'Evening desert safari', 'Desert Camp', 'scheduled', { date: '2026-10-16', time: '15:30', amount: 295, assignee: 'Guide: Saeed', meta: { capacity: 40, booked: 40, sub: 'Desert safari' } }),
  w('SE-03', 'o1', 'sessions', 'Old Dubai walking tour', 'Al Fahidi', 'scheduled', { date: '2026-10-16', time: '09:00', amount: 150, assignee: 'Guide: Mona', meta: { capacity: 15, booked: 6, sub: 'Tour' } }),
  w('SE-04', 'o1', 'sessions', 'Perfume-making workshop', 'Al Quoz Studio', 'scheduled', { date: '2026-10-17', time: '11:00', amount: 380, assignee: 'Host: Leila', meta: { capacity: 12, booked: 9, sub: 'Workshop' } }),
  w('SE-05', 'o1', 'sessions', 'Overnight desert safari', 'Desert Camp', 'scheduled', { date: '2026-10-17', time: '15:00', amount: 650, assignee: 'Guide: Saeed', meta: { capacity: 20, booked: 3, sub: 'Desert safari' } }),
  w('SE-06', 'o1', 'sessions', 'Evening desert safari', 'Desert Camp', 'completed', { date: '2026-10-14', time: '15:30', amount: 295, assignee: 'Guide: Saeed', meta: { capacity: 40, booked: 37, sub: 'Desert safari' } }),
  // Experiences · reservations
  w('RS-01', 'o1', 'reservations', 'Evening desert safari · 6 seats', 'Chen Wei', 'pending', { date: TODAY, amount: 1770, meta: { session: 'SE-01', seats: 6, pickup: 'Downtown — Address Hotel' } }),
  w('RS-02', 'o1', 'reservations', 'Evening desert safari · 4 seats', 'Rohan Kapoor', 'confirmed', { date: TODAY, amount: 1180, meta: { session: 'SE-01', seats: 4, pickup: 'JVC' } }),
  w('RS-03', 'o1', 'reservations', 'Perfume-making workshop · 2 seats', 'Daniel Costa', 'confirmed', { date: '2026-10-17', amount: 760, meta: { session: 'SE-04', seats: 2, pickup: '—' } }),
  w('RS-04', 'o1', 'reservations', 'Old Dubai walking tour · 3 seats', 'Fatima Al Suwaidi', 'checked_in', { date: '2026-10-16', amount: 450, meta: { session: 'SE-03', seats: 3, pickup: '—' } }),
  // Memberships · members (meta.plan, meta.credits, meta.renews)
  w('MB-01', 'o2', 'members', 'Monthly', 'Lucas Martins', 'trial', { date: '2026-10-17', amount: 450, meta: { plan: 'Monthly', credits: 0, renews: '—', checkins: 0 } }),
  w('MB-02', 'o2', 'members', 'Annual', 'Hessa Al Ketbi', 'active', { date: '2026-03-01', amount: 4200, meta: { plan: 'Annual', credits: 0, renews: '2027-03-01', checkins: 88 } }),
  w('MB-03', 'o2', 'members', '20-class pack', 'Sophie Laurent', 'active', { date: '2026-09-02', amount: 1200, meta: { plan: '20-class pack', credits: 13, renews: '2027-01-02', checkins: 7 } }),
  w('MB-04', 'o2', 'members', 'Monthly', 'Rohan Kapoor', 'frozen', { date: '2026-06-10', amount: 450, meta: { plan: 'Monthly', credits: 0, renews: '2026-11-10', checkins: 41 } }),
  w('MB-05', 'o2', 'members', 'Monthly', 'Grace Lim', 'renewal_due', { date: '2025-10-20', amount: 450, meta: { plan: 'Monthly', credits: 0, renews: '2026-10-20', checkins: 132 } }),
  w('MB-06', 'o2', 'members', '20-class pack', 'Elena Petrova', 'active', { date: '2026-08-14', amount: 1200, meta: { plan: '20-class pack', credits: 2, renews: '2026-12-14', checkins: 18 } }),
  w('MB-07', 'o2', 'members', 'Annual', 'Daniel Costa', 'expired', { date: '2025-09-30', amount: 4200, meta: { plan: 'Annual', credits: 0, renews: '2026-09-30', checkins: 150 } }),
  // Programs · applications
  w('AD-01', 'o3', 'applications', 'Nursery · Jan intake', 'Aisha & Rashid Al Hammadi', 'tour_booked', { date: '2026-10-18', meta: { child: 'Hamdan (2y)', program: 'Little Stars Nursery' } }),
  w('AD-02', 'o3', 'applications', 'Nursery · Jan intake', 'Priya & Arjun Shah', 'submitted', { date: '2026-10-11', meta: { child: 'Anaya (3y)', program: 'Little Stars Nursery' } }),
  w('AD-03', 'o3', 'applications', 'Academy · U10 football', 'Mark & Jen Tan', 'assessment', { date: '2026-10-17', meta: { child: 'Leo (9y)', program: 'Junior football academy' } }),
  w('AD-04', 'o3', 'applications', 'Bootcamp · evening cohort', 'Kavya Iyer', 'offer', { date: '2026-10-13', meta: { child: '—', program: 'Data & AI bootcamp' } }),
  w('AD-05', 'o3', 'applications', 'Camp · winter break', 'Omar & Dina Saleh', 'enrolled', { date: '2026-10-02', meta: { child: 'Yusuf (8y)', program: 'Winter multi-activity camp' } }),
  // Programs · enrolments
  w('EN-01', 'o3', 'enrolments', 'Data & AI bootcamp', 'Evening cohort · 18 learners', 'active', { date: '2026-09-07', meta: { schedule: 'Mon & Wed 18:30–21:30', progress: 45 } }),
  w('EN-02', 'o3', 'enrolments', 'Little Stars Nursery', 'Caterpillars room · 16 children', 'active', { date: '2026-09-01', meta: { schedule: 'Sun–Thu 07:30–13:30', progress: 20 } }),
  w('EN-03', 'o3', 'enrolments', 'Junior football academy', 'U10 squad · 22 players', 'active', { date: '2026-09-14', meta: { schedule: 'Tue & Thu 16:30–18:00', progress: 30 } }),
  w('EN-04', 'o3', 'enrolments', 'Winter multi-activity camp', '40 places', 'upcoming', { date: '2026-12-14', meta: { schedule: 'Mon–Fri 08:00–14:00', progress: 0 } }),
  // Health · appointments (meta.practitioner, meta.hour, meta.patient)
  w('HA-01', 'o2', 'clinic', 'Consultation', 'P-2210', 'checked_in', { date: TODAY, meta: { practitioner: 'p1', hour: 9, patient: 'Mohammed A.', reason: 'Follow-up · blood results', insurer: 'Daman' } }),
  w('HA-02', 'o2', 'clinic', 'Consultation', 'P-2231', 'confirmed', { date: TODAY, meta: { practitioner: 'p1', hour: 11, patient: 'Sarah K.', reason: 'New patient', insurer: 'AXA' } }),
  w('HA-03', 'o2', 'clinic', 'Check-up & cleaning', 'P-1984', 'confirmed', { date: TODAY, meta: { practitioner: 'p2', hour: 10, patient: 'Ivan P.', reason: 'Routine hygiene', insurer: 'Self-pay' } }),
  w('HA-04', 'o2', 'clinic', 'Assessment', 'P-2240', 'requested', { date: TODAY, meta: { practitioner: 'p3', hour: 14, patient: 'Lara M.', reason: 'Knee pain after running', insurer: 'Bupa' } }),
  w('HA-05', 'o2', 'clinic', 'Session', 'P-1877', 'confirmed', { date: TODAY, meta: { practitioner: 'p4', hour: 16, patient: 'Restricted', reason: 'Restricted', insurer: 'Self-pay' } }),
  w('HA-06', 'o2', 'clinic', 'Session 4 of 8', 'P-2002', 'completed', { date: TODAY, meta: { practitioner: 'p3', hour: 9, patient: 'Tariq B.', reason: 'Shoulder rehab', insurer: 'MetLife' } }),
  // Protection · quote requests
  w('IQ-01', 'o4', 'quote_requests', 'Motor · 2024 Land Cruiser', 'Yousef Badr', 'new', { date: '2026-10-15', meta: { product: 'Motor', quotes: 0, best: 0 } }),
  w('IQ-02', 'o4', 'quote_requests', 'Health · family of 4', 'Elena Petrova', 'details_collected', { date: '2026-10-14', meta: { product: 'Health', quotes: 0, best: 0 } }),
  w('IQ-03', 'o4', 'quote_requests', 'Property · landlord cover', 'Hessa Al Ketbi', 'quotes_received', { date: '2026-10-12', meta: { product: 'Property', quotes: 3, best: 880 } }),
  w('IQ-04', 'o4', 'quote_requests', 'Motor · 2022 Tesla Model Y', 'Rohan Kapoor', 'application', { date: '2026-10-09', meta: { product: 'Motor', quotes: 5, best: 2350 } }),
  w('IQ-05', 'o4', 'quote_requests', 'Health · individual', 'Lucas Martins', 'policy_issued', { date: '2026-10-02', meta: { product: 'Health', quotes: 4, best: 3900 } }),
  // Protection · policies
  w('PL-01', 'o4', 'policies', 'Motor comprehensive', 'Yousef Badr', 'renewal_due', { date: '2026-11-01', amount: 1450, meta: { insurer: 'Gulf Insurance Co.', number: 'GIC-MTR-772190' } }),
  w('PL-02', 'o4', 'policies', 'Health · Enhanced', 'Lucas Martins', 'active', { date: '2027-10-02', amount: 3900, meta: { insurer: 'Oasis Health', number: 'OH-HLT-118823' } }),
  w('PL-03', 'o4', 'policies', 'Home contents', 'Ahmed Al Mansoori', 'active', { date: '2027-05-18', amount: 620, meta: { insurer: 'Falcon General', number: 'FG-HOM-550912' } }),
  w('PL-04', 'o4', 'policies', 'Motor third party', 'James Whitfield', 'lapsed', { date: '2026-09-30', amount: 980, meta: { insurer: 'Gulf Insurance Co.', number: 'GIC-MTR-701288' } }),
];

/** Personal (customer) context — the same demo person's own activity. */
export const MY_ACTIVITY = [
  { vertical: 'spaces' as const, title: 'Lease · 3BR townhouse, Arabian Ranches', provider: 'Emaar Leasing', status: 'Active · renews 1 Mar 2027', detail: 'Cheque 3/4 due 1 Dec 2026' },
  { vertical: 'services' as const, title: 'AC service · 4 units', provider: 'CoolBreeze Technical', status: 'Booked · Sat 17 Oct, 10:00', detail: 'Technician assigned' },
  { vertical: 'memberships' as const, title: 'Annual membership', provider: 'Fit Republic', status: 'Active · 22 check-ins this month', detail: 'Renews 4 Jan 2027' },
  { vertical: 'programs' as const, title: 'Junior swim academy — Sami (7y)', provider: 'AquaKids Academy', status: 'Enrolled · Term 1', detail: 'Next session Tue 20 Oct' },
  { vertical: 'insurance' as const, title: 'Motor comprehensive', provider: 'via Gulf Shield Brokers', status: 'Policy active', detail: 'Renewal 12 Feb 2027' },
  { vertical: 'experiences' as const, title: 'Hatta kayaking tour · 2 seats', provider: 'Hajar Adventures', status: 'Confirmed · Fri 23 Oct', detail: 'Meeting point: Hatta Dam' },
];

/** A second demo person for the Personal context: a customer with no business, so enquiries reach Layla's businesses. */
export const DEMO_CUSTOMER = { name: 'Sam Carter', email: 'sam.carter@mail.ae', phone: '+971 55 410 2288', initials: 'SC' };
