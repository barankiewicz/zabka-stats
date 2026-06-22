import Chart from 'chart.js/auto';
import L from 'leaflet';
import { C, STATE } from '../config.js';
import { M, CHARTS } from '../state.js';
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

  if(s&&s.merrychef_pct!=null){
    set('spol-kpi-mc',`${String(s.merrychef_pct).replace('.',',')}<span class="stat-unit">%</span>`);
  }
}

export function renderSpoleczenstwo(){
  startTabParticles('particles-spoleczenstwo',[188,224,58],60);
  renderSpolecKPIs();
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
  renderMerrychef();
  renderDumbbellByLevel();
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
    style(f){const p=byName[f.properties.name]||0;const t=Math.min(p/12,1);return{fillColor:`rgba(${Math.round(232*t)},${Math.round(90*(1-t))},${Math.round(47*t)},${0.25+t*.5})`,fillOpacity:.7,color:'#2a2a3a',weight:1}},
    onEachFeature(f,l){
      l.bindTooltip(`<b>${f.properties.name}</b><br>${byName[f.properties.name]||0}% zamknietych w niedziele`,{sticky:true});
      l.on('click',()=>{
        const v=f.properties.name;
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
    style(f){const d=dn[f.properties.name]||0;return{fillColor:`rgba(0,192,96,${0.1+d/maxD*.75})`,fillOpacity:.7,color:'#2a2a3a',weight:1}},
    onEachFeature(f,l){l.bindTooltip(`<b>${f.properties.name}</b><br>${(dn[f.properties.name]||0).toFixed(1)}/100 km²`,{sticky:true})}
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
  const PAD_R=55;
  const W_CHART=420;
  const DOT_R=5;
  const FONT_LABEL=10;
  const FONT_RATIO=9;
  const FONT_GRID=8;
  const H=arr.length*ROW+30;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  const VBW=PAD_L+W_CHART+PAD_R;
  svg.setAttribute('viewBox',`0 0 ${VBW} ${H}`);
  svg.style.cssText=`display:block;margin:0 auto;width:100%;max-width:${VBW}px;height:auto`;
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
  const LEG_Y=H-6;
  [['#84c341','Zabka/100k'],['#f2a359','InPost/100k']].forEach(([col,lbl],i)=>{
    const cx2=PAD_L+40+i*100;
    const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('cx',cx2);c.setAttribute('cy',LEG_Y);c.setAttribute('r','4');c.setAttribute('fill',col);
    svg.appendChild(c);
    const t=document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('x',cx2+7);t.setAttribute('y',LEG_Y+3);t.setAttribute('fill','#5a5a6a');t.setAttribute('font-size','8');
    t.textContent=lbl;svg.appendChild(t);
  });
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
