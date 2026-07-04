// "Żabka a Polska" bottom panel: two powiat residual choropleths side by side.
// Both maps share the SAME powiat boundaries and the SAME idea - colour is not
// raw density but the *residual* of Żabka density (stores per 1000 residents)
// against a linear fit on an economic variable:
//   left  map -> residual vs unemployment_rate
//   right map -> residual vs avg_salary
// Green = the powiat has more Żabki than its economy predicts, red = fewer,
// pale = right on the trend line. Residuals + ramp bounds are precomputed by
// the /api/stats/powiat-economics-geo endpoint so we only fetch one joined
// FeatureCollection and render each map from a different property.
import { M, MAPS } from '../state.js';
import { fetchJSON } from '../data.js';
import { debounce, escapeHtml } from '../utils.js';
import { loadMaplibre } from '../maplibre-lazy.js';

// MapLibre is already loaded higher up this tab (the InPost choropleth), so this
// lazy import resolves instantly; keeping it lazy avoids pulling it in when the
// econ chunk is parsed before the maps come into view.
let createMap, fitPoland, showMapUnavailable, WebGLUnavailableError;
function ensureMaplibre() {
  return loadMaplibre().then(m => {
    ({ createMap, fitPoland, showMapUnavailable, WebGLUnavailableError } = m);
    return m;
  });
}

const plr = r => (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(2).replace('.', ',');
const dec3 = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(3).replace('.', ',');

// Diverging ramp from a symmetric bound: red-orange (below trend) -> pale
// neutral (on trend) -> Żabka green (above trend). MapLibre clamps values
// outside [-bound, bound] to the end stops, so resort outliers just saturate.
function fillExpr(prop, bound) {
  const b = bound || 1;
  return ['interpolate', ['linear'], ['coalesce', ['get', prop], 0],
    -b, '#c2410c',
    -b * 0.45, '#e8693d',
    0, '#e9ebd6',
    b * 0.45, '#84c341',
    b, '#a6e84a'];
}

let _tip = null;
function ensureTip() {
  if (!_tip) {
    _tip = document.createElement('div');
    _tip.className = 'gran-tooltip maplibre-hover-tip';
    _tip.style.display = 'none';
    document.body.appendChild(_tip);
  }
  return _tip;
}

function tipHtml(p, propKey, econKey) {
  if (!('per_1k' in p)) {
    return `<b>${escapeHtml(p.nazwa || '')}</b><br/><span style="color:#93a487">brak danych ekonomicznych</span>`;
  }
  const resid = propKey === 'resid_salary' ? p.resid_salary : p.resid_unemp;
  const denser = resid >= 0;
  const econLine = econKey === 'salary'
    ? `Średnia płaca: <b>${Number(p.avg_salary).toLocaleString('pl-PL')} zł</b>`
    : `Bezrobocie: <b>${String(p.unemployment_rate).replace('.', ',')}%</b>`;
  return `<span style="font-family:JetBrains Mono;font-size:12px;line-height:1.6;color:#eef3e6">
    <b>${escapeHtml(p.name || p.nazwa)}</b><br/>
    Żabki / 1000 mieszk.: <b>${Number(p.per_1k).toFixed(3).replace('.', ',')}</b><br/>
    ${econLine}<br/>
    <span style="color:${denser ? '#a6e84a' : '#e8693d'}">${denser ? 'gęściej' : 'rzadziej'} niż przewiduje trend (${dec3(resid)})</span></span>`;
}

function legendHtml() {
  return `<span class="econ-lg-item"><span class="econ-lg-swatch" style="background:#e8693d"></span>rzadziej niż trend</span>` +
    `<span class="econ-lg-item"><span class="econ-lg-swatch" style="background:#e9ebd6"></span>zgodnie z trendem</span>` +
    `<span class="econ-lg-item"><span class="econ-lg-swatch" style="background:#84c341"></span>gęściej niż trend</span>`;
}

const _maps = {};

async function buildMap(containerId, fc, meta, propKey, econKey) {
  const el = document.getElementById(containerId);
  if (!el || _maps[containerId]) return;
  await ensureMaplibre();
  if (_maps[containerId]) return;   // re-check after async gap
  const bound = propKey === 'resid_salary' ? meta.bound_salary : meta.bound_unemp;

  let map;
  try {
    map = createMap(containerId, {
      center: [19.3, 52.05], zoom: 5.35, minZoom: 4.8, maxZoom: 9,
      dragRotate: false, scrollZoom: true, doubleClickZoom: true,
    });
  } catch (e) {
    if (e instanceof WebGLUnavailableError) { showMapUnavailable(el, { message: 'Mapa niedostępna' }); return; }
    throw e;
  }
  _maps[containerId] = map;
  MAPS[containerId] = map;   // exposed for the S3 PNG-export toolbar (main.js)

  map.on('load', () => {
    map.addSource('pe', { type: 'geojson', data: fc, promoteId: '_fid' });
    map.addLayer({
      id: 'pe-fill', type: 'fill', source: 'pe',
      paint: {
        'fill-color': ['case', ['has', propKey], fillExpr(propKey, bound), '#182312'],
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.92],
      },
    });
    map.addLayer({
      id: 'pe-line', type: 'line', source: 'pe',
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#eef3e6', 'rgba(8,17,10,.75)'],
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 1.6, 0.5],
      },
    });
    fitPoland(map, 6);

    const tip = ensureTip();
    let hover = null;
    map.on('mousemove', 'pe-fill', e => {
      const f = e.features && e.features[0]; if (!f) return;
      if (hover != null) map.setFeatureState({ source: 'pe', id: hover }, { hover: false });
      hover = f.id;
      map.setFeatureState({ source: 'pe', id: hover }, { hover: true });
      map.getCanvas().style.cursor = 'pointer';
      tip.innerHTML = tipHtml(f.properties || {}, propKey, econKey);
      tip.style.left = (e.originalEvent.clientX + 14) + 'px';
      tip.style.top = (e.originalEvent.clientY + 14) + 'px';
      tip.style.display = 'block';
    });
    map.on('mouseleave', 'pe-fill', () => {
      if (hover != null) map.setFeatureState({ source: 'pe', id: hover }, { hover: false });
      hover = null;
      map.getCanvas().style.cursor = '';
      tip.style.display = 'none';
    });
    setTimeout(() => { try { map.resize(); fitPoland(map, 6); } catch (e) { /* not ready */ } }, 120);
  });

  const ro = new ResizeObserver(debounce(() => { try { map.resize(); } catch (e) { /* not ready */ } }, 120));
  ro.observe(el);
}

function showError() {
  const err = document.getElementById('econ-scene-error');
  if (err) err.hidden = false;
  const btn = document.getElementById('econ-scene-retry');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      err.hidden = true;
      M.powiat_economics_geo = null;
      await loadAndRender();
    });
  }
}

async function loadAndRender() {
  let fc = M.powiat_economics_geo;
  if (!fc || !fc.features || !fc.features.length) {
    try {
      fc = await fetchJSON('/api/stats/powiat-economics-geo');
      M.powiat_economics_geo = fc;
    } catch (e) { showError(); return; }
  }
  if (!fc || !fc.features || !fc.features.length) { showError(); return; }

  const meta = fc.meta || {};
  const setR = (id, r) => {
    const el = document.getElementById(id);
    if (el && r != null && !el.querySelector('.econ-r')) {
      el.insertAdjacentHTML('beforeend', ` <span class="econ-r">r = ${plr(r)}</span>`);
    }
  };
  setR('econ-map-unemp-title', meta.r_unemp);
  setR('econ-map-salary-title', meta.r_salary);
  const lu = document.getElementById('econ-legend-unemp'); if (lu) lu.innerHTML = legendHtml();
  const ls = document.getElementById('econ-legend-salary'); if (ls) ls.innerHTML = legendHtml();

  buildMap('map-econ-unemp', fc, meta, 'resid_unemp', 'unemp');
  buildMap('map-econ-salary', fc, meta, 'resid_salary', 'salary');
}

let _econDone = false;
export function renderEcon() {
  const root = document.getElementById('ec-root'); if (!root) return;
  if (_econDone) {
    const fc = M.powiat_economics_geo;
    if (fc) {
      const meta = fc.meta || {};
      const setR = (id, r) => {
        const el = document.getElementById(id);
        if (el && r != null) {
          const old = el.querySelector('.econ-r');
          if (old) old.remove();
          el.insertAdjacentHTML('beforeend', ` <span class="econ-r">r = ${plr(r)}</span>`);
        }
      };
      setR('econ-map-unemp-title', meta.r_unemp);
      setR('econ-map-salary-title', meta.r_salary);
      const lu = document.getElementById('econ-legend-unemp'); if (lu) lu.innerHTML = legendHtml();
      const ls = document.getElementById('econ-legend-salary'); if (ls) ls.innerHTML = legendHtml();
    }
    return;
  }
  _econDone = true;
  loadAndRender();
}
