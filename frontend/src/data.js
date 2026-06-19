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

export async function loadData() {
  document.querySelectorAll('.chart-wrap canvas,.map-container>div,.hero-band,.origin-cards').forEach(el=>{
    el.classList.add('skel');el.dataset.skelApplied='1';
  });
  const BASE = '/api';
  const [
    summary, networkGrowth, networkOrigin, storesTimeline, openingHours,
    perCapita, growthByVoiv, cityFirst, topCities, economics,
    sunday, density, merrychef, inpost, kraniec,
    elevation, neighborStats, section3, amphibians, wojGeo
  ] = await Promise.allSettled([
    fetchJSON(`${BASE}/stats/summary`),
    fetchJSON(`${BASE}/stats/network-growth`),
    fetchJSON(`${BASE}/stats/network-origin`),
    fetchJSON(`${BASE}/stats/stores-timeline`),
    fetchJSON(`${BASE}/stats/opening-hours`),
    fetchJSON(`${BASE}/stats/per-capita`),
    fetchJSON(`${BASE}/stats/growth-by-voivodeship`),
    fetchJSON(`${BASE}/stats/city-first-opening`),
    fetchJSON(`${BASE}/stats/top-cities?limit=20`),
    fetchJSON(`${BASE}/stats/powiat-economics`),
    fetchJSON(`${BASE}/stats/sunday-by-voivodeship`),
    fetchJSON(`${BASE}/stats/voivodeship-density`),
    fetchJSON(`${BASE}/stats/voivodeship`),
    fetchJSON(`${BASE}/stats/inpost-vs-zabka`),
    fetchJSON(`${BASE}/stats/kraniec-facts`),
    fetchJSON(`${BASE}/stats/elevation`),
    fetchJSON(`${BASE}/stats/neighbor-stats`),
    fetchJSON(`${BASE}/stats/section3-rare`),
    fetchJSON(`${BASE}/stats/amphibians`),
    fetchJSON(`${BASE}/geo/voivodeships`),
  ]);

  function val(settled, fallback={}) { return settled.status==='fulfilled' ? settled.value : fallback; }

  const kf = val(kraniec, {facts:[], backdrop:[]});
  Object.assign(M, {
    summary:               val(summary, {total_active:0, cities_count:0, merrychef_pct:0, sunday_pct:0, h24_count:0}),
    network_growth:        val(networkGrowth, []),
    network_origin:        val(networkOrigin, {}),
    stores_timeline:       val(storesTimeline, {}),
    opening_hours:         val(openingHours, {}),
    per_capita:            val(perCapita, []),
    growth_by_voivodeship: val(growthByVoiv, []),
    city_first_opening:    val(cityFirst, []),
    top_cities:            val(topCities, []),
    powiat_economics:      val(economics, []),
    sunday_by_voivodeship: val(sunday, []),
    voivodeship_density:   val(density, []),
    voivodeship_merrychef: val(merrychef, []),
    inpost_vs_zabka:       val(inpost, []),
    kraniec_facts:         kf.facts || [],
    points_sample:         kf.backdrop || [],
    elevation:             val(elevation, {}),
    neighbor_stats:        val(neighborStats, {}),
    section3_rare:         val(section3, {}),
    amphibian_extremes:    val(amphibians, {}),
    woj_geo:               val(wojGeo, {type:'FeatureCollection', features:[]}),
    timeline_monthly:      [],
  });

  document.querySelectorAll('[data-skel-applied]').forEach(el=>{el.classList.remove('skel');delete el.dataset.skelApplied});
}
