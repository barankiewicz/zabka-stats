import { M } from './state.js';

export async function fetchJSON(url, timeout=8000) {
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {signal: ctrl.signal});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const BASE = '/api';
function val(settled, fallback={}) {
  if (settled.status === 'fulfilled') {
    return settled.value;
  }
  const copy = Array.isArray(fallback) ? [...fallback] : { ...fallback };
  copy._error = true;
  return copy;
}

export function applySkel(selector) {
  const target = selector ? document.querySelectorAll(selector) : document.querySelectorAll('.chart-wrap canvas,.map-container>div,.hero-band,.origin-cards');
  target.forEach(el=>{
    el.classList.add('skel');el.dataset.skelApplied='1';
  });
}
export function clearSkel(selector) {
  const target = selector ? document.querySelectorAll(selector) : document.querySelectorAll('[data-skel-applied]');
  target.forEach(el=>{el.classList.remove('skel');delete el.dataset.skelApplied});
}

// Core bucket: the minimum set of data needed for the SIEC tab first paint
// (hero count-up, stat strip, growth chart, GRAN map, Atlas). Heavy
// spoleczenstwo-only payloads (economics, density, inpost, streets, gmina
// leaders, nbl) are deferred to loadSpoleczenstwo() so they don't block the
// default tab.
let _coreDone = false;
export async function loadCore() {
  if (_coreDone) return;
  _coreDone = true;
  applySkel('.hero-band, .origin-cards');
  // Core bucket is intentionally tiny (all small payloads, ~6 KB total) so the
  // above-the-fold hero + stat strip - the LCP element - paints fast even on
  // slow mobile. The big woj_geo GeoJSON (46 KB) moved to loadSiec since only
  // below-fold maps need it.
  const [
    summary, networkGrowth, networkOrigin, neighborStats,
    coverageFunnel, perCapita, section3, openingHours,
  ] = await Promise.allSettled([
    fetchJSON(`${BASE}/stats/summary`),
    fetchJSON(`${BASE}/stats/network-growth`),
    fetchJSON(`${BASE}/stats/network-origin`),
    fetchJSON(`${BASE}/stats/neighbor-stats`),
    fetchJSON(`${BASE}/stats/coverage-funnel`),
    fetchJSON(`${BASE}/stats/per-capita`),
    fetchJSON(`${BASE}/stats/section3-rare`),
    fetchJSON(`${BASE}/stats/opening-hours`),
  ]);
  Object.assign(M, {
    summary:          val(summary, {total_active:0, cities_count:0, merrychef_pct:0, sunday_pct:0, h24_count:0, last_updated:null}),
    woj_geo:          {type:'FeatureCollection', features:[]},  // filled by loadSiec
    network_growth:   val(networkGrowth, []),
    network_origin:   val(networkOrigin, {}),
    neighbor_stats:   val(neighborStats, {}),
    coverage_funnel:  val(coverageFunnel, []),
    per_capita:       val(perCapita, []),
    section3_rare:    val(section3, {}),
    opening_hours:    val(openingHours, []),
    // pre-fill keys that spoleczenstwo reads so they're never undefined
    powiat_economics:      [],
    voivodeship_density:   [],
    voivodeship_merrychef: [],
    inpost_vs_zabka:       [],
    common_streets:        {streets:[], distinct:0},
    gmina_leaders:         {per_1k:[], per_km2:[], national_per_1k:null},
    neighbor_by_level:     {rows:[], total:0, level:'voivodeship'},
    sunday_by_voivodeship: [],
  });
  clearSkel('.hero-band, .origin-cards');
}

// Per-tab buckets. Each fires only when its tab is first opened, then caches.
const _tabLoaded = new Set();
export async function loadTabData(tab) {
  if (_tabLoaded.has(tab)) return;
  _tabLoaded.add(tab);
  if (tab === 'siec')           await loadSiec();
  else if (tab === 'spoleczenstwo') await loadSpoleczenstwo();
}

// Heavy SIEC bucket - everything the below-the-fold scenes need (the big
// stores-timeline + amphibians payloads, woj_geo, Atlas data). Cached as a
// single promise so scene builders can `loadSiec().then(...)` without the
// above-fold render ever awaiting it. Kicked off by renderSiec right after the
// hero paints, so it no longer blocks LCP on slow mobile.
let _siecPromise = null;
export function loadSiec() {
  return _siecPromise ??= _loadSiecImpl();
}
async function _loadSiecImpl() {
  const skelSels = '#tab-siec .chart-wrap canvas, #tab-siec .map-container>div, #canvas-calendar, #canvas-fingerprint-flat, #powiat-donut, #canvas-powiat-map';
  applySkel(skelSels);
  const [
    wojGeo, storesTimeline, openingsMonthly,
    powiatCoverage, kraniec, elevation, parksStores, twins, amphibians, citiesWithoutZabka,
  ] = await Promise.allSettled([
    fetchJSON(`${BASE}/geo/voivodeships`),
    fetchJSON(`${BASE}/stats/stores-timeline`),
    fetchJSON(`${BASE}/stats/openings-monthly`),
    fetchJSON(`${BASE}/stats/powiat-coverage`),
    fetchJSON(`${BASE}/stats/kraniec-facts`),
    fetchJSON(`${BASE}/stats/elevation`),
    fetchJSON(`${BASE}/stats/parks-stores`),
    fetchJSON(`${BASE}/stats/twins`),
    fetchJSON(`${BASE}/stats/amphibians`),
    fetchJSON(`${BASE}/stats/cities-without-zabka`),
  ]);
  const kf = val(kraniec, {facts:[], backdrop:[]});
  Object.assign(M, {
    woj_geo:           val(wojGeo, {type:'FeatureCollection', features:[]}),
    stores_timeline:   val(storesTimeline, {}),
    openings_monthly:  val(openingsMonthly, []),
    powiat_coverage:   val(powiatCoverage, {total:0, covered:0, dots:[]}),
    kraniec_facts:     kf.facts || [],
    points_sample:     kf.backdrop || [],
    elevation:         val(elevation, {}),
    parks_stores:      val(parksStores, []),
    twins:             val(twins, {within_50m:0, within_100m:0, within_200m:0, total:0, closest_pairs:[], same_address:[], points:[], points_50:[]}),
    amphibian_extremes: val(amphibians, {}),
    cities_without_zabka: val(citiesWithoutZabka, {total_cities:0, without_zabka:0, pct:0, cities:[]}),
  });
  clearSkel(skelSels);
}

// Standalone re-fetch for a single chart's retry button (econ scene): only
// this one endpoint, so a flaky economics request doesn't force a full
// tab-data reload.
export async function refetchPowiatEconomics() {
  const r = await fetchJSON(`${BASE}/stats/powiat-economics`);
  M.powiat_economics = r;
  return r;
}

async function loadSpoleczenstwo() {
  const skelSels = '#tab-spoleczenstwo .chart-wrap canvas, #tab-spoleczenstwo .map-container>div, #inpost-dumbbell';
  applySkel(skelSels);
  const [
    economics, density, merrychef, inpost, commonStreets,
    gminaLeaders, neighborByLevel, sundayByVoiv, elevation,
  ] = await Promise.allSettled([
    fetchJSON(`${BASE}/stats/powiat-economics`),
    fetchJSON(`${BASE}/stats/voivodeship-density`),
    fetchJSON(`${BASE}/stats/voivodeship`),
    fetchJSON(`${BASE}/stats/inpost-vs-zabka`),
    fetchJSON(`${BASE}/stats/common-streets?limit=15`),
    fetchJSON(`${BASE}/stats/gmina-leaders?limit=12`),
    fetchJSON(`${BASE}/stats/neighbor-by-level?level=voivodeship&sort=asc`),
    fetchJSON(`${BASE}/stats/sunday-by-voivodeship`),
    fetchJSON(`${BASE}/stats/elevation`),
  ]);
  Object.assign(M, {
    powiat_economics:      val(economics, []),
    voivodeship_density:   val(density, []),
    voivodeship_merrychef: val(merrychef, []),
    inpost_vs_zabka:       val(inpost, []),
    common_streets:        val(commonStreets, {streets:[], distinct:0}),
    gmina_leaders:         val(gminaLeaders, {per_1k:[], per_km2:[], national_per_1k:null}),
    neighbor_by_level:     val(neighborByLevel, {rows:[], total:0, level:'voivodeship'}),
    sunday_by_voivodeship: val(sundayByVoiv, []),
    // loadSiec() also fetches this (edge.js/kraniec.js need it for the Atlas
    // extremes); fetched again here so the elevation chart has data even
    // when spoleczenstwo (the default tab) renders before SIEC's bucket ever
    // loads. Same Redis-cached endpoint, so the duplicate request is cheap.
    elevation:             val(elevation, M.elevation || {}),
  });
  clearSkel(skelSels);
}

export async function ensurePowGeo() {
  if (M.powGeo) {
    return M.powGeo;
  }
  M.powGeo = await fetchJSON('/api/geo/powiats');
  return M.powGeo;
}
