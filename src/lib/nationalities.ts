/**
 * Nationality list — COUNTRY names, not adjectives.
 *
 * The Emirates ID prints the country ("Pakistan"), so storing the country is
 * what makes a scanned value line up with the dropdown exactly. The backend OCR
 * (ocr.service.ts) canonicalises to these same country names.
 */
export const NATIONALITIES = [
  'Afghanistan','Albania','Algeria','Angola','Argentina','Armenia','Australia','Austria','Azerbaijan',
  'Bahrain','Bangladesh','Belgium','Bolivia','Bosnia and Herzegovina','Brazil','Bulgaria','Cambodia',
  'Cameroon','Canada','Chile','China','Colombia','Congo','Croatia','Cuba','Czechia','Denmark','Egypt',
  'Ethiopia','Finland','France','Georgia','Germany','Ghana','Greece','Guatemala','Haiti','Honduras',
  'Hungary','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy','Jamaica','Japan','Jordan',
  'Kazakhstan','Kenya','Kuwait','Lebanon','Libya','Malaysia','Mexico','Morocco','Myanmar','Namibia',
  'Nepal','New Zealand','Nigeria','Norway','Oman','Pakistan','Palestine','Paraguay','Peru','Philippines',
  'Poland','Portugal','Qatar','Romania','Russia','Saudi Arabia','Serbia','Singapore','Slovakia','Somalia',
  'South Africa','South Korea','Spain','Sri Lanka','Sudan','Sweden','Switzerland','Syria','Taiwan',
  'Tanzania','Thailand','Tunisia','Turkey','Uganda','Ukraine','United Arab Emirates','United Kingdom',
  'United States','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe',
].sort();

/** Short forms and OCR spellings that aren't the canonical country name. */
const ALIASES: Record<string, string> = {
  'uae': 'United Arab Emirates', 'u.a.e': 'United Arab Emirates', 'u.a.e.': 'United Arab Emirates',
  'emirates': 'United Arab Emirates', 'uk': 'United Kingdom', 'great britain': 'United Kingdom',
  'england': 'United Kingdom', 'britain': 'United Kingdom', 'usa': 'United States',
  'u.s.a': 'United States', 'united states of america': 'United States', 'america': 'United States',
  'czech republic': 'Czechia', 'burma': 'Myanmar', 'korea': 'South Korea',
  'republic of korea': 'South Korea', 'bosnia': 'Bosnia and Herzegovina',
};

/**
 * Adjective → country. Records created before the switch to country names hold
 * the demonym ("Pakistani"), so the dropdown must still resolve those to the
 * right option instead of showing the field as blank.
 */
const DEMONYM_TO_COUNTRY: Record<string, string> = {
  afghan: 'Afghanistan', albanian: 'Albania', algerian: 'Algeria', american: 'United States',
  angolan: 'Angola', argentinian: 'Argentina', armenian: 'Armenia', australian: 'Australia',
  austrian: 'Austria', azerbaijani: 'Azerbaijan', bahraini: 'Bahrain', bangladeshi: 'Bangladesh',
  belgian: 'Belgium', bolivian: 'Bolivia', bosnian: 'Bosnia and Herzegovina', brazilian: 'Brazil',
  british: 'United Kingdom', bulgarian: 'Bulgaria', burmese: 'Myanmar', cambodian: 'Cambodia',
  cameroonian: 'Cameroon', canadian: 'Canada', chilean: 'Chile', chinese: 'China',
  colombian: 'Colombia', congolese: 'Congo', croatian: 'Croatia', cuban: 'Cuba', czech: 'Czechia',
  danish: 'Denmark', egyptian: 'Egypt', emirati: 'United Arab Emirates', ethiopian: 'Ethiopia',
  filipino: 'Philippines', finnish: 'Finland', french: 'France', georgian: 'Georgia',
  german: 'Germany', ghanaian: 'Ghana', greek: 'Greece', guatemalan: 'Guatemala', haitian: 'Haiti',
  honduran: 'Honduras', hungarian: 'Hungary', indian: 'India', indonesian: 'Indonesia',
  iranian: 'Iran', iraqi: 'Iraq', irish: 'Ireland', israeli: 'Israel', italian: 'Italy',
  jamaican: 'Jamaica', japanese: 'Japan', jordanian: 'Jordan', kazakh: 'Kazakhstan', kenyan: 'Kenya',
  korean: 'South Korea', kuwaiti: 'Kuwait', lebanese: 'Lebanon', libyan: 'Libya',
  malaysian: 'Malaysia', mexican: 'Mexico', moroccan: 'Morocco', namibian: 'Namibia',
  nepali: 'Nepal', 'new zealander': 'New Zealand', nigerian: 'Nigeria', norwegian: 'Norway',
  omani: 'Oman', pakistani: 'Pakistan', palestinian: 'Palestine', paraguayan: 'Paraguay',
  peruvian: 'Peru', polish: 'Poland', portuguese: 'Portugal', qatari: 'Qatar', romanian: 'Romania',
  russian: 'Russia', saudi: 'Saudi Arabia', serbian: 'Serbia', singaporean: 'Singapore',
  slovak: 'Slovakia', somali: 'Somalia', 'south african': 'South Africa', spanish: 'Spain',
  'sri lankan': 'Sri Lanka', sudanese: 'Sudan', swedish: 'Sweden', swiss: 'Switzerland',
  syrian: 'Syria', taiwanese: 'Taiwan', tanzanian: 'Tanzania', thai: 'Thailand',
  tunisian: 'Tunisia', turkish: 'Turkey', ugandan: 'Uganda', ukrainian: 'Ukraine',
  venezuelan: 'Venezuela', vietnamese: 'Vietnam', yemeni: 'Yemen', zambian: 'Zambia',
  zimbabwean: 'Zimbabwe',
};

/**
 * Snap a stored or scanned value onto a list entry.
 * Returns '' for empty input, and the ORIGINAL string when it can't be matched
 * — callers keep an unmatched value selectable so a scan is never lost.
 */
export function normalizeNationality(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  const key = value.toLowerCase().replace(/\s+/g, ' ');
  const exact = NATIONALITIES.find(n => n.toLowerCase() === key);
  if (exact) return exact;
  return ALIASES[key] ?? DEMONYM_TO_COUNTRY[key] ?? value;
}
