import Chart from 'chart.js/auto';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { annotPlugin, barValueLabels, C, STATE } from './config.js';
import { M, CHARTS, MAPS, RENDERED } from './state.js';
import { getFont, destroyChart } from './utils.js';
import { setFilter, clearFilter, registerFilterCallbacks } from './filter.js';
import { loadData } from './data.js';
import { renderSiec, renderGranular } from './tabs/siec.js';
import { renderSpoleczenstwo, renderDumbbellByLevel, wireInpostLevel } from './tabs/spoleczenstwo.js';
import { renderEdge, jumpToFact, jumpBack, jumpToH24, jumpToParks } from './tabs/edge.js';
import { renderPlazy } from './tabs/plazy.js';

Chart.register(annotPlugin);
Chart.register(barValueLabels);

// flip to false to hide all chart/map id labels
const DEBUG_SHOW_IDS = true;

function initIdOverlays(){
  document.body.classList.toggle('debug-ids',DEBUG_SHOW_IDS);
}

function chartDefaults(){
  Chart.defaults.color=C.muted;
  Chart.defaults.borderColor=C.axis;
  Chart.defaults.font.family=`'${getFont('body')}',sans-serif`;
  Chart.defaults.font.size=12;
}
chartDefaults();

export function renderKPI(){
  const s=M.summary;if(!s)return;
  // header KPI strip was removed; the hero count-up now carries the headline
  // total. Guard so the cross-filter callback is a no-op when the tiles are gone.
  if(!document.getElementById('kpi-stores'))return;
  document.getElementById('kpi-stores').textContent=(+s.total_active).toLocaleString('pl-PL');
  document.getElementById('kpi-cities').textContent=(+s.cities_count).toLocaleString('pl-PL');
  document.getElementById('kpi-mc').textContent=s.merrychef_pct+'%';
  document.getElementById('kpi-sun').textContent=s.sunday_pct+'%';
  document.getElementById('kpi-h24').textContent=(+s.h24_count).toLocaleString('pl-PL');
}

registerFilterCallbacks(renderKPI, renderGranular, renderDumbbellByLevel);

function revealAll(){document.querySelectorAll('.reveal').forEach((el,i)=>setTimeout(()=>el.classList.add('shown'),80+i*50))}
setTimeout(revealAll,100);

function resetTabReveals(tabEl){
  const revEls=Array.from(tabEl.querySelectorAll('[class*="-reveal"]'));
  const showEls=Array.from(tabEl.querySelectorAll('.reveal'));
  revEls.forEach(el=>el.classList.remove('in'));
  showEls.forEach(el=>el.classList.remove('shown'));
  requestAnimationFrame(()=>{
    const obs=new IntersectionObserver((entries)=>{
      entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');obs.unobserve(e.target);}});
    },{threshold:.12});
    revEls.forEach(el=>obs.observe(el));
    showEls.forEach((el,i)=>setTimeout(()=>el.classList.add('shown'),60+i*50));
  });
}

function renderTab(tab){
  if(tab==='siec')renderSiec();
  if(tab==='spoleczenstwo')renderSpoleczenstwo();
  if(tab==='edge')renderEdge();
  if(tab==='plazy')renderPlazy();
  setTimeout(initIdOverlays,300);
}

document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    const tab=btn.dataset.tab;
    const tabEl=document.getElementById('tab-'+tab);
    tabEl.classList.add('active');
    STATE.tab=tab;
    resetTabReveals(tabEl);
    if(!RENDERED.has(tab)){RENDERED.add(tab);setTimeout(()=>renderTab(tab),60)}
    setTimeout(()=>Object.values(MAPS).forEach(m=>m&&m.invalidateSize&&m.invalidateSize()),200);
  });
});

document.addEventListener('DOMContentLoaded',()=>{
  const btn=document.getElementById('filter-clear');if(btn)btn.addEventListener('click',clearFilter);
});

// expose functions called from inline onclick handlers in HTML
window.jumpToFact = jumpToFact;
window.jumpBack = jumpBack;
window.jumpToH24 = jumpToH24;
window.jumpToParks = jumpToParks;

RENDERED.add('spoleczenstwo');
loadData()
  .then(()=>{renderKPI();setTimeout(()=>{renderSpoleczenstwo();wireInpostLevel();setTimeout(initIdOverlays,300)},120)})
  .catch(err=>console.error('loadData failed:',err));
