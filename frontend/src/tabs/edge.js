import { M } from '../state.js';
import { capName } from '../utils.js';

export function renderEdgeKPIs() {
  const s = M.summary || {};
  const s3 = M.section3_rare || {};
  const parks = s3.parks || {};
  const ns = M.neighbor_stats || {};
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const setCount = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.dataset.count = v; };

  if (s.h24_count != null) setCount('edge-kpi-h24', s.h24_count);
  if (parks.count != null) setCount('edge-kpi-parks', parks.count);
  const mf = (M.amphibian_extremes && M.amphibian_extremes.most_froggy) || {};
  if (mf.amphibian_occurrences_5km != null) setCount('edge-kpi-frogrecord', mf.amphibian_occurrences_5km);

  // ep-zerofrog-val / ep-zerofrog-note (panel "Bez żadnej żaby w pobliżu")
  const ae = M.amphibian_extremes || {};
  if (ae.zero_frog_count != null) {
    setCount('ep-zerofrog-val', ae.zero_frog_count);
    if (s.total_active) {
      const pct = ((ae.zero_frog_count / s.total_active) * 100).toFixed(1).replace('.', ',');
      set('ep-zerofrog-note', `sklepów (${pct}%) bez ani jednej obserwacji płaza w 5 km`);
    }
  }

  // ep-isolated-val from neighbor_stats loner (panel under map, ep-isolated)
  const loner = ns.loner || {};
  if (loner.nearest_neighbor_distance_meters) {
    setCount('ep-isolated-val', loner.nearest_neighbor_distance_meters / 1000);
    if (loner.city) set('ep-isolated-city', `${loner.city}${loner.voivodeship ? ', ' + capName(loner.voivodeship) : ''}`);
    if (loner.street) set('ep-isolated-street', loner.street);
  }

  // oldest KPI tile from network_origin
  const no = M.network_origin || {};
  const oldest = no.oldest || {};
  if (oldest.first_opening_date) {
    const yr = oldest.first_opening_date.slice(0, 4);
    const age = new Date().getFullYear() - parseInt(yr, 10);
    setCount('edge-kpi-oldest', yr);
    const subEl = document.getElementById('edge-kpi-oldest-sub');
    if (subEl && oldest.city) subEl.textContent = oldest.city + ' · dziala od ' + age + ' lat';
  }

  // void KPI from section3_rare
  const vd = s3.void;
  if (vd && vd.value) {
    setCount('edge-kpi-void', vd.value);
  }

  // Elevation panels from M.elevation.extremes
  const elev = M.elevation || {};
  if (elev.extremes && elev.extremes.length) {
    const top = elev.extremes.find(e => e.which === 'top');
    const bot = elev.extremes.find(e => e.which === 'bottom');
    if (top) {
      setCount('ep-highest-val', top.elevation_meters);
      if (top.city) set('ep-highest-city', `${top.city}${top.voivodeship ? ', ' + capName(top.voivodeship) : ''}`);
      if (top.street) set('ep-highest-street', top.street);
    }
    if (bot) {
      setCount('ep-lowest-val', bot.elevation_meters);
      if (bot.city) set('ep-lowest-city', `${bot.city}${bot.voivodeship ? ', ' + capName(bot.voivodeship) : ''}`);
      if (bot.street) set('ep-lowest-street', bot.street);
    }
  }

  // Frog street panel
  const frogStreets = s3.frog_streets || [];
  if (frogStreets.length) {
    const crown = frogStreets[0];
    if (crown.city) set('ep-frogstreet-city', `${crown.city}${crown.voivodeship ? ', ' + capName(crown.voivodeship) : ''}`);
    const cnt = s3.frog_streets_count || frogStreets.length;
    set('ep-frogstreet-note', `Żabka przy ulicy Zielonej Żabki – jeden z ${cnt} sklepów na ulicach z żabim motywem.`);
  }

  // Farthest from any amphibian observation
  const ff = (M.amphibian_extremes && M.amphibian_extremes.farthest_from_frog) || {};
  if (ff.city && ff.nearest_amphibian_km != null) {
    setCount('edge-kpi-farthestfrog', ff.nearest_amphibian_km);
    const subEl = document.getElementById('edge-kpi-farthestfrog-sub');
    if (subEl) subEl.textContent = ff.city + (ff.voivodeship ? ', ' + capName(ff.voivodeship) : '');
  }
}
