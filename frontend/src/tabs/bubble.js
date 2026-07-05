// Import the specific d3 submodules this chart uses instead of the `d3`
// meta-package, so the install pulls only these (not d3's ~30 submodules).
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import { drag } from 'd3-drag';
import { extent } from 'd3-array';
import { scaleSqrt } from 'd3-scale';
import { forceSimulation, forceX, forceY, forceCollide } from 'd3-force';
// Side-effect import: d3-transition patches selection.prototype.transition,
// which _svg.transition() relies on below. No named binding needed.
import 'd3-transition';
import { C, fpRamp } from '../config.js';
import { debounce, showChartStatus } from '../utils.js';
import { fetchJSON } from '../data.js';
import { t, getLang } from '../i18n.js';

// Force-directed "volumetric" bubble chart of the network (one bubble per
// powiat/miasto, size = store count, plus a "Pozostałe" bubble for the tail).
// Ported from test/READY_CHART_1.html: same behaviour (drag, ctrl+scroll zoom,
// remainder node) but cleaned visuals — label halos via paint-order stroke
// instead of blurry text-shadows, and no drop-shadow glow on the remainder —
// and wired to real /api/stats/by-dimension data instead of the mock.

const MAX_BUBBLES = 60;
function getUnitLabel(dim) {
  const key = 'gran_word_' + (dim === 'voivodeship' ? 'voivodeship' : dim);
  return t(key);
}
// fpRamp (green fingerprint ramp) is imported from config.js - single source.

let _dim = 'city';
let _svg = null, _group = null, _sim = null, _zoom = null, _transform = zoomIdentity;
let _wired = false;
const _cache = new Map();

async function fetchBubble(dim) {
  if (_cache.has(dim)) return _cache.get(dim);
  try {
    const d = await fetchJSON(`/api/stats/by-dimension?dim=${dim}&metric=count&sort=desc&limit=${MAX_BUBBLES}`);
    _cache.set(dim, d);
    return d;
  } catch(e) {
    console.error('fetchBubble error', e);
    return { rows: [], total: 0, sum: 0 };
  }
}

function cleanName(n) {
  n = String(n || '')
    .replace(/^M\.st\.\s*/i, '')
    .replace(/\s+od\s+\d{4}\s*$/i, '')
    .replace(/^powiat\s+/i, '')
    .trim();
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : n;
}

function process(res) {
  const rows = res.rows || [];
  const total = res.total || rows.length;
  const sum = res.sum || rows.reduce((a, b) => a + (b.cnt || 0), 0);
  const shown = rows.reduce((a, b) => a + (b.cnt || 0), 0);
  const nodes = rows.map((d, i) => ({
    id: d.geo_id != null ? String(d.geo_id) : `${d.name}_${i}`,
    name: cleanName(d.name), value: d.cnt, cnt: d.cnt, isRemainder: false,
  }));
  const remCount = total - rows.length, remSum = sum - shown;
  if (remCount > 0 && remSum > 0) {
    nodes.push({ id: 'REMAINDER', name: t('bucket_others'), value: remSum / 1.6,
      cnt: remSum, isRemainder: true, remCount, remSum });
  }
  return nodes;
}

export async function renderBubble() {
  const stage = document.getElementById('bubble-stage');
  if (!stage) return;
  const res = await fetchBubble(_dim);
  if (res && res._error) {
    showChartStatus(stage, 'error', async () => {
      _cache.delete(_dim);
      showChartStatus(stage, null);
      await renderBubble();
    });
    return;
  }
  const rows = res.rows || [];
  if (!rows.length) {
    showChartStatus(stage, 'empty');
    return;
  }
  showChartStatus(stage, null);

  if (!_svg) {
    _svg = select(stage).append('svg');
    _group = _svg.append('g');
    _zoom = zoom().scaleExtent([0.3, 6])
      .wheelDelta((e) => -e.deltaY * 0.0008)
      .filter(e => e.type !== 'wheel' || e.ctrlKey)
      .on('zoom', e => { _transform = e.transform; _group.attr('transform', e.transform); });
    _svg.call(_zoom);
    if (!_wired) { _wired = true; window.addEventListener('resize', debounce(() => { if (_sim) _sim.alpha(0.2).restart(); })); }
  }
  draw(res, stage);
}

function draw(res, stage) {
  const w = stage.clientWidth || 1000, h = stage.clientHeight || 520;
  _svg.attr('width', w).attr('height', h);
  let initScale = 1.0;
  if (w < 600) {
    initScale = 0.58;
  }
  const initTransform = zoomIdentity.translate((w / 2) * (1 - initScale), (h / 2) * (1 - initScale)).scale(initScale);
  _svg.transition().duration(350).call(_zoom.transform, initTransform);
  _transform = initTransform;

  const nodes = process(res);
  const ext = extent(nodes, d => d.value);
  const r = scaleSqrt().domain([ext[0] || 0, ext[1] || 1]).range([14, 54]);
  nodes.forEach(d => { if (!d.isRemainder) d._rc = fpRamp(Math.random()); });
  const rad = d => d.isRemainder ? Math.max(72, r(d.value)) : r(d.value);

  if (_sim) _sim.stop();

  const g = _group.selectAll('g.bub').data(nodes, d => d.id);
  g.exit().remove();
  const enter = g.enter().append('g').attr('class', 'bub');
  enter.append('circle').attr('class', 'bubble');
  enter.append('text').attr('class', 'b-main');
  enter.append('text').attr('class', 'b-sub');
  enter.append('text').attr('class', 'b-sub2');
  const all = enter.merge(g);

  all.select('circle.bubble')
    .classed('rem', d => d.isRemainder)
    .attr('r', rad)
    .attr('fill', d => d.isRemainder ? 'rgba(15,27,14,.92)' : d._rc)
    .call(drag().on('start', dstart).on('drag', ddrag).on('end', dend));

  all.select('text.b-main')
    .text(d => d.name)
    .attr('dy', d => d.isRemainder ? '-0.6em' : '-0.25em')
    .style('font-size', d => d.isRemainder ? '14px' : Math.min(15, Math.max(10, r(d.value) / 3.6)) + 'px');

  all.select('text.b-sub')
    .classed('bright', d => d.isRemainder)
    .text(d => {
      const loc = getLang() === 'en' ? 'en-US' : 'pl-PL';
      return d.isRemainder
        ? `${d.remCount.toLocaleString(loc)} ${getUnitLabel(_dim)}`
        : d.cnt.toLocaleString(loc);
    })
    .attr('dy', d => d.isRemainder ? '0.5em' : '1.15em')
    .style('font-size', d => d.isRemainder ? '11px' : Math.min(12, Math.max(9, r(d.value) / 4.6)) + 'px');

  all.select('text.b-sub2')
    .text(d => d.isRemainder ? `Σ ${d.remSum.toLocaleString(getLang() === 'en' ? 'en-US' : 'pl-PL')}` : '')
    .attr('dy', '1.7em')
    .style('display', d => d.isRemainder ? 'block' : 'none');

  _sim = forceSimulation(nodes)
    .force('x', forceX(w / 2).strength(0.07))
    .force('y', forceY(h / 2).strength(0.07))
    .force('collide', forceCollide(d => rad(d) + 2.5).iterations(2))
    .alphaDecay(0.05)
    .on('tick', () => all.attr('transform', d => `translate(${d.x},${d.y})`));

  function dstart(e, d) { if (!e.active) _sim.alphaTarget(0.12).restart(); d.fx = d.x; d.fy = d.y; }
  function ddrag(e, d) {
    const rect = stage.getBoundingClientRect();
    const touch = (e.sourceEvent.touches && e.sourceEvent.touches[0]) || 
                  (e.sourceEvent.changedTouches && e.sourceEvent.changedTouches[0]) || 
                  e.sourceEvent;
    if (touch && touch.clientX != null) {
      const p = _transform.invert([touch.clientX - rect.left, touch.clientY - rect.top]);
      d.fx = p[0]; d.fy = p[1];
    }
  }
  function dend(e, d) { if (!e.active) _sim.alphaTarget(0); d.fx = null; d.fy = null; }
}


