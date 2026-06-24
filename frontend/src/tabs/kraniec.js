// Atlas krancow: interaktywna mapa + lista skrajnych zjawisk.
// Hover NIE skacze - dopiero klik. Kazdy wpis moze renderowac kropki
// (np. h24, parki, sciana zachodnia, sklepy tuz obok). Trzymane w M, cap 360
// na wpis zeby nie przeciazac CPU.
import L from 'leaflet';
import { M } from '../state.js';
import { fmt } from '../utils.js';

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

const HOME = [52.05, 19.3], HOME_Z = 6;

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
  if (_krDone) { if (_krMap) setTimeout(() => _krMap.invalidateSize(), 120); return; }
  _krDone = true;
  _updateKrDataCounts();
  buildMap();
  buildList();
  wirePanels();
}

function buildMap() {
  const node = document.getElementById('kr-map'); if (!node || !L) return;
  const map = L.map('kr-map', { zoomControl: false, attributionControl: true, scrollWheelZoom: 'ctrl' })
    .setView(HOME, HOME_Z);
  _krMap = map;
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { attribution: '© OpenStreetMap, © CARTO', subdomains: 'abcd', maxZoom: 16, detectRetina: true })
    .addTo(map);

  // Tlo: brak kropek - pokazujemy je dopiero po wybraniu zjawiska z listy
  const FACTS = buildFacts();

  // Pustka: czerwone kolko (tlo) + marker (do popupu po kliknieciu)
  const voidFact = FACTS.find(f => f.id === 'void');
  const voidRadius = parseFloat(String(voidFact.val).replace(',', '.')) * 1000;
  L.circle([voidFact.lat, voidFact.lon], {
    radius: voidRadius,
    color: '#e8693d', weight: 1.5, dashArray: '5 5',
    fillColor: '#e8693d', fillOpacity: .07, interactive: false
  }).addTo(map);

  // Markery dla facts typu point (jeden punkt) + void (specjalny marker)
  const markers = {};
  FACTS.forEach(f => {
    if (f.type === 'point') {
      const c = COL[f.g];
      const icon = L.divIcon({ className: '',
        html: `<div class="mk ${f.id === 'frog' ? 'big' : ''}" style="--c:${c}"></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8] });
      const m = L.marker([f.lat, f.lon], { icon }).addTo(map);
      m.bindPopup(_popupHtml(f), { maxWidth: 260, closeButton: false });
      m.on('click', () => selectFact(f.id));
      m.on('mouseover', () => { if (activeId !== f.id) m.openPopup(); });
      m.on('mouseout',  () => { if (activeId !== f.id) m.closePopup(); });
      markers[f.id] = m;
    } else if (f.type === 'circle') {
      // Void - marker w srodku okregu, do popupu
      const c = COL[f.g];
      const icon = L.divIcon({ className: '',
        html: `<div class="mk" style="--c:${c}"></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8] });
      const m = L.marker([f.lat, f.lon], { icon }).addTo(map);
      m.bindPopup(_popupHtml(f), { maxWidth: 260, closeButton: false });
      m.on('click', () => selectFact(f.id));
      m.on('mouseover', () => { if (activeId !== f.id) m.openPopup(); });
      m.on('mouseout',  () => { if (activeId !== f.id) m.closePopup(); });
      markers[f.id] = m;
    }
  });

  // Hover helper: otwiera popup markera (markery maja tylko popup, nie tooltip)
  const showTooltip = (id) => {
    const m = markers[id];
    if (m) m.openPopup();
  };
  const hideTooltip = (id) => {
    const m = markers[id];
    if (m) m.closePopup();
  };
  // Dla cluster faktow - Leaflet nie ma markera, tooltip rysujemy recznie
  let clusterTipEl = null;
  function showClusterTip(f) {
    if (!f || f.type === 'point' || f.type === 'circle') return;
    if (clusterTipEl) clusterTipEl.remove();
    const tip = document.createElement('div');
    tip.className = 'kr-tip kr-tip-cluster';
    tip.style.setProperty('--c', COL[f.g] || '#84c341');
    tip.innerHTML = `<div class="krtc-v">${f.val}</div><div class="krtc-l">${f.lab}</div>`;
    document.body.appendChild(tip);
    const p = map.latLngToContainerPoint([f.lat, f.lon]);
    const r = map.getContainer().getBoundingClientRect();
    tip.style.left = (r.left + p.x) + 'px';
    tip.style.top = (r.top + p.y - 14) + 'px';
    clusterTipEl = tip;
  }
  function hideClusterTip() {
    if (clusterTipEl) { clusterTipEl.remove(); clusterTipEl = null; }
  }

  // Hover na liscie (kr-rail .item)
  const railEl = document.getElementById('kr-rail');
  if (railEl) {
    railEl.addEventListener('mouseover', e => {
      const it = e.target.closest('.item');
      if (!it) return;
      const id = it.dataset.id;
      const f = FACTS.find(x => x.id === id);
      if (!f) return;
      if (f.type === 'point' || f.type === 'circle') showTooltip(id);
      else showClusterTip(f);
    });
    railEl.addEventListener('mouseout', e => {
      const it = e.target.closest('.item');
      if (!it) return;
      const id = it.dataset.id;
      const f = FACTS.find(x => x.id === id);
      if (!f) return;
      if (f.type === 'point' || f.type === 'circle') hideTooltip(id);
      else hideClusterTip();
    });
  }

  // Hover na panelach (KPI u gory + ep-* pod mapa)
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
  panelIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('mouseover', () => {
      const factId = panelFactMap[id];
      const f = FACTS.find(x => x.id === factId);
      if (!f) return;
      if (f.type === 'point' || f.type === 'circle') showTooltip(factId);
      else showClusterTip(f);
    });
    el.addEventListener('mouseout', () => {
      const factId = panelFactMap[id];
      const f = FACTS.find(x => x.id === factId);
      if (!f) return;
      if (f.type === 'point' || f.type === 'circle') hideTooltip(factId);
      else hideClusterTip();
    });
  });

  // Warstwy kropek dla zjawisk skupiskowych (h24, parks, twins)
  // Rysowane na canvas overlay z animacja (jak 380/380 w SIEC).
  // Canvas dolaczony do Leaflet overlayPane, zeby wspoldzielic coord system i z-index.
  const canvas = document.getElementById('kr-dots-canvas');
  map.getPanes().overlayPane.appendChild(canvas);
  canvas.classList.add('kr-canvas-pane');
  const ctx = canvas.getContext('2d');
  const dotsByFact = {};
  const FACT_BY_ID = Object.fromEntries(FACTS.map(f => [f.id, f]));

  FACTS.forEach(f => {
    if (f.type === 'cluster' && f.dots && f.dots.length) {
      dotsByFact[f.id] = f.dots.map((latlon, i) => {
        const lat = Array.isArray(latlon) ? latlon[0] : (latlon && latlon.lat);
        const lon = Array.isArray(latlon) ? latlon[1] : (latlon && latlon.lon);
        const baseColor = (f.id === 'twins') ? _twinsColorForDot(i, f.dotsMeta && f.dotsMeta[i]) : COL[f.g];
        return { lat, lon, color: baseColor, progress: 0, target: 0 };
      });
    }
  });

  let activeDotsFact = null;
  let dotsAnim = null;

  // Rozmiar canvasa (dopasowany do kontenera + obsluga resize)
  function resizeCanvas() {
    const r = map.getContainer().getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(r.width * dpr);
    canvas.height = Math.floor(r.height * dpr);
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();

  // Hover - pozycja kursora do podswietlenia okolicznych kropek
  const hover = { x: -9999, y: -9999, on: false };

  function latlngToPx(latlng) {
    return map.latLngToContainerPoint(latlng);
  }

  function drawDots(now) {
    const r = map.getContainer().getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    const fact = activeDotsFact ? dotsByFact[activeDotsFact] : null;
    if (!fact) return;
    const EFFECT_R = 46, BASE_R = 1.6, MAX_R = 3.0;
    fact.forEach(d => {
      if (d.progress <= 0.001) return;
      const p = map.latLngToLayerPoint([d.lat, d.lon]);
      const x = p.x, y = p.y;
      if (x < -20 || y < -20 || x > r.width + 20 || y > r.height + 20) return;
      const dist = hover.on ? Math.hypot(x - hover.x, y - hover.y) : 999;
      const t = dist < EFFECT_R ? 1 - dist / EFFECT_R : 0;
      const breathe = t > 0 ? 0.2 * Math.sin(now / 280 + dist / 18) : 0;
      const jx = t > 0 ? 0.5 * Math.sin(now / 370 + dist / 22) : 0;
      const jy = t > 0 ? 0.5 * Math.cos(now / 340 + dist / 28) : 0;
      const radius = Math.max(0, BASE_R * d.progress + t * (MAX_R - BASE_R) * d.progress + breathe);
      // alpha z progress + delikatna poświata
      const alpha = d.progress * (0.55 + 0.3 * t);
      ctx.beginPath();
      ctx.arc(x + jx, y + jy, radius, 0, Math.PI * 2);
      ctx.fillStyle = hexWithAlpha(d.color, alpha);
      ctx.shadowColor = hexWithAlpha(d.color, 0.5 + 0.3 * t);
      ctx.shadowBlur = 3 + t * 7;
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  function animLoop(now) {
    let moving = false;
    const fact = activeDotsFact ? dotsByFact[activeDotsFact] : null;
    if (fact) {
      for (let i = 0; i < fact.length; i++) {
        const d = fact[i];
        const delta = d.target - d.progress;
        if (Math.abs(delta) > 0.003) {
          d.progress += delta * 0.12;
          moving = true;
        } else {
          d.progress = d.target;
        }
      }
    }
    // Jesli poprzednia grupa sie pojawila, tez ja animuj (od target=1 do target=0)
    Object.entries(dotsByFact).forEach(([id, arr]) => {
      if (id !== activeDotsFact) {
        for (let i = 0; i < arr.length; i++) {
          const d = arr[i];
          const delta = d.target - d.progress;
          if (Math.abs(delta) > 0.003) {
            d.progress += delta * 0.12;
            moving = true;
          } else {
            d.progress = d.target;
          }
        }
      }
    });
    drawDots(now);
    if (moving || hover.on) {
      dotsAnim = requestAnimationFrame(animLoop);
    } else {
      dotsAnim = null;
    }
  }

  function startAnim() {
    if (!dotsAnim) dotsAnim = requestAnimationFrame(animLoop);
  }

  function setActiveDots(factId) {
    // Ustaw targety - poprzednia grupa na 0, nowa na 1
    Object.keys(dotsByFact).forEach(id => {
      const target = (id === factId) ? 1 : 0;
      dotsByFact[id].forEach(d => { d.target = target; });
    });
    if (factId && dotsByFact[factId]) {
      canvas.classList.add('active');
    } else {
      canvas.classList.remove('active');
      hover.on = false;
    }
    startAnim();
  }

  // Hover na canvasie
  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    hover.x = e.clientX - r.left;
    hover.y = e.clientY - r.top;
    hover.on = true;
    startAnim();
  });
  canvas.addEventListener('mouseleave', () => {
    hover.on = false;
    startAnim();
  });

  // Invalidate przy zmianie rozmiaru / zoom / pan
  map.on('move zoom moveend zoomend resize', () => { if (activeDotsFact) startAnim(); });
  window.addEventListener('resize', () => { resizeCanvas(); startAnim(); });

  const cap = document.getElementById('kr-cap');
  let activeId = null;
  const setActiveMarker = id => Object.entries(markers).forEach(([k, m]) => {
    const el = m.getElement(); if (el) {
      const d = el.querySelector('.mk');
      if (d) d.classList.toggle('active', k === id);
    }
  });

  const showDots = (factId) => {
    activeDotsFact = factId || null;
    setActiveDots(activeDotsFact);
  };
  const flyToFact = (f, withPopup) => {
    if (!f) return;
    // Zamknij poprzedni popup, jesli zmieniamy zjawisko
    map.closePopup();
    // Dla zjawisk skupiskowych: najpierw pokaz kropki, potem dopasuj mape do nich
    if (f.type === 'cluster' && f.dots && f.dots.length) {
      showDots(f.id);
      try {
        const bnd = L.latLngBounds(f.dots);
        map.flyToBounds(bnd, { padding: [28, 28], duration: RM ? 0 : 1.6, easeLinearity: .22, maxZoom: 12 });
      } catch (e) {
        map.flyTo([f.lat, f.lon], f.zoom, { duration: RM ? 0 : 1.6, easeLinearity: .22 });
      }
    } else {
      map.flyTo([f.lat, f.lon], f.zoom, { duration: RM ? 0 : 1.6, easeLinearity: .22 });
    }
    setActiveMarker(f.id);
    document.querySelectorAll('#kr-rail .item').forEach(it => it.classList.toggle('active', it.dataset.id === f.id));
    if (f.type !== 'cluster') showDots(null);
    if (cap) cap.innerHTML = `<b>${f.city || f.lab}</b> · ${f.val} – ${f.desc}`;
    if (withPopup && (f.type === 'point' || f.type === 'circle') && markers[f.id]) {
      setTimeout(() => markers[f.id].openPopup(), RM ? 0 : 650);
    }
  };
  const select = (id) => {
    const f = FACTS.find(x => x.id === id);
    if (!f) return;
    activeId = id;
    flyToFact(f, true);
  };
  _select = select;
  _highlight = (id) => {
    const f = FACTS.find(x => x.id === id);
    if (!f) return;
    setActiveMarker(f.id);
    showDots(f.type === 'cluster' ? f.id : null);
  };

  const resetBtn = document.getElementById('kr-reset');
  if (resetBtn) resetBtn.onclick = () => {
    activeId = null;
    setActiveMarker(null);
    map.closePopup();
    showDots(null);
    document.querySelectorAll('#kr-rail .item').forEach(it => it.classList.remove('active'));
    document.querySelectorAll('.kr-fact-tile').forEach(it => it.classList.remove('active'));
    map.flyTo(HOME, HOME_Z, { duration: RM ? 0 : 1.4, easeLinearity: .22 });
    if (cap) cap.textContent = 'Kliknij zjawisko – mapa doleci i podświetli kropki.';
  };

  setTimeout(() => { map.invalidateSize(); resizeCanvas(); startAnim(); }, 300);
  new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { map.invalidateSize(); resizeCanvas(); } }), { threshold: .1 }).observe(node);
  window.addEventListener('resize', () => { map.invalidateSize(); resizeCanvas(); startAnim(); });
}

// 3 odcienie zieleni dla twins, w proporcjach odpowiadajacych progom
function _twinsColorForDot(i, meta) {
  if (!meta) return '#a6e84a';
  const b = meta.bucket;
  if (b === 'a') return '#5e9a2a';   // <50 m, ciemna zielen
  if (b === 'b') return '#84c341';   // 50-100 m, bazowa
  return '#a6e84a';                  // 100-200 m, jasna
}

function hexWithAlpha(hex, a) {
  if (!hex || hex[0] !== '#' || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function _tooltipHtml(f) {
  const c = COL[f.g];
  return `<div class="kr-tip-inner" style="--c:${c}">
    <div class="krt-v">${f.val}</div>
    <div class="krt-l">${f.lab}</div>
    ${f.city ? `<div class="krt-c">${f.city}</div>` : ''}
  </div>`;
}

function _popupHtml(f) {
  const c = COL[f.g];
  return `<div class="pop" style="--c:${c}">
    <div class="pk">${f.lab}</div>
    <div class="pv">${f.val}</div>
    ${f.city ? `<div class="pc">${f.city}</div>` : ''}
    ${f.voiv ? `<div class="ps">${f.voiv}${f.street ? ' · ' + f.street : ''}</div>` : ''}
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
            ? f.city + (f.voiv ? ' · ' + f.voiv : '')
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
