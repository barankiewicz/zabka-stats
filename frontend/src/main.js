import Chart from 'chart.js/auto';
import './style.css';
import { annotPlugin, barValueLabels, C, STATE } from './config.js';
import { M, CHARTS, MAPS, RENDERED } from './state.js';
import { getFont, destroyChart } from './utils.js';
import { setFilter, clearFilter, registerFilterCallbacks } from './filter.js';
import { loadCore, loadTabData } from './data.js';

// Tabs are loaded on demand. Each dynamic import() becomes its own Rollup chunk,
// so the heavy per-tab libs (echarts in econ/kraniec, d3 in the siec
// bubble) stay out of the initial bundle and only ship
// when their tab is first opened.
const TAB_LOADERS = {
  siec:          () => import('./tabs/siec.js'),
  spoleczenstwo: () => import('./tabs/spoleczenstwo.js'),
};
const _mods = {};
function tabModule(tab) {
  if (!_mods[tab]) _mods[tab] = TAB_LOADERS[tab]();
  return _mods[tab];
}

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

// renderGranular (siec) and renderDumbbellByLevel (spoleczenstwo) register
// themselves when their tab module loads; only the KPI callback is local.
registerFilterCallbacks(renderKPI, null, null);

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

async function renderTab(tab){
  try {
    await loadTabData(tab);          // fetch this tab's endpoints (cached after first open)
    const mod = await tabModule(tab); // download + parse this tab's chunk
    if(tab==='siec'){
      registerFilterCallbacks(null, mod.renderGranular, null);
      mod.renderSiec();
    } else if(tab==='spoleczenstwo'){
      registerFilterCallbacks(null, null, mod.renderDumbbellByLevel);
      mod.renderSpoleczenstwo();
      mod.wireInpostLevel();
    }
  } catch(err){
    console.error(`renderTab(${tab}) failed:`, err);
    return;
  }
  setTimeout(initIdOverlays,300);
}

document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-selected','false');});
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected','true');
    const tab=btn.dataset.tab;
    const tabEl=document.getElementById('tab-'+tab);
    window.scrollTo({top:0,behavior:'instant'});
    tabEl.classList.add('active');
    STATE.tab=tab;
    resetTabReveals(tabEl);
    if(!RENDERED.has(tab)){RENDERED.add(tab);setTimeout(()=>renderTab(tab),60)}
    setTimeout(()=>Object.values(MAPS).forEach(m=>m&&(m.resize&&m.resize())),200);
  });
});

document.addEventListener('DOMContentLoaded',()=>{
  const btn=document.getElementById('filter-clear');if(btn)btn.addEventListener('click',clearFilter);
});

// SIEC is the default tab. loadCore() fetches only what SIEC needs for first
// paint; per-tab heavy payloads (spoleczenstwo economics etc.) load on first click.
RENDERED.add('siec');
loadCore()
  .then(()=>{
    renderKPI();
    setTimeout(()=>{
      renderTab('siec');
      const siecEl=document.getElementById('tab-siec');
      if(siecEl)resetTabReveals(siecEl);
    },120);
  })
  .catch(err=>console.error('loadCore failed:',err));
