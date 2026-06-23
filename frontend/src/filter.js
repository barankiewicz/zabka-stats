import { STATE } from './config.js';
import { M, CHARTS, RENDERED } from './state.js';
import { fmt, macroCol } from './utils.js';

let _renderKPI = null;
let _renderGranular = null;
let _renderDumbbell = null;

// Null-safe merge: tab modules load lazily, so each registers its own callback
// when its chunk arrives without clobbering the ones already set.
export function registerFilterCallbacks(kpi, granular, dumbbell) {
  if (kpi) _renderKPI = kpi;
  if (granular) _renderGranular = granular;
  if (dumbbell) _renderDumbbell = dumbbell;
}

export function setFilter(v){
  STATE.filter=v;
  const bar=document.getElementById('filter-bar');
  const chip=document.getElementById('filter-chip-text');
  if(v){bar.style.display='flex';chip.textContent='Filtruj: '+v}
  else{bar.style.display='none'}
  refreshKpiFiltered();
  if(RENDERED.has('siec')&&_renderGranular)_renderGranular(true);
  if(RENDERED.has('spoleczenstwo')){highlightMerrychef();highlightDumbbell()}
}

export function clearFilter(){setFilter(null)}

export function refreshKpiFiltered(){
  if(!STATE.filter){if(_renderKPI)_renderKPI();return}
  // header KPI tiles were removed; nothing to update here (charts still react)
  if(!document.getElementById('kpi-stores'))return;
  const v=STATE.filter.toLowerCase();
  const woj=M.voivodeship_merrychef&&M.voivodeship_merrychef.find(d=>d.voivodeship&&d.voivodeship.toLowerCase()===v);
  const pc=M.per_capita&&M.per_capita.find(d=>d.voivodeship&&d.voivodeship.toLowerCase()===v);
  const total=pc?pc.count:(woj?woj.total:0);
  document.getElementById('kpi-stores').textContent=fmt(total);
  document.getElementById('kpi-cities').textContent='–';
  if(woj){
    document.getElementById('kpi-mc').textContent=woj.mc_pct+'%';
    const sunPct=woj.open_sunday&&woj.total?Math.round(woj.open_sunday/woj.total*1000)/10:'–';
    document.getElementById('kpi-sun').textContent=typeof sunPct==='number'?sunPct+'%':sunPct;
    document.getElementById('kpi-h24').textContent=woj.h24||0;
  }
}

export function highlightPerCapita(){
  const ch=CHARTS['per-capita'];if(!ch)return;
  const v=STATE.filter;
  ch.data.datasets[0].backgroundColor=ch.data.labels.map((l,i)=>{
    const base=macroCol(M.per_capita[i]?M.per_capita[i].voivodeship:l);
    return(!v||l.toLowerCase()===v.toLowerCase())?base:base.replace(/[^,]+\)$/,'0.25)');
  });
  ch.update('none');
}

export function highlightMerrychef(){
  const ch=CHARTS['merrychef'];if(!ch)return;
  const v=STATE.filter;
  const data=ch.data.labels;
  ch.data.datasets[0].backgroundColor=data.map(l=>{
    const woj=M.voivodeship_merrychef.find(d=>d.voivodeship===l);
    const base=woj&&(woj.voivodeship.toLowerCase().includes('dolno')||woj.mc_pct<93)?'#f2a359':'#84c34199';
    return(!v||l.toLowerCase()===v.toLowerCase())?base:base+'44';
  });
  ch.update('none');
}

export function highlightDumbbell(){
  if(_renderDumbbell)_renderDumbbell();
}
