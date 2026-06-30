// Named imports so Rollup tree-shakes d3 down to the handful of modules this
// chart actually touches (selection, zoom, drag, force, scale) instead of
// bundling the whole d3 meta-package.
import {
  select, zoom, zoomIdentity, drag, extent, scaleSqrt,
  forceSimulation, forceX, forceY, forceCollide,
  transition as _ensureTransition,
} from 'd3';
// `transition` is imported only for its side effect: d3-transition patches
// selection.prototype.transition, which _svg.transition() relies on below.
// Reference it so the named import is not tree-shaken away.
void _ensureTransition;
import { C } from '../config.js';

// Force-directed "volumetric" bubble chart of the network (one bubble per
// powiat/miasto, size = store count, plus a "Pozostałe" bubble for the tail).
// Ported from test/READY_CHART_1.html: same behaviour (drag, ctrl+scroll zoom,
// remainder node) but cleaned visuals — label halos via paint-order stroke
// instead of blurry text-shadows, and no drop-shadow glow on the remainder —
// and wired to real /api/stats/by-dimension data instead of the mock.

const MAX_BUBBLES = 60;
const UNIT_PL = { powiat: 'powiatów', city: 'miast', voivodeship: 'województw' };
const FP_STOPS=['#103d1d','#1d5a28','#2f7d2e','#5aa82e','#84c341','#a6e84a','#c8f06a'];
function fpRamp(t){
  t=Math.max(0,Math.min(1,t));
  const seg=t*(FP_STOPS.length-1),i=Math.min(FP_STOPS.length-2,Math.floor(seg)),u=seg-i;
  const h=k=>[parseInt(k.slice(1,3),16),parseInt(k.slice(3,5),16),parseInt(k.slice(5,7),16)];
  const a=h(FP_STOPS[i]),b=h(FP_STOPS[i+1]);
  return`rgb(${Math.round(a[0]+(b[0]-a[0])*u)},${Math.round(a[1]+(b[1]-a[1])*u)},${Math.round(a[2]+(b[2]-a[2])*u)})`;
}

let _dim = 'city';
let _svg = null, _group = null, _sim = null, _zoom = null, _transform = zoomIdentity;
let _wired = false;
const _cache = new Map();

function fetchBubble(dim) {
  if (_cache.has(dim)) return _cache.get(dim);
  const p = fetch(`/api/stats/by-dimension?dim=${dim}&metric=count&sort=desc&limit=${MAX_BUBBLES}`)
    .then(r => r.json()).catch(() => ({ rows: [], total: 0, sum: 0 }));
  _cache.set(dim, p);
  return p;
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
    nodes.push({ id: 'REMAINDER', name: 'Pozostałe', value: remSum / 1.6,
      cnt: remSum, isRemainder: true, remCount, remSum });
  }
  return nodes;
}

export async function renderBubble() {
  const stage = document.getElementById('bubble-stage');
  if (!stage) return;
  if (!_svg) {
    _svg = select(stage).append('svg');
    _group = _svg.append('g');
    _zoom = zoom().scaleExtent([0.3, 6])
      .wheelDelta((e) => -e.deltaY * 0.0008)
      .filter(e => e.type !== 'wheel' || e.ctrlKey)
      .on('zoom', e => { _transform = e.transform; _group.attr('transform', e.transform); });
    _svg.call(_zoom);
    if (!_wired) { _wired = true; window.addEventListener('resize', () => { if (_sim) _sim.alpha(0.2).restart(); }); }
  }
  draw(await fetchBubble(_dim), stage);
}

function draw(res, stage) {
  const w = stage.clientWidth || 1000, h = stage.clientHeight || 520;
  _svg.attr('width', w).attr('height', h);
  _svg.transition().duration(350).call(_zoom.transform, zoomIdentity);
  _transform = zoomIdentity;

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
    .style('font-size', d => d.isRemainder ? '13px' : Math.min(14, Math.max(9, r(d.value) / 3.6)) + 'px');

  all.select('text.b-sub')
    .classed('bright', d => d.isRemainder)
    .text(d => d.isRemainder ? `${d.remCount} ${UNIT_PL[_dim] || ''}` : d.cnt)
    .attr('dy', d => d.isRemainder ? '0.5em' : '1.15em')
    .style('font-size', d => d.isRemainder ? '10px' : Math.min(11, Math.max(8, r(d.value) / 4.6)) + 'px');

  all.select('text.b-sub2')
    .text(d => d.isRemainder ? `Σ ${d.remSum.toLocaleString('pl-PL')}` : '')
    .attr('dy', '1.7em')
    .style('display', d => d.isRemainder ? 'block' : 'none');

  _sim = forceSimulation(nodes)
    .force('x', forceX(w / 2).strength(0.07))
    .force('y', forceY(h / 2).strength(0.07))
    .force('collide', forceCollide(d => rad(d) + 2.5).iterations(4))
    .alphaDecay(0.018)
    .on('tick', () => all.attr('transform', d => `translate(${d.x},${d.y})`));

  function dstart(e, d) { if (!e.active) _sim.alphaTarget(0.12).restart(); d.fx = d.x; d.fy = d.y; }
  function ddrag(e, d) {
    const rect = stage.getBoundingClientRect();
    const p = _transform.invert([e.sourceEvent.clientX - rect.left, e.sourceEvent.clientY - rect.top]);
    d.fx = p[0]; d.fy = p[1];
  }
  function dend(e, d) { if (!e.active) _sim.alphaTarget(0); d.fx = null; d.fy = null; }
}


