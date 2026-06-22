// "Wartości brzegowe": Atlas krańców - interaktywna mapa Leaflet z panelem
// wyboru i trybem tournee + cztery wykresy ECharts (wysokość, k-NN, parki,
// adresy obywatelskie). Dane krańców osadzone (kuratorowane, 9 faktów).
// Leaflet z app (npm), ECharts bundlowane przez Vite. Wszystko zakresowane do .kr.
import { init as echartsInit, use as echartsUse, graphic } from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
echartsUse([BarChart, PieChart, GridComponent, TooltipComponent, CanvasRenderer]);
import L from 'leaflet';
import { M } from '../state.js';
import { fmt } from '../utils.js';

const RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;

const COL = { compass: '#84c341', elevation: '#f2a359', isolation: '#4dd0b1', void: '#e8693d', frog: '#a6e84a' };
const FACTS = [
  { id: 'north', g: 'compass', grp: 'Kompas - cztery kierunki', lab: 'Najdalej na północ', val: '54,83°N', city: 'Jastrzębia Góra', voiv: 'pomorskie', street: 'ul. Słowackiego 1A', lat: 54.833467, lon: 18.300591, zoom: 11, desc: 'Najbardziej wysunięta na północ Żabka w kraju - tuż przy nadbałtyckim klifie.' },
  { id: 'south', g: 'compass', grp: 'Kompas - cztery kierunki', lab: 'Najdalej na południe', val: '49,21°N', city: 'Cisna', voiv: 'podkarpackie', street: 'ul. Cisna 95', lat: 49.213484, lon: 22.328102, zoom: 11, desc: 'Kraniec południa: Cisna w Bieszczadach, brama w góry.' },
  { id: 'east', g: 'compass', grp: 'Kompas - cztery kierunki', lab: 'Najdalej na wschód', val: '23,90°E', city: 'Hrubieszów', voiv: 'lubelskie', street: 'ul. Kolejowa 6B', lat: 50.799815, lon: 23.904273, zoom: 11, desc: 'Najbardziej na wschód - Hrubieszów, niemal przy granicy z Ukrainą.' },
  { id: 'west', g: 'compass', grp: 'Kompas - cztery kierunki', lab: 'Najdalej na zachód', val: '14,20°E', city: 'Cedynia', voiv: 'zachodniopomorskie', street: 'ul. Mieszka I 6', lat: 52.879565, lon: 14.204963, zoom: 11, desc: 'Skrajny zachód: Cedynia nad Odrą, kilka kilometrów od Niemiec.' },
  { id: 'highest', g: 'elevation', grp: 'Wysokość - góra i dół', lab: 'Najwyżej n.p.m.', val: '962,6 m', city: 'Kościelisko', voiv: 'małopolskie', street: 'Nędzy Kubińca 101', lat: 49.3, lon: 19.9, zoom: 12, desc: 'Najwyżej położona Żabka - 962,6 m n.p.m. pod Tatrami.' },
  { id: 'lowest', g: 'elevation', grp: 'Wysokość - góra i dół', lab: 'Jedyna poniżej morza', val: '−1,5 m', city: 'Gdańsk (port)', voiv: 'pomorskie', street: 'Przełom 12', lat: 54.4, lon: 18.66, zoom: 12, desc: 'Jedyna Żabka poniżej poziomu morza: −1,5 m w gdańskim porcie.' },
  { id: 'isolated', g: 'isolation', grp: 'Izolacja - samotnik', lab: 'Najbardziej samotna', val: '27,8 km', city: 'Michałowo', voiv: 'podlaskie', street: 'ul. Białostocka 33', lat: 53.033086, lon: 23.606322, zoom: 10, desc: 'Najbardziej samotny sklep - 27,8 km dzieli go od najbliższej innej Żabki.' },
  { id: 'void', g: 'void', grp: 'Pustka - biała plama', lab: 'Największa pustka', val: '46,5 km', city: 'Bieszczady', voiv: 'podkarpackie', street: '49,01°N / 22,89°E', lat: 49.01, lon: 22.89, zoom: 9, desc: 'Punkt w Bieszczadach oddalony o 46,5 km od jakiejkolwiek Żabki - największa biała plama na mapie.' },
  { id: 'frog', g: 'frog', grp: 'Żabka na Żabiej', lab: 'Korona kolekcji', val: 'Żabia Wola', city: 'Żabia Wola', voiv: 'mazowieckie', street: 'ul. Zielonej Żabki 7', lat: 52.031662, lon: 20.689194, zoom: 13, desc: 'Żabka przy ulicy Zielonej Żabki. Marketingowy zbieg okoliczności idealny.' }
];
const FROG_DOTS = [[54.343816, 18.648804], [52.33865, 16.834308], [50.083331, 19.942971], [52.3476, 16.880587], [50.934701, 21.379812], [52.139366, 21.057362], [53.184492, 14.840288], [52.196604, 21.1269], [52.253856, 20.992802]];
const H24_DOTS = [[51.1082, 17.0379], [51.109, 17.0301], [52.326, 14.6519], [52.3231, 14.654], [52.3144, 15.7825], [52.2975, 21.0128], [52.6795, 15.2158], [50.2632, 18.8604], [54.5721, 18.4183], [49.8229, 19.0697], [53.9107, 14.2496], [51.7432, 19.457], [54.1258, 22.9404], [49.9339, 19.9516], [51.4076, 21.9301]];
const HOME = [52.05, 19.3], HOME_Z = 6;

const axisC = '#93a487', mono = 'JetBrains Mono', split = 'rgba(140,200,80,.06)';

let _krDone = false, _krMap = null;

function _setDC(id, v) {
  const el = document.getElementById(id); if (!el) return;
  el.dataset.count = v; el.textContent = '0';
}
function _setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function _setHTML(id, h) { const el = document.getElementById(id); if (el) el.innerHTML = h; }

function _updateKrDataCounts() {
  const s = M.summary || {};
  const s3 = M.section3_rare || {};
  const parks = s3.parks || {};

  // KPI strip
  if (s.total_active) _setDC('kr-kpi-stores', s.total_active);
  if (s3.powiats_covered) _setDC('kr-kpi-powiats', s3.powiats_covered);
  if (s.h24_count) _setDC('kr-kpi-h24', s.h24_count);
  if (parks.count) _setDC('kr-kpi-parks', parks.count);
  if (s3.frog_streets_count) _setDC('kr-kpi-frogstreets', s3.frog_streets_count);

  // Parks KPI label
  if (parks.count && s.total_active) {
    const pct = ((parks.count / s.total_active) * 100).toFixed(1).replace('.', ',');
    _setText('kr-kpi-parks-label', `w parkach krajobrazowych · ${pct}%`);
  }

  // Hero number (void distance)
  const vd = s3.void;
  if (vd && vd.value) {
    const el = document.getElementById('hero-num-edge');
    if (el) el.textContent = String(vd.value).replace('.', ',');
  }

  // E2 parks count
  if (parks.count) _setText('kr-e2-parks-count', fmt(parks.count));

  // E3 void distance
  if (vd && vd.value) _setText('kr-e3-void', String(vd.value).replace('.', ',') + ' km');

  // Sidecards
  if (s.h24_count) _setDC('kr-sc-h24', s.h24_count);
  const pr = (s3.powiat_range || []);
  const maxRow = pr.find(r => r.which === 'max');
  const minRow = pr.find(r => r.which === 'min');
  if (maxRow) {
    _setDC('kr-sc-maxpowiat', maxRow.cnt);
    _setHTML('kr-sc-powiat-label',
      `rozpiętość pokrycia powiatów: od <b style="color:#eef3e6">${minRow ? minRow.cnt : 1}</b> ` +
      `(${minRow ? minRow.powiat : '?'}) do <b style="color:#eef3e6">${maxRow.cnt}</b> (${maxRow.powiat}).`);
  }

  // F1 frog streets
  if (s3.frog_streets_count) {
    _setText('kr-f1-oneliner', `${s3.frog_streets_count} sklepów na ulicach o wodnych i płazich nazwach.`);
    _setHTML('kr-frogstreets-blurb',
      `Żabia Wola, mazowieckie. Sklep <b>Żabka</b> przy ulicy <b>Zielonej Żabki</b> — marketingowy zbieg okoliczności idealny. ` +
      `To jeden z ${s3.frog_streets_count} sklepów stojących na ulicach ze słowem „żaba" lub bliskoznacznych w nazwie.`);
  }

  // G1 powiats text
  if (s3.powiats_covered) {
    _setText('kr-g1-text', `${fmt(s3.powiats_covered)} powiatów. Żaden bez Żabki.`);
    if (maxRow && minRow) {
      _setText('kr-g1-caveat',
        `Od ${minRow.cnt} sklepu (${minRow.powiat}) do ${fmt(maxRow.cnt)} (${maxRow.powiat})`);
    }
  }

  // Neighbor stats statline
  const ns = M.neighbor_stats && M.neighbor_stats.distribution;
  if (ns) {
    const med = ns.median_m ? Math.round(ns.median_m) + ' m' : '—';
    const avg = ns.avg_m ? Math.round(ns.avg_m) + ' m' : '—';
    const loner = M.neighbor_stats.loner || {};
    const maxKm = loner.nearest_neighbor_distance_meters
      ? (loner.nearest_neighbor_distance_meters / 1000).toFixed(1).replace('.', ',') + ' km'
      : (ns.max_m ? (ns.max_m / 1000).toFixed(1).replace('.', ',') + ' km' : '—');
    _setText('kr-stat-median', med);
    _setText('kr-stat-avg', avg);
    _setText('kr-stat-max', maxKm);
  }

  // Parks cnote + statline
  if (parks.count && s.total_active) {
    const pct = ((parks.count / s.total_active) * 100).toFixed(1).replace('.', ',');
    _setText('kr-parks-cnote', `${fmt(parks.count)} sklepów (${pct}%) stoi w parkach lub ich otulinach.`);
  }
  if (parks.top3 && parks.top3.length) {
    _setHTML('kr-parks-statline', parks.top3.map(p => `<span>${p.park_name}: <b>${p.cnt}</b></span>`).join(''));
  }

  // Elevation histogram caption (n = total stores with elevation data)
  const elev = M.elevation || {};
  const elevHist = elev.histogram || [];
  const elevN = elevHist.reduce((acc, b) => acc + (b.cnt || 0), 0);
  if (elevN > 0) {
    const capEl = document.getElementById('kr-elev-cap-n');
    if (capEl) capEl.textContent = elevN.toLocaleString('pl-PL');
  }
  if (elev.extremes && elev.extremes.length >= 2) {
    const top = elev.extremes.find(e => e.which === 'top');
    const bot = elev.extremes.find(e => e.which === 'bottom');
    const cnoteEl = document.getElementById('kr-elev-cnote');
    if (cnoteEl && top && bot) {
      const hiStr = top.city + ' ' + (Math.round(top.elevation_meters * 10) / 10).toFixed(1).replace('.', ',') + ' m';
      const loStr = bot.city + ' ' + bot.elevation_meters + ' m';
      const pcts = elev.percentiles;
      const rangeStr = (pcts && pcts.p5 != null && pcts.p95 != null)
        ? `między ${pcts.p5} a ${pcts.p95} m`
        : 'między 17 a 332 m';
      cnoteEl.innerHTML = `95% sieci mieści się ${rangeStr}. Rekordy: <b style="color:#f2a359">${hiStr}</b> i <b style="color:#e8693d">${loStr} (jedyna poniżej morza)</b>.`;
    }
  }

  // Siec hero eyebrow - snapshot date from network_origin
  const no = M.network_origin;
  if (no && no.snapshot_date) {
    _setText('hero-eyebrow-siec', `Atlas Żabki · migawka ${no.snapshot_date}`);
  } else if (M.network_growth && M.network_growth.length) {
    _setText('hero-eyebrow-siec', `Atlas Żabki · dane ${M.network_growth[M.network_growth.length - 1].year}`);
  }
}

export function renderKraniec() {
  const root = document.getElementById('kr-root'); if (!root) return;
  if (_krDone) { if (_krMap) setTimeout(() => _krMap.invalidateSize(), 120); return; }
  _krDone = true;

  // ---- update data-count attrs from API before count-up observer fires ----
  _updateKrDataCounts();

  // ---- reveal + count-up, scoped to .kr ----
  const ro = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); } }), { threshold: .14 });
  root.querySelectorAll('.kr-reveal').forEach(r => ro.observe(r));
  const countUp = el => {
    const t = parseFloat(el.dataset.count), dec = parseInt(el.dataset.dec || '0');
    const f = v => v.toLocaleString('pl-PL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (RM) { el.textContent = f(t); return; }
    const dur = 1300, t0 = performance.now();
    (function s(n) { let p = Math.min(1, (n - t0) / dur); p = 1 - Math.pow(1 - p, 3); el.textContent = f(t * p); if (p < 1) requestAnimationFrame(s); })(t0);
  };
  const co = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { countUp(e.target); co.unobserve(e.target); } }), { threshold: .6 });
  root.querySelectorAll('[data-count]').forEach(el => co.observe(el));

  buildMap();
  buildCharts();
}

function buildMap() {
  const node = document.getElementById('kr-map'); if (!node || !L) return;
  const map = L.map('kr-map', { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView(HOME, HOME_Z);
  _krMap = map;
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap, © CARTO', subdomains: 'abcd', maxZoom: 16, detectRetina: true }).addTo(map);
  map.on('focus', () => map.scrollWheelZoom.enable());
  map.on('blur', () => map.scrollWheelZoom.disable());

  FROG_DOTS.forEach(c => L.circleMarker(c, { radius: 3, color: '#a6e84a', weight: 0, fillColor: '#a6e84a', fillOpacity: .35, interactive: false }).addTo(map));
  H24_DOTS.forEach(c => L.circleMarker(c, { radius: 3, color: '#f2a359', weight: 0, fillColor: '#f2a359', fillOpacity: .28, interactive: false }).addTo(map));
  const voidFact = FACTS.find(f => f.id === 'void');
  L.circle([voidFact.lat, voidFact.lon], { radius: 46520, color: '#e8693d', weight: 1.5, dashArray: '5 5', fillColor: '#e8693d', fillOpacity: .07, interactive: false }).addTo(map);

  const markers = {};
  FACTS.forEach(f => {
    const c = COL[f.g];
    const icon = L.divIcon({ className: '', html: `<div class="mk ${f.id === 'frog' ? 'big' : ''}" style="--c:${c}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
    const m = L.marker([f.lat, f.lon], { icon }).addTo(map);
    m.bindTooltip(`<div style="font-size:12px"><b style="color:${c}">${f.val}</b><br>${f.city} · ${f.voiv}</div>`, { direction: 'top', offset: [0, -10], opacity: 0.95 });
    m.bindPopup(`<div class="pop" style="--c:${c}"><div class="pk">${f.lab}</div><div class="pv">${f.val}</div><div class="pc">${f.city}</div><div class="ps">${f.voiv} · ${f.street}</div><div class="pd">${f.desc}</div></div>`, { maxWidth: 260, closeButton: false });
    m.on('click', () => select(f.id, true));
    markers[f.id] = m;
  });

  // Frog KPI markers (dynamic, from M.amphibian_extremes)
  const ae = M.amphibian_extremes || {};
  if (ae.most_froggy && ae.most_froggy.latitude) {
    const mf = ae.most_froggy;
    const icon = L.divIcon({ className: '', html: `<div class="mk" style="--c:#4dd0b1"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
    L.marker([mf.latitude, mf.longitude], { icon }).addTo(map)
      .bindTooltip(`<div style="font-size:12px"><b style="color:#4dd0b1">${fmt(mf.amphibian_occurrences_5km || 0)} obs. płazów</b><br>${mf.city || ''}</div>`, { direction: 'top', offset: [0, -10], opacity: 0.95 })
      .bindPopup(`<div class="pop" style="--c:#4dd0b1"><div class="pk">Najbardziej żabia Żabka</div><div class="pv">${fmt(mf.amphibian_occurrences_5km || 0)} obs.</div><div class="pc">${mf.city || ''}</div><div class="ps">${(mf.voivodeship || '')} · ${mf.street || ''}</div></div>`, { maxWidth: 260, closeButton: false });
  }
  if (ae.farthest_from_frog && ae.farthest_from_frog.latitude) {
    const ff = ae.farthest_from_frog;
    const icon = L.divIcon({ className: '', html: `<div class="mk" style="--c:#e8693d"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
    L.marker([ff.latitude, ff.longitude], { icon }).addTo(map)
      .bindTooltip(`<div style="font-size:12px"><b style="color:#e8693d">${ff.nearest_amphibian_km ? ff.nearest_amphibian_km.toFixed(2) : '—'} km od płaza</b><br>${ff.city || ''}</div>`, { direction: 'top', offset: [0, -10], opacity: 0.95 })
      .bindPopup(`<div class="pop" style="--c:#e8693d"><div class="pk">Najdalej od płaza</div><div class="pv">${ff.nearest_amphibian_km ? ff.nearest_amphibian_km.toFixed(2) + ' km' : '—'}</div><div class="pc">${ff.city || ''}</div><div class="ps">${(ff.voivodeship || '')}</div></div>`, { maxWidth: 260, closeButton: false });
  }

  let activeId = null;
  const cap = document.getElementById('kr-cap');
  const setActiveMarker = id => Object.entries(markers).forEach(([k, m]) => { const el = m.getElement(); if (el) { const d = el.querySelector('.mk'); if (d) d.classList.toggle('active', k === id); } });
  const flyToFact = (f, open) => {
    map.flyTo([f.lat, f.lon], f.zoom, { duration: RM ? 0 : 1.6, easeLinearity: .22 });
    setActiveMarker(f.id);
    document.querySelectorAll('#kr-rail .item').forEach(it => it.classList.toggle('active', it.dataset.id === f.id));
    if (cap) cap.innerHTML = `<b>${f.city}</b> · ${f.val} - ${f.desc}`;
    if (open) { const m = markers[f.id]; setTimeout(() => m.openPopup(), RM ? 0 : 650); }
  };
  const select = (id, open) => { activeId = id; flyToFact(FACTS.find(f => f.id === id), open); };

  const resetBtn = document.getElementById('kr-reset');
  if (resetBtn) resetBtn.onclick = () => {
    activeId = null; setActiveMarker(null); map.closePopup();
    document.querySelectorAll('#kr-rail .item').forEach(it => it.classList.remove('active'));
    map.flyTo(HOME, HOME_Z, { duration: RM ? 0 : 1.4, easeLinearity: .22 });
    if (cap) cap.textContent = 'Wskazówka: kliknij punkt z panelu obok - mapa doleci tam płynnie i pokaże szczegóły.';
  };

  // selection rail
  const rail = document.getElementById('kr-rail');
  let lastGrp = null;
  FACTS.forEach(f => {
    const c = COL[f.g];
    if (f.grp !== lastGrp) { const h = document.createElement('div'); h.className = 'grp-h'; h.style.setProperty('--c', c); h.innerHTML = `<span class="dot"></span>${f.grp}`; rail.appendChild(h); lastGrp = f.grp; }
    const it = document.createElement('div'); it.className = 'item'; it.dataset.id = f.id; it.style.setProperty('--c', c);
    it.innerHTML = `<div class="v">${f.val}</div><div class="meta"><div class="lab">${f.lab}</div><div class="sub">${f.city} · ${f.voiv}</div></div>`;
    it.onmouseenter = () => { if (activeId !== f.id) { map.flyTo([f.lat, f.lon], Math.max(f.zoom - 1, 7), { duration: RM ? 0 : 1.2, easeLinearity: .25 }); setActiveMarker(f.id); if (cap) cap.innerHTML = `<b>${f.city}</b> · ${f.val} - ${f.desc}`; } };
    it.onclick = () => select(f.id, true);
    rail.appendChild(it);
  });

  // tournee removed

  setTimeout(() => map.invalidateSize(), 300);
  new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) map.invalidateSize(); }), { threshold: .1 }).observe(node);
  window.addEventListener('resize', () => map.invalidateSize());
}

function lazyChart(id, fn) {
  const node = document.getElementById(id); if (!node) return;
  new IntersectionObserver((es, o) => es.forEach(e => { if (e.isIntersecting) { fn(); o.unobserve(e.target); } }), { threshold: .3 }).observe(node);
}

function buildCharts() {
  lazyChart('kr-c-elev', () => {
    const ch = echartsInit(document.getElementById('kr-elevChart'));
    // Use API data; fall back to spec values if elevation not yet enriched
    const histRaw = (M.elevation && M.elevation.histogram) || [];
    const hasDat = histRaw.length > 0;
    const cats = hasDat
      ? histRaw.map(b => b.bucket_m + '–' + (b.bucket_m + 50) + ' m')
      : ['17–67', '67–117', '117–167', '167–217', '217–267', '267–332', '>332'];
    const vals = hasDat
      ? histRaw.map(b => b.cnt)
      : [3200, 2150, 1890, 1620, 1340, 980, 323];
    ch.setOption({
      backgroundColor: 'transparent', animationDuration: RM ? 0 : 900, animationDelay: RM ? 0 : (i => i * 70),
      grid: { left: 46, right: 14, top: 14, bottom: 44 },
      tooltip: { backgroundColor: '#0c160b', borderColor: 'rgba(140,200,80,.3)', textStyle: { color: '#eef3e6' }, formatter: p => p[0].name + '<br><b>' + p[0].value.toLocaleString('pl-PL') + '</b> sklepów' },
      xAxis: { type: 'category', data: cats, axisLabel: { color: axisC, fontFamily: mono, fontSize: 9, interval: 0, rotate: 30 }, axisLine: { lineStyle: { color: 'rgba(140,200,80,.2)' } }, name: 'm n.p.m.', nameLocation: 'middle', nameGap: 34, nameTextStyle: { color: '#5d6c52', fontFamily: mono, fontSize: 10 } },
      yAxis: { type: 'value', axisLabel: { color: axisC, fontFamily: mono, fontSize: 10 }, splitLine: { lineStyle: { color: split } } },
      series: [{ type: 'bar', data: vals, barWidth: '62%', itemStyle: { borderRadius: [4, 4, 0, 0], color: new graphic.LinearGradient(0, 1, 0, 0, [{ offset: 0, color: '#4dd0b1' }, { offset: 1, color: '#f2a359' }]) } }]
    });
    window.addEventListener('resize', () => ch.resize());
  });

  lazyChart('kr-c-knn', () => {
    const ch = echartsInit(document.getElementById('kr-knnChart'));
    const bucketsRaw = (M.neighbor_stats && M.neighbor_stats.distribution && M.neighbor_stats.distribution.buckets) || [];
    const hasDat = bucketsRaw.length > 0;
    const cats = hasDat ? bucketsRaw.map(b => b.bucket) : ['<200 m', '200–500 m', '500 m–1 km', '1–3 km', '3–10 km', '>10 km'];
    const vals = hasDat ? bucketsRaw.map(b => b.cnt) : [3865, 5434, 1746, 1142, 782, 185];
    const cols = ['#84c341', '#a6e84a', '#a6e84a', '#f2a359', '#e8693d', '#e8693d'];
    ch.setOption({
      backgroundColor: 'transparent', animationDuration: RM ? 0 : 1000, animationDelay: RM ? 0 : (i => i * 90),
      grid: { left: 92, right: 40, top: 8, bottom: 24 },
      tooltip: { backgroundColor: '#0c160b', borderColor: 'rgba(140,200,80,.3)', textStyle: { color: '#eef3e6' }, formatter: p => p.name + '<br><b>' + p.value.toLocaleString('pl-PL') + '</b> sklepów' },
      xAxis: { type: 'value', axisLabel: { color: axisC, fontFamily: mono, fontSize: 10 }, splitLine: { lineStyle: { color: split } } },
      yAxis: { type: 'category', data: cats, inverse: true, axisLabel: { color: '#eef3e6', fontFamily: 'IBM Plex Sans', fontSize: 12 }, axisLine: { lineStyle: { color: 'rgba(140,200,80,.2)' } }, axisTick: { show: false } },
      series: [{ type: 'bar', barWidth: '56%', data: vals.map((v, i) => ({ value: v, itemStyle: { color: cols[i % cols.length], borderRadius: [0, 5, 5, 0] } })), label: { show: true, position: 'right', color: '#93a487', fontFamily: mono, fontSize: 11, formatter: p => p.value.toLocaleString('pl-PL') } }]
    });
    window.addEventListener('resize', () => ch.resize());
  });

  lazyChart('kr-c-parks', () => {
    const ch = echartsInit(document.getElementById('kr-parksChart'));
    const parks = (M.section3_rare && M.section3_rare.parks) || {};
    const inPark = parks.count || 0;
    const total = parks.total || (M.summary && M.summary.total_active) || 0;
    if (!total) return;
    const outPark = Math.max(0, total - inPark);
    ch.setOption({
      backgroundColor: 'transparent', animationDuration: RM ? 0 : 900,
      tooltip: { backgroundColor: '#0c160b', borderColor: 'rgba(140,200,80,.3)', textStyle: { color: '#eef3e6' }, formatter: p => p.name + ': <b>' + p.value.toLocaleString('pl-PL') + '</b> (' + p.percent + '%)' },
      series: [{ type: 'pie', radius: ['58%', '82%'], center: ['50%', '52%'], avoidLabelOverlap: false,
        label: { show: true, position: 'center', formatter: inPark.toLocaleString('pl-PL') + '\n{a|w parkach}', rich: { a: { color: '#93a487', fontFamily: mono, fontSize: 11, lineHeight: 18 } }, color: '#eef3e6', fontFamily: 'Bricolage Grotesque', fontWeight: 800, fontSize: 34 }, labelLine: { show: false },
        data: [{ value: inPark, name: 'W parkach', itemStyle: { color: '#84c341' } }, { value: outPark, name: 'Poza parkami', itemStyle: { color: '#16261f' } }] }]
    });
    window.addEventListener('resize', () => ch.resize());
  });

  lazyChart('kr-c-civic', () => {
    const ch = echartsInit(document.getElementById('kr-civicChart'));
    const cs = (M.section3_rare && M.section3_rare.civic_streets) || {};
    const cats = ['Rynek', 'Kościuszki', 'Piłsudskiego', 'Wojska Polskiego', 'Mickiewicza', 'Jana Pawła II'];
    const vals = [
      cs.rynek           || 225,
      cs.kosciuszki      || 201,
      cs.pilsudskiego    || 162,
      cs.wojska_polskiego|| 138,
      cs.mickiewicza     || 114,
      cs.jana_pawla_ii   || 113,
    ];
    ch.setOption({
      backgroundColor: 'transparent', animationDuration: RM ? 0 : 1000, animationDelay: RM ? 0 : (i => i * 90),
      grid: { left: 118, right: 38, top: 8, bottom: 24 },
      tooltip: { backgroundColor: '#0c160b', borderColor: 'rgba(140,200,80,.3)', textStyle: { color: '#eef3e6' }, formatter: p => 'ul. ' + p.name + '<br><b>' + p.value + '</b> sklepów' },
      xAxis: { type: 'value', axisLabel: { color: axisC, fontFamily: mono, fontSize: 10 }, splitLine: { lineStyle: { color: split } } },
      yAxis: { type: 'category', data: cats, inverse: true, axisLabel: { color: '#eef3e6', fontFamily: 'IBM Plex Sans', fontSize: 12 }, axisLine: { lineStyle: { color: 'rgba(140,200,80,.2)' } }, axisTick: { show: false } },
      series: [{ type: 'bar', barWidth: '56%', data: vals.map((v, i) => ({ value: v, itemStyle: { color: ['#84c341', '#8fc841', '#9bcf45', '#a6e84a', '#c2ec4f', '#a6e84a'][i], borderRadius: [0, 5, 5, 0] } })), label: { show: true, position: 'right', color: '#93a487', fontFamily: mono, fontSize: 11 } }]
    });
    window.addEventListener('resize', () => ch.resize());
  });
}
