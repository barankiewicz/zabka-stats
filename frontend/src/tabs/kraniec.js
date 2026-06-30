// Atlas krancow: interaktywna mapa + lista skrajnych zjawisk.
// Hover NIE skacze - dopiero klik. Kazdy wpis moze renderowac kropki
// (np. h24, parki, sciana zachodnia, sklepy tuz obok). Trzymane w M, cap 360
// na wpis zeby nie przeciazac CPU.
import { maplibregl, createMap, fitPoland, pointsToFC, geoCircle, boundsOf, showMapUnavailable, WebGLUnavailableError } from '../maplibre-map.js';
import { M, MAPS } from '../state.js';
import { fmt, capName } from '../utils.js';

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

let _krDone = false, _krMap = null, _select = null, _highlight = null;
export function selectFact(id) { if (_select) _select(id); }

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
    _setText('hero-eyebrow-siec', `Atlas Żabki · migawka ${no.snapshot_date}`);
  } else if (M.network_growth && M.network_growth.length) {
    _setText('hero-eyebrow-siec', `Atlas Żabki · dane ${M.network_growth[M.network_growth.length - 1].year}`);
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
  const voidVal = s3.void && s3.void.value != null ? s3.void.value : 46.52;
  const out = [];

  // Kompas: 4 wpisy
  out.push({ id: 'north', g: 'compass', grp: 'Kompas – cztery kierunki', lab: 'Najdalej na północ',
    val: '54,83°N', city: 'Jastrzębia Góra', voiv: 'pomorskie', street: 'ul. Słowackiego 1A',
    lat: 54.833467, lon: 18.300591, zoom: 11, type: 'point',
    desc: 'Najbardziej wysunięta na północ Żabka w kraju – tuż przy nadbałtyckim klifie.' });
  out.push({ id: 'south', g: 'compass', grp: 'Kompas – cztery kierunki', lab: 'Najdalej na południe',
    val: '49,21°N', city: 'Cisna', voiv: 'podkarpackie', street: 'ul. Cisna 95',
    lat: 49.213484, lon: 22.328102, zoom: 11, type: 'point',
    desc: 'Kraniec południa: Cisna w Bieszczadach, brama w góry.' });
  out.push({ id: 'east', g: 'compass', grp: 'Kompas – cztery kierunki', lab: 'Najdalej na wschód',
    val: '23,90°E', city: 'Hrubieszów', voiv: 'lubelskie', street: 'ul. Kolejowa 6B',
    lat: 50.799815, lon: 23.904273, zoom: 11, type: 'point',
    desc: 'Najbardziej na wschód – Hrubieszów, niemal przy granicy z Ukrainą.' });
  out.push({ id: 'west', g: 'compass', grp: 'Kompas – cztery kierunki', lab: 'Najdalej na zachód',
    val: '14,20°E', city: 'Cedynia', voiv: 'zachodniopomorskie', street: 'ul. Mieszka I 6',
    lat: 52.879565, lon: 14.204963, zoom: 11, type: 'point',
    desc: 'Skrajny zachód: Cedynia nad Odrą, kilka kilometrów od Niemiec.' });

  // Wysokosc
  const elev = M.elevation || {};
  const top = (elev.extremes || []).find(e => e.which === 'top');
  const bot = (elev.extremes || []).find(e => e.which === 'bottom');
  out.push({ id: 'highest', g: 'elevation', grp: 'Wysokość – góra i dół', lab: 'Najwyżej n.p.m.',
    val: top ? String(top.elevation_meters).replace('.', ',') + ' m' : '962,6 m',
    city: top ? top.city : 'Kościelisko', voiv: top ? top.voivodeship : 'małopolskie',
    street: top ? top.street : 'Nędzy Kubińca 101',
    lat: (top && top.latitude != null) ? top.latitude : 49.3,
    lon: (top && top.longitude != null) ? top.longitude : 19.9,
    zoom: 12, type: 'point',
    desc: 'Najwyżej położona Żabka w sieci.' });
  out.push({ id: 'lowest', g: 'elevation', grp: 'Wysokość – góra i dół', lab: 'Poniżej morza',
    val: bot ? String(bot.elevation_meters).replace('.', ',') + ' m' : '−1,5 m',
    city: bot ? bot.city : 'Gdańsk (port)', voiv: bot ? bot.voivodeship : 'pomorskie',
    street: bot ? bot.street : 'Przełom 12',
    lat: (bot && bot.latitude != null) ? bot.latitude : 54.4,
    lon: (bot && bot.longitude != null) ? bot.longitude : 18.66,
    zoom: 12, type: 'point',
    desc: 'Jedyna Żabka poniżej poziomu morza.' });

  // Izolacja
  const ns = M.neighbor_stats || {};
  const loner = ns.loner || {};
  out.push({ id: 'isolated', g: 'isolation', grp: 'Izolacja – samotnik', lab: 'Najdalej od sąsiadki',
    val: loner.nearest_neighbor_distance_meters
      ? (loner.nearest_neighbor_distance_meters / 1000).toFixed(1).replace('.', ',') + ' km'
      : '27,8 km',
    city: loner.city || 'Michałowo', voiv: loner.voivodeship || 'podlaskie',
    street: loner.street || 'ul. Białostocka 33',
    lat: (loner && loner.latitude != null) ? loner.latitude : 53.033086,
    lon: (loner && loner.longitude != null) ? loner.longitude : 23.606322,
    zoom: 10, type: 'point',
    desc: 'Najbardziej samotna Żabka w sieci.' });

  // Najstarsza aktywna Zabka (historia sieci)
  const no = M.network_origin || {};
  const oldestStore = no.oldest || {};
  if (oldestStore.lat != null && oldestStore.lon != null) {
    const yr = oldestStore.first_opening_date ? oldestStore.first_opening_date.slice(0, 4) : '1998';
    const age = new Date().getFullYear() - parseInt(yr, 10);
    out.push({ id: 'oldest', g: 'history', grp: 'Historia sieci', lab: 'Najstarsza wciaz czynna',
      val: yr,
      city: oldestStore.city || 'Swarzedz', voiv: oldestStore.voivodeship || 'wielkopolskie',
      street: oldestStore.street || 'Rynek 4/5',
      lat: oldestStore.lat, lon: oldestStore.lon,
      zoom: 14, type: 'point',
      desc: 'Najstarsza wciaz dzialajaca Zabka w sieci. Otwarta w ' + yr + ', w sieci od ' + age + ' lat.' });
  }

  // Pustka
  out.push({ id: 'void', g: 'void', grp: 'Pustka – biała plama', lab: 'Największa pustka',
    val: String(voidVal).replace('.', ',') + ' km',
    city: 'Bieszczady', voiv: 'podkarpackie', street: '49,01°N / 22,89°E',
    lat: (s3.void && s3.void.lat != null) ? s3.void.lat : 49.01,
    lon: (s3.void && s3.void.lon != null) ? s3.void.lon : 22.89,
    zoom: 9, type: 'circle',
    desc: 'Punkt w Bieszczadach oddalony o ' + String(voidVal).replace('.', ',') + ' km od jakiejkolwiek Żabki – największa biała plama na mapie.' });

  // Plazy
  const mf = ae.most_froggy || {};
  out.push({ id: 'frog', g: 'frog', grp: 'Żabka a żabki', lab: 'Korona kolekcji',
    val: 'Żabia Wola', city: 'Żabia Wola', voiv: 'mazowieckie',
    street: 'ul. Zielonej Żabki 7', lat: 52.031662, lon: 20.689194, zoom: 13, type: 'point',
    desc: 'Żabka przy ulicy Zielonej Żabki.' });
  if (mf && mf.latitude) {
    out.push({ id: 'frogrecord', g: 'frogrecord', grp: 'Żabka a żabki', lab: 'Rekord płazów',
      val: fmt(mf.amphibian_occurrences_5km || 0) + ' obs.',
      city: mf.city || '', voiv: mf.voivodeship || '',
      street: mf.street || '',
      lat: mf.latitude, lon: mf.longitude, zoom: 11, type: 'point',
      desc: 'Najwięcej obserwacji płazów w promieniu 5 km ze wszystkich sklepów sieci.' });
  }
  const ff = ae.farthest_from_frog || {};
  if (ff && ff.latitude) {
    out.push({ id: 'farfrog', g: 'farfrog', grp: 'Żabka a żabki', lab: 'Najdalej od żaby',
      val: ff.nearest_amphibian_km != null
        ? ff.nearest_amphibian_km.toFixed(2).replace('.', ',') + ' km' : '–',
      city: ff.city || '', voiv: ff.voivodeship || '', street: '',
      lat: ff.latitude, lon: ff.longitude, zoom: 10, type: 'point',
      desc: 'Żabka najbardziej oddalona od najbliższej obserwacji płaza.' });
  }
  // 668 Żabek bez żadnej żaby w promieniu 5 km - pokazane jako skupisko punktow
  if (ae.zero_frog_count != null) {
    const zeroFrogDots = (ae.stores || [])
      .filter(s => s[2] === 0)
      .map(s => [s[0], s[1]]);
    out.push({ id: 'zerofrog', g: 'farfrog', grp: 'Żabka a żabki', lab: 'Bez żadnej żaby w pobliżu',
      val: fmt(ae.zero_frog_count) + ' sklepów',
      city: '', voiv: '', street: '',
      lat: 52.05, lon: 19.3, zoom: 6, type: 'cluster',
      short: 'sklepy bez obserwacji płaza w 5 km',
      desc: 'Tyle sklepów nie ma ani jednej obserwacji płaza w promieniu 5 km (GBIF, Amphibia). ' +
            (ff && ff.nearest_amphibian_km != null
              ? 'Najbardziej odizolowana Żabka: ' + ff.city + ' – ' +
                ff.nearest_amphibian_km.toFixed(2).replace('.', ',') + ' km od najbliższej żaby.'
              : ''),
      dots: zeroFrogDots });
  }

  // 24/7
  const h24pts = s3.h24_points || [];
  out.push({ id: 'h24', g: 'h24', grp: '24/7', lab: 'Sklepy całodobowe',
    val: fmt(h24Count) + (h24Count === 1 ? ' sklep' : ' sklepów'),
    city: '', voiv: '', street: '',
    lat: 52.05, lon: 19.3, zoom: 6, type: 'cluster',
    short: 'Żabki, które nigdy nie śpią',
    desc: 'Żabki, które nigdy nie zamykają. Bardzo rzadkie w sieci – ' + fmt(h24Count) + ' na ' + fmt(total) + '.',
    dots: h24pts });

  // Parki
  out.push({ id: 'parks', g: 'parks', grp: 'Na łonie natury', lab: 'W parkach i rezerwatach',
    val: fmt(parks.count || 0) + ' / ' + fmt(total),
    city: '', voiv: '', street: '',
    lat: 52.05, lon: 19.3, zoom: 6, type: 'cluster',
    short: 'Żabka w parku lub otulinie',
    desc: 'Sklepy w parkach krajobrazowych i otulinach.',
    dots: M.parks_stores || [] });

  // Sklepy tuz obok siebie
  out.push({ id: 'twins', g: 'twins', grp: 'Tuż obok siebie', lab: 'Sklepy tuż obok siebie',
    val: fmt(tw.within_50m != null ? tw.within_50m : 0) + ' w 50 m',
    city: '', voiv: '', street: '',
    lat: 52.05, lon: 19.3, zoom: 6, type: 'cluster',
    short: 'sieć dusi się od zagęszczenia',
    desc: 'Przeciwieństwo samotnika: ' + fmt(tw.within_50m || 0) + ' sklepów ma inną Żabkę w promieniu 50 m.',
    dots: (tw.points_50 || []).map(p => [p.lat, p.lon]),
    dotsMeta: tw.points_50 || [] });

  return out;
}

export function renderKraniec() {
  const root = document.getElementById('kr-root'); if (!root) return;
  if (_krDone) { if (_krMap) setTimeout(() => _krMap.resize && _krMap.resize(), 120); return; }
  _krDone = true;
  _updateKrDataCounts();
  buildMap();
  buildList();
  wirePanels();
}

function buildMap() {
  const node = document.getElementById('kr-map'); if (!node) return;
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

  // Unified hover tooltip: a DOM element anchored to the hovered item. Works
  // for the rail list and the KPI/ep panels regardless of the map library.
  let _tipEl = null;
  function showTip(f, targetEl) {
    if (_tipEl) { _tipEl.remove(); _tipEl = null; }
    const tip = document.createElement('div');
    tip.className = 'kr-tip-cluster';
    tip.style.position = 'fixed';
    tip.style.setProperty('--c', COL[f.g] || '#84c341');
    tip.innerHTML = `<div class="krtc-v">${f.val}</div><div class="krtc-l">${f.lab}</div>`;
    document.body.appendChild(tip);
    const r = targetEl.getBoundingClientRect();
    tip.style.left = (r.left + r.width / 2) + 'px';
    tip.style.top = (r.top - 10) + 'px';
    _tipEl = tip;
  }
  function hideTip() { if (_tipEl) { _tipEl.remove(); _tipEl = null; } }

  const railEl = document.getElementById('kr-rail');
  if (railEl) {
    railEl.addEventListener('mouseover', e => {
      const it = e.target.closest('.item');
      if (!it) return;
      const f = FACTS.find(x => x.id === it.dataset.id);
      if (f) showTip(f, it);
    });
    railEl.addEventListener('mouseout', e => {
      if (!e.target.closest('.item')) return;
      hideTip();
    });
  }
  const panelIds = [
    'edge-kpi-h24-tile', 'edge-kpi-parks-tile', 'edge-kpi-frogrecord-tile',
    'edge-kpi-void-tile', 'edge-kpi-oldest-tile', 'edge-kpi-farthestfrog-tile',
    'ep-highest', 'ep-lowest', 'ep-isolated', 'ep-zerofrog-panel', 'ep-frog-panel',
  ];
  const panelFactMap = {
    'edge-kpi-h24-tile': 'h24', 'edge-kpi-parks-tile': 'parks',
    'edge-kpi-frogrecord-tile': 'frogrecord', 'edge-kpi-void-tile': 'void',
    'edge-kpi-oldest-tile': 'oldest', 'edge-kpi-farthestfrog-tile': 'farfrog',
    'ep-highest': 'highest', 'ep-lowest': 'lowest', 'ep-isolated': 'isolated',
    'ep-zerofrog-panel': 'zerofrog', 'ep-frog-panel': 'frog',
  };
  panelIds.forEach(pid => {
    const el = document.getElementById(pid);
    if (!el) return;
    el.addEventListener('mouseover', () => {
      const f = FACTS.find(x => x.id === panelFactMap[pid]);
      if (f) showTip(f, el);
    });
    el.addEventListener('mouseout', () => hideTip());
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
    if (cap) cap.innerHTML = `<b>${f.city || f.lab}</b> · ${f.val} – ${f.desc}`;
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
    _krMap.flyTo({ center: HOME, zoom: HOME_Z, duration: RM ? 0 : 1400 });
    if (cap) cap.textContent = 'Kliknij zjawisko – mapa doleci i podświetli kropki.';
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
      el.addEventListener('mouseenter', () => { if (activeId !== f.id) popup.setLngLat([f.lon, f.lat]).addTo(_krMap); });
      el.addEventListener('mouseleave', () => { if (activeId !== f.id) popup.remove(); });
      markers[f.id] = { marker, el, mkEl, popup };
    });

    fitPoland(_krMap, 4);
  });

  // keep the map sized when its container reveals / resizes
  new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && _krMap) _krMap.resize(); }), { threshold: 0.1 }).observe(node);
  window.addEventListener('resize', () => { if (_krMap) _krMap.resize(); });
  setTimeout(() => { if (_krMap) _krMap.resize(); }, 300);
  } catch (e) {
    if (e instanceof WebGLUnavailableError) {
      showMapUnavailable(node, { message: 'Atlas krańców niedostępny' });
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
  return `<div class="pop" style="--c:${c}">
    <div class="pk">${f.lab}</div>
    <div class="pv">${f.val}</div>
    ${f.city ? `<div class="pc">${f.city}</div>` : ''}
    ${f.voiv ? `<div class="ps">${capName(f.voiv)}${f.street ? ' · ' + f.street : ''}</div>` : ''}
    <div class="pd">${f.desc}</div>
  </div>`;
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
