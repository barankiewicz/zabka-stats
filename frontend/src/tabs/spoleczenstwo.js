import Chart from 'chart.js/auto';
import L from 'leaflet';
import { C, STATE } from '../config.js';
import { M, CHARTS, MAPS } from '../state.js';
import { fmt, macroCol, getFont, destroyChart, leafletDark, startTabParticles } from '../utils.js';
import { setFilter } from '../filter.js';
import { renderEcon } from './econ.js';


function renderSpolecKPIs(){
  const s=M.summary, pc=M.per_capita||[], dens=M.voivodeship_density||[], iv=M.inpost_vs_zabka||[];

  const set=(id,html)=>{const el=document.getElementById(id);if(el)el.innerHTML=html};

  if(s&&pc.length&&s.total_active){
    const totalPop=pc.reduce((a,r)=>a+(r.population||0),0);
    const perStore=Math.round(totalPop/(+s.total_active));
    set('spol-kpi-residents',`${perStore.toLocaleString('pl-PL')}<span class="stat-unit"> os.</span>`);
  }

  if(dens.length&&s&&s.total_active){
    const totalArea=dens.reduce((a,r)=>a+(r.area_km2||0),0);
    const per100=(+s.total_active)/totalArea*100;
    set('spol-kpi-density',`${per100.toFixed(2).replace('.',',')}<span class="stat-unit">/100km²</span>`);
  }

  const powiats=M.section3_rare&&M.section3_rare.powiats_covered;
  if(powiats){
    set('spol-kpi-powiats',`${powiats}<span class="stat-unit">/381</span>`);
  }

  if(iv.length){
    const totZ=iv.reduce((a,r)=>a+(r.zabki||0),0);
    const totP=iv.reduce((a,r)=>a+(r.paczkomaty||0),0);
    if(totZ){
      const ratio=(totP/totZ).toFixed(2).replace('.',',');
      set('spol-kpi-inpost',`${ratio}<span class="stat-unit">x</span>`);
    }
  }

  if(s&&s.cities_count){
    set('spol-kpi-cities',(+s.cities_count).toLocaleString('pl-PL'));
  }

  const ohArr = Array.isArray(M.opening_hours) ? M.opening_hours : [];
  if(ohArr.length) {
    const ohTotal = ohArr.reduce((s,p) => s+(p.cnt||0), 0);
    const oh23 = ohArr.filter(p => (p.pattern||'').includes('23:')).reduce((s,p) => s+(p.cnt||0), 0);
    if(ohTotal > 0) {
      const pct = Math.round(oh23/ohTotal*1000)/10;
      set('spol-kpi-closed23', `${String(pct).replace('.',',')}<span class="stat-unit">%</span>`);
    }
  }
}

const _IP_STOPS=['#132912','#1e4019','#2d6324','#4a9228','#72c133','#a6e84a'];
function _ipRamp(t){
  t=Math.max(0,Math.min(1,t));
  const seg=t*(_IP_STOPS.length-1),i=Math.min(_IP_STOPS.length-2,Math.floor(seg)),u=seg-i;
  const h=k=>[parseInt(k.slice(1,3),16),parseInt(k.slice(3,5),16),parseInt(k.slice(5,7),16)];
  const a=h(_IP_STOPS[i]),b=h(_IP_STOPS[i+1]);
  return`rgb(${Math.round(a[0]+(b[0]-a[0])*u)},${Math.round(a[1]+(b[1]-a[1])*u)},${Math.round(a[2]+(b[2]-a[2])*u)})`;
}

function renderInpostMap(){
  const data=M.inpost_vs_zabka||[];
  if(!data.length||!M.woj_geo||!M.woj_geo.features||!M.woj_geo.features.length)return;
  if(MAPS['map-inpost'])return;
  const el=document.getElementById('map-inpost');if(!el)return;
  const byName={};
  data.forEach(d=>{byName[(d.voivodeship||'').toLowerCase()]=d});
  const vals=data.map(d=>d.zabki_per_100k||0);
  const vmin=Math.min(...vals),vmax=Math.max(...vals,vmin+0.01);
  function norm(v){return(v-vmin)/(vmax-vmin);}
  function wStyle(d,opacity=0.9){
    return{weight:1,color:'#08110a',
      fillColor:d?_ipRamp(norm(d.zabki_per_100k||0)):'#0e1e0c',
      fillOpacity:opacity};
  }
  const map=L.map('map-inpost',{
    zoomControl:false,attributionControl:false,
    scrollWheelZoom:true,dragging:true,
    doubleClickZoom:true,boxZoom:true,keyboard:true,
    zoomSnap:0  // allow fractional zoom so fitBounds fills the canvas tightly
  });
  MAPS['map-inpost']=map;
  map.setView([52.0,19.3],6.5);
  map.invalidateSize();
  const pairs=[];
  L.geoJSON(M.woj_geo,{
    style:f=>wStyle(byName[(f.properties.nazwa||'').toLowerCase()],0),
    onEachFeature:(f,layer)=>{
      const d=byName[(f.properties.nazwa||'').toLowerCase()];
      const name=f.properties.nazwa||'';
      pairs.push({layer,d,f});
      if(d){
        const z=(d.zabki_per_100k||0).toFixed(1);
        const p=(d.lockers_per_100k||0).toFixed(1);
        const r=typeof d.ratio==='number'?d.ratio.toFixed(2):String(d.ratio);
        layer.bindTooltip(
          `<div style="font-weight:700;font-size:13px;margin-bottom:3px">${name}</div>`+
          `<div style="font-size:12px;color:#93a487">Żabka: ${z}/100k</div>`+
          `<div style="font-size:12px;color:#93a487">InPost: ${p}/100k</div>`+
          `<div style="font-size:12px;color:#93a487">stosunek: ${r}x</div>`,
          {sticky:true,className:'gran-tooltip',opacity:1}
        );
      }
      layer.on('mouseover',()=>{
        const v=d?norm(d.zabki_per_100k||0):null;
        layer.setStyle({weight:2.5,color:'rgba(166,232,74,.85)',
          fillColor:v!=null?_ipRamp(Math.min(1,v+0.18)):'#1c3a1c',fillOpacity:1});
        layer.bringToFront();
        const svg=layer.getElement&&layer.getElement();
        if(svg){const b=layer.getBounds().getCenter();const pt=map.latLngToLayerPoint(b);
          svg.style.transformOrigin=`${pt.x}px ${pt.y}px`;svg.style.transform='scale(1.06)';}
      });
      layer.on('mouseout',()=>{
        layer.setStyle(wStyle(d));
        const svg=layer.getElement&&layer.getElement();
        if(svg){svg.style.transform='scale(1)';}
      });
    }
  }).addTo(map);
  // Fit Poland to the canvas. invalidateSize first so fitBounds sees the real
  // container size; re-fit after the flex/reveal layout settles so the map
  // fills the whole canvas instead of leaving margins.
  const _bounds=L.geoJSON(M.woj_geo).getBounds();
  function fitInpost(){
    if(!map)return;
    map.invalidateSize();
    try{map.fitBounds(_bounds,{padding:[4,4]})}catch(e){}
  }
  fitInpost();
  setTimeout(fitInpost,80);
  setTimeout(fitInpost,320);
  pairs.forEach(({layer},i)=>setTimeout(()=>{
    const svg=layer.getElement&&layer.getElement();
    if(svg)svg.style.transition='fill-opacity .25s ease,fill .25s ease,transform .2s ease';
    layer.setStyle({fillOpacity:0.9});
  },10+i*14));
}

export function renderSpoleczenstwo(){
  startTabParticles('particles-spoleczenstwo',[188,224,58],60);
  renderSpolecKPIs();
  renderInpostMap();
  // Update lead paragraph with live totals
  const leadEl=document.getElementById('ec-lead-totals');
  if(leadEl&&M.summary&&M.section3_rare){
    const total=M.summary.total_active?(+M.summary.total_active).toLocaleString('pl-PL'):null;
    const powiats=M.section3_rare.powiats_covered||null;
    if(total&&powiats){
      leadEl.innerHTML=`<b>${total}</b> sklepów w <b>${powiats}</b> powiatach. W dwóch rozdziałach sprawdzamy, czy gęstość sieci idzie za <b>pieniędzmi</b> i za <b>pracą</b> - i co tak naprawdę mówią o tym liczby.`;
    }
  }
  const hEl=document.getElementById('hero-num-spoleczenstwo');
  if(hEl&&M.summary&&M.summary.sunday_pct!=null){
    const target=M.summary.sunday_pct;
    const prefersReduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(prefersReduced){
      hEl.innerHTML=`${String(target).replace('.',',')}<span class="stat-unit">%</span>`;
    }else{
      const from=70,dur=1800,start=performance.now();
      (function step(now){
        const t=Math.min(1,(now-start)/dur);
        const e=t>=1?1:1-Math.pow(2,-14*t);
        const v=from+(target-from)*e;
        hEl.innerHTML=`${String(Math.round(v*10)/10).replace('.',',')}<span class="stat-unit">%</span>`;
        if(t<1)requestAnimationFrame(step);
      })(performance.now());
    }
  }
  renderEcon();
  renderDumbbellByLevel();
  renderStreets();
  renderGminaLeaders();
  renderNbl();
  wireStreetsAndGmina();
  wireNbl();
}

// ---- common-streets bar (Zabka stoi tam, gdzie Polska stawia pomniki) ----
export function renderStreets(){
  const cs=M.common_streets||{streets:[]};
  const rows=(cs.streets||[]).slice(0,15);
  if(!rows.length)return;
  const distEl=document.getElementById('streets-distinct');
  if(distEl&&cs.distinct)distEl.textContent=(+cs.distinct).toLocaleString('pl-PL');
  destroyChart('streets');
  CHARTS['streets']=new Chart(document.getElementById('chart-streets'),{
    type:'bar',
    data:{labels:rows.map(d=>d.name),datasets:[{
      data:rows.map(d=>d.cnt),
      backgroundColor:rows.map((_,i)=>i===0?C.greenBright:C.green+'aa'),
      borderRadius:2,borderWidth:0
    }]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},
        tooltip:{callbacks:{label:ctx=>`${ctx.raw} Żabek na ul. ${ctx.label}`}},
        barLabels:{thousands:true,color:C.muted}},
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{display:false},ticks:{color:C.muted,font:{size:11}}}}
    }
  });
}

// ---- gmina leaders (kurorty) per_1k / per_km2 ----
let _gminaMetric='per_1k';
export function renderGminaLeaders(){
  const gl=M.gmina_leaders||{};
  const rows=(_gminaMetric==='per_1k'?gl.per_1k:gl.per_km2)||[];
  if(!rows.length)return;
  const r12=rows.slice(0,12);
  const per1k=_gminaMetric==='per_1k';
  const sub=document.getElementById('gmina-lead-sub');
  if(sub)sub.textContent=per1k
    ? 'gminy wg sklepów na 1000 zameldowanych - morze i góry biją resztę kraju'
    : 'gminy wg sklepów na km² - tu wygrywają wielkie miasta';
  const cav=document.getElementById('gmina-lead-caveat');
  if(cav)cav.style.display=per1k?'':'none';
  const natRef=per1k&&gl.national_per_1k?[{value:gl.national_per_1k,axis:'x',color:'rgba(255,255,255,.3)',label:'śr. kraj '+String(gl.national_per_1k).replace('.',',')}]:[];
  destroyChart('gmina-lead');
  CHARTS['gmina-lead']=new Chart(document.getElementById('chart-gmina-lead'),{
    type:'bar',
    data:{labels:r12.map(d=>d.name),datasets:[{
      data:r12.map(d=>per1k?d.per_1k:d.per_km2),
      backgroundColor:r12.map((_,i)=>i===0?C.greenBright:macroCol(r12[i].voivodeship)+'cc'),
      borderRadius:2,borderWidth:0
    }]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},
        tooltip:{callbacks:{label:ctx=>{const d=r12[ctx.dataIndex];return [
          per1k?`${d.per_1k} skl./1000 mieszk.`:`${d.per_km2} skl./km²`,
          `${d.cnt} Żabek · ${(d.population||0).toLocaleString('pl-PL')} mieszk.`]}}},
        barLabels:{decimals:2,color:C.muted},
        annot:{refLines:natRef}},
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{display:false},ticks:{color:C.muted,font:{size:11}}}}
    }
  });
}

function wireStreetsAndGmina(){
  document.querySelectorAll('#gmina-metric .gran-btn').forEach(btn=>{
    if(btn._wired)return;btn._wired=true;
    btn.addEventListener('click',()=>{
      _gminaMetric=btn.dataset.gmetric;
      document.querySelectorAll('#gmina-metric .gran-btn').forEach(b=>b.classList.toggle('active',b===btn));
      renderGminaLeaders();
    });
  });
}

// ---- neighbor-by-level ranking (median/avg, level, sort) ----
let _nblLevel='voivodeship', _nblMetric='median_m', _nblSort='desc';
const _nblCache={};
const _NBL_LABEL={voivodeship:'województw',powiat:'powiatów',city:'miast'};

async function _fetchNbl(level,metric,sort){
  const key=`${level}_${metric}_${sort}`;
  if(_nblCache[key])return _nblCache[key];
  try{
    const r=await fetch(`/api/stats/neighbor-by-level?level=${level}&metric=${metric}&sort=${sort}&limit=20`);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();_nblCache[key]=d;return d;
  }catch(e){console.error('nbl fetch',e);return null}
}

function _drawNbl(data){
  const rows=(data&&data.rows||[]).slice(0,20);
  if(!rows.length)return;
  const metric=_nblMetric;
  const sub=document.getElementById('nbl-sub');
  if(sub)sub.textContent=`${metric==='median_m'?'Mediana':'Średnia'} odległości do najbliższej Żabki, według ${_NBL_LABEL[_nblLevel]}`;
  destroyChart('nbl');
  CHARTS['nbl']=new Chart(document.getElementById('chart-nbl'),{
    type:'bar',
    data:{labels:rows.map(d=>d.name),datasets:[{
      data:rows.map(d=>d[metric]),
      backgroundColor:rows.map(d=>macroCol(d.voivodeship)+'cc'),
      borderRadius:2,borderWidth:0
    }]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},
        tooltip:{callbacks:{label:ctx=>{const d=rows[ctx.dataIndex];return [
          `mediana ${d.median_m.toLocaleString('pl-PL')} m`,
          `średnia ${d.avg_m.toLocaleString('pl-PL')} m`,
          `${d.n} sklepów`]}}},
        barLabels:{thousands:true,color:C.muted}},
      scales:{x:{grid:{color:C.axis},title:{display:true,text:'metry do najbliższej Żabki',color:C.muted,font:{size:11}},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}

export async function renderNbl(){
  let data;
  if(_nblLevel==='voivodeship'&&_nblMetric==='median_m'&&_nblSort==='desc'
     &&M.neighbor_by_level&&(M.neighbor_by_level.rows||[]).length){
    data=M.neighbor_by_level;
  }else{
    data=await _fetchNbl(_nblLevel,_nblMetric,_nblSort)||M.neighbor_by_level;
  }
  _drawNbl(data);
}

function wireNbl(){
  const wire=(sel,attr,set)=>document.querySelectorAll(sel+' .gran-btn').forEach(btn=>{
    if(btn._wired)return;btn._wired=true;
    btn.addEventListener('click',()=>{
      set(btn.dataset[attr]);
      document.querySelectorAll(sel+' .gran-btn').forEach(b=>b.classList.toggle('active',b===btn));
      renderNbl();
    });
  });
  wire('#nbl-level','nlevel',v=>_nblLevel=v);
  wire('#nbl-metric','nmetric',v=>_nblMetric=v);
  wire('#nbl-sort','nsort',v=>_nblSort=v);
}

export function renderScatters(){
  const data=M.powiat_economics.filter(d=>d.avg_salary>0&&d.per_1k>0);
  const ptSize=d=>Math.max(3,Math.sqrt(d.population/5000));
  const ptColor=d=>macroCol(d.voivodeship);
  const scatterOpts=(xLabel)=>({
    responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{display:false},
      tooltip:{callbacks:{label:ctx=>`${ctx.raw.label||'powiat'} (${ctx.raw.voj}): ${ctx.raw.y.toFixed(2)}/1k`}},
      annot:{refLines:[]}
    },
    scales:{
      x:{title:{display:true,text:xLabel,color:C.muted,font:{size:11}},ticks:{color:C.muted,font:{size:10}},grid:{color:C.axis}},
      y:{title:{display:true,text:'sklepy / 1k mieszk.',color:C.muted,font:{size:11}},ticks:{color:C.muted,font:{size:10}},grid:{color:C.axis}}
    }
  });
  destroyChart('scatter-salary');
  CHARTS['scatter-salary']=new Chart(document.getElementById('chart-scatter-salary'),{
    type:'scatter',
    data:{datasets:[{data:data.map(d=>({x:d.avg_salary,y:d.per_1k,label:d.powiat,voj:d.voivodeship})),backgroundColor:data.map(ptColor),pointRadius:data.map(ptSize),pointHoverRadius:7}]},
    options:scatterOpts('srednia pensja (PLN)')
  });
  destroyChart('scatter-unemp');
  CHARTS['scatter-unemp']=new Chart(document.getElementById('chart-scatter-unemp'),{
    type:'scatter',
    data:{datasets:[{data:data.map(d=>({x:d.unemployment_rate,y:d.per_1k,label:d.powiat,voj:d.voivodeship})),backgroundColor:data.map(ptColor),pointRadius:data.map(ptSize),pointHoverRadius:7}]},
    options:scatterOpts('stopa bezrobocia (%)')
  });
}

export function renderSundayChoropleth(){
  const map=leafletDark('map-sunday');map.setView([52,19.4],5.5);
  const byName={};M.sunday_by_voivodeship.forEach(d=>byName[d.voivodeship]=d.closed_pct);
  L.geoJSON(M.woj_geo,{
    style(f){const p=byName[f.properties.nazwa]||0;const t=Math.min(p/12,1);return{fillColor:`rgba(${Math.round(232*t)},${Math.round(90*(1-t))},${Math.round(47*t)},${0.25+t*.5})`,fillOpacity:.7,color:'#2a2a3a',weight:1}},
    onEachFeature(f,l){
      l.bindTooltip(`<b>${f.properties.nazwa}</b><br>${byName[f.properties.nazwa]||0}% zamknietych w niedziele`,{sticky:true});
      l.on('click',()=>{
        const v=f.properties.nazwa;
        setFilter(STATE.filter===v?null:v);
        openSundayDrawer(v);
      });
    }
  }).addTo(map);
  const closeBtn=document.getElementById('sunday-drawer-close');
  if(closeBtn&&!closeBtn._wired){
    closeBtn._wired=true;
    closeBtn.addEventListener('click',()=>{document.getElementById('sunday-drawer').hidden=true});
  }
}

async function openSundayDrawer(voivodeship){
  const drawer=document.getElementById('sunday-drawer');
  const title=document.getElementById('sunday-drawer-title');
  const count=document.getElementById('sunday-drawer-count');
  const body=document.getElementById('sunday-drawer-body');
  if(!drawer)return;
  title.textContent=voivodeship;
  count.textContent='ladowanie...';
  body.innerHTML='';
  drawer.hidden=false;
  try{
    const data=await fetch(`/api/stats/sunday-closed-stores?voivodeship=${encodeURIComponent(voivodeship)}`).then(r=>r.json());
    count.textContent=`${data.length} zamknietych`;
    if(!data.length){
      body.innerHTML='<div class="drawer-row" style="color:var(--muted)">Brak zamknietych sklepow w tej woj.</div>';
      return;
    }
    body.innerHTML=data.map(s=>`<div class="drawer-row"><span class="drawer-city">${s.city}</span><span class="drawer-street">${s.street}</span>${s.has_merrychef?'<span class="drawer-mc">piec</span>':''}</div>`).join('');
  }catch(e){
    body.innerHTML='<div class="drawer-row" style="color:var(--muted)">Blad ladowania.</div>';
  }
}

export function renderDensityChoropleth(){
  const AREA={
    'mazowieckie':35558,'śląskie':12333,'wielkopolskie':29826,'małopolskie':15183,
    'łódzkie':18219,'dolnośląskie':19948,'zachodniopomorskie':22892,'warmińsko-mazurskie':24173,
    'podlaskie':20187,'świętokrzyskie':11711,'lubuskie':13988,'opolskie':9412,
    'kujawsko-pomorskie':17972,'pomorskie':18310,'podkarpackie':17846,'lubelskie':25122
  };
  const map=leafletDark('map-density');map.setView([52,19.4],5.5);
  const dn={};M.voivodeship_density.forEach(d=>{
    const area=AREA[d.voivodeship]||1;
    dn[d.voivodeship]=(d.stores||d.total||0)/area*100;
  });
  const maxD=Math.max(...Object.values(dn),0.001);
  L.geoJSON(M.woj_geo,{
    style(f){const d=dn[f.properties.nazwa]||0;return{fillColor:`rgba(0,192,96,${0.1+d/maxD*.75})`,fillOpacity:.7,color:'#2a2a3a',weight:1}},
    onEachFeature(f,l){l.bindTooltip(`<b>${f.properties.nazwa}</b><br>${(dn[f.properties.nazwa]||0).toFixed(1)}/100 km²`,{sticky:true})}
  }).addTo(map);
}

export function renderMerrychef(){
  const data=[...M.voivodeship_merrychef].sort((a,b)=>a.mc_pct-b.mc_pct);
  // National average from data; fall back to summary counts if voivodeship list is empty
  const natAvg=data.length
    ? Math.round(data.reduce((s,d)=>s+d.mc_pct,0)/data.length*10)/10
    : (M.summary&&M.summary.with_merrychef&&M.summary.total_active
        ? Math.round(M.summary.with_merrychef/M.summary.total_active*1000)/10
        : 0);
  if(!natAvg)return;
  const low=data.find(d=>d.mc_pct<natAvg-2);
  const titleEl=document.querySelector('[data-debug-id="2.2b"]');
  if(titleEl){
    titleEl.textContent=low
      ? `${low.voivodeship.charAt(0).toUpperCase()+low.voivodeship.slice(1)}: jedyny region poniżej ${natAvg}% z piecem`
      : `Merrychef — rozkład województw (śr. krajowa ${natAvg}%)`;
  }
  const subEl=titleEl&&titleEl.closest('.card')&&titleEl.closest('.card').querySelector('.card-sub');
  if(subEl)subEl.textContent=`% sklepów z Merrychef, posortowane rosnąco — średnia krajowa ${String(natAvg).replace('.',',')}%`;
  destroyChart('merrychef');
  CHARTS['merrychef']=new Chart(document.getElementById('chart-merrychef'),{
    type:'bar',
    data:{labels:data.map(d=>d.voivodeship),datasets:[{data:data.map(d=>d.mc_pct),backgroundColor:data.map(d=>d.mc_pct<natAvg-2?C.amber:C.green+'aa'),borderRadius:2,borderWidth:0}]},
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.raw}% z Merrychef`}},annot:{refLines:[{value:natAvg,axis:'x',color:'rgba(255,255,255,.25)'}]}},
      scales:{x:{min:Math.max(0,Math.floor(Math.min(...data.map(d=>d.mc_pct))-2)),max:100,grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}

let _dbTip=null;
const _DB_LIMIT=20;
let _dbLevel='voivodeship';
let _dbDataCache={};

const _DB_LEVEL_MAP={'voivodeship':'voivodeship','powiat':'powiat','city':'city','gmina':'gmina'};
const _DB_LEVEL_LABEL_PL={'voivodeship':'województw','powiat':'powiatów','city':'miast','gmina':'gmin'};

async function fetchDumbbellLevel(level,limit){
  const key=`${level}_${limit}`;
  if(_dbDataCache[key])return _dbDataCache[key];
  const apiLevel=_DB_LEVEL_MAP[level]||level;
  try{
    const r=await fetch(`/api/stats/inpost-vs-zabka-by-level?level=${encodeURIComponent(apiLevel)}&limit=${limit}`);
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const d=await r.json();
    _dbDataCache[key]=d;
    return d;
  }catch(e){console.error('dumbbell fetch error',e);return null}
}

export function renderDumbbell(data){
  if(!data)data=M.inpost_vs_zabka;
  const arr=(data||[]).filter(d=>{
    const z=d.zabki_per_100k||0, p=d.lockers_per_100k||0;
    if(!z||!p) return false;
    // require at least 5% relative difference so the line is actually visible
    return Math.abs(p-z)/Math.max(z,p)>=0.05;
  }).sort((a,b)=>{
    const na=(a.name||a.voivodeship||'').toLowerCase();
    const nb=(b.name||b.voivodeship||'').toLowerCase();
    return na.localeCompare(nb,'pl');
  });
  const el=document.getElementById('inpost-dumbbell');if(!el)return;
  const allVals=arr.flatMap(d=>[d.zabki_per_100k||0,d.lockers_per_100k||0]);
  const maxV=Math.max(...allVals,1);
  const ROW=24;
  const PAD_L=130;
  const PAD_R=80;
  const W_CHART=420;
  const DOT_R=5;
  const FONT_LABEL=10;
  const FONT_RATIO=9;
  const FONT_GRID=8;
  const H=arr.length*ROW+30;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  const VBW=PAD_L+W_CHART+PAD_R;
  svg.setAttribute('viewBox',`0 0 ${VBW} ${H}`);
  svg.setAttribute('height', H);
  svg.style.cssText=`display:block;width:100%;max-width:${VBW}px`;
  function px(v){return PAD_L+v/maxV*W_CHART}
  [0.25,0.5,0.75,1.0].forEach(f=>{
    const x=px(maxV*f);
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',x);line.setAttribute('y1',16);line.setAttribute('x2',x);line.setAttribute('y2',H-10);
    line.setAttribute('stroke','#2a2a3a');line.setAttribute('stroke-width','0.6');
    svg.appendChild(line);
    const lbl=document.createElementNS('http://www.w3.org/2000/svg','text');
    lbl.setAttribute('x',x);lbl.setAttribute('y',12);lbl.setAttribute('text-anchor','middle');
    lbl.setAttribute('fill','#7a7a90');lbl.setAttribute('font-size',FONT_GRID);
    lbl.textContent=(maxV*f).toFixed(0);svg.appendChild(lbl);
  });
  arr.forEach((d,i)=>{
    const y=22+i*ROW;
    const xz=px(d.zabki_per_100k||0),xi=px(d.lockers_per_100k||0);
    const isFiltered=STATE.filter&&d.voivodeship&&d.voivodeship.toLowerCase()!==STATE.filter.toLowerCase();
    const alpha=isFiltered?'0.15':'1';
    const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
    ln.setAttribute('x1',Math.min(xz,xi));ln.setAttribute('y1',y);ln.setAttribute('x2',Math.max(xz,xi));ln.setAttribute('y2',y);
    ln.setAttribute('stroke','#3a3a4a');ln.setAttribute('stroke-width','1.5');ln.setAttribute('opacity',alpha);
    svg.appendChild(ln);
    const cz=document.createElementNS('http://www.w3.org/2000/svg','circle');
    cz.setAttribute('cx',xz);cz.setAttribute('cy',y);cz.setAttribute('r',DOT_R);
    cz.setAttribute('fill','#84c341');cz.setAttribute('opacity',alpha);
    svg.appendChild(cz);
    const ci=document.createElementNS('http://www.w3.org/2000/svg','circle');
    ci.setAttribute('cx',xi);ci.setAttribute('cy',y);ci.setAttribute('r',DOT_R);
    ci.setAttribute('fill','#f2a359');ci.setAttribute('opacity',alpha);
    svg.appendChild(ci);
    const lbl=document.createElementNS('http://www.w3.org/2000/svg','text');
    lbl.setAttribute('x',PAD_L-6);lbl.setAttribute('y',y+3.5);lbl.setAttribute('text-anchor','end');
    lbl.setAttribute('fill',isFiltered?'#3a3a5a':'#c8c8d8');lbl.setAttribute('font-size',FONT_LABEL);
    const name=d.name||d.voivodeship||'';
    lbl.textContent=name;
    svg.appendChild(lbl);
    const rb=document.createElementNS('http://www.w3.org/2000/svg','text');
    rb.setAttribute('x',PAD_L+W_CHART+4);rb.setAttribute('y',y+3);
    rb.setAttribute('fill','#5a5a6a');rb.setAttribute('font-size',FONT_RATIO);
    rb.textContent=d.ratio+'x';svg.appendChild(rb);
  });
  if(!_dbTip){
    _dbTip=document.createElement('div');
    _dbTip.style.cssText='position:fixed;pointer-events:none;opacity:0;transition:opacity .12s;background:rgba(12,22,11,.95);border:1px solid rgba(140,200,80,.3);border-radius:8px;padding:8px 12px;font-size:12px;color:#eef3e6;white-space:nowrap;z-index:9999;line-height:1.6';
    document.body.appendChild(_dbTip);
  }
  if(_dbTip)_dbTip.style.opacity='0';
  svg.addEventListener('mousemove',(e)=>{
    const r=svg.getBoundingClientRect();
    const svgY=e.clientY-r.top;
    const idx=Math.round((svgY-22)/ROW);
    if(idx>=0&&idx<arr.length){
      const d=arr[idx];
      const name=d.name||d.voivodeship||'';
      const z=(d.zabki_per_100k||0).toFixed(1);
      const p=(d.lockers_per_100k||0).toFixed(1);
      const ratio=typeof d.ratio==='number'?d.ratio.toFixed(2):String(d.ratio||'—');
      _dbTip.innerHTML=`<div style="font-weight:700;margin-bottom:2px">${name}</div>`+
        `<span style="color:#84c341">Żabka: ${z}/100k</span>&nbsp;&nbsp;`+
        `<span style="color:#f2a359">InPost: ${p}/100k</span>`+
        `<div style="color:#93a487;margin-top:2px">stosunek: ${ratio}x</div>`;
      _dbTip.style.opacity='1';
      _dbTip.style.top=(e.clientY+14)+'px';
      _dbTip.style.left=(e.clientX+14)+'px';
    } else {
      _dbTip.style.opacity='0';
    }
  });
  svg.addEventListener('mouseleave',()=>{if(_dbTip)_dbTip.style.opacity='0';});
  el.innerHTML='';el.appendChild(svg);
}

export async function renderDumbbellByLevel(){
  if(_dbLevel==='voivodeship'){
    renderDumbbell(M.inpost_vs_zabka);
    const title=document.querySelector('[data-debug-id="2.3"]');
    if(title){
      const inpostRows=M.inpost_vs_zabka||[];
      const sumZ=inpostRows.reduce((s,d)=>s+(d.zabki_per_100k||0),0);
      const sumI=inpostRows.reduce((s,d)=>s+(d.lockers_per_100k||0),0);
      const ratio=sumZ>0?sumI/sumZ:null;
      title.textContent='InPost vs Żabka'+(ratio?' - '+ratio.toFixed(2).replace('.',',')+' paczkomaty na każdą Żabkę w Polsce':'');
    }
    return;
  }
  const d=await fetchDumbbellLevel(_dbLevel,_DB_LIMIT);
  if(!d){renderDumbbell(M.inpost_vs_zabka);return}
  const label=_DB_LEVEL_LABEL_PL[_dbLevel]||_dbLevel;
  const title=document.querySelector('[data-debug-id="2.3"]');
  if(title)title.textContent=`InPost vs Żabka - top ${d.rows.length} ${label} alfabetycznie (${d.total} łącznie)`;
  renderDumbbell(d.rows);
}

function wireInpostLevel(){
  document.querySelectorAll('#inpost-level .gran-btn').forEach(btn=>{
    if(btn._wired)return;btn._wired=true;
    btn.addEventListener('click',()=>{
      _dbLevel=btn.dataset.ilevel;
      document.querySelectorAll('#inpost-level .gran-btn').forEach(b=>b.classList.toggle('active',b===btn));
      renderDumbbellByLevel();
    });
  });
}

export {wireInpostLevel};
