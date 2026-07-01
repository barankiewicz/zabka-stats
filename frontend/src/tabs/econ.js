// "380 dots": scroll-driven econ scene (spec: ekonomia infotainment rebuild).
// One persistent ECharts instance morphs through six acts as the user scrolls
// past the .econ-step markers: map of powiaty -> salary strip -> scatter
// assembly -> quartile bars -> outliers -> axis flip to unemployment. Dots
// keep identity across acts via a stable `id` (powiat_id); the salary quartile
// merge/split (acts 3<->4<->5) additionally wires `groupId` so ECharts'
// universalTransition can animate the many-to-one/one-to-many morph.
import { init as echartsInit, use as echartsUse } from 'echarts/core';
import { ScatterChart, LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { UniversalTransition } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';
echartsUse([ScatterChart, LineChart, BarChart, GridComponent, TooltipComponent, UniversalTransition, CanvasRenderer]);
import { M } from '../state.js';
import { debounce, wireCountUp } from '../utils.js';
import { refetchPowiatEconomics } from '../data.js';

const RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
const fmtPop = p => p >= 1e6 ? (p / 1e6).toFixed(2) + ' mln' : Math.round(p / 1000) + ' tys.';
const plr = r => (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(2).replace('.', ',');
const cleanPow = n => (n || '').replace(/^powiat\s+/i, '');

function pearson(xs, ys) {
  const n = xs.length; if (!n) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  return (sx && sy) ? sxy / Math.sqrt(sx * sy) : 0;
}
function linreg(xs, ys) {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx; num += dx * (ys[i] - my); den += dx * dx; }
  const slope = den ? num / den : 0; return { slope, intercept: my - slope * mx };
}

// Pure function of powiat_id (not Math.random()): the strip jitter (act 2)
// must land on the same y every time a dot is drawn, or the "same dots"
// illusion breaks when the user scrolls back up to revisit act 2.
function jitterFor(id) {
  let h = id >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 2000) / 2000 - 0.5; // -0.5..0.5
}

// Macro-region colors (CLAUDE.md color table) - constant across every act,
// the visual thread that makes "same dots" legible while axes and shapes change.
const REGION_COLOR = {
  pomorskie: '#4dd0b1', 'warmińsko-mazurskie': '#4dd0b1', 'kujawsko-pomorskie': '#4dd0b1', podlaskie: '#4dd0b1',
  'dolnośląskie': '#a6e84a', zachodniopomorskie: '#a6e84a', lubuskie: '#a6e84a', opolskie: '#a6e84a',
  mazowieckie: '#84c341', 'łódzkie': '#84c341', 'świętokrzyskie': '#84c341', wielkopolskie: '#84c341',
  'śląskie': '#f2a359', 'małopolskie': '#f2a359', podkarpackie: '#f2a359', lubelskie: '#f2a359',
};
const regionColor = v => REGION_COLOR[(v || '').toLowerCase()] || '#84c341';

// Editorially-chosen outliers (act 5): the resort group (amber) vs the twist (red-orange).
const OUTLIERS = [
  { match: 'kamieńsk', color: '#f2a359', label: n => `${n} · kurort` },
  { match: 'tatrza', color: '#f2a359', label: n => `${n} · kurort` },
  { match: 'świnoujście', color: '#f2a359', label: n => `${n} · kurort` },
  { match: 'lubińsk', color: '#e8693d', label: n => `${n} · miedź, nie tłum` },
];
const outlierSpec = powiat => OUTLIERS.find(o => (powiat || '').toLowerCase().includes(o.match));

const AXIS_LINE = { lineStyle: { color: 'rgba(140,200,80,.14)' } };
const HIDDEN_AXIS_BITS = { show: false, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false } };

function prepareRows() {
  const raw = (M.powiat_economics || []).filter(d => d.lon != null && d.lat != null && d.avg_salary > 0);
  if (!raw.length) return null;

  const bySalary = [...raw].sort((a, b) => a.avg_salary - b.avg_salary);
  const byUnemp = [...raw].sort((a, b) => a.unemployment_rate - b.unemployment_rate);
  const qSize = Math.ceil(raw.length / 4);
  bySalary.forEach((r, i) => { r.q_salary = Math.min(4, Math.floor(i / qSize) + 1); });
  byUnemp.forEach((r, i) => { r.q_unemployment = Math.min(4, Math.floor(i / qSize) + 1); });

  const pops = raw.map(r => Math.sqrt(r.population || 0));
  const popLo = Math.min(...pops), popHi = Math.max(...pops);
  raw.forEach(r => {
    const t = popHi > popLo ? (Math.sqrt(r.population || 0) - popLo) / (popHi - popLo) : 0.5;
    r._size = 6 + t * 20;
    r._jitter = jitterFor(r.powiat_id);
    r._outlier = outlierSpec(r.powiat);
  });

  const salaries = raw.map(r => r.avg_salary), unemp = raw.map(r => r.unemployment_rate);
  const perKs = raw.map(r => r.per_1k);
  const r1 = pearson(salaries, perKs), reg1 = linreg(salaries, perKs);
  const r2 = pearson(unemp, perKs), reg2 = linreg(unemp, perKs);
  const salaryMin = Math.floor(Math.min(...salaries) / 500) * 500;
  const salaryMax = Math.ceil(Math.max(...salaries) / 500) * 500;
  const unempMax = Math.max(20, Math.ceil(Math.max(...unemp) / 2) * 2);
  const ymax = Math.max(1.05, Math.max(...perKs) * 1.08);

  const quartileMeansBy = qkey => {
    const out = [0, 0, 0, 0];
    for (let q = 1; q <= 4; q++) {
      const seg = raw.filter(r => r[qkey] === q);
      out[q - 1] = seg.length ? seg.reduce((s, r) => s + r.per_1k, 0) / seg.length : 0;
    }
    return out;
  };

  return {
    rows: raw, r1, reg1, r2, reg2,
    salaryMin, salaryMax, unempMax, ymax,
    qSalaryMeans: quartileMeansBy('q_salary'),
    qUnempMeans: quartileMeansBy('q_unemployment'),
  };
}

// Poland's real aspect ratio at this latitude band (1 deg lon ~= cos(52deg) * 1 deg
// lat in ground distance) so the map act doesn't squash the country into the
// container's raw pixel aspect.
const MAP_LON = [14.1, 24.2], MAP_LAT = [49.0, 54.9];
const MAP_ASPECT = ((MAP_LON[1] - MAP_LON[0]) * Math.cos(52 * Math.PI / 180)) / (MAP_LAT[1] - MAP_LAT[0]);
function mapGrid(w, h) {
  const pad = 24;
  const availW = w - pad * 2, availH = h - pad * 2;
  let boxW, boxH;
  if (availW / availH > MAP_ASPECT) { boxH = availH; boxW = boxH * MAP_ASPECT; }
  else { boxW = availW; boxH = boxW / MAP_ASPECT; }
  return { left: (w - boxW) / 2, top: (h - boxH) / 2, width: boxW, height: boxH };
}

function tooltipFmt(p) {
  const d = p.data;
  if (d.value == null || !Array.isArray(d.value)) {
    return `<b>${p.name}</b><br/>Średnia gęstość: <b>${(d.value ?? 0).toFixed(3)}</b> skl./1000<br/><span style="color:#93a487">n = ${d._n || ''} powiaty</span>`;
  }
  return `<span style="font-family:JetBrains Mono;font-size:12px;line-height:1.6;color:#eef3e6">
    <b>${cleanPow(d._powiat)}</b><br/>
    średnia płaca: <b>${Math.round(d._salary).toLocaleString('pl-PL')} zł</b><br/>
    Bezrobocie: <b>${d._unemployment.toFixed(1).replace('.', ',')}%</b><br/>
    Żabki / 1000 mieszk.: <b>${d._per1k.toFixed(3)}</b><br/>
    Populacja: ${fmtPop(d._population)}</span>`;
}

function dotItem(r, { groupId } = {}) {
  return {
    id: r.powiat_id,
    ...(groupId ? { groupId } : {}),
    name: cleanPow(r.powiat),
    _powiat: r.powiat, _salary: r.avg_salary, _unemployment: r.unemployment_rate,
    _per1k: r.per_1k, _population: r.population,
  };
}

function baseOption() {
  return {
    backgroundColor: 'transparent',
    animationDurationUpdate: RM ? 0 : 1000,
    animationEasingUpdate: 'cubicInOut',
    animationDelayUpdate: RM ? 0 : (idx => Math.min(idx * 1.5, 550)),
    tooltip: {
      trigger: 'item', backgroundColor: '#0c160b', borderColor: 'rgba(140,200,80,.3)', borderWidth: 1,
      padding: [8, 12], textStyle: { color: '#eef3e6', fontFamily: 'IBM Plex Sans', fontSize: 11 },
      formatter: tooltipFmt,
    },
    xAxis: { show: false },
    yAxis: { show: false },
    series: [
      { id: 'trend', type: 'line', showSymbol: false, silent: true, z: 1, data: [],
        universalTransition: { enabled: true },
        lineStyle: { width: 2, type: 'dashed', opacity: .7 } },
      { id: 'powiaty', type: 'scatter', z: 2, data: [],
        universalTransition: { enabled: true },
        symbolSize: d => d[2] || 10,
        itemStyle: { opacity: .84, borderColor: 'rgba(10,18,10,.6)', borderWidth: .5, shadowBlur: 8, shadowColor: 'rgba(132,195,65,.15)' },
        emphasis: { scale: 1.3, itemStyle: { borderColor: 'rgba(166,232,74,.6)', borderWidth: 1 } } },
    ],
  };
}

function buildAct1(ctx, gridBox) {
  return {
    grid: gridBox,
    xAxis: { type: 'value', min: MAP_LON[0], max: MAP_LON[1], ...HIDDEN_AXIS_BITS, splitLine: { show: false } },
    yAxis: { type: 'value', min: MAP_LAT[0], max: MAP_LAT[1], ...HIDDEN_AXIS_BITS, splitLine: { show: false } },
    series: [
      { id: 'trend', data: [] },
      { id: 'powiaty', type: 'scatter',
        animationDelay: RM ? 0 : (idx => idx * 2),
        data: ctx.rows.map(r => ({ ...dotItem(r), value: [r.lon, r.lat, r._size], itemStyle: { color: regionColor(r.voivodeship) } })) },
    ],
  };
}

function buildAct2(ctx) {
  const extremes = new Set([
    ctx.rows.reduce((b, r) => r.avg_salary < (b ? b.avg_salary : Infinity) ? r : b, null)?.powiat_id,
    ctx.rows.reduce((b, r) => r.avg_salary > (b ? b.avg_salary : -Infinity) ? r : b, null)?.powiat_id,
  ]);
  return {
    grid: { left: 40, right: 40, top: 60, bottom: 60 },
    xAxis: { type: 'value', min: ctx.salaryMin, max: ctx.salaryMax, ...HIDDEN_AXIS_BITS, splitLine: { show: true, ...AXIS_LINE } },
    yAxis: { type: 'value', min: -0.6, max: 0.6, ...HIDDEN_AXIS_BITS, splitLine: { show: false } },
    series: [
      { id: 'trend', data: [] },
      { id: 'powiaty', type: 'scatter',
        data: ctx.rows.map(r => ({
          ...dotItem(r), value: [r.avg_salary, r._jitter * 0.8, r._size],
          itemStyle: { color: regionColor(r.voivodeship) },
          label: extremes.has(r.powiat_id)
            ? { show: true, formatter: () => `${cleanPow(r.powiat)} · ${Math.round(r.avg_salary).toLocaleString('pl-PL')} zł`,
                color: '#eef3e6', fontFamily: 'JetBrains Mono', fontSize: 10, position: 'top' }
            : undefined,
        })) },
    ],
  };
}

function buildAct3(ctx) {
  return {
    grid: { left: 44, right: 24, top: 24, bottom: 56 },
    xAxis: { type: 'value', min: ctx.salaryMin, max: ctx.salaryMax, ...HIDDEN_AXIS_BITS, splitLine: { show: true, ...AXIS_LINE } },
    yAxis: { type: 'value', min: 0, max: ctx.ymax, ...HIDDEN_AXIS_BITS, splitLine: { show: true, ...AXIS_LINE } },
    series: [
      { id: 'trend', data: [[ctx.salaryMin, ctx.reg1.slope * ctx.salaryMin + ctx.reg1.intercept],
                             [ctx.salaryMax, ctx.reg1.slope * ctx.salaryMax + ctx.reg1.intercept]],
        lineStyle: { color: '#a6e84a', width: 2, type: 'dashed', opacity: .7 } },
      { id: 'powiaty', type: 'scatter',
        data: ctx.rows.map(r => ({
          ...dotItem(r, { groupId: 'sq' + r.q_salary }), value: [r.avg_salary, r.per_1k, r._size],
          itemStyle: { color: regionColor(r.voivodeship) },
        })) },
    ],
  };
}

const QUARTILE_COLORS_SALARY = ['#4dd0b1', '#84c341', '#a6e84a', '#f2a359'];
const QUARTILE_LABELS_SALARY = ['Q1 – najniższe zarobki', 'Q2 – niższe zarobki', 'Q3 – wyższe zarobki', 'Q4 – najwyższe zarobki'];

function buildAct4(ctx) {
  return {
    grid: { left: 44, right: 24, top: 30, bottom: 56 },
    xAxis: { type: 'category', data: QUARTILE_LABELS_SALARY, axisLine: AXIS_LINE,
      axisTick: { show: false }, axisLabel: { show: true, color: '#93a487', fontFamily: 'IBM Plex Sans', fontSize: 10.5, interval: 0 },
      splitLine: { show: false } },
    yAxis: { type: 'value', min: 0, max: Math.max(...ctx.qSalaryMeans) * 1.2, ...HIDDEN_AXIS_BITS, splitLine: { show: true, ...AXIS_LINE } },
    series: [
      { id: 'trend', data: [] },
      { id: 'powiaty', type: 'bar', barWidth: '52%',
        data: ctx.qSalaryMeans.map((v, i) => ({
          id: 'sq' + (i + 1), value: v, _n: ctx.rows.filter(r => r.q_salary === i + 1).length,
          itemStyle: { color: QUARTILE_COLORS_SALARY[i], borderRadius: [6, 6, 0, 0] },
          label: { show: true, position: 'top', color: '#eef3e6', fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 500, formatter: p => p.value.toFixed(3) },
        })) },
    ],
  };
}

function buildAct5(ctx) {
  return {
    grid: { left: 44, right: 24, top: 24, bottom: 56 },
    xAxis: { type: 'value', min: ctx.salaryMin, max: ctx.salaryMax, ...HIDDEN_AXIS_BITS, splitLine: { show: true, ...AXIS_LINE } },
    yAxis: { type: 'value', min: 0, max: ctx.ymax, ...HIDDEN_AXIS_BITS, splitLine: { show: true, ...AXIS_LINE } },
    series: [
      { id: 'trend', data: [[ctx.salaryMin, ctx.reg1.slope * ctx.salaryMin + ctx.reg1.intercept],
                             [ctx.salaryMax, ctx.reg1.slope * ctx.salaryMax + ctx.reg1.intercept]],
        lineStyle: { color: '#a6e84a', width: 2, type: 'dashed', opacity: .3 } },
      { id: 'powiaty', type: 'scatter',
        data: ctx.rows.map(r => {
          const o = r._outlier;
          return {
            ...dotItem(r, { groupId: 'sq' + r.q_salary }), value: [r.avg_salary, r.per_1k, r._size],
            itemStyle: { color: o ? o.color : regionColor(r.voivodeship), opacity: o ? 1 : .18 },
            label: o ? { show: true, formatter: () => o.label(cleanPow(r.powiat)), color: o.color,
                         fontFamily: 'JetBrains Mono', fontSize: 10.5, position: 'top', fontWeight: 500 } : undefined,
          };
        }) },
    ],
  };
}

function buildAct6(ctx) {
  return {
    grid: { left: 44, right: 24, top: 24, bottom: 56 },
    xAxis: { type: 'value', min: 0, max: ctx.unempMax, ...HIDDEN_AXIS_BITS, splitLine: { show: true, ...AXIS_LINE } },
    yAxis: { type: 'value', min: 0, max: ctx.ymax, ...HIDDEN_AXIS_BITS, splitLine: { show: true, ...AXIS_LINE } },
    series: [
      { id: 'trend', data: [[0, ctx.reg2.intercept], [ctx.unempMax, ctx.reg2.slope * ctx.unempMax + ctx.reg2.intercept]],
        lineStyle: { color: '#e8693d', width: 2, type: 'dashed', opacity: .7 } },
      { id: 'powiaty', type: 'scatter',
        data: ctx.rows.map(r => {
          const isRecord = r.unemployment_rate === Math.max(...ctx.rows.map(x => x.unemployment_rate));
          return {
            ...dotItem(r), value: [r.unemployment_rate, r.per_1k, r._size],
            itemStyle: { color: regionColor(r.voivodeship), opacity: .84 },
            label: isRecord ? { show: true, formatter: () => `${cleanPow(r.powiat)} · ${r.unemployment_rate.toFixed(1)}%`,
                                 color: '#e8693d', fontFamily: 'JetBrains Mono', fontSize: 10.5, position: 'top' } : undefined,
          };
        }) },
    ],
  };
}

const ACT_ORDER = ['1', '2', '3', '4', '5', '6'];

function animateNumber(el, from, to, duration, fmt) {
  if (RM || duration <= 0) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  function tick(t) {
    const p = Math.min(1, (t - t0) / duration);
    el.textContent = fmt(from + (to - from) * p);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

let _econDone = false;
function initEconScene(ctx) {
  const chartEl = document.getElementById('econ-scene-chart');
  const wrap = document.getElementById('econ-scene-chart-wrap');
  const hudR = document.getElementById('econ-hud-r');
  const hudAxis = document.getElementById('econ-hud-axis');
  if (!chartEl || !wrap) return;
  wrap.classList.remove('skel');

  const chart = echartsInit(chartEl, null, { renderer: 'canvas' });
  chart.setOption(baseOption());

  const ACTS = {
    '1': () => buildAct1(ctx, mapGrid(chart.getWidth(), chart.getHeight())),
    '2': () => buildAct2(ctx),
    '3': () => buildAct3(ctx),
    '4': () => buildAct4(ctx),
    '5': () => buildAct5(ctx),
    '6': () => buildAct6(ctx),
  };

  function syncHud(id) {
    if (id === '3') {
      hudR.classList.remove('neg'); hudR.classList.add('show');
      animateNumber(hudR, 0, ctx.r1, RM ? 0 : 700, v => 'r = ' + plr(v));
      hudAxis.classList.add('show'); hudAxis.textContent = 'płaca → gęstość sieci';
    } else if (id === '4') {
      hudR.classList.remove('show');
      hudAxis.classList.add('show'); hudAxis.textContent = 'kwartyle wg płacy';
    } else if (id === '5') {
      hudR.classList.remove('neg'); hudR.classList.add('show');
      hudR.textContent = 'r = ' + plr(ctx.r1);
      hudAxis.classList.add('show'); hudAxis.textContent = 'wyjątki na szczycie gęstości';
    } else if (id === '6') {
      hudR.classList.add('show'); hudR.classList.add('neg');
      animateNumber(hudR, ctx.r1, ctx.r2, RM ? 0 : 700, v => 'r = ' + plr(v));
      hudAxis.classList.add('show'); hudAxis.textContent = 'stopa bezrobocia → gęstość sieci';
    } else {
      hudR.classList.remove('show'); hudAxis.classList.remove('show');
    }
  }

  let currentAct = null;
  function applyAct(id) {
    if (id === currentAct) return;
    const prevIdx = currentAct ? ACT_ORDER.indexOf(currentAct) : -1;
    const idx = ACT_ORDER.indexOf(id);
    const jump = prevIdx === -1 || Math.abs(idx - prevIdx) > 1;
    currentAct = id;
    const opt = ACTS[id]();
    if (jump || RM) { opt.animationDurationUpdate = 0; opt.animationDelayUpdate = 0; }
    chart.setOption(opt);
    syncHud(id);
  }

  const steps = Array.from(document.querySelectorAll('.econ-step'));
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      applyAct(e.target.dataset.act);
      steps.forEach(s => s.classList.toggle('is-active', s === e.target));
    });
  }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
  steps.forEach(s => io.observe(s));

  const ro = new ResizeObserver(debounce(() => {
    chart.resize();
    if (currentAct === '1') chart.setOption({ grid: mapGrid(chart.getWidth(), chart.getHeight()) });
  }, 100));
  ro.observe(wrap);
}

function showError() {
  const wrap = document.getElementById('econ-scene-chart-wrap');
  const err = document.getElementById('econ-scene-error');
  if (!wrap || !err) return;
  wrap.classList.remove('skel');
  err.hidden = false;
  const btn = document.getElementById('econ-scene-retry');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      err.hidden = true;
      wrap.classList.add('skel');
      try { await refetchPowiatEconomics(); } catch { /* keep skeleton, user can retry again */ }
      const ctx = prepareRows();
      if (ctx) { err.hidden = true; initEconScene(ctx); _updateEconFacts(); }
      else showError();
    });
  }
}

function _setDC(id, v) { const el = document.getElementById(id); if (el && v != null) el.dataset.count = v; }
function _setTxt(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }

function _updateEconFacts() {
  const all = M.powiat_economics || [];
  const rowsS = all.filter(d => d.avg_salary > 0 && d.per_1k > 0);
  const rowsU = all.filter(d => d.unemployment_rate != null && d.unemployment_rate > 0 && d.per_1k > 0);

  if (rowsS.length >= 8) {
    const ss = [...rowsS].sort((a, b) => a.avg_salary - b.avg_salary);
    const q = Math.floor(ss.length / 4);
    const q1avg = ss.slice(0, q).reduce((s, r) => s + r.per_1k, 0) / q;
    const q4avg = ss.slice(ss.length - q).reduce((s, r) => s + r.per_1k, 0) / q;
    if (q1avg > 0) _setDC('ec-fact-ratio-num', (q4avg / q1avg).toFixed(1));

    const maxRow = rowsS.reduce((b, r) => r.per_1k > (b ? b.per_1k : 0) ? r : b, null);
    if (maxRow && maxRow.per_1k > 0) {
      const inv = Math.round(1000 / maxRow.per_1k);
      _setDC('ec-fact-record-num', inv);
      _setTxt('ec-fact-record-sub', cleanPow(maxRow.powiat) + (maxRow.voivodeship ? ' (' + maxRow.voivodeship + ')' : ''));
    }
    const rS = pearson(rowsS.map(d => d.avg_salary), rowsS.map(d => d.per_1k));
    _setTxt('ec-fact-r-salary', plr(rS));
  }

  if (rowsU.length >= 8) {
    const su = [...rowsU].sort((a, b) => a.unemployment_rate - b.unemployment_rate);
    const qu = Math.floor(su.length / 4);
    const lowAvg = su.slice(0, qu).reduce((s, r) => s + r.per_1k, 0) / qu;
    const highAvg = su.slice(su.length - qu).reduce((s, r) => s + r.per_1k, 0) / qu;
    if (highAvg > 0) _setDC('ec-fact-u-ratio-num', (lowAvg / highAvg).toFixed(1));

    const maxURow = su[su.length - 1];
    if (maxURow) {
      _setDC('ec-fact-u-max-num', maxURow.unemployment_rate.toFixed(1));
      _setTxt('ec-fact-u-max-sub', cleanPow(maxURow.powiat) + ' – tylko ' + maxURow.per_1k.toFixed(2).replace('.', ',') + ' skl./1000');
      _setTxt('ec-fact-u-max-density', maxURow.per_1k.toFixed(2).replace('.', ','));
    }
    const rU = pearson(rowsU.map(d => d.unemployment_rate), rowsU.map(d => d.per_1k));
    _setTxt('ec-fact-r-unemp', plr(rU));
  }
}

export function renderEcon() {
  const root = document.getElementById('ec-root'); if (!root) return;

  const obsR = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obsR.unobserve(e.target); } }), { threshold: .16 });
  root.querySelectorAll('.ec-reveal').forEach(r => obsR.observe(r));
  wireCountUp(root);
  const obsF = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { e.target.style.width = e.target.dataset.fill + '%'; obsF.unobserve(e.target); } }), { threshold: .6 });
  root.querySelectorAll('[data-fill]').forEach(el => obsF.observe(el));

  if (_econDone) return; // scene + facts only wired once
  _econDone = true;

  const ctx = prepareRows();
  if (!ctx) { showError(); return; }
  const countEl = document.getElementById('econ-dot-count');
  if (countEl) countEl.textContent = ctx.rows.length;
  _updateEconFacts();
  initEconScene(ctx);
}
