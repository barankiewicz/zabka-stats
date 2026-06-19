import Chart from 'chart.js/auto';
import 'leaflet/dist/leaflet.css';
import { annotPlugin, C, STATE } from './config.js';
import { M, CHARTS, MAPS, RENDERED } from './state.js';
import { getFont, destroyChart } from './utils.js';
import { setFilter, clearFilter, registerFilterCallbacks } from './filter.js';
import { loadData } from './data.js';
import { renderSiec, renderTopCities, drawSpiral, drawFingerprint, drawClock } from './tabs/siec.js';
import { renderSpoleczenstwo, renderDumbbell } from './tabs/spoleczenstwo.js';
import { renderEdge, jumpToFact, jumpBack, jumpToH24, jumpToParks, drawH24Mini, drawVoidMini, drawParksDonut } from './tabs/edge.js';
import { renderPlazy, drawBeeswarm } from './tabs/plazy.js';

Chart.register(annotPlugin);

function chartDefaults(){
  Chart.defaults.color=C.muted;
  Chart.defaults.borderColor=C.axis;
  Chart.defaults.font.family=`'${getFont('body')}',sans-serif`;
  Chart.defaults.font.size=12;
}
chartDefaults();

export function renderKPI(){
  const s=M.summary;if(!s)return;
  document.getElementById('kpi-stores').textContent=(+s.total_active).toLocaleString('pl-PL');
  document.getElementById('kpi-cities').textContent=(+s.cities_count).toLocaleString('pl-PL');
  document.getElementById('kpi-mc').textContent=s.merrychef_pct+'%';
  document.getElementById('kpi-sun').textContent=s.sunday_pct+'%';
  document.getElementById('kpi-h24').textContent=(+s.h24_count).toLocaleString('pl-PL');
}

registerFilterCallbacks(renderKPI, renderTopCities, renderDumbbell);

function revealAll(){document.querySelectorAll('.reveal').forEach((el,i)=>setTimeout(()=>el.classList.add('shown'),80+i*50))}
setTimeout(revealAll,100);

function renderTab(tab){
  if(tab==='siec')renderSiec();
  if(tab==='spoleczenstwo')renderSpoleczenstwo();
  if(tab==='edge')renderEdge();
  if(tab==='plazy')renderPlazy();
}

document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    const tab=btn.dataset.tab;
    document.getElementById('tab-'+tab).classList.add('active');
    STATE.tab=tab;
    if(!RENDERED.has(tab)){RENDERED.add(tab);setTimeout(()=>renderTab(tab),60)}
    setTimeout(()=>Object.values(MAPS).forEach(m=>m&&m.invalidateSize&&m.invalidateSize()),200);
  });
});

document.addEventListener('DOMContentLoaded',()=>{
  const btn=document.getElementById('filter-clear');if(btn)btn.addEventListener('click',clearFilter);
});

document.querySelectorAll('.fs-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.fs-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    STATE.font=btn.dataset.font;
    document.documentElement.dataset.font=STATE.font;
    chartDefaults();
    Object.keys(CHARTS).forEach(k=>destroyChart(k));
    RENDERED.forEach(t=>{if(t!==STATE.tab)RENDERED.delete(t)});
    renderTab(STATE.tab);
    setTimeout(()=>{drawSpiral();drawFingerprint();drawClock();
      if(RENDERED.has('edge')){drawH24Mini();drawVoidMini();drawParksDonut()}
      if(RENDERED.has('plazy'))drawBeeswarm();
    },50);
  });
});

const scatSide=document.getElementById('scat-side');
const scatStack=document.getElementById('scat-stack');
if(scatSide&&scatStack){
  scatSide.addEventListener('click',()=>{
    scatSide.classList.add('active');scatStack.classList.remove('active');
    document.getElementById('scatter-container').classList.remove('stacked');
    document.querySelectorAll('#scatter-container .h400').forEach(el=>el.style.height='400px');
  });
  scatStack.addEventListener('click',()=>{
    scatStack.classList.add('active');scatSide.classList.remove('active');
    document.getElementById('scatter-container').classList.add('stacked');
    document.querySelectorAll('#scatter-container .h400').forEach(el=>el.style.height='520px');
    setTimeout(()=>Object.values(CHARTS).forEach(c=>c.resize&&c.resize()),100);
  });
}

// expose functions called from inline onclick handlers in HTML
window.jumpToFact = jumpToFact;
window.jumpBack = jumpBack;
window.jumpToH24 = jumpToH24;
window.jumpToParks = jumpToParks;

RENDERED.add('siec');
loadData()
  .then(()=>{renderKPI();setTimeout(()=>renderSiec(),120)})
  .catch(err=>console.error('loadData failed:',err));
