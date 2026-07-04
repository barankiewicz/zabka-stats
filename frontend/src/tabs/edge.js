import { M } from '../state.js';
import { capName, escapeHtml } from '../utils.js';
import { t } from '../i18n.js';

export function renderEdgeKPIs() {
  const s = M.summary || {};
  const s3 = M.section3_rare || {};
  const parks = s3.parks || {};
  const ns = M.neighbor_stats || {};
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setCount = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (v != null) {
      el.dataset.count = v;
      // Show sibling unit span if it exists
      const unit = el.nextElementSibling;
      if (unit && unit.classList.contains('stat-unit')) {
        unit.style.display = '';
      }
    } else {
      el.removeAttribute('data-count');
      el.textContent = t('no_data');
      // Hide sibling unit span if it exists
      const unit = el.nextElementSibling;
      if (unit && unit.classList.contains('stat-unit')) {
        unit.style.display = 'none';
      }
    }
  };

  setCount('edge-kpi-h24', s.h24_count);
  setCount('edge-kpi-parks', parks.count);
  const mf = (M.amphibian_extremes && M.amphibian_extremes.most_froggy) || {};
  setCount('edge-kpi-frogrecord', mf.amphibian_occurrences_5km);

  // ep-zerofrog-val / ep-zerofrog-note (panel "Bez żadnej żaby w pobliżu")
  const ae = M.amphibian_extremes || {};
  setCount('ep-zerofrog-val', ae.zero_frog_count);
  if (ae.zero_frog_count != null && s.total_active) {
    const pct = ((ae.zero_frog_count / s.total_active) * 100).toFixed(1).replace('.', ',');
    set('ep-zerofrog-note', t('ep_zerofrog_note').replace('{pct}', pct));
  } else {
    set('ep-zerofrog-note', t('no_data'));
  }

  // ep-isolated-val from neighbor_stats loner (panel under map, ep-isolated)
  const loner = ns.loner || {};
  setCount('ep-isolated-val', loner.nearest_neighbor_distance_meters ? loner.nearest_neighbor_distance_meters / 1000 : null);
  if (loner.nearest_neighbor_distance_meters) {
    if (loner.city) setText('ep-isolated-city', `${loner.city}${loner.voivodeship ? ', ' + capName(loner.voivodeship) : ''}`);
    if (loner.street) setText('ep-isolated-street', loner.street);
  } else {
    setText('ep-isolated-city', t('no_data'));
    setText('ep-isolated-street', t('no_data'));
  }

  // oldest KPI tile from network_origin
  const no = M.network_origin || {};
  const oldest = no.oldest || {};
  if (oldest.first_opening_date) {
    const yr = oldest.first_opening_date.slice(0, 4);
    const age = new Date().getFullYear() - parseInt(yr, 10);
    setCount('edge-kpi-oldest', yr);
    const subEl = document.getElementById('edge-kpi-oldest-sub');
    if (subEl && oldest.city) subEl.textContent = t('oldest_active_sub').replace('{city}', oldest.city).replace('{age}', age);
  } else {
    setCount('edge-kpi-oldest', null);
    setText('edge-kpi-oldest-sub', t('no_data'));
  }

  // void KPI from section3_rare
  const vd = s3.void;
  setCount('edge-kpi-void', vd ? vd.value : null);

  // Elevation panels from M.elevation.extremes
  const elev = M.elevation || {};
  const top = elev.extremes ? elev.extremes.find(e => e.which === 'top') : null;
  const bot = elev.extremes ? elev.extremes.find(e => e.which === 'bottom') : null;

  setCount('ep-highest-val', top ? top.elevation_meters : null);
  if (top) {
    if (top.city) setText('ep-highest-city', `${top.city}${top.voivodeship ? ', ' + capName(top.voivodeship) : ''}`);
    if (top.street) setText('ep-highest-street', top.street);
  } else {
    setText('ep-highest-city', t('no_data'));
    setText('ep-highest-street', t('no_data'));
  }

  setCount('ep-lowest-val', bot ? bot.elevation_meters : null);
  if (bot) {
    if (bot.city) setText('ep-lowest-city', `${bot.city}${bot.voivodeship ? ', ' + capName(bot.voivodeship) : ''}`);
    if (bot.street) setText('ep-lowest-street', bot.street);
  } else {
    setText('ep-lowest-city', t('no_data'));
    setText('ep-lowest-street', t('no_data'));
  }

  // Frog street panel
  const frogStreets = s3.frog_streets || [];
  if (frogStreets.length) {
    const crown = frogStreets[0];
    if (crown.city) setText('ep-frogstreet-city', `${crown.city}${crown.voivodeship ? ', ' + capName(crown.voivodeship) : ''}`);
    const cnt = s3.frog_streets_count || frogStreets.length;
    set('ep-frogstreet-note', t('frog_street_note').replace('{cnt}', cnt));
  } else {
    setText('ep-frogstreet-city', t('no_data'));
    set('ep-frogstreet-note', t('no_data'));
  }

  // Farthest from any amphibian observation
  const ff = (M.amphibian_extremes && M.amphibian_extremes.farthest_from_frog) || {};
  setCount('edge-kpi-farthestfrog', ff.nearest_amphibian_km);
  const subEl = document.getElementById('edge-kpi-farthestfrog-sub');
  if (subEl) {
    if (ff.city && ff.nearest_amphibian_km != null) {
      subEl.textContent = (ff.city + (ff.voivodeship ? ', ' + capName(ff.voivodeship) : '')) + ' · ' + t('edge_kpi_farthest_sub');
    } else {
      subEl.textContent = t('no_data');
    }
  }
}
