import Chart from 'chart.js/auto';
import * as d3 from 'd3';
import L from 'leaflet';
import 'leaflet.heat';
import { C } from '../config.js';
import { M, CHARTS, MAPS } from '../state.js';
import { fmt, getFont, destroyChart, leafletDark, startTabParticles } from '../utils.js';
import { renderPlazyExt } from './plazy_ext.js';

// Color buckets for dot map (matches test file scheme)
const DOT_CLASSES = [
  { max: 0,   col: '#3a4a36', lab: '0 - sucho' },
  { max: 10,  col: '#4dd0b1', lab: '1-10' },
  { max: 30,  col: '#84c341', lab: '11-30' },
  { max: 60,  col: '#a6e84a', lab: '31-60' },
  { max: 100, col: '#f2a359', lab: '61-100' },
  { max: 1e9, col: '#e8693d', lab: '100+' },
];

function dotColor(occ) {
  for (const c of DOT_CLASSES) { if (occ <= c.max) return c.col; }
  return '#e8693d';
}

export function renderPlazy() {
  startTabParticles('particles-plazy', [77, 208, 177], 72);
  updatePlazyStats();
  drawBeeswarm();
  renderPlazyMap();
  renderPlazyChoroMap();
  renderPlazyExt();
  renderFrogVoiv();
  renderFrogScatter();
  renderFrogTop10();
}

// Update hero-band stats from API data
function updatePlazyStats() {
  const ae = M.amphibian_extremes || {};
  const el = id => document.getElementById(id);
  if (el('plazy-gbif-total') && ae.gbif_total)
    el('plazy-gbif-total').textContent = fmt(ae.gbif_total);
  if (el('plazy-median') && ae.median_occurrences)
    el('plazy-median').textContent = fmt(ae.median_occurrences);
  if (el('plazy-record') && ae.most_froggy)
    el('plazy-record').textContent = fmt(ae.most_froggy.amphibian_occurrences_5km);
  if (el('plazy-zero-count') && ae.zero_frog_count != null)
    el('plazy-zero-count').textContent = fmt(ae.zero_frog_count);
  if (el('plazy-farthest-km') && ae.farthest_from_frog)
    el('plazy-farthest-km').textContent = ae.farthest_from_frog.nearest_amphibian_km.toFixed(2).replace('.', ',') + ' km';

  // P5 most froggy card
  if (ae.most_froggy) {
    const mf = ae.most_froggy;
    if (el('plazy-p5-num')) el('plazy-p5-num').textContent = fmt(mf.amphibian_occurrences_5km);
    if (el('plazy-p5-city')) el('plazy-p5-city').textContent = mf.city + ', ' + mf.voivodeship;
    if (el('plazy-p5-street')) el('plazy-p5-street').textContent = mf.street;
  }
  // P6 zero-frog card
  if (ae.zero_frog_count != null && el('plazy-p6-num'))
    el('plazy-p6-num').textContent = fmt(ae.zero_frog_count);
  if (ae.farthest_from_frog && el('plazy-p6-city'))
    el('plazy-p6-city').textContent = 'Najdalej od jakiejkolwiek: ' + ae.farthest_from_frog.city + ', ' + ae.farthest_from_frog.nearest_amphibian_km.toFixed(2).replace('.', ',') + ' km';
  if (ae.zero_frog_count != null && ae.gbif_total && el('plazy-p6-sub')) {
    const total = M.summary && M.summary.total_active;
    if (total) {
      const pct = ((ae.zero_frog_count / total) * 100).toFixed(1).replace('.', ',');
      el('plazy-p6-sub').textContent = 'sklepow (' + pct + '%) ze zero plazami w 5 km';
    }
  }

  // Dynamic hero lede
  const ledeEl = el('hero-lede-plazy');
  if (ledeEl && ae.median_occurrences != null && ae.most_froggy) {
    const med = fmt(ae.median_occurrences);
    const rec = fmt(ae.most_froggy.amphibian_occurrences_5km);
    const recCity = ae.most_froggy.city || 'Ursynow';
    ledeEl.textContent = `${med} obserwacje w promieniu 5 km - tyle wynosi mediana dla polskiej Żabki. Jeden sklep w ${recCity} bije rekordy: ${rec}. Białowieża ze swoimi 425 nie ma szans.`;
  }

  // Dynamic P1 title
  const p1TitleEl = el('plazy-p1-title');
  if (p1TitleEl && ae.most_froggy) {
    const rec = fmt(ae.most_froggy.amphibian_occurrences_5km);
    p1TitleEl.textContent = `Większość Żabek ma kilkadziesiąt żab w pobliżu. Jedna ma ${rec}.`;
  }
}

export function drawBeeswarm() {
  const cv = document.getElementById('canvas-beeswarm');
  const W = cv.offsetWidth || 1200; cv.width = W; cv.height = 300;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, 300);
  const ae0 = M.amphibian_extremes || {};
  const stores = ae0.stores || [];
  const recMax = ae0.most_froggy ? (ae0.most_froggy.amphibian_occurrences_5km || 1) : 1;
  const domMax = Math.max(100, Math.ceil(recMax * 1.1 / 100) * 100);
  const logScale = d3.scaleLog().domain([1, domMax]).range([60, W - 60]).clamp(true);
  const teals = ['#0a2a2a', '#0d4040', '#0f5a52', '#00b4c8', '#00e0d0'];
  const tealsScale = d3.scaleLog().domain([1, domMax]).range([0, 4]).clamp(true);
  const bucketStacks = {}; const BW = Math.ceil(W / 120);
  stores.forEach(([, , occ]) => { if (occ === 0) return; const bx = Math.floor(logScale(occ) / BW); bucketStacks[bx] = (bucketStacks[bx] || 0) + 1; });
  const bucketCurr = {};
  stores.forEach(([lat, lon, occ]) => {
    if (occ === 0) return;
    const x = Math.round(logScale(occ));
    const bx = Math.floor(x / BW);
    const si = (bucketCurr[bx] || 0); bucketCurr[bx] = si + 1;
    const cy2 = 150 + (si % 2 === 0 ? 1 : -1) * Math.ceil(si / 2) * 4.5;
    if (cy2 < 20 || cy2 > 280) return;
    const ti = Math.floor(tealsScale(occ));
    ctx.fillStyle = teals[Math.min(ti, 4)]; ctx.globalAlpha = .75;
    ctx.beginPath(); ctx.arc(x, cy2, 2, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
  const ae2 = M.amphibian_extremes || {};
  const mf2 = ae2.most_froggy;
  const recOcc = (mf2 && mf2.amphibian_occurrences_5km > 0) ? mf2.amphibian_occurrences_5km : 0;
  const recCity2 = mf2 ? (mf2.city || '') : '';
  if (recOcc > 0) {
    const urx = Math.round(logScale(recOcc));
    ctx.beginPath(); ctx.arc(urx, 150, 6, 0, Math.PI * 2); ctx.fillStyle = C.teal; ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = `11px '${getFont('body')}',sans-serif`; ctx.fillStyle = C.ink;
    ctx.textAlign = 'left'; ctx.fillText(recCity2 + ' (' + recOcc.toLocaleString('pl-PL') + ')', urx + 10, 148);
  }
  [1, 10, 100, 1000].forEach(v => {
    const x = logScale(v);
    ctx.fillStyle = C.muted; ctx.font = `10px '${getFont('mono')}',monospace`;
    ctx.textAlign = 'center'; ctx.fillText(v, x, 288);
    ctx.strokeStyle = C.axis; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 280); ctx.lineTo(x, 284); ctx.stroke();
  });
  ctx.textAlign = 'left';
}

// Enhanced coexistence map with dot/heat/dry modes + voivodeship highlight
export function renderPlazyMap() {
  if (MAPS['plazy']) return; // already initialized
  const map = L.map('map-plazy-main', { preferCanvas: true, scrollWheelZoom: false, zoomControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CARTO', subdomains: 'abcd', maxZoom: 16, detectRetina: true,
  }).addTo(map);
  map.setView([52.05, 19.3], 6);
  map.on('focus', () => map.scrollWheelZoom.enable());
  map.on('blur', () => map.scrollWheelZoom.disable());
  MAPS['plazy'] = map;

  const stores = M.amphibian_extremes.stores || [];
  const voivNames = M.amphibian_extremes.voivodeship_names || [];

  // Shared canvas renderer
  const cv = L.canvas({ padding: .5 });
  const cv2 = L.canvas({ padding: .5 });

  // Dot layer
  const dotLayer = L.layerGroup();
  const counts = [0, 0, 0, 0, 0, 0];
  function classIdx(occ) { for (let i = 0; i < DOT_CLASSES.length; i++) { if (occ <= DOT_CLASSES[i].max) return i; } return 5; }

  stores.forEach(s => {
    const occ = s[2];
    counts[classIdx(occ)]++;
    L.circleMarker([s[0], s[1]], {
      renderer: cv, radius: occ === 0 ? 2 : 2.6, stroke: false,
      fillColor: dotColor(occ), fillOpacity: occ === 0 ? .3 : .72,
    }).bindTooltip(`${fmt(occ)} obserwacji plazow w 5 km`, { sticky: true }).addTo(dotLayer);
  });

  // Heat layer
  const heatPts = stores.map(s => [s[0], s[1], Math.min(1, Math.log10(s[2] + 1) / Math.log10(2030))]);
  const heatLayer = typeof L.heatLayer === 'function' ? L.heatLayer(heatPts, {
    radius: 14, blur: 18, maxZoom: 11, minOpacity: .25,
    gradient: { 0.0: '#0a3d33', 0.3: '#4dd0b1', 0.5: '#84c341', 0.7: '#d7f25a', 0.85: '#f2a359', 1.0: '#e8693d' },
  }) : null;

  // Dry layer (stores with zero frogs) - built lazily
  let dryLayer = null;
  function buildDry() {
    if (dryLayer) return;
    dryLayer = L.layerGroup();
    stores.forEach(s => {
      if (s[2] === 0) L.circleMarker([s[0], s[1]], { renderer: cv, radius: 3.4, stroke: false, fillColor: '#e8693d', fillOpacity: .85 }).addTo(dryLayer);
    });
  }

  // Voivodeship highlight cache
  const hlCache = {};
  let hlLayer = null, selVoiv = -1;
  function buildHl(idx) {
    if (hlCache[idx]) return hlCache[idx];
    const lg = L.layerGroup(); let n = 0;
    stores.forEach(s => {
      if (s[4] === idx) { n++; L.circleMarker([s[0], s[1]], { renderer: cv2, radius: 3.4, stroke: false, fillColor: '#a6e84a', fillOpacity: .95 }).addTo(lg); }
    });
    hlCache[idx] = { layer: lg, n };
    return hlCache[idx];
  }
  function clearVoiv() {
    selVoiv = -1;
    if (hlLayer) { map.removeLayer(hlLayer); hlLayer = null; }
    const c = cv._container; if (c) c.style.opacity = '1';
  }
  function selectVoiv(idx) {
    if (idx === -1) { clearVoiv(); setCaption('dots'); return; }
    if (currentMode !== 'dots') setMode('dots');
    selVoiv = idx;
    const c = cv._container; if (c) c.style.opacity = '.16';
    if (hlLayer) map.removeLayer(hlLayer);
    const h = buildHl(idx); hlLayer = h.layer; hlLayer.addTo(map);
    capEl.innerHTML = 'Podswietlono: <b>' + (voivNames[idx] || idx) + '</b> - ' + h.n.toLocaleString('pl-PL') + ' Zabek (reszta przygaszona).';
  }

  const capEl = document.getElementById('plazy-map-cap');
  function setCaption(m) {
    if (!capEl) return;
    if (m === 'dots') capEl.innerHTML = 'Tryb: <b>kropki</b> - kolor = liczba obserwacji plazow w 5 km.';
    if (m === 'heat') capEl.innerHTML = 'Tryb: <b>mapa ciepla</b> - jasnosc = intensywnosc obserwacji plazow wokol sklepow.';
    if (m === 'dry') capEl.innerHTML = 'Tryb: <b>suche Zabki</b> - sklepy (czerwone) bez zadnej obserwacji plaza w 5 km.';
  }

  let currentMode = 'dots';
  function setMode(m) {
    currentMode = m;
    if (selVoiv !== -1) { clearVoiv(); const vs = document.getElementById('plazy-vsel'); if (vs) vs.value = '-1'; }
    map.removeLayer(dotLayer);
    if (heatLayer) map.removeLayer(heatLayer);
    if (dryLayer) map.removeLayer(dryLayer);
    document.querySelectorAll('.plazy-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.plazyMode === m));
    if (m === 'dots') { dotLayer.addTo(map); setCaption('dots'); }
    if (m === 'heat') { if (heatLayer) { heatLayer.addTo(map); } else { dotLayer.addTo(map); } setCaption('heat'); }
    if (m === 'dry') { buildDry(); dryLayer.addTo(map); setCaption('dry'); }
  }

  // Start with dot layer
  dotLayer.addTo(map);
  setCaption('dots');

  // Mode buttons
  document.querySelectorAll('.plazy-mode-btn').forEach(b => {
    b.addEventListener('click', () => setMode(b.dataset.plazyMode));
  });

  // Extreme markers
  const ae = M.amphibian_extremes || {};
  const mf = ae.most_froggy || {};
  const ff = ae.farthest_from_frog || {};
  const mkIcon = c => L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${c};border:2px solid #0a120a;box-shadow:0 0 0 3px rgba(10,18,10,.55),0 0 14px ${c}"></div>`,
    iconSize: [16, 16], iconAnchor: [8, 8],
  });
  const frogLat = mf.latitude || null;
  const frogLon = mf.longitude || null;
  const dryLat = ff.latitude || null;
  const dryLon = ff.longitude || null;

  const frogM = frogLat != null
    ? L.marker([frogLat, frogLon], { icon: mkIcon('#a6e84a') }).addTo(map)
        .bindPopup(`<b>Najbardziej zabia Zabka</b><br>${fmt(mf.amphibian_occurrences_5km || 0)} obserwacji<br>${mf.city || ''} · ${mf.street || ''}`, { closeButton: false, maxWidth: 240 })
    : null;
  const dryM = dryLat != null
    ? L.marker([dryLat, dryLon], { icon: mkIcon('#e8693d') }).addTo(map)
        .bindPopup(`<b>Najdalej od plaza</b><br>${ff.nearest_amphibian_km ? ff.nearest_amphibian_km.toFixed(2) : '—'} km<br>${ff.city || ''} · ${ff.voivodeship || ''}`, { closeButton: false, maxWidth: 240 })
    : null;

  const flyBtn = id => document.getElementById(id);
  if (flyBtn('plazy-fly-frog') && frogLat != null) flyBtn('plazy-fly-frog').addEventListener('click', () => { map.flyTo([frogLat, frogLon], 12, { duration: 1.5, easeLinearity: .22 }); if (frogM) setTimeout(() => frogM.openPopup(), 650); });
  if (flyBtn('plazy-fly-dry') && dryLat != null) flyBtn('plazy-fly-dry').addEventListener('click', () => { map.flyTo([dryLat, dryLon], 11, { duration: 1.5, easeLinearity: .22 }); if (dryM) setTimeout(() => dryM.openPopup(), 650); });
  if (flyBtn('plazy-fly-home')) flyBtn('plazy-fly-home').addEventListener('click', () => { map.closePopup(); map.flyTo([52.05, 19.3], 6, { duration: 1.3 }); });

  // Voivodeship select
  const vsel = document.getElementById('plazy-vsel');
  if (vsel && voivNames.length) {
    voivNames.map((n, i) => [n, i]).sort((a, b) => a[0].localeCompare(b[0], 'pl')).forEach(([n, i]) => {
      const o = document.createElement('option'); o.value = i; o.textContent = n; vsel.appendChild(o);
    });
    vsel.addEventListener('change', () => selectVoiv(parseInt(vsel.value)));
  }

  // GBIF heat overlay (if present)
  if (ae.gbif_obs && ae.gbif_obs.length && typeof L.heatLayer === 'function') {
    L.heatLayer(ae.gbif_obs.map(([lat, lon]) => [lat, lon, .5]), {
      radius: 18, blur: 15, maxZoom: 12,
      gradient: { 0: 'transparent', .5: 'rgba(0,180,200,.25)', 1: 'rgba(0,224,200,.55)' },
    }).addTo(map);
  }

  // Legend
  const lgEl = document.getElementById('plazy-legend');
  if (lgEl) {
    const maxC = Math.max(...counts);
    DOT_CLASSES.forEach((c, i) => {
      const pct = Math.round(counts[i] / maxC * 100);
      const row = document.createElement('div'); row.className = 'plazy-lgrow';
      row.innerHTML = `<i style="background:${c.col}"></i><div class="lb">${c.lab}<div class="mb"><span data-w="${pct}" style="background:${c.col}"></span></div></div><span class="cnt">${counts[i].toLocaleString('pl-PL')}</span>`;
      lgEl.appendChild(row);
    });
    // Animate legend bars on scroll into view
    const fo = new IntersectionObserver(es => {
      es.forEach(e => {
        if (e.isIntersecting) { lgEl.querySelectorAll('.mb span').forEach(s => { s.style.width = s.dataset.w + '%'; }); fo.unobserve(e.target); }
      });
    }, { threshold: .3 });
    fo.observe(lgEl);
  }

  setTimeout(() => map.invalidateSize(), 300);
  new IntersectionObserver(es => { es.forEach(e => { if (e.isIntersecting) map.invalidateSize(); }); }, { threshold: .1 }).observe(document.getElementById('map-plazy-main'));
  window.addEventListener('resize', () => map.invalidateSize());
}

// Choropleth: average amphibian observations per store by voivodeship
export function renderPlazyChoroMap() {
  if (MAPS['plazy-choro']) return;
  const container = document.getElementById('map-plazy-choro');
  if (!container) return;

  const map = L.map('map-plazy-choro', { scrollWheelZoom: false, zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CARTO', subdomains: 'abcd', maxZoom: 12, detectRetina: true,
  }).addTo(map);
  MAPS['plazy-choro'] = map;

  const byVoiv = M.amphibian_extremes.by_voivodeship || [];
  const avgByName = {};
  byVoiv.forEach(r => { avgByName[r.voivodeship] = { avg: r.avg_occurrences, stores: r.stores }; });

  const WCLASS = [
    { max: 20,  col: '#1f4d42' },
    { max: 40,  col: '#3f8a4a' },
    { max: 60,  col: '#84c341' },
    { max: 90,  col: '#d7f25a' },
    { max: 120, col: '#f2a359' },
    { max: 1e9, col: '#e8693d' },
  ];
  function wojColor(a) { for (const c of WCLASS) { if (a <= c.max) return c.col; } return '#e8693d'; }

  const wojGeo = M.woj_geo;
  if (!wojGeo || !wojGeo.features || !wojGeo.features.length) {
    // No GeoJSON available - show fallback message
    container.innerHTML = '<div style="color:var(--muted);padding:20px;font-size:13px">Brak danych GeoJSON dla choroplety.</div>';
    return;
  }

  const gj = L.geoJSON(wojGeo, {
    style: f => {
      // GeoJSON properties may use 'name' or 'nazwa'
      const name = (f.properties && (f.properties.name || f.properties.nazwa || f.properties.NAME)) || '';
      const d = avgByName[name] || {};
      return { fillColor: wojColor(d.avg || 0), fillOpacity: .82, color: '#0a120a', weight: 1.2 };
    },
    onEachFeature: (f, layer) => {
      const name = (f.properties && (f.properties.name || f.properties.nazwa || f.properties.NAME)) || '';
      const d = avgByName[name] || { avg: '?', stores: '?' };
      layer.bindTooltip(
        `<div class="woj-tip-plazy"><b>${name}</b><br>${d.avg} obs./sklep · ${typeof d.stores === 'number' ? d.stores.toLocaleString('pl-PL') : d.stores} sklepow</div>`,
        { sticky: true, opacity: 1 }
      );
      layer.on('mouseover', () => layer.setStyle({ weight: 2.4, color: '#4dd0b1', fillOpacity: .95 }));
      layer.on('mouseout', () => gj.resetStyle(layer));
    },
  }).addTo(map);
  try { map.fitBounds(gj.getBounds(), { padding: [10, 10] }); } catch (e) { map.setView([52, 19.4], 5); }

  // Choropleth legend
  const wl = document.getElementById('plazy-choro-legend');
  if (wl) {
    [['<20', '#1f4d42'], ['20-40', '#3f8a4a'], ['40-60', '#84c341'], ['60-90', '#d7f25a'], ['90-120', '#f2a359'], ['120+', '#e8693d']].forEach(([lab, col]) => {
      const r = document.createElement('div'); r.className = 'plazy-lgrow';
      r.innerHTML = `<i style="background:${col}"></i><div class="lb">${lab} obs./sklep</div>`;
      wl.appendChild(r);
    });
  }

  setTimeout(() => map.invalidateSize(), 300);
  new IntersectionObserver(es => {
    es.forEach(e => {
      if (e.isIntersecting) {
        map.invalidateSize();
        try { map.fitBounds(gj.getBounds(), { padding: [10, 10] }); } catch (e2) { /* ignore */ }
      }
    });
  }, { threshold: .1 }).observe(container);
  window.addEventListener('resize', () => map.invalidateSize());
}

export function renderFrogVoiv() {
  const data = [...(M.amphibian_extremes.by_voivodeship || [])].sort((a, b) => b.avg_occurrences - a.avg_occurrences);
  if (!data.length) return;
  const maxV = data[0].avg_occurrences;
  destroyChart('frog-voiv');
  CHARTS['frog-voiv'] = new Chart(document.getElementById('chart-frog-voiv'), {
    type: 'bar',
    data: {
      labels: data.map(d => d.voivodeship),
      datasets: [{ data: data.map(d => d.avg_occurrences), backgroundColor: data.map(d => `rgba(0,180,200,${.25 + .75 * (d.avg_occurrences / maxV)})`), borderRadius: 2, borderWidth: 0 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `sr. ${fmt(ctx.raw)} obserwacji` } } },
      scales: { x: { grid: { color: C.axis }, ticks: { color: C.muted, font: { size: 10 } } }, y: { grid: { display: false }, ticks: { color: C.muted, font: { size: 10 } } } },
    },
  });
}

// Density scatter: Zabka count in 5km vs amphibian observations in 5km
export function renderFrogScatter() {
  const scatter = M.amphibian_extremes.scatter_sample || [];
  const stores = M.amphibian_extremes.stores || [];

  let pts = [];
  if (scatter.length) {
    // [density, occ] pairs from backend scatter_sample
    pts = scatter.filter(p => p[0] > 0 && p[1] > 0);
  } else {
    // Fallback: use stores near_km (index 3) vs occ as a proxy
    pts = stores
      .filter((s, i) => i % 3 === 0 && s[2] > 0 && s[3] > 0)
      .slice(0, 300)
      .map(s => [s[3], s[2]]); // [near_km, occ]
  }

  if (!pts.length) return;

  const maxOcc = Math.max(...pts.map(p => p[1]), 1);
  const tsc = d3.scaleLog().domain([1, maxOcc]).range(['#0d4040', '#00e0c8']);
  const xLabel = scatter.length ? 'liczba Zabek w promieniu 5 km' : 'odleglosc do najblizszej obserwacji (km)';

  destroyChart('frog-scatter');
  CHARTS['frog-scatter'] = new Chart(document.getElementById('chart-frog-scatter'), {
    type: 'scatter',
    data: {
      datasets: [{
        data: pts.map(p => ({ x: p[0], y: p[1] })),
        backgroundColor: pts.map(p => tsc(Math.max(p[1], 1))),
        pointRadius: 4, pointHoverRadius: 7,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 800, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.raw.x} · ${fmt(ctx.raw.y)} obs.` } },
      },
      scales: {
        x: {
          type: scatter.length ? 'logarithmic' : 'linear',
          title: { display: true, text: xLabel, color: C.muted, font: { size: 10 } },
          ticks: { color: C.muted, font: { size: 10 } }, grid: { color: C.axis },
        },
        y: {
          type: 'logarithmic',
          title: { display: true, text: 'obserwacje plazow w 5 km', color: C.muted, font: { size: 10 } },
          ticks: { color: C.muted, font: { size: 10 } }, grid: { color: C.axis },
        },
      },
    },
  });
}

export function renderFrogTop10() {
  const top10 = M.amphibian_extremes.top10 || [];
  destroyChart('frog-top10');
  CHARTS['frog-top10'] = new Chart(document.getElementById('chart-frog-top10'), {
    type: 'bar',
    data: { labels: top10.map(d => d.city), datasets: [{ data: top10.map(d => d.occ), backgroundColor: C.teal + 'cc', borderRadius: 2, borderWidth: 0 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${fmt(ctx.raw)} obserwacji w 5 km` } } },
      scales: { x: { grid: { color: C.axis }, ticks: { color: C.muted, font: { size: 10 } } }, y: { grid: { display: false }, ticks: { color: C.muted, font: { size: 10 } } } },
    },
  });
}
