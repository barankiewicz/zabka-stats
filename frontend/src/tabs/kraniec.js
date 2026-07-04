// Atlas krancow: interaktywna mapa + lista skrajnych zjawisk.
// Hover NIE skacze - dopiero klik. Kazdy wpis moze renderowac kropki
// (np. h24, parki, sciana zachodnia, sklepy tuz obok). Trzymane w M, cap 360
// na wpis zeby nie przeciazac CPU.
import { M, MAPS } from '../state.js';
import { fmt, capName, whenVisibleIdle, debounce, escapeHtml } from '../utils.js';
import { loadMaplibre } from '../maplibre-lazy.js';
import { t } from '../i18n.js';

// MapLibre (~280 KB gz) is loaded lazily, only when the Atlas map nears view.
let maplibregl, createMap, fitPoland, pointsToFC, geoCircle, boundsOf, showMapUnavailable, WebGLUnavailableError;
function ensureMaplibre(){
  return loadMaplibre().then(m=>{
    ({ maplibregl, createMap, fitPoland, pointsToFC, geoCircle, boundsOf, showMapUnavailable, WebGLUnavailableError } = m);
    return m;
  });
}

const RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;

const COL = {
  compass:    '#84c341',
  elevation:  '#f2a359',
  isolation:  '#4dd0b1',
  void:       '#e8693d',
  frog:       '#a6e84a',
  frogrecord: '#4dd0b1',
  farfrog:    '#e8693d',
  h24:        '#f2a359',
  parks:      '#84c341',
  twins:      '#a6e84a',
  history:    '#a6e84a',
};

const HOME = [19.3, 52.05], HOME_Z = 6;

let _krDone = false, _krMap = null, _select = null, _highlight = null, _pendingSelect = null;
// selectFact() can be called (e.g. from a /fakt/<slug> deep link) before the
// Atlas map has finished its own lazy load (buildMap() only fires once
// #kr-map scrolls near view) - queue the id and apply it once _select exists.
export function selectFact(id) { if (_select) _select(id); else _pendingSelect = id; }

function _setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }

function _updateKrDataCounts() {
  const s3 = M.section3_rare || {};
  const vd = s3.void;
  if (vd && vd.value) {
    const el = document.getElementById('hero-num-edge');
    if (el) el.textContent = String(vd.value).replace('.', ',');
  }
  const no = M.network_origin;
  if (no && no.snapshot_date) {
    _setText('hero-eyebrow-siec', t('hero_eyebrow_siec_snapshot').replace('{date}', no.snapshot_date));
  } else if (M.network_growth && M.network_growth.length) {
    _setText('hero-eyebrow-siec', t('hero_eyebrow_siec_data').replace('{year}', M.network_growth[M.network_growth.length - 1].year));
  }
}

// ---------- lista zjawisk ----------
// Statyczne fakty z kraniec-facts (4 kompasy + 2 wysokosci + izolacja + void + frog),
// plus wpisy dynamiczne z API (frogrecord, farfrog, h24, parks, twins).
function buildFacts() {
  const s3 = M.section3_rare || {};
  const ae = M.amphibian_extremes || {};
  const tw = M.twins || {};
  const total = M.summary && M.summary.total_active || 0;
  const h24Count = M.summary && M.summary.h24_count || (s3.h24_points || []).length || 0;
  const parks = s3.parks || {};
  const voidVal = s3.void && s3.void.value != null ? s3.void.value : null;
  const no = M.network_origin;
  const out = [];

  // Kompas: 4 wpisy
  out.push({ id: 'north', g: 'compass', grp: t('fact_grp_compass'), lab: t('fact_lab_north'),
    val: '54,83°N', city: 'Jastrzębia Góra', voiv: 'pomorskie', street: 'ul. Słowackiego 1A',
    lat: 54.833467, lon: 18.300591, zoom: 11, type: 'point',
    desc: t('fact_desc_north') });
  out.push({ id: 'south', g: 'compass', grp: t('fact_grp_compass'), lab: t('fact_lab_south'),
    val: '49,21°N', city: 'Cisna', voiv: 'podkarpackie', street: 'ul. Cisna 95',
    lat: 49.213484, lon: 22.328102, zoom: 11, type: 'point',
    desc: t('fact_desc_south') });
  out.push({ id: 'east', g: 'compass', grp: t('fact_grp_compass'), lab: t('fact_lab_east'),
    val: '23,90°E', city: 'Hrubieszów', voiv: 'lubelskie', street: 'ul. Kolejowa 6B',
    lat: 50.799815, lon: 23.904273, zoom: 11, type: 'point',
    desc: t('fact_desc_east') });
  out.push({ id: 'west', g: 'compass', grp: t('fact_grp_compass'), lab: t('fact_lab_west'),
    val: '14,20°E', city: 'Cedynia', voiv: 'zachodniopomorskie', street: 'ul. Mieszka I 6',
    lat: 52.879565, lon: 14.204963, zoom: 11, type: 'point',
    desc: t('fact_desc_west') });

  // Wysokosc
  const elev = M.elevation || {};
  const top = (elev.extremes || []).find(e => e.which === 'top');
  const bot = (elev.extremes || []).find(e => e.which === 'bottom');
  out.push({ id: 'highest', g: 'elevation', grp: t('fact_grp_elevation'), lab: t('fact_lab_highest'),
    val: top ? String(top.elevation_meters).replace('.', ',') + ' m' : t('no_data'),
    city: top ? top.city : t('no_data'), voiv: top ? top.voivodeship : t('no_data'),
    street: top ? top.street : t('no_data'),
    lat: (top && top.latitude != null) ? top.latitude : 49.3,
    lon: (top && top.longitude != null) ? top.longitude : 19.9,
    zoom: 12, type: top ? 'point' : 'none',
    desc: t('fact_desc_highest') });
  out.push({ id: 'lowest', g: 'elevation', grp: t('fact_grp_elevation'), lab: t('fact_lab_lowest'),
    val: bot ? String(bot.elevation_meters).replace('.', ',') + ' m' : t('no_data'),
    city: bot ? bot.city : t('no_data'), voiv: bot ? bot.voivodeship : t('no_data'),
    street: bot ? bot.street : t('no_data'),
    lat: (bot && bot.latitude != null) ? bot.latitude : 54.4,
    lon: (bot && bot.longitude != null) ? bot.longitude : 18.66,
    zoom: 12, type: bot ? 'point' : 'none',
    desc: t('fact_desc_lowest') });

  // Izolacja
  const ns = M.neighbor_stats || {};
  const loner = ns.loner || {};
  out.push({ id: 'isolated', g: 'isolation', grp: t('fact_grp_isolation'), lab: t('fact_lab_isolated'),
    val: (loner && loner.nearest_neighbor_distance_meters)
      ? (loner.nearest_neighbor_distance_meters / 1000).toFixed(1).replace('.', ',') + ' km'
      : t('no_data'),
    city: (loner && loner.city) ? loner.city : t('no_data'),
    voiv: (loner && loner.voivodeship) ? loner.voivodeship : t('no_data'),
    street: (loner && loner.street) ? loner.street : t('no_data'),
    lat: (loner && loner.latitude != null) ? loner.latitude : 53.033086,
    lon: (loner && loner.longitude != null) ? loner.longitude : 23.606322,
    zoom: 10, type: (loner && loner.nearest_neighbor_distance_meters) ? 'point' : 'none',
    desc: t('fact_desc_isolated') });

  // Najstarsza aktywna Zabka (historia sieci)
  const oldestStore = (no || {}).oldest || {};
  if (oldestStore.lat != null && oldestStore.lon != null) {
    const yr = oldestStore.first_opening_date ? oldestStore.first_opening_date.slice(0, 4) : '1998';
    const age = new Date().getFullYear() - parseInt(yr, 10);
    out.push({ id: 'oldest', g: 'history', grp: t('fact_grp_history'), lab: t('fact_lab_oldest'),
      val: yr,
      city: oldestStore.city || 'Swarzędz', voiv: oldestStore.voivodeship || 'wielkopolskie',
      street: oldestStore.street || 'Rynek 4/5',
      lat: oldestStore.lat, lon: oldestStore.lon,
      zoom: 14, type: 'point',
      desc: t('fact_desc_oldest').replace('{year}', yr).replace('{age}', age) });
  }

  // Pustka - tylko gdy API faktycznie zwrociło wartość (bez zgadywania liczby)
  if (voidVal != null) {
    out.push({ id: 'void', g: 'void', grp: t('fact_grp_void'), lab: t('fact_lab_void'),
      val: String(voidVal).replace('.', ',') + ' km',
      city: 'Bieszczady', voiv: 'podkarpackie', street: '49,01°N / 22,89°E',
      lat: (s3.void && s3.void.lat != null) ? s3.void.lat : 49.01,
      lon: (s3.void && s3.void.lon != null) ? s3.void.lon : 22.89,
      zoom: 9, type: 'circle',
      desc: t('fact_desc_void').replace('{distance}', String(voidVal).replace('.', ',')) });
  }

  // Plazy
  const mf = ae.most_froggy || {};
  out.push({ id: 'frog', g: 'frog', grp: t('fact_grp_frog'), lab: t('fact_lab_crown'),
    val: 'Żabia Wola', city: 'Żabia Wola', voiv: 'mazowieckie',
    street: 'ul. Zielonej Żabki 7', lat: 52.031662, lon: 20.689194, zoom: 13, type: 'point',
    desc: t('fact_desc_crown') });
  if (mf && mf.latitude) {
    out.push({ id: 'frogrecord', g: 'frogrecord', grp: t('fact_grp_frog'), lab: t('fact_lab_frogrecord'),
      val: fmt(mf.amphibian_occurrences_5km || 0) + ' obs.',
      city: mf.city || '', voiv: mf.voivodeship || '',
      street: mf.street || '',
      lat: mf.latitude, lon: mf.longitude, zoom: 11, type: 'point',
      desc: t('fact_desc_frogrecord') });
  }
  const ff = ae.farthest_from_frog || {};
  if (ff && ff.latitude) {
    out.push({ id: 'farfrog', g: 'farfrog', grp: t('fact_grp_frog'), lab: t('fact_lab_farfrog'),
      val: ff.nearest_amphibian_km != null
        ? ff.nearest_amphibian_km.toFixed(2).replace('.', ',') + ' km' : '–',
      city: ff.city || '', voiv: ff.voivodeship || '', street: '',
      lat: ff.latitude, lon: ff.longitude, zoom: 10, type: 'point',
      desc: t('fact_desc_farfrog') });
  }
  // 668 Żabek bez żadnej żaby w promieniu 5 km - pokazane jako skupisko punktow
  if (ae.zero_frog_count != null) {
    const zeroFrogDots = (ae.stores || [])
      .filter(s => s[2] === 0)
      .map(s => [s[0], s[1]]);
    
    let descStr = '';
    if (ff && ff.nearest_amphibian_km != null && ff.city) {
      descStr = t('fact_desc_zerofrog')
        .replace('{isolated_store}', ff.city)
        .replace('{distance}', ff.nearest_amphibian_km.toFixed(2).replace('.', ','));
    } else {
      descStr = t('fact_desc_zerofrog_simple');
    }

    out.push({ id: 'zerofrog', g: 'farfrog', grp: t('fact_grp_frog'), lab: t('fact_lab_zerofrog'),
      val: t('fact_val_zerofrog').replace('{count}', fmt(ae.zero_frog_count)),
      city: '', voiv: '', street: '',
      lat: 52.05, lon: 19.3, zoom: 6, type: 'cluster',
      short: t('fact_short_zerofrog'),
      desc: descStr,
      dots: zeroFrogDots });
  }

  // 24/7
  const h24pts = s3.h24_points || [];
  out.push({ id: 'h24', g: 'h24', grp: t('fact_grp_h24'), lab: t('fact_lab_h24'),
    val: fmt(h24Count) + ' ' + (h24Count === 1 ? t('unit_store_singular') : t('unit_store_plural')),
    city: '', voiv: '', street: '',
    lat: 52.05, lon: 19.3, zoom: 6, type: 'cluster',
    short: t('fact_short_h24'),
    desc: t('fact_desc_h24').replace('{count}', fmt(h24Count)).replace('{total}', fmt(total)),
    dots: h24pts });

  // Parki
  out.push({ id: 'parks', g: 'parks', grp: t('fact_grp_nature'), lab: t('fact_lab_parks'),
    val: fmt(parks.count || 0) + ' / ' + fmt(total),
    city: '', voiv: '', street: '',
    lat: 52.05, lon: 19.3, zoom: 6, type: 'cluster',
    short: t('fact_short_parks'),
    desc: t('fact_desc_parks'),
    dots: M.parks_stores || [] });

  // Sklepy tuz obok siebie
  out.push({ id: 'twins', g: 'twins', grp: t('fact_grp_twins'), lab: t('fact_lab_twins'),
    val: t('fact_val_twins').replace('{count}', fmt(tw.within_50m != null ? tw.within_50m : 0)),
    city: '', voiv: '', street: '',
    lat: 52.05, lon: 19.3, zoom: 6, type: 'cluster',
    short: t('fact_short_twins'),
    desc: t('fact_desc_twins').replace('{count}', fmt(tw.within_50m || 0)),
    dots: (tw.points_50 || []).map(p => [p.lat, p.lon]),
    dotsMeta: tw.points_50 || [] });

  return out;
}

export function renderKraniec() {
  const root = document.getElementById('kr-root'); if (!root) return;
  _updateKrDataCounts();
  if (_krDone) {
    buildList();
    if (_krMap) {
      setTimeout(() => _krMap.resize && _krMap.resize(), 120);
    }
    const activeItem = root.querySelector('#kr-rail .item.active');
    if (activeItem) {
      const activeId = activeItem.dataset.id;
      const f = buildFacts().find(x => x.id === activeId);
      if (f) {
        const cap = document.getElementById('kr-caption');
        if (cap) cap.innerHTML = `<b>${escapeHtml(f.city || f.lab)}</b> · ${escapeHtml(f.val)} – ${escapeHtml(f.desc)}`;
      }
    }
    return;
  }
  _krDone = true;
  whenVisibleIdle(document.getElementById('kr-map'), buildMap, '80px');   // defer MapLibre until the Atlas is on-screen + past load
  buildList();
  wirePanels();
}

async function buildMap() {
  const node = document.getElementById('kr-map'); if (!node) return;
  await ensureMaplibre();
  try {
  _krMap = createMap('kr-map', {
    center: HOME, zoom: HOME_Z, minZoom: 5, maxZoom: 13,
    dragRotate: false, pitchWithRotate: false,
    scrollZoom: false, doubleClickZoom: true, touchZoom: true,
    cooperativeGestures: true,   // ctrl+scroll to zoom (page scrolls otherwise)
    attributionControl: false,
  });
  MAPS['kr-map'] = _krMap;

  // ctrl + scroll to zoom, centered on the cursor (parity with the growth map)
  node.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = node.getBoundingClientRect();
    const lngLat = _krMap.unproject([e.clientX - r.left, e.clientY - r.top]);
    _krMap.easeTo({ center: lngLat, zoom: _krMap.getZoom() + (e.deltaY < 0 ? 0.6 : -0.6), duration: 0 });
  }, { passive: false });

  const FACTS = buildFacts();
  const FACT_BY_ID = Object.fromEntries(FACTS.map(f => [f.id, f]));
  const CLUSTER_FACTS = FACTS.filter(f => f.type === 'cluster' && f.dots && f.dots.length);
  const POINT_FACTS = FACTS.filter(f => f.type === 'point' || f.type === 'circle');

  // cluster dot layers: opacity tweened by a single rAF loop
  const _dotState = {};   // factId -> {opacity, target}
  let _dotRaf = 0;
  function _dotLoop() {
    let moving = false;
    CLUSTER_FACTS.forEach(f => {
      const st = _dotState[f.id] || (_dotState[f.id] = { opacity: 0, target: 0 });
      const d = st.target - st.opacity;
      if (Math.abs(d) > 0.01) { st.opacity += d * 0.15; moving = true; } else st.opacity = st.target;
      const lid = 'cluster-' + f.id + '-dots';
      if (_krMap.getLayer(lid)) {
        const vis = st.opacity > 0.005 ? 'visible' : 'none';
        _krMap.setLayoutProperty(lid, 'visibility', vis);
        if (vis === 'visible') {
          _krMap.setPaintProperty(lid, 'circle-opacity', st.opacity * 0.85);
          _krMap.setPaintProperty(lid, 'circle-stroke-opacity', st.opacity * 0.4);
        }
      }
    });
    _dotRaf = moving ? requestAnimationFrame(_dotLoop) : 0;
  }
  function _setClusterTarget(factId) {
    CLUSTER_FACTS.forEach(f => {
      _dotState[f.id] = _dotState[f.id] || { opacity: 0, target: 0 };
      _dotState[f.id].target = (f.id === factId) ? 1 : 0;
    });
    if (!_dotRaf) _dotRaf = requestAnimationFrame(_dotLoop);
  }

  // Hovering a rail entry or a KPI/panel tile previews the fact ON THE MAP -
  // the same popup you get hovering the point itself, and the dot cloud for
  // cluster facts - instead of a separate DOM tooltip. A pinned (clicked) fact
  // is left untouched; leaving the hover restores whatever was pinned.
  function _restoreDots() {
    const af = activeId ? FACT_BY_ID[activeId] : null;
    showDots(af && af.type === 'cluster' ? af.id : null);
  }
  function hoverFact(f) {
    if (!f || activeId === f.id) return;
    if (f.type === 'cluster') { showDots(f.id); return; }
    const m = markers[f.id];
    if (m) {
      setActiveMarker(f.id);
      const zoomedOut = _krMap.getZoom() <= 7.5;
      const onScreen = _krMap.getBounds().contains([f.lon, f.lat]);
      if (zoomedOut || onScreen) {
        m.popup.setLngLat([f.lon, f.lat]).addTo(_krMap);
        panPopupIntoView(m.popup);
      }
    }
  }
  function unhoverFact(f) {
    if (!f || activeId === f.id) return;
    if (f.type === 'cluster') { _restoreDots(); return; }
    const m = markers[f.id];
    if (m) { setActiveMarker(activeId); m.popup.remove(); }
  }

  const railEl = document.getElementById('kr-rail');
  if (railEl) {
    railEl.addEventListener('mouseover', e => {
      const it = e.target.closest('.item');
      if (it) hoverFact(FACTS.find(x => x.id === it.dataset.id));
    });
    railEl.addEventListener('mouseout', e => {
      const it = e.target.closest('.item');
      if (it) unhoverFact(FACTS.find(x => x.id === it.dataset.id));
    });
  }
  const panelFactMap = {
    'edge-kpi-h24-tile': 'h24', 'edge-kpi-parks-tile': 'parks',
    'edge-kpi-frogrecord-tile': 'frogrecord', 'edge-kpi-void-tile': 'void',
    'edge-kpi-oldest-tile': 'oldest', 'edge-kpi-farthestfrog-tile': 'farfrog',
    'ep-highest': 'highest', 'ep-lowest': 'lowest', 'ep-isolated': 'isolated',
    'ep-zerofrog-panel': 'zerofrog', 'ep-frog-panel': 'frog',
  };
  Object.keys(panelFactMap).forEach(pid => {
    const el = document.getElementById(pid);
    if (!el) return;
    const getF = () => FACTS.find(x => x.id === panelFactMap[pid]);
    el.addEventListener('mouseover', () => hoverFact(getF()));
    el.addEventListener('mouseout', () => unhoverFact(getF()));
  });

  const markers = {};   // factId -> {marker, el, mkEl, popup}
  const cap = document.getElementById('kr-cap');
  let activeId = null;

  function setActiveMarker(id) {
    Object.entries(markers).forEach(([k, mm]) => {
      if (mm.mkEl) mm.mkEl.classList.toggle('active', k === id);
    });
  }

  const showDots = (factId) => _setClusterTarget(factId);

  function flyToFact(f, withPopup) {
    if (!f) return;
    // close any open popup when switching facts
    Object.values(markers).forEach(mm => { if (mm.popup) mm.popup.remove(); });
    if (f.type === 'cluster' && f.dots && f.dots.length) {
      showDots(f.id);
      try {
        const bnd = boundsOf(f.dots);
        _krMap.fitBounds(bnd, { padding: 28, animate: !RM, duration: RM ? 0 : 1600, maxZoom: 12 });
      } catch (e) {
        _krMap.flyTo({ center: [f.lon, f.lat], zoom: f.zoom, duration: RM ? 0 : 1600 });
      }
    } else {
      _krMap.flyTo({ center: [f.lon, f.lat], zoom: f.zoom, duration: RM ? 0 : 1600 });
    }
    setActiveMarker(f.id);
    document.querySelectorAll('#kr-rail .item').forEach(it => it.classList.toggle('active', it.dataset.id === f.id));
    if (f.type !== 'cluster') showDots(null);
    if (cap) cap.innerHTML = `<b>${escapeHtml(f.city || f.lab)}</b> · ${escapeHtml(f.val)} – ${escapeHtml(f.desc)}`;
    if (withPopup && (f.type === 'point' || f.type === 'circle') && markers[f.id]) {
      setTimeout(() => markers[f.id].popup.setLngLat([f.lon, f.lat]).addTo(_krMap), RM ? 0 : 650);
    }
  }

  const select = (id) => {
    const f = FACT_BY_ID[id];
    if (!f) return;
    activeId = id;
    flyToFact(f, true);
  };
  _select = select;
  _highlight = (id) => {
    const f = FACT_BY_ID[id];
    if (!f) return;
    setActiveMarker(f.id);
    showDots(f.type === 'cluster' ? f.id : null);
  };

  const resetBtn = document.getElementById('kr-reset');
  if (resetBtn) resetBtn.onclick = () => {
    activeId = null;
    setActiveMarker(null);
    Object.values(markers).forEach(mm => { if (mm.popup) mm.popup.remove(); });
    showDots(null);
    document.querySelectorAll('#kr-rail .item').forEach(it => it.classList.remove('active'));
    document.querySelectorAll('.kr-fact-tile').forEach(it => it.classList.remove('active'));
    // On mobile a reset tap right after a pinch can land while the pinch's own
    // kinetic-zoom easing is still running, and land mid-flight against a
    // container size MapLibre cached before the page finished settling - stop
    // any in-progress camera animation and re-measure the container before
    // starting the new one, or the fitBounds zoom can lose to the leftover one.
    _krMap.stop();
    _krMap.resize();
    fitPoland(_krMap, 4, { duration: RM ? 0 : 1400 });   // same full-Poland view as initial load
    if (cap) cap.textContent = t('kr_cap_default');
  };

  _krMap.on('load', () => {
    // faint store backdrop for geographic context (no raster tiles)
    const backdrop = M.points_sample || [];
    if (backdrop.length) {
      _krMap.addSource('backdrop', { type: 'geojson', data: pointsToFC(backdrop) });
      _krMap.addLayer({ id: 'backdrop-dots', type: 'circle', source: 'backdrop',
        paint: { 'circle-radius': 1, 'circle-color': '#1a3a14', 'circle-opacity': 0.5 } });
    }
    // voivodeship outline
    if (M.woj_geo) {
      _krMap.addSource('woj', { type: 'geojson', data: M.woj_geo });
      _krMap.addLayer({ id: 'woj-line', type: 'line', source: 'woj',
        paint: { 'line-color': 'rgba(140,200,80,.12)', 'line-width': 1 } });
    }
    // Bieszczady void: dashed geodesic circle
    const voidFact = FACT_BY_ID.void;
    if (voidFact) {
      const radiusM = parseFloat(String(voidFact.val).replace(',', '.')) * 1000;
      _krMap.addSource('void', { type: 'geojson', data: geoCircle(voidFact.lat, voidFact.lon, radiusM) });
      _krMap.addLayer({ id: 'void-fill', type: 'fill', source: 'void', paint: { 'fill-color': '#e8693d', 'fill-opacity': 0.06 } });
      _krMap.addLayer({ id: 'void-line', type: 'line', source: 'void',
        paint: { 'line-color': '#e8693d', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } });
    }
    // cluster dot layers — one per cluster fact, all start hidden
    CLUSTER_FACTS.forEach(f => {
      const fc = pointsToFC(f.dots, (lat, lon, p, i) => ({
        _c: (f.id === 'twins') ? _twinsColorForDot(i, f.dotsMeta && f.dotsMeta[i]) : COL[f.g],
      }));
      _krMap.addSource('cluster-' + f.id, { type: 'geojson', data: fc });
      _krMap.addLayer({
        id: 'cluster-' + f.id + '-dots', type: 'circle', source: 'cluster-' + f.id,
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 1.8, 'circle-color': ['get', '_c'],
          'circle-opacity': 0, 'circle-blur': 0.5,
          'circle-stroke-color': ['get', '_c'], 'circle-stroke-opacity': 0, 'circle-stroke-width': 0.5,
        },
      });
    });
    // point/circle facts as HTML markers (reuse the .mk CSS)
    POINT_FACTS.forEach(f => {
      const c = COL[f.g];
      const el = document.createElement('div');
      el.className = 'mk-wrap';
      el.innerHTML = `<div class="mk ${f.id === 'frog' ? 'big' : ''}" style="--c:${c}"></div>`;
      const mkEl = el.querySelector('.mk');
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([f.lon, f.lat]).addTo(_krMap);
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, maxWidth: '280px', className: 'zab-popup' })
        .setHTML(_popupHtml(f));
      marker.setPopup(popup);
      el.addEventListener('click', (ev) => { ev.stopPropagation(); selectFact(f.id); });
      el.addEventListener('mouseenter', () => { if (activeId !== f.id) { popup.setLngLat([f.lon, f.lat]).addTo(_krMap); panPopupIntoView(popup); } });
      el.addEventListener('mouseleave', () => { if (activeId !== f.id) popup.remove(); });
      markers[f.id] = { marker, el, mkEl, popup };
    });

    fitPoland(_krMap, 4);

    // A selectFact() call that arrived before the style finished loading (e.g.
    // a /fakt/<slug> deep link racing this map's own setup) was queued -
    // apply it now, after markers exist and after the fitPoland above, so it
    // doesn't get immediately overridden by it.
    if (_pendingSelect) { const id = _pendingSelect; _pendingSelect = null; select(id); }
  });

  // keep the map sized when its container reveals / resizes
  new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && _krMap) _krMap.resize(); }), { threshold: 0.1 }).observe(node);
  window.addEventListener('resize', debounce(() => { if (_krMap) _krMap.resize(); }));
  setTimeout(() => { if (_krMap) _krMap.resize(); }, 300);
  } catch (e) {
    if (e instanceof WebGLUnavailableError) {
      showMapUnavailable(node, { message: t('atlas_map_unavailable') });
      _krMap = null;
      return;
    }
    throw e;
  }
}
// 3 odcienie zieleni dla twins, w proporcjach odpowiadajacych progom
function _twinsColorForDot(i, meta) {
  if (!meta) return '#a6e84a';
  const b = meta.bucket;
  if (b === 'a') return '#5e9a2a';   // <50 m, ciemna zielen
  if (b === 'b') return '#84c341';   // 50-100 m, bazowa
  return '#a6e84a';                  // 100-200 m, jasna
}

function _popupHtml(f) {
  const c = COL[f.g];
  const escapedCity = escapeHtml(f.city);
  const escapedVoiv = capName(escapeHtml(f.voiv));
  const escapedStreet = escapeHtml(f.street);
  const escapedDesc = escapeHtml(f.desc);
  const escapedLab = escapeHtml(f.lab);
  const escapedVal = escapeHtml(f.val);
  return `<div class="pop" style="--c:${c}">
    <div class="pk">${escapedLab}</div>
    <div class="pv">${escapedVal}</div>
    ${f.city ? `<div class="pc">${escapedCity}</div>` : ''}
    ${f.voiv ? `<div class="ps">${escapedVoiv}${f.street ? ' · ' + escapedStreet : ''}</div>` : ''}
    <div class="pd">${escapedDesc}</div>
  </div>`;
}

// MapLibre popups don't auto-pan: a point near an edge gets its popup clipped by
// the canvas. After a popup opens, measure it and nudge the map by exactly the
// overflow so the whole tooltip is visible. Runs next frame so the popup DOM is
// laid out before we measure.
function panPopupIntoView(popup) {
  if (!_krMap || !popup) return;
  requestAnimationFrame(() => {
    const el = popup.getElement();
    if (!el || !_krMap) return;
    const c = _krMap.getContainer().getBoundingClientRect();
    const p = el.getBoundingClientRect();
    const pad = 12;
    let tx = 0, ty = 0;
    if (p.left < c.left + pad) tx = (c.left + pad) - p.left;
    else if (p.right > c.right - pad) tx = (c.right - pad) - p.right;
    if (p.top < c.top + pad) ty = (c.top + pad) - p.top;
    else if (p.bottom > c.bottom - pad) ty = (c.bottom - pad) - p.bottom;
    // panBy(center offset) shifts content by the negative of that offset
    if (tx || ty) _krMap.panBy([-tx, -ty], { duration: RM ? 0 : 300 });
  });
}

function buildList() {
  const rail = document.getElementById('kr-rail');
  if (!rail) return;
  const FACTS = buildFacts();
  rail.innerHTML = '';
  let lastGrp = null;
  FACTS.forEach(f => {
    const c = COL[f.g];
    if (f.grp !== lastGrp) {
      const h = document.createElement('div');
      h.className = 'grp-h';
      h.style.setProperty('--c', c);
      h.innerHTML = `<span class="dot"></span>${f.grp}`;
      rail.appendChild(h);
      lastGrp = f.grp;
    }
    const it = document.createElement('div');
    it.className = 'item';
    it.dataset.id = f.id;
    it.style.setProperty('--c', c);
    it.innerHTML = `<div class="v">${f.val}</div>
      <div class="meta">
        <div class="lab">${f.lab}</div>
        <div class="sub">${f.id === 'frog' && f.street
          ? f.city + ' · ' + f.street
          : f.city
            ? f.city + (f.voiv ? ' · ' + capName(f.voiv) : '')
            : (f.short || f.desc)}</div>
      </div>`;
    it.onclick = () => selectFact(f.id);
    rail.appendChild(it);
  });
}

function wirePanels() {
  // Klikalne kafelki: kpi u gory + panele pod mapa
  const panelMap = [
    { id: 'edge-kpi-h24-tile',          fact: 'h24' },
    { id: 'edge-kpi-parks-tile',        fact: 'parks' },
    { id: 'edge-kpi-frogrecord-tile',   fact: 'frogrecord' },
    { id: 'edge-kpi-void-tile',         fact: 'void' },
    { id: 'edge-kpi-oldest-tile',       fact: 'oldest' },
    { id: 'edge-kpi-farthestfrog-tile', fact: 'farfrog' },
    { id: 'ep-highest',                 fact: 'highest' },
    { id: 'ep-lowest',                  fact: 'lowest' },
    { id: 'ep-isolated',                fact: 'isolated' },
    { id: 'ep-zerofrog-panel',          fact: 'zerofrog' },
    { id: 'ep-frog-panel',              fact: 'frog' },
  ];
  panelMap.forEach(({ id, fact }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.onclick = (e) => { e.stopPropagation(); selectFact(fact); };
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectFact(fact); }
    });
  });
}
