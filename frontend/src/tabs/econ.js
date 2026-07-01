// "Żabka a Polska" infotainment: dwa rozdziały (płaca, bezrobocie) z korelacją
// gęstości sieci. Scattery + kwartyle liczone z prawdziwych M.powiat_economics
// (ECharts, bundlowane przez Vite). Narracja (bohaterowie, twisty)
// w czystym polskim. Animacje (count-up, reveal, r-meter) zakresowane do .ec.
import { init as echartsInit, use as echartsUse } from 'echarts/core';
import { ScatterChart, LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, VisualMapContinuousComponent, MarkPointComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
echartsUse([ScatterChart, LineChart, BarChart, GridComponent, TooltipComponent, VisualMapContinuousComponent, MarkPointComponent, CanvasRenderer]);
import { M } from '../state.js';
import { debounce, wireCountUp } from '../utils.js';

const RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
const fmtPop = p => p >= 1e6 ? (p / 1e6).toFixed(2) + ' mln' : Math.round(p / 1000) + ' tys.';

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
function quartileMeans(rows, kx, ky) {
  const s = [...rows].sort((a, b) => a[kx] - b[kx]);
  const q = Math.floor(s.length / 4), out = [];
  for (let i = 0; i < 4; i++) {
    const seg = s.slice(i * q, i === 3 ? s.length : (i + 1) * q);
    out.push(seg.reduce((a, b) => a + b[ky], 0) / (seg.length || 1));
  }
  return out;
}
const plr = r => (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(2).replace('.', ',');
const cleanPow = n => (n || '').replace(/^powiat\s+/i, '');

// Stratified subsample: n points spread evenly across the sorted range of sortKey.
// Hero rows (those matching any spec.match) are always included; the rest are sampled.
// Stats (pearson, linreg, quartiles) use the full arrays; only scatter dots use this.
function stratSample(arr, n, sortKey) {
  if (arr.length <= n) return arr;
  const s = [...arr].sort((a, b) => a[sortKey] - b[sortKey]);
  const step = s.length / n;
  return Array.from({ length: n }, (_, i) => s[Math.min(s.length - 1, Math.round(i * step))]);
}
function sampleWithHeroes(arr, n, sortKey, specs) {
  const isHero = r => specs.some(sp => (r.powiat || '').toLowerCase().includes(sp.match));
  const pinned = arr.filter(isHero);
  const rest   = arr.filter(r => !isHero(r));
  return [...pinned, ...stratSample(rest, Math.max(0, n - pinned.length), sortKey)];
}

function heroPoints(rows, xkey, specs) {
  // specs: [{match, label, color, pos, off}] -> place label on the real point
  const out = [];
  specs.forEach(sp => {
    const r = rows.find(d => (d.powiat || '').toLowerCase().includes(sp.match));
    if (!r) return;
    out.push({ coord: [r[xkey], r.per_1k], txt: sp.label,
      label: { color: sp.color, position: sp.pos || 'right', offset: sp.off || [6, 0] } });
  });
  return out;
}

function buildScatter(cfg) {
  const node = document.getElementById(cfg.el); if (!node) return;
  const chart = echartsInit(node, null, { renderer: 'canvas' });
  const xk = cfg.xkey || 'avg_salary';
  const heroMatches = cfg.heroSpecs || [];
  const isHero = row => heroMatches.some(sp => (row.powiat || '').toLowerCase().includes(sp.match));
  const makePoint = d => ({ value: [d[xk], d.per_1k, Math.sqrt(d.population) / 8, d.population, d.unemployment_rate, d.voivodeship, d.avg_salary], name: cleanPow(d.powiat) });
  const regularData = cfg.pts.filter(d => !isHero(d)).map(makePoint);
  const heroData    = cfg.pts.filter(d =>  isHero(d)).map(makePoint);
  const dotStyle = { opacity: .84, borderColor: 'rgba(10,18,10,.6)', borderWidth: .5, shadowBlur: 8, shadowColor: 'rgba(132,195,65,.15)' };
  const tooltipFmt = p => {
    const v = p.data.value;
    const xDisp = cfg.xfmt ? cfg.xfmt(v[0]) : v[0];
    return `<span style="font-family:JetBrains Mono;font-size:12px;line-height:1.6;color:#eef3e6"><b>${p.data.name}</b><br/>${cfg.xname}: <b>${xDisp}</b><br/>Żabki / 1k: <b>${v[1].toFixed(3)}</b><br/>Populacja: ${fmtPop(v[3])}</span>`;
  };
  chart.setOption({
    backgroundColor: 'transparent',
    animationDuration: RM ? 0 : 900, animationEasing: 'cubicOut', animationDelay: RM ? 0 : (i => i * 4),
    grid: { left: 56, right: 20, top: 20, bottom: 48 },
    tooltip: { trigger: 'item', backgroundColor: '#0c160b', borderColor: 'rgba(140,200,80,.3)', borderWidth: 1, padding: [8, 12], textStyle: { color: '#eef3e6', fontFamily: 'IBM Plex Sans', fontSize: 11 }, formatter: tooltipFmt },
    visualMap: { min: cfg.vmMin, max: cfg.vmMax, dimension: 0, calculable: false, show: false, inRange: { color: cfg.colors } },
    xAxis: { type: 'value', min: cfg.xmin, max: cfg.xmax, name: cfg.xname, nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: '#5d6c52', fontFamily: 'JetBrains Mono', fontSize: 10 }, axisLabel: { color: '#93a487', fontFamily: 'JetBrains Mono', fontSize: 10, formatter: cfg.xfmt }, axisLine: { lineStyle: { color: 'rgba(140,200,80,.2)' } }, splitLine: { lineStyle: { color: 'rgba(140,200,80,.06)' } } },
    yAxis: { type: 'value', min: 0, max: cfg.ymax || 1.05, name: 'Żabki / 1000 mieszk.', nameLocation: 'middle', nameGap: 38, nameRotate: 90, nameTextStyle: { color: '#5d6c52', fontFamily: 'JetBrains Mono', fontSize: 10 }, axisLabel: { color: '#93a487', fontFamily: 'JetBrains Mono', fontSize: 10 }, axisLine: { lineStyle: { color: 'rgba(140,200,80,.2)' } }, splitLine: { lineStyle: { color: 'rgba(140,200,80,.06)' } } },
    series: [
      { name: 'trend', type: 'line', showSymbol: false, silent: true, z: 1, animationDelay: RM ? 0 : 1000, animationDuration: RM ? 0 : 1200,
        data: [[cfg.tx0, cfg.slope * cfg.tx0 + cfg.intercept], [cfg.tx1, cfg.slope * cfg.tx1 + cfg.intercept]],
        lineStyle: { color: cfg.trendColor, width: 2, type: 'dashed', opacity: .6 },
        markPoint: { symbol: 'circle', symbolSize: 1, silent: true, animationDelay: RM ? 0 : 1300, label: { color: cfg.trendColor, fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 500, backgroundColor: 'rgba(12,22,11,.9)', borderColor: cfg.trendColor, borderWidth: 1, borderRadius: 6, padding: [5, 9], formatter: cfg.rText }, data: [{ coord: cfg.rPos }] } },
      { name: 'powiaty', type: 'scatter', z: 2, data: regularData, silent: false, symbolSize: d => Math.max(5, Math.min(22, d[2])),
        itemStyle: dotStyle, emphasis: { scale: 1.2, itemStyle: { borderColor: 'rgba(166,232,74,.5)', borderWidth: 1, shadowBlur: 10, shadowColor: 'rgba(132,195,65,.25)' } } },
      { name: 'hero-pts', type: 'scatter', z: 3, data: heroData, silent: false, symbolSize: d => Math.max(5, Math.min(22, d[2])),
        itemStyle: dotStyle,
        emphasis: { scale: 1.35, itemStyle: { borderColor: 'rgba(166,232,74,.8)', borderWidth: 1.5, shadowBlur: 18, shadowColor: 'rgba(166,232,74,.35)' } },
        markPoint: { symbol: 'circle', symbolSize: 1, silent: true, animationDelay: RM ? 0 : 1450, label: { color: '#eef3e6', fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 500, backgroundColor: 'rgba(12,22,11,.85)', borderColor: 'rgba(140,200,80,.3)', borderWidth: 1, borderRadius: 4, padding: [4, 9], formatter: p => p.data.txt }, data: cfg.heroes } }
    ]
  });
  window.addEventListener('resize', debounce(() => chart.resize()));
}

function buildBar(cfg) {
  const node = document.getElementById(cfg.el); if (!node) return;
  const chart = echartsInit(node, null, { renderer: 'canvas' });
  chart.setOption({
    backgroundColor: 'transparent',
    animationDuration: RM ? 0 : 1100, animationEasing: 'cubicOut', animationDelay: RM ? 0 : (i => i * 180),
    grid: { left: cfg.left || 158, right: 54, top: 6, bottom: 24 },
    tooltip: { backgroundColor: '#0c160b', borderColor: 'rgba(140,200,80,.3)', borderWidth: 1, textStyle: { color: '#eef3e6', fontFamily: 'IBM Plex Sans' }, formatter: p => p.name + '<br><b>' + p.value.toFixed(3) + '</b> sklepu / 1000 mieszk.' },
    xAxis: { type: 'value', max: 0.45, axisLabel: { color: '#93a487', fontFamily: 'JetBrains Mono', fontSize: 10 }, axisLine: { show: false }, splitLine: { lineStyle: { color: 'rgba(140,200,80,.06)' } } },
    yAxis: { type: 'category', data: cfg.cats, inverse: true, axisLabel: { color: '#eef3e6', fontFamily: 'IBM Plex Sans', fontSize: 10 }, axisLine: { lineStyle: { color: 'rgba(140,200,80,.2)' } }, axisTick: { show: false } },
    series: [{ type: 'bar', barWidth: '48%', data: cfg.vals.map((v, i) => ({ value: v, itemStyle: { color: cfg.cols[i], borderRadius: [0, 4, 4, 0] } })), label: { show: true, position: 'right', color: '#eef3e6', fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 500, formatter: p => p.value.toFixed(3) } }]
  });
  window.addEventListener('resize', debounce(() => chart.resize()));
}

function _setDC(id, v) { const el = document.getElementById(id); if (el && v != null) el.dataset.count = v; }
function _setTxt(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }

function _updateEconFacts() {
  const all = M.powiat_economics || [];
  const pc = M.per_capita || [];
  const allStores = all.reduce((s, r) => s + (r.stores || 0), 0);

  // Salary chapter facts
  const rowsS = all.filter(d => d.avg_salary > 0 && d.per_1k > 0);

  if (rowsS.length >= 8) {
    const ss = [...rowsS].sort((a, b) => a.avg_salary - b.avg_salary);
    const q = Math.floor(ss.length / 4);
    const q1avg = ss.slice(0, q).reduce((s, r) => s + r.per_1k, 0) / q;
    const q4avg = ss.slice(ss.length - q).reduce((s, r) => s + r.per_1k, 0) / q;
    if (q1avg > 0) _setDC('ec-fact-ratio-num', (q4avg / q1avg).toFixed(1));
    // share of the whole network that sits in the richest salary quartile
    if (allStores > 0) {
      const richShare = ss.slice(ss.length - q).reduce((s, r) => s + (r.stores || 0), 0) / allStores * 100;
      _setDC('ec-fact-rich-share-num', Math.round(richShare));
    }

    const maxRow = rowsS.reduce((b, r) => r.per_1k > (b ? b.per_1k : 0) ? r : b, null);
    if (maxRow && maxRow.per_1k > 0) {
      const inv = Math.round(1000 / maxRow.per_1k);
      _setDC('ec-fact-record-num', inv);
      _setTxt('ec-fact-record-inv', inv.toLocaleString('pl-PL'));
      _setTxt('ec-fact-record-sub', (maxRow.powiat || '').replace(/^powiat\s+/i, '') + (maxRow.voivodeship ? ' (' + maxRow.voivodeship + ')' : ''));
    }
  }

  if (pc.length >= 2) {
    const pcs = [...pc].filter(r => r.per_1k > 0).sort((a, b) => b.per_1k - a.per_1k);
    const top = pcs[0], bot = pcs[pcs.length - 1];
    if (top && bot && bot.per_1k > 0) {
      const voivRatio = top.per_1k / bot.per_1k;
      _setDC('ec-fact-voiv-num', voivRatio.toFixed(1));
      _setTxt('ec-fact-voiv-sub', top.voivodeship + ' ' + top.per_1k.toFixed(2) + ' vs ' + bot.voivodeship + ' ' + bot.per_1k.toFixed(2));
      // bar fill for salary ratio = salary Q4/Q1 ratio normalized by voivodeship ratio
      if (rowsS.length >= 8) {
        const ss2 = [...rowsS].sort((a, b) => a.avg_salary - b.avg_salary);
        const q2 = Math.floor(ss2.length / 4);
        const q1m = ss2.slice(0, q2).reduce((s, r) => s + r.per_1k, 0) / q2;
        const q4m = ss2.slice(ss2.length - q2).reduce((s, r) => s + r.per_1k, 0) / q2;
        if (q1m > 0) {
          const fill = Math.round(Math.min(98, (q4m / q1m) / voivRatio * 100));
          const barEl = document.getElementById('ec-fact-ratio-bar');
          if (barEl) barEl.dataset.fill = fill;
        }
      }
    }
  }

  // Salary chapter: correlation + richest powiat (fill strip to 6)
  if (rowsS.length >= 8) {
    const rS = pearson(rowsS.map(d => d.avg_salary), rowsS.map(d => d.per_1k));
    _setTxt('ec-fact-r-salary', plr(rS));
    const richRow = rowsS.reduce((b, r) => r.avg_salary > (b ? b.avg_salary : 0) ? r : b, null);
    if (richRow) {
      _setDC('ec-fact-rich-num', richRow.per_1k.toFixed(2));
      _setTxt('ec-fact-rich-sub', cleanPow(richRow.powiat) + ' (' + Math.round(richRow.avg_salary).toLocaleString('pl-PL') + ' zł) – skl./1000');
    }
  }

  // Unemployment chapter facts
  const rowsU = all.filter(d => d.unemployment_rate != null && d.unemployment_rate > 0 && d.per_1k > 0);
  if (rowsU.length >= 8) {
    const su = [...rowsU].sort((a, b) => a.unemployment_rate - b.unemployment_rate);
    const qu = Math.floor(su.length / 4);
    const lowAvg = su.slice(0, qu).reduce((s, r) => s + r.per_1k, 0) / qu;
    const highAvg = su.slice(su.length - qu).reduce((s, r) => s + r.per_1k, 0) / qu;
    if (highAvg > 0) {
      const uRatio = lowAvg / highAvg;
      _setDC('ec-fact-u-ratio-num', uRatio.toFixed(1));
      // bar fill: ratio normalized by max ratio (salary chapter d4 voiv ratio if available, else 3x)
      const maxRatio = 3;
      const barEl = document.getElementById('ec-fact-u-ratio-bar');
      if (barEl) barEl.dataset.fill = Math.round(Math.min(98, uRatio / maxRatio * 100));
    }
    const allPer1k = rowsU.map(r => r.per_1k).sort((a, b) => a - b);
    const natMedian = allPer1k[Math.floor(allPer1k.length / 2)];
    const highQRows = su.slice(su.length - qu);
    const belowPct = Math.round(highQRows.filter(r => r.per_1k < natMedian).length / highQRows.length * 100);
    _setDC('ec-fact-u-below-num', belowPct);

    const maxURow = su[su.length - 1];
    if (maxURow) {
      _setDC('ec-fact-u-max-num', maxURow.unemployment_rate.toFixed(1));
      _setTxt('ec-fact-u-max-sub', (maxURow.powiat || '').replace(/^powiat\s+/i, ''));
      _setTxt('ec-fact-u-max-density', maxURow.per_1k.toFixed(2).replace('.', ','));
    }
    const leski = rowsU.find(r => r.powiat && r.powiat.toLowerCase().includes('leski'));
    if (leski) {
      _setDC('ec-fact-u-leski-num', leski.unemployment_rate.toFixed(1));
      _setTxt('ec-fact-u-leski-sub', (leski.powiat || '').replace(/^powiat\s+/i, '') + ' – a gęstość ' + leski.per_1k.toFixed(2));
    }
    const uMedian = su[Math.floor(su.length / 2)].unemployment_rate;
    _setDC('ec-fact-u-median-num', uMedian.toFixed(1));
    const uHigh10 = rowsU.filter(r => r.unemployment_rate > 10).length;
    _setDC('ec-fact-u-high10-num', uHigh10);

    // strip fillers to 6
    const rU = pearson(rowsU.map(d => d.unemployment_rate), rowsU.map(d => d.per_1k));
    _setTxt('ec-fact-r-unemp', plr(rU));
    const minURow = su[0];
    if (minURow) {
      _setDC('ec-fact-u-min-num', minURow.unemployment_rate.toFixed(1));
      _setTxt('ec-fact-u-min-sub', cleanPow(minURow.powiat) + ' – najniższy w kraju');
    }
    // share of the whole network sitting in the calmest / toughest labour-market quartile
    if (allStores > 0) {
      _setDC('ec-fact-u-lowshare-num', Math.round(su.slice(0, qu).reduce((s, r) => s + (r.stores || 0), 0) / allStores * 100));
      _setDC('ec-fact-u-highshare-num', Math.round(su.slice(su.length - qu).reduce((s, r) => s + (r.stores || 0), 0) / allStores * 100));
    }
    if (lowAvg > 0) _setDC('ec-fact-u-q1dens-num', lowAvg.toFixed(2));
    if (highAvg > 0) _setDC('ec-fact-u-q4dens-num', highAvg.toFixed(2));
  }
}

let _econDone = false;
export function renderEcon() {
  const root = document.getElementById('ec-root'); if (!root) return;
  _updateEconFacts();

  // ---- animations scoped to .ec ----
  const obsR = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obsR.unobserve(e.target); } }), { threshold: .16 });
  root.querySelectorAll('.ec-reveal').forEach(r => obsR.observe(r));
  wireCountUp(root);
  const obsF = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { e.target.style.width = e.target.dataset.fill + '%'; obsF.unobserve(e.target); } }), { threshold: .6 });
  root.querySelectorAll('[data-fill]').forEach(el => obsF.observe(el));
  if (_econDone) return;   // charts only once
  _econDone = true;

  const all = M.powiat_economics || [];
  const rowsS = all.filter(d => d.avg_salary > 0 && d.per_1k > 0);
  const rowsU = all.filter(d => d.unemployment_rate != null && d.per_1k > 0);

  // ---- correlations + regression from real data ----
  const r1 = pearson(rowsS.map(d => d.avg_salary), rowsS.map(d => d.per_1k));
  const reg1 = linreg(rowsS.map(d => d.avg_salary), rowsS.map(d => d.per_1k));
  const r2 = pearson(rowsU.map(d => d.unemployment_rate), rowsU.map(d => d.per_1k));
  const reg2 = linreg(rowsU.map(d => d.unemployment_rate), rowsU.map(d => d.per_1k));
  const ymax = Math.min(1.05, Math.max(...all.map(d => d.per_1k || 0)) * 1.08);
  const sMin = Math.min(...rowsS.map(d => d.avg_salary));
  const sMax = Math.max(...rowsS.map(d => d.avg_salary));
  const uMin = Math.min(...rowsU.map(d => d.unemployment_rate));
  const uMax = Math.max(...rowsU.map(d => d.unemployment_rate));
  const heroSpecsS = [
    { match: 'kamieńsk', label: 'kamienski · kurort',  color: '#a6e84a', pos: 'top', off: [0, -10] },
    { match: 'tatrza',   label: 'tatrzanski · Zakopane', color: '#a6e84a', pos: 'bottom', off: [0, 8] },
    { match: 'warszawa', label: 'Warszawa',              color: '#eef3e6', pos: 'right' },
    { match: 'lubińsk',  label: 'lubinski · najbogatszy', color: '#f2a359', pos: 'top', off: [-20, -10] },
  ];
  const heroSpecsU = [
    { match: 'szydłowieck', label: 'szydłowiecki', color: '#e8693d', pos: 'top', off: [0, -10] },
    { match: 'poznański',   label: 'poznański',    color: '#84c341', pos: 'right' },
  ];
  const ptsS = sampleWithHeroes(rowsS, 30, 'avg_salary',        heroSpecsS);
  const ptsU = sampleWithHeroes(rowsU, 30, 'unemployment_rate', heroSpecsU);
  buildScatter({
    el: 'scatter1', pts: ptsS, xkey: 'avg_salary',
    xname: 'średnia płaca (zł)', xmin: Math.floor(sMin / 500) * 500, xmax: Math.ceil(sMax / 500) * 500,
    xfmt: v => (v / 1000) + 'k', ymax,
    vmMin: sMin, vmMax: sMax, colors: ['#4dd0b1', '#84c341', '#a6e84a', '#f2a359'],
    slope: reg1.slope, intercept: reg1.intercept, tx0: sMin, tx1: sMax,
    trendColor: '#a6e84a', rText: 'r = ' + plr(r1), rPos: [sMax * 0.88, (ymax * 0.9)],
    heroes: heroPoints(rowsS, 'avg_salary', heroSpecsS), heroSpecs: heroSpecsS,
  });
  buildScatter({
    el: 'scatter2', pts: ptsU, xkey: 'unemployment_rate',
    xname: 'stopa bezrobocia (%)', xmin: 0, xmax: Math.ceil(uMax / 2) * 2 + 1, xfmt: v => v + '%', ymax,
    vmMin: uMin, vmMax: uMax, colors: ['#84c341', '#a6e84a', '#f2a359', '#e8693d'],
    slope: reg2.slope, intercept: reg2.intercept, tx0: uMin, tx1: uMax,
    trendColor: '#e8693d', rText: 'r = ' + plr(r2), rPos: [uMax * 0.78, (ymax * 0.9)],
    heroes: heroPoints(rowsU, 'unemployment_rate', heroSpecsU), heroSpecs: heroSpecsU,
  });

  // ---- quartile bars from real data ----
  const q1 = quartileMeans(rowsS, 'avg_salary', 'per_1k');
  buildBar({ el: 'bar1', left: 155, cats: ['Q1 – najniższe zarobki', 'Q2 – niższe zarobki', 'Q3 – wyższe zarobki', 'Q4 – najwyższe zarobki'], vals: q1, cols: ['#4dd0b1', '#84c341', '#a6e84a', '#f2a359'] });
  const q2 = quartileMeans(rowsU, 'unemployment_rate', 'per_1k');
  buildBar({ el: 'bar2', left: 155, cats: ['Q1 – niskie bezrobocie', 'Q2 – umiarkowane', 'Q3 – podwyższone', 'Q4 – wysokie bezrobocie'], vals: q2, cols: ['#84c341', '#a6e84a', '#f2a359', '#e8693d'] });
}
