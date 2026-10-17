// Country detail packs ("states / districts / local areas" for one country).
//
// ADDING A COUNTRY: drop `map-data/<country>-detail.json` next to the others. No code changes.
//   file name  = country name (exactly as in the Map area list), lower case, other characters -> "-"
//                e.g. "Myanmar" -> myanmar-detail.json, "United States of America" -> united-states-of-america-detail.json
//   The pack describes itself. See "Country detail packs" in README.md for the format:
//     country, features[{properties:{key,name,level}, geometry}], and optionally
//     defaultLevel, defaultRegion, levelLabels, ready, attribution, cities.
//
// Packs are looked up by file name when a country is chosen; a country without a pack simply
// stays a plain country map. COUNTRY_DETAILS below is only a FALLBACK for packs that predate
// self-describing files (Bangladesh): a value inside the pack always wins over this table.
export const COUNTRY_DETAILS = Object.freeze({
  Bangladesh: {
    defaultLevel: 'district',
    defaultRegion: 'Dhaka',
    levels: [['division', 'Divisions'], ['district', 'Districts'], ['local', 'Local areas / upazilas']],
    ready: 'Select a boundary level, then add Border or Highlight and pick a region. City labels show district towns.',
    attribution: 'District boundaries: BBS/OCHA (2020), via geoBoundaries, CC BY 3.0 IGO.',
  },
});

// Saved projects made before region targets carried a country were Bangladesh-only.
export const LEGACY_REGION_COUNTRY = 'Bangladesh';

const LEVEL_ORDER = ['division', 'district', 'local'];
const LEVEL_LABELS = { division: 'Divisions', district: 'Districts', local: 'Local areas' };
const GENERIC_READY = 'Select a boundary level, then add Border or Highlight and pick a region.';
const titleCase = s => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** "Côte d'Ivoire" -> "cote-d-ivoire" */
export const detailSlug = country => String(country).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** Where the pack for a country lives. */
export const detailFileOf = country => COUNTRY_DETAILS[country]?.file || `map-data/${detailSlug(country)}-detail.json`;
/** Level ids are free-form but must be safe to store in a project file. */
export const isLevelId = s => typeof s === 'string' && /^[a-z][a-z0-9_-]{0,31}$/i.test(s);

const sourceText = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string').join(' · ') : typeof v === 'string' ? v : '');

/**
 * Everything the UI needs to know about a country's pack, merged from the pack itself
 * (preferred) and the COUNTRY_DETAILS fallback. Works before the pack has loaded, using
 * the fallback only.
 *   levels:        [[id, label], ...] in display order, only levels that have regions once loaded
 *   defaultLevel:  level shown first
 *   defaultRegion: key or name of the region new Border / Highlight items start on
 */
export function detailInfo(geo, country) {
  const pack = geo?.details?.get(country), base = COUNTRY_DETAILS[country] || {};
  const own = pack?.levelLabels && typeof pack.levelLabels === 'object' ? pack.levelLabels : null;
  const labels = { ...LEVEL_LABELS, ...Object.fromEntries(base.levels || []), ...(own || {}) };
  let ids = pack ? Object.keys(pack.levels || {}).filter(l => pack.levels[l]?.length) : (base.levels || []).map(l => l[0]);
  const declared = own ? Object.keys(own) : [], rank = l => { const i = LEVEL_ORDER.indexOf(l); return i < 0 ? LEVEL_ORDER.length : i; };
  ids = [...ids].sort((a, b) => (declared.length ? (declared.indexOf(a) + 1 || 99) - (declared.indexOf(b) + 1 || 99) : rank(a) - rank(b)));
  const defaultLevel = [pack?.defaultLevel, base.defaultLevel].find(l => l && ids.includes(l)) || ids[0] || base.defaultLevel || 'district';
  return {
    levels: ids.map(id => [id, labels[id] || titleCase(id)]),
    defaultLevel,
    defaultRegion: pack?.defaultRegion ?? base.defaultRegion ?? '',
    ready: pack?.ready || base.ready || GENERIC_READY,
    attribution: sourceText(pack?.attribution) || sourceText(pack?.sources) || base.attribution || '',
  };
}

/** The level to use: `preferred` if the pack has it, else the pack's default level. */
export function detailLevelOf(geo, country, preferred) {
  const pack = geo?.details?.get(country);
  if (!pack) return preferred || COUNTRY_DETAILS[country]?.defaultLevel || 'district';
  if (preferred && pack.levels?.[preferred]?.length) return preferred;
  return detailInfo(geo, country).defaultLevel;
}

export function detailCountryFromLoc(loc, known = Object.keys(COUNTRY_DETAILS)) {
  if (!loc) return null;
  if (loc.country) return loc.country;
  if (known.includes(loc.name)) return loc.name;
  if (loc.kind !== 'region') return null;
  return known.find(country => loc.name?.startsWith(country + ' / ')) || null;
}
