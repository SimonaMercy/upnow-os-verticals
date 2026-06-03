/**
 * UAE tenancy-contract jurisdiction config.
 *
 * The tenancy contract differs by emirate — registration system (Dubai = Ejari,
 * Abu Dhabi = Tawtheeq, others = municipality), governing law, rental-dispute
 * body and utility authority (DEWA / ADDC / SEWA / FEWA). This maps a property's
 * emirate to the jurisdiction-specific text the contract renders, so it is no
 * longer hard-wired to Dubai.
 *
 * NOTE on branding: we only hold the official Dubai Land Department artwork, so
 * `useDldLogos` is true for Dubai only. Other emirates render a text header
 * (Government of <Emirate> + authority) rather than a legally-wrong DLD logo.
 */

export interface TenancyJurisdiction {
  key: string;
  emirateLabel: string;
  /** Top-left header emblem text when DLD logos aren't used. */
  governmentEn: string;
  governmentAr: string;
  /** The land/registration authority (department) for this emirate. */
  authorityEn: string;
  authorityAr: string;
  /** Tenancy registration system name. */
  registrationEn: string;
  registrationAr: string;
  /** Utility authority for the "Premises No." field. */
  utilityAuthority: string;
  utilityAuthorityAr: string;
  /** Rental-dispute body (Term: disputes settled by …). */
  disputeBodyEn: string;
  disputeBodyAr: string;
  /** Governing tenancy law citation (Term: this contract is subject to …). */
  governingLawEn: string;
  governingLawAr: string;
  /** "Know your rights" bullet list. */
  rightsEn: string[];
  rightsAr: string[];
  /** Footer contact line; null → omit. */
  footer: string | null;
  /** Use the official Dubai Land Department logos (Dubai only). */
  useDldLogos: boolean;
}

const norm = (s?: string | null) =>
  (s ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** DEWA / ADDC / SEWA / FEWA by emirate (FEWA covers the northern emirates). */
export function utilityAuthorityForEmirate(emirate?: string | null): { en: string; ar: string } {
  switch (norm(emirate)) {
    case 'dubai': return { en: 'DEWA', ar: 'ديوا' };
    case 'abudhabi': return { en: 'ADDC', ar: 'شركة أبوظبي للتوزيع' };
    case 'alain': return { en: 'AADC', ar: 'شركة العين للتوزيع' };
    case 'sharjah': return { en: 'SEWA', ar: 'هيئة كهرباء ومياه الشارقة' };
    // Ajman, Ras Al Khaimah, Fujairah, Umm Al Quwain → FEWA
    default: return { en: 'FEWA', ar: 'الهيئة الاتحادية للكهرباء والماء' };
  }
}

const DUBAI: TenancyJurisdiction = {
  key: 'dubai',
  emirateLabel: 'Dubai',
  governmentEn: 'Government of Dubai',
  governmentAr: 'حكومة دبي',
  authorityEn: 'Dubai Land Department',
  authorityAr: 'دائرة الأراضي والأملاك',
  registrationEn: 'Ejari',
  registrationAr: 'إيجاري',
  utilityAuthority: 'DEWA',
  utilityAuthorityAr: 'ديوا',
  disputeBodyEn: 'the Rental Dispute Settlement Centre',
  disputeBodyAr: 'مركز فض المنازعات الإيجارية',
  governingLawEn:
    'This contract is subject to all provisions of Law No (26) of 2007 regulating the relation between landlords and tenants in the emirate of Dubai as amended, and as it will be changed or amended from time to time, as long with any related legislations and regulations applied in the emirate of Dubai.',
  governingLawAr:
    'يخضع هذا العقد لكافة أحكام القانون رقم (26) لسنة 2007 بشأن تنظيم العلاقة بين مؤجري و مستأجري العقارات في إمارة دبي، و تعديلاته و أي تغيير أو تعديل يطرأ عليه من وقت لآخر.',
  rightsEn: [
    'Visit the Rental Dispute Settlement Centre via www.dubailand.gov.ae in case of any rental dispute.',
    'Law No 26 of 2007 regulating landlord–tenant relationship.',
    'Law No 33 of 2008 amending law 26 of 2007.',
    'Law No 43 of 2013 determining rent increases.',
  ],
  rightsAr: [
    'زيارة موقع مركز فض المنازعات الإيجارية www.dubailand.gov.ae',
    'قانون رقم 26 لسنة 2007 بشأن العلاقة بين المؤجرين والمستأجرين.',
    'قانون رقم 33 لسنة 2008 المعدل لقانون 26 لعام 2007.',
    'قانون رقم 43 لسنة 2013 بشأن تحديد زيادة بدل الإيجار.',
  ],
  footer: 'Tel: 8004488  |  P.O.Box 1166, Dubai, U.A.E.  |  support@dubailand.gov.ae  |  www.dubailand.gov.ae',
  useDldLogos: true,
};

const ABU_DHABI: TenancyJurisdiction = {
  key: 'abu_dhabi',
  emirateLabel: 'Abu Dhabi',
  governmentEn: 'Government of Abu Dhabi',
  governmentAr: 'حكومة أبوظبي',
  authorityEn: 'Department of Municipalities and Transport',
  authorityAr: 'دائرة البلديات والنقل',
  registrationEn: 'Tawtheeq',
  registrationAr: 'توثيق',
  utilityAuthority: 'ADDC',
  utilityAuthorityAr: 'شركة أبوظبي للتوزيع',
  disputeBodyEn: 'the Abu Dhabi Rental Disputes Committee',
  disputeBodyAr: 'لجنة فض المنازعات الإيجارية بأبوظبي',
  governingLawEn:
    'This contract is subject to Law No (20) of 2006 concerning leasing of premises in the emirate of Abu Dhabi and its amendments, together with any related legislation and regulations applied in the emirate of Abu Dhabi.',
  governingLawAr:
    'يخضع هذا العقد لأحكام القانون رقم (20) لسنة 2006 بشأن تأجير الأماكن في إمارة أبوظبي و تعديلاته، و أي تشريعات أو لوائح ذات صلة مطبقة في إمارة أبوظبي.',
  rightsEn: [
    'Refer any rental dispute to the Abu Dhabi Rental Disputes Committee.',
    'Law No 20 of 2006 concerning the leasing of premises (as amended).',
    'Register this contract on the Tawtheeq system of the Department of Municipalities and Transport.',
  ],
  rightsAr: [
    'إحالة أي نزاع إيجاري إلى لجنة فض المنازعات الإيجارية بأبوظبي.',
    'القانون رقم 20 لسنة 2006 بشأن تأجير الأماكن و تعديلاته.',
    'تسجيل هذا العقد في نظام توثيق التابع لدائرة البلديات والنقل.',
  ],
  footer: null,
  useDldLogos: false,
};

/** Sharjah and the northern emirates — neutral municipal wording. */
function genericEmirate(label: string): TenancyJurisdiction {
  const util = utilityAuthorityForEmirate(label);
  return {
    key: norm(label) || 'uae',
    emirateLabel: label || 'the Emirate',
    governmentEn: label ? `Government of ${label}` : 'United Arab Emirates',
    governmentAr: 'الإمارات العربية المتحدة',
    authorityEn: label ? `${label} Municipality` : 'the competent municipality',
    authorityAr: 'البلدية المختصة',
    registrationEn: 'the official tenancy registration system',
    registrationAr: 'نظام تسجيل عقود الإيجار الرسمي',
    utilityAuthority: util.en,
    utilityAuthorityAr: util.ar,
    disputeBodyEn: 'the competent rental disputes committee',
    disputeBodyAr: 'لجنة فض المنازعات الإيجارية المختصة',
    governingLawEn:
      `This contract is subject to the tenancy laws and regulations applied in the emirate of ${label || 'the relevant emirate'} and the applicable federal laws of the United Arab Emirates.`,
    governingLawAr:
      'يخضع هذا العقد لقوانين و لوائح الإيجار المطبقة في الإمارة المعنية و القوانين الاتحادية السارية في دولة الإمارات العربية المتحدة.',
    rightsEn: [
      'Refer any rental dispute to the competent rental disputes committee in your emirate.',
      'The tenancy laws and regulations applied in your emirate.',
      'Register this contract with the competent municipality / registration authority.',
    ],
    rightsAr: [
      'إحالة أي نزاع إيجاري إلى لجنة فض المنازعات الإيجارية المختصة في إمارتك.',
      'قوانين و لوائح الإيجار المطبقة في إمارتك.',
      'تسجيل هذا العقد لدى البلدية / جهة التسجيل المختصة.',
    ],
    footer: null,
    useDldLogos: false,
  };
}

/** Resolve the jurisdiction profile for a property's emirate (defaults to Dubai). */
export function jurisdictionForEmirate(emirate?: string | null): TenancyJurisdiction {
  switch (norm(emirate)) {
    case 'dubai': return DUBAI;
    case 'abudhabi': return ABU_DHABI;
    case '': return DUBAI; // unknown/blank → Dubai (current default market)
    default: return genericEmirate(emirate ?? '');
  }
}
