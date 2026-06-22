// "Punkt po punkcie": ECharts log-log scatter — gestość Zabek vs obserwacje plazow.
// Hardcoded 165-point curated sample (SCPTS); prefers M.amphibian_extremes.scatter_sample if present.
// Scoped to #zz-plazy-root / .zz-* to avoid collisions with existing plazy.js charts.
import * as echarts from 'echarts';
import { M } from '../state.js';

const RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;

// 165-point curated sample: d = Zabki in 5km, o = amphibian observations in 5km
const SCPTS = [
  {d:17,o:11},{d:38,o:7},{d:31,o:11},{d:49,o:11},{d:113,o:9},{d:14,o:6},{d:61,o:38},
  {d:198,o:41},{d:4,o:9},{d:36,o:10},{d:52,o:4},{d:5,o:5},{d:54,o:40},{d:21,o:78},
  {d:4,o:12},{d:88,o:21},{d:295,o:58},{d:89,o:80},{d:1,o:8},{d:15,o:1},{d:8,o:4},
  {d:270,o:159},{d:18,o:5},{d:3,o:14},{d:36,o:11},{d:7,o:3},{d:23,o:5},{d:19,o:3},
  {d:161,o:51},{d:57,o:4},{d:297,o:223},{d:26,o:8},{d:313,o:125},{d:51,o:128},
  {d:313,o:165},{d:188,o:38},{d:353,o:26},{d:10,o:5},{d:280,o:178},{d:3,o:11},
  {d:107,o:19},{d:1,o:12},{d:7,o:6},{d:77,o:37},{d:36,o:9},{d:80,o:29},{d:90,o:3},
  {d:13,o:22},{d:6,o:9},{d:259,o:2010},{d:11,o:2},{d:455,o:87},{d:30,o:11},{d:18,o:3},
  {d:112,o:23},{d:13,o:13},{d:38,o:7},{d:81,o:89},{d:13,o:1},{d:116,o:25},{d:79,o:20},
  {d:28,o:30},{d:52,o:9},{d:29,o:22},{d:223,o:179},{d:84,o:112},{d:19,o:7},
  {d:381,o:71},{d:15,o:14},{d:445,o:71},{d:42,o:22},{d:58,o:14},{d:118,o:120},
  {d:356,o:220},{d:41,o:1},{d:313,o:2022},{d:90,o:33},{d:47,o:34},{d:173,o:136},
  {d:6,o:11},{d:37,o:15},{d:3,o:1},{d:51,o:14},{d:14,o:13},{d:105,o:101},
  {d:103,o:7},{d:8,o:4},{d:67,o:36},{d:6,o:2},{d:4,o:24},{d:13,o:18},{d:262,o:83},
  {d:358,o:20},{d:126,o:18},{d:21,o:222},{d:13,o:13},{d:426,o:67},{d:115,o:60},
  {d:361,o:26},{d:4,o:1},{d:425,o:74},{d:345,o:238},{d:209,o:128},{d:68,o:11},
  {d:32,o:10},{d:38,o:43},{d:100,o:1},{d:3,o:7},{d:102,o:39},{d:17,o:12},
  {d:26,o:9},{d:182,o:38},{d:171,o:62},{d:7,o:13},{d:9,o:3},{d:26,o:14},
  {d:169,o:68},{d:116,o:14},{d:20,o:13},{d:79,o:33},{d:180,o:2023},{d:1,o:6},
  {d:5,o:21},{d:365,o:208},{d:165,o:34},{d:64,o:40},{d:11,o:14},{d:50,o:5},
  {d:9,o:3},{d:7,o:6},{d:402,o:74},{d:315,o:158},{d:265,o:57},{d:105,o:33},
  {d:58,o:12},{d:110,o:25},{d:22,o:454},{d:1,o:5},{d:104,o:19},{d:116,o:21},
  {d:60,o:14},{d:78,o:100},{d:124,o:98},{d:154,o:80},{d:173,o:34},{d:7,o:6},
  {d:9,o:3},{d:365,o:26},{d:354,o:222},{d:124,o:5},{d:93,o:15},{d:52,o:15},
  {d:18,o:4},{d:37,o:11},{d:14,o:63},{d:1,o:6},{d:62,o:10},{d:45,o:6},
  {d:309,o:60},{d:121,o:14},{d:106,o:41},{d:26,o:4},{d:242,o:53},{d:116,o:20},
  {d:58,o:30},{d:286,o:2029},
];

let _zzDone = false;

export function renderPlazyExt() {
  if (_zzDone) return;
  _zzDone = true;

  // Reveal animation for .zz-reveal elements
  const obs = new IntersectionObserver(es => {
    es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } });
  }, { threshold: 0.08 });
  document.querySelectorAll('#zz-plazy-root .zz-reveal').forEach(el => obs.observe(el));

  // Lazy-init scatter on intersection
  const cardEl = document.getElementById('zz-card-scatter');
  if (!cardEl) return;
  new IntersectionObserver((es, o) => {
    es.forEach(e => { if (e.isIntersecting) { o.unobserve(e.target); buildScatter(); } });
  }, { threshold: 0.2 }).observe(cardEl);
}

function buildScatter() {
  const el = document.getElementById('zz-scatter');
  if (!el || el.dataset.init) return;
  el.dataset.init = '1';

  // Prefer live API data if the backend provides scatter_sample; fall back to curated SCPTS
  const sample = M.amphibian_extremes && M.amphibian_extremes.scatter_sample;
  const pts = (sample && sample.length)
    ? sample.filter(p => p[0] > 0 && p[1] > 0).map(p => ({ value: [p[0], p[1]] }))
    : SCPTS.map(p => ({ value: [p.d, p.o] }));

  const ch = echarts.init(el);
  // Power-law trend: y = 10^(0.533 * log10(x) + 0.371)
  const tf = x => Math.pow(10, 0.533 * Math.log10(x) + 0.371);
  const axisC = '#93a487', mono = 'JetBrains Mono', splitC = 'rgba(140,200,80,.06)';

  ch.setOption({
    backgroundColor: 'transparent',
    animationDuration: RM ? 0 : 900,
    animationEasing: 'cubicOut',
    animationDelay: RM ? 0 : (i => i * 4),
    grid: { left: 64, right: 24, top: 24, bottom: 54 },
    tooltip: {
      backgroundColor: '#0c160b',
      borderColor: 'rgba(140,200,80,.3)',
      borderWidth: 1,
      textStyle: { color: '#eef3e6' },
      formatter: p => {
        if (p.seriesName === 'trend') return '';
        const v = p.value;
        return '<b>' + v[0] + '</b> Żabek w 5 km<br><b>' + v[1].toLocaleString('pl-PL') + '</b> obserwacji płazów';
      },
    },
    xAxis: {
      type: 'log', min: 1, max: 500,
      name: 'liczba Żabek w promieniu 5 km', nameLocation: 'middle', nameGap: 34,
      nameTextStyle: { color: '#5d6c52', fontFamily: mono, fontSize: 11 },
      axisLabel: { color: axisC, fontFamily: mono, fontSize: 11 },
      axisLine: { lineStyle: { color: 'rgba(140,200,80,.2)' } },
      splitLine: { lineStyle: { color: splitC } },
    },
    yAxis: {
      type: 'log', min: 1, max: 3000,
      name: 'obserwacje płazów w 5 km', nameLocation: 'middle', nameGap: 46, nameRotate: 90,
      nameTextStyle: { color: '#5d6c52', fontFamily: mono, fontSize: 11 },
      axisLabel: { color: axisC, fontFamily: mono, fontSize: 11 },
      axisLine: { lineStyle: { color: 'rgba(140,200,80,.2)' } },
      splitLine: { lineStyle: { color: splitC } },
    },
    series: [
      {
        name: 'trend',
        type: 'line',
        showSymbol: false,
        silent: true,
        z: 1,
        animationDelay: RM ? 0 : 1000,
        animationDuration: RM ? 0 : 1200,
        data: [[1, tf(1)], [5, tf(5)], [20, tf(20)], [80, tf(80)], [300, tf(300)], [500, tf(500)]],
        lineStyle: { color: '#a6e84a', width: 2, type: 'dashed', opacity: .6 },
        markPoint: {
          symbol: 'circle', symbolSize: 1, silent: true,
          animationDelay: RM ? 0 : 1300,
          label: {
            color: '#a6e84a', fontFamily: mono, fontSize: 13, fontWeight: 500,
            backgroundColor: 'rgba(12,22,11,.9)',
            borderColor: '#a6e84a', borderWidth: 1, borderRadius: 6, padding: [5, 9],
            formatter: 'rho = +0,67',
          },
          data: [{ coord: [3.0, 900] }],
        },
      },
      {
        name: 'Zabki',
        type: 'scatter',
        z: 2,
        data: pts,
        symbolSize: 8,
        itemStyle: { color: '#84c341', opacity: .55, borderColor: 'rgba(10,18,10,.5)', borderWidth: .5 },
        emphasis: { itemStyle: { color: '#a6e84a', opacity: 1, borderColor: '#eef3e6', borderWidth: 1 } },
        markPoint: {
          symbol: 'circle', symbolSize: 1, silent: true,
          animationDelay: RM ? 0 : 1450,
          label: {
            color: '#eef3e6', fontFamily: mono, fontSize: 11, fontWeight: 500,
            backgroundColor: 'rgba(12,22,11,.85)',
            borderColor: 'rgba(242,163,89,.5)', borderWidth: 1, borderRadius: 6, padding: [4, 7],
            formatter: p => p.data.txt,
          },
          data: [{ coord: [286, 2029], txt: 'Warszawa · 2029 rek.', label: { color: '#f2a359', position: 'left', offset: [-6, 0] } }],
        },
      },
    ],
  });

  window.addEventListener('resize', () => ch.resize());
}
