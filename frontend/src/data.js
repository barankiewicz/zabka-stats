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
function val(settled, fallback={}) { return settled.status==='fulfilled' ? settled.value : fallback; }

function applySkel() {
  document.querySelectorAll('.chart-wrap canvas,.map-container>div,.hero-band,.origin-cards').forEach(el=>{
    el.classList.add('skel');el.dataset.skelApplied='1';
  });
}
function clearSkel() {
  document.querySelectorAll('[data-skel-applied]').forEach(el=>{el.classList.remove('skel');delete el.dataset.skelApplied});
}

// Core bucket: everything the default tab (spoleczenstwo / "Żabka a Polska")
// plus the shared KPI/header need. The heavy per-tab payloads (stores-timeline,
// amphibians, the edge-case facts) are deferred to loadTabData() so they stay
// off the critical path on first paint.
let _coreDone = false;
export async function loadCore() {
  if (_coreDone) return;
  _coreDone = true;
  applySkel();
  const [
    summary, wojGeo, economics, sunday, density, merrychef, inpost, perCapita, section3, openingHours,
    commonStreets, gminaLeaders, neighborByLevel,
  ] = await Promise.allSettled([
    fetchJSON(`${BASE}/stats/summary`),
    fetchJSON(`${BASE}/geo/voivodeships`),
    fetchJSON(`${BASE}/stats/powiat-economics`),
    fetchJSON(`${BASE}/stats/sunday-by-voivodeship`),
    fetchJSON(`${BASE}/stats/voivodeship-density`),
    fetchJSON(`${BASE}/stats/voivodeship`),
    fetchJSON(`${BASE}/stats/inpost-vs-zabka`),
    fetchJSON(`${BASE}/stats/per-capita`),
    fetchJSON(`${BASE}/stats/section3-rare`),
    fetchJSON(`${BASE}/stats/opening-hours`),
    fetchJSON(`${BASE}/stats/common-streets?limit=15`),
    fetchJSON(`${BASE}/stats/gmina-leaders?limit=12`),
    fetchJSON(`${BASE}/stats/neighbor-by-level?level=voivodeship`),
  ]);
  Object.assign(M, {
    summary:               val(summary, {total_active:0, cities_count:0, merrychef_pct:0, sunday_pct:0, h24_count:0}),
    woj_geo:               val(wojGeo, {type:'FeatureCollection', features:[]}),
    powiat_economics:      val(economics, []),
    sunday_by_voivodeship: val(sunday, []),
    voivodeship_density:   val(density, []),
    voivodeship_merrychef: val(merrychef, []),
    inpost_vs_zabka:       val(inpost, []),
    per_capita:            val(perCapita, []),
    section3_rare:         val(section3, {}),
    opening_hours:         val(openingHours, []),
    common_streets:        val(commonStreets, {streets:[], distinct:0}),
    gmina_leaders:         val(gminaLeaders, {per_1k:[], per_km2:[], national_per_1k:null}),
    neighbor_by_level:     val(neighborByLevel, {rows:[], total:0, level:'voivodeship'}),
    timeline_monthly:      [],
  });
  clearSkel();
}

// Per-tab buckets. Each fires only when its tab is first opened, then caches.
const _tabLoaded = new Set();
export async function loadTabData(tab) {
  if (_tabLoaded.has(tab)) return;
  _tabLoaded.add(tab);
  if (tab === 'siec')  await loadSiec();
  else if (tab === 'edge')  await Promise.all([loadEdge(), loadPlazy()]);
  else if (tab === 'plazy') await loadPlazy();
  // 'spoleczenstwo' is fully covered by the core bucket.
}

async function loadSiec() {
  const [
    networkGrowth, networkOrigin, storesTimeline, openingHours, growthByVoiv,
    cityFirst, topCities, openingsMonthly, coverageFunnel, powiatCoverage,
  ] = await Promise.allSettled([
    fetchJSON(`${BASE}/stats/network-growth`),
    fetchJSON(`${BASE}/stats/network-origin`),
    fetchJSON(`${BASE}/stats/stores-timeline`),
    fetchJSON(`${BASE}/stats/opening-hours`),
    fetchJSON(`${BASE}/stats/growth-by-voivodeship`),
    fetchJSON(`${BASE}/stats/city-first-opening`),
    fetchJSON(`${BASE}/stats/top-cities?limit=20`),
    fetchJSON(`${BASE}/stats/openings-monthly`),
    fetchJSON(`${BASE}/stats/coverage-funnel`),
    fetchJSON(`${BASE}/stats/powiat-coverage`),
  ]);
  Object.assign(M, {
    network_growth:        val(networkGrowth, []),
    network_origin:        val(networkOrigin, {}),
    stores_timeline:       val(storesTimeline, {}),
    opening_hours:         val(openingHours, {}),
    growth_by_voivodeship: val(growthByVoiv, []),
    city_first_opening:    val(cityFirst, []),
    top_cities:            val(topCities, []),
    openings_monthly:      val(openingsMonthly, []),
    coverage_funnel:       val(coverageFunnel, []),
    powiat_coverage:       val(powiatCoverage, {total:0, covered:0, dots:[]}),
  });
}

async function loadEdge() {
  const [kraniec, elevation, neighborStats, parksStores, twins] = await Promise.allSettled([
    fetchJSON(`${BASE}/stats/kraniec-facts`),
    fetchJSON(`${BASE}/stats/elevation`),
    fetchJSON(`${BASE}/stats/neighbor-stats`),
    fetchJSON(`${BASE}/stats/parks-stores`),
    fetchJSON(`${BASE}/stats/twins`),
  ]);
  const kf = val(kraniec, {facts:[], backdrop:[]});
  Object.assign(M, {
    kraniec_facts:  kf.facts || [],
    points_sample:  kf.backdrop || [],
    elevation:      val(elevation, {}),
    neighbor_stats: val(neighborStats, {}),
    parks_stores:   val(parksStores, []),
    twins:          val(twins, {within_50m:0, within_100m:0, within_200m:0, total:0, closest_pairs:[], same_address:[]}),
  });
}

async function loadPlazy() {
  const [amphibians] = await Promise.allSettled([
    fetchJSON(`${BASE}/stats/amphibians`),
  ]);
  Object.assign(M, {
    amphibian_extremes: val(amphibians, {}),
  });
}
