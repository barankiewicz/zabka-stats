import Chart from 'chart.js/auto';
import { maplibregl, createMap, fitPoland, featureBBoxCenter, showMapUnavailable, WebGLUnavailableError } from '../maplibre-map.js';
import { C, STATE } from '../config.js';
import { M, CHARTS, MAPS } from '../state.js';
import { fmt, getFont, destroyChart, startTabParticles } from '../utils.js';
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

  const gminy=(M.coverage_funnel||[]).find(r=>r.level==='gminy');
  if(gminy&&gminy.pct!=null){
    set('spol-kpi-gminy',`${String(gminy.pct).replace('.',',')}<span class="stat-unit">%</span>`);
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

let _ipMap=null,_ipTip=null,_ipLabelMarkers=[];
const _IP_FILL_STOPS=[
  'interpolate',['linear'],['get','_t'],
  0,'#132912', 0.2,'#1e4019', 0.4,'#2d6324', 0.6,'#4a9228', 0.8,'#72c133', 1,'#a6e84a'];

function _refreshIpLabels(features){
  _ipLabelMarkers.forEach(m=>{try{m.remove()}catch(e){}});
  _ipLabelMarkers=[];
  if(!_ipMap)return;
  features.forEach(f=>{
    const c=featureBBoxCenter(f);
    const lab=f.properties&&f.properties._label;
    if(!c||!lab)return;
    const el=document.createElement('div');
    el.className='woj-val-label-marker';
    el.textContent=lab;
    _ipLabelMarkers.push(new maplibregl.Marker({element:el,anchor:'center'}).setLngLat(c).addTo(_ipMap));
  });
}

function renderInpostMap(){
  const data=M.inpost_vs_zabka||[];
  if(!data.length||!M.woj_geo||!M.woj_geo.features||!M.woj_geo.features.length)return;
  if(MAPS['map-inpost'])return;
  const el=document.getElementById('map-inpost');if(!el)return;

  const byName={};
  data.forEach(d=>{byName[(d.voivodeship||'').toLowerCase()]=d});
  const vals=data.map(d=>+d.ratio||0);
  const vmin=Math.min(...vals), vmax=Math.max(...vals,vmin+0.01);

  // Build the joined FeatureCollection: _t is the inverted ramp position
  // (high InPost/Żabka ratio -> dim, low ratio -> bright), _label is the
  // ratio string, _tip is the hover card HTML.
  function _buildData(){
    const features=(M.woj_geo.features||[]).map((f,i)=>{
      const d=byName[(f.properties.nazwa||'').toLowerCase()];
      const nf={type:'Feature',geometry:f.geometry,properties:{...(f.properties||{}),_fid:i}};
      if(d){
        const r0=(+d.ratio||0);
        const norm=(r0-vmin)/(vmax-vmin);
        nf.properties._t=Math.max(0,Math.min(1,1-(isNaN(norm)?0.5:norm)));
        const rr=typeof d.ratio==='number'?d.ratio.toFixed(2):String(d.ratio);
        nf.properties._label=rr.replace('.',',')+'x';
        const _rn=f.properties.nazwa||'';
        nf.properties._name=_rn?_rn[0].toUpperCase()+_rn.slice(1):_rn;
        const z=(d.zabki_per_100k||0).toFixed(1), p=(d.lockers_per_100k||0).toFixed(1);
        nf.properties._tip=`<div style="font-weight:700;font-size:13px;margin-bottom:3px">${nf.properties._name}</div>`+
          `<div style="font-size:12px;color:#93a487">Żabka: ${z}/100k</div>`+
          `<div style="font-size:12px;color:#93a487">InPost: ${p}/100k</div>`+
          `<div style="font-size:12px;color:#93a487">stosunek: ${rr}x</div>`;
      }else{
        nf.properties._t=0;nf.properties._label='';
      }
      return nf;
    });
    return {type:'FeatureCollection',features};
  }

  try {
  _ipMap=createMap('map-inpost',{
    center:[19.3,52.05],zoom:5.6,minZoom:5,maxZoom:9,
    dragPan:true,dragRotate:false,scrollZoom:true,doubleClickZoom:true,touchZoom:true,keyboard:true,
  });
  MAPS['map-inpost']=_ipMap;

  _ipMap.on('load',()=>{
    const fc=_buildData();
    _ipMap.addSource('ip-woj',{type:'geojson',data:fc,promoteId:'_fid'});
    _ipMap.addLayer({id:'ip-woj-fill',type:'fill',source:'ip-woj',paint:{
      'fill-color':_IP_FILL_STOPS,
      'fill-opacity':['case',['boolean',['feature-state','hover'],false],1,0.9],
    }});
    _ipMap.addLayer({id:'ip-woj-line',type:'line',source:'ip-woj',paint:{
      'line-color':['case',['boolean',['feature-state','hover'],false],'#a6e84a','#08110a'],
      'line-width':['case',['boolean',['feature-state','hover'],false],2.5,1],
    }});
    _refreshIpLabels(fc.features);
    fitPoland(_ipMap,4);

    let _hoverFid=null;
    if(!_ipTip){
      _ipTip=document.createElement('div');
      _ipTip.className='gran-tooltip maplibre-hover-tip';_ipTip.style.display='none';
      document.body.appendChild(_ipTip);
    }
    _ipMap.on('mousemove','ip-woj-fill',e=>{
      const fs=e.features&&e.features[0];if(!fs)return;
      if(_hoverFid!=null)_ipMap.setFeatureState({source:'ip-woj',id:_hoverFid},{hover:false});
      _hoverFid=fs.id;_ipMap.setFeatureState({source:'ip-woj',id:_hoverFid},{hover:true});
      _ipMap.getCanvas().style.cursor='pointer';
      const p=fs.properties||{};
      if(p._tip){_ipTip.innerHTML=p._tip;_ipTip.style.left=(e.originalEvent.clientX+14)+'px';_ipTip.style.top=(e.originalEvent.clientY+14)+'px';_ipTip.style.display='block';}
    });
    _ipMap.on('mouseleave','ip-woj-fill',()=>{
      if(_hoverFid!=null)_ipMap.setFeatureState({source:'ip-woj',id:_hoverFid},{hover:false});
      _hoverFid=null;_ipMap.getCanvas().style.cursor='';_ipTip.style.display='none';
    });
    setTimeout(()=>{if(_ipMap){_ipMap.resize();fitPoland(_ipMap,4);}},120);
  });
  } catch (e) {
    if (e instanceof WebGLUnavailableError) {
      showMapUnavailable(el, { message: 'Mapa Żabka vs InPost niedostępna' });
      _ipMap = null;
      return;
    }
    throw e;
  }
}
export function renderSpoleczenstwo(){
  if(!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)){
    startTabParticles('particles-spoleczenstwo',[188,224,58],60);
  }
  renderSpolecKPIs();
  renderInpostMap();
  // Update lead paragraph with live totals
  const leadEl=document.getElementById('ec-lead-totals');
  if(leadEl&&M.summary&&M.section3_rare){
    const total=M.summary.total_active?(+M.summary.total_active).toLocaleString('pl-PL'):null;
    const powiats=M.section3_rare.powiats_covered||null;
    if(total&&powiats){
      leadEl.innerHTML=`<b>${total}</b> sklepów w <b>${powiats}</b> powiatach. W dwóch rozdziałach sprawdzamy, czy gęstość sieci idzie za <b>pieniędzmi</b> i za <b>pracą</b> – i co tak naprawdę mówią o tym liczby.`;
    }
  }
  const hEl=document.getElementById('hero-num-spoleczenstwo');
  if(hEl){
    const voidData=(M.section3_rare&&M.section3_rare.void)||null;
    const target=voidData&&voidData.value!=null?+voidData.value:46.52;
    const prefersReduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(prefersReduced){
      hEl.innerHTML=`${String(target).replace('.',',')}<span class="stat-unit"> km</span>`;
    }else{
      const from=0,dur=1800,start=performance.now();
      (function step(now){
        const t=Math.min(1,(now-start)/dur);
        const e=t>=1?1:1-Math.pow(2,-14*t);
        const v=from+(target-from)*e;
        hEl.innerHTML=`${String(Math.round(v*100)/100).replace('.',',')}<span class="stat-unit"> km</span>`;
        if(t<1)requestAnimationFrame(step);
      })(performance.now());
    }
  }
  renderEcon();
  renderDumbbellByLevel();
  renderSpolKnn();
  renderStreets();
  renderGminaLeaders();
  renderNbl();
  wireStreetsAndGmina();
  wireNbl();
}

// ---- common-streets bar (Zabka stoi tam, gdzie Polska stawia pomniki) ----
export function renderStreets(){
  const ps=M.section3_rare&&M.section3_rare.physical_streets;
  const rows=(ps||[]).slice(0,15);
  if(!rows.length)return;
  const distEl=document.getElementById('streets-distinct');
  if(distEl){
    const total=(M.summary&&M.summary.total_active)||0;
    if(total) distEl.textContent=fmt(total);
  }
  destroyChart('streets');
  const monoFont=getFont('mono');
  // Plugin: rysuj tick labels z ulica duzym fontem + miasto mniejszym
  const streetsData=rows;
  const dualLabelPlugin={
    id:'dualLabelSpoleczenstwo',
    afterDatasetsDraw(chart){
      const yScale=chart.scales.y;
      const ctx=chart.ctx;
      ctx.save();
      ctx.textAlign='right';
      ctx.textBaseline='middle';
      const items=(yScale._labelItems&&yScale._labelItems.length)?yScale._labelItems:null;
      const drawOne=(y,i)=>{
        const s=streetsData[i];if(!s)return;
        const x=yScale.left-8;
        ctx.font=`600 13px '${getFont('body')}',sans-serif`;
        ctx.fillStyle='#c8d4c0';
        const st=s.street.replace(/^ul\.\s*/i,'').trim();
        ctx.fillText(st.length>28?st.slice(0,27)+'…':st, x, y-4);
        ctx.font=`400 10px '${getFont('body')}',sans-serif`;
        ctx.fillStyle='#93a487';
        ctx.fillText(s.city, x, y+10);
      };
      if(items){items.forEach((it,i)=>drawOne(it.y,i));}
      else{const m=chart.getDatasetMeta(0);if(m&&m.data)m.data.forEach((b,i)=>drawOne(b.y,i));}
      ctx.restore();
    }
  };
  CHARTS['streets']=new Chart(document.getElementById('chart-streets'),{
    type:'bar',
    data:{labels:rows.map((s,i)=>i),datasets:[{
      data:rows.map(d=>d.cnt),
      backgroundColor:rows.map((_,i)=>i===0?C.greenBright:C.green+'aa'),
      borderWidth:0,borderRadius:2,maxBarThickness:20
    }]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      layout:{padding:{right:60,left:180,top:8,bottom:8}},
      plugins:{legend:{display:false},
        tooltip:{enabled:false},
        barLabels:{thousands:true,color:C.muted},
        dualLabelSpoleczenstwo:{}},
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{display:false},ticks:{display:false}}}},
    plugins:[dualLabelPlugin],
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
    ? 'gminy wg sklepów na 1000 zameldowanych – morze i góry biją resztę kraju'
    : 'gminy wg sklepów na km² – tu wygrywają wielkie miasta';
  const cav=document.getElementById('gmina-lead-caveat');
  if(cav)cav.style.display=per1k?'':'none';
  const natRef=per1k&&gl.national_per_1k?[{value:gl.national_per_1k,axis:'x',color:'rgba(255,255,255,.3)',label:'śr. kraj '+String(gl.national_per_1k).replace('.',',')}]:[];
  destroyChart('gmina-lead');
  CHARTS['gmina-lead']=new Chart(document.getElementById('chart-gmina-lead'),{
    type:'bar',
    data:{labels:r12.map(d=>d.name),datasets:[{
      data:r12.map(d=>per1k?d.per_1k:d.per_km2),
      backgroundColor:r12.map((_,i)=>_ipRamp(1-i/Math.max(r12.length-1,1))),
      borderRadius:2,borderWidth:0,maxBarThickness:20
    }]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      animation:{duration:0},
      layout:{padding:{right:60,top:8,bottom:8}},
      plugins:{legend:{display:false},
        tooltip:{enabled:false},
        barLabels:{decimals:2,color:C.muted},
        annot:{refLines:natRef}},
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}

function wireStreetsAndGmina(){
  document.querySelectorAll('#gmina-metric .gran-btn').forEach(btn=>{
    if(btn._wired)return;btn._wired=true;
    btn.addEventListener('click',()=>{
      _gminaMetric=btn.dataset.gmetric;
      _setActiveSpol('#gmina-metric',btn);
      renderGminaLeaders();
    });
  });
}

// ---- neighbor-by-level ranking (median/avg, level, sort) ----
let _nblLevel='voivodeship', _nblMetric='median_m', _nblSort='asc';
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
  const total=data&&data.total||rows.length;
  const sub=document.getElementById('nbl-sub');
  if(sub)sub.textContent=`${metric==='median_m'?'Mediana':'Średnia'} odległości do najbliższej Żabki, według ${_NBL_LABEL[_nblLevel]}`;

  const labels=rows.map(d=>d.name);
  const vals=rows.map(d=>d[metric]);
  const bgs=rows.map((_,i)=>_ipRamp(1-i/Math.max(rows.length-1,1)));

  if(total>rows.length){
    const ns=(M.neighbor_stats&&M.neighbor_stats.distribution)||{};
    const natVal=metric==='median_m'?(ns.median_m||null):(ns.avg_m||null);
    if(natVal!=null){
      labels.push('Pozostałe');
      vals.push(Math.round(natVal));
      bgs.push('rgba(147,164,135,0.35)');
    }
  }

  destroyChart('nbl');
  CHARTS['nbl']=new Chart(document.getElementById('chart-nbl'),{
    type:'bar',
    data:{labels,datasets:[{
      data:vals,
      backgroundColor:bgs,
      borderRadius:2,borderWidth:0
    }]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      layout:{padding:{right:72,top:4}},
      plugins:{legend:{display:false},
        tooltip:{callbacks:{label:ctx=>{const d=rows[ctx.dataIndex];if(!d)return[];return [
          `mediana ${d.median_m.toLocaleString('pl-PL')} m`,
          `średnia ${d.avg_m.toLocaleString('pl-PL')} m`,
          `${d.n} sklepów`]}}},
        barLabels:{thousands:true,color:C.muted,suffix:' m'}},
      scales:{x:{grid:{color:C.axis},title:{display:true,text:'metry do najbliższej Żabki',color:C.muted,font:{size:11}},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}

export async function renderNbl(){
  let data;
  if(_nblLevel==='voivodeship'&&_nblMetric==='median_m'&&_nblSort==='asc'
     &&M.neighbor_by_level&&(M.neighbor_by_level.rows||[]).length){
    data=M.neighbor_by_level;
  }else{
    data=await _fetchNbl(_nblLevel,_nblMetric,_nblSort)||M.neighbor_by_level;
  }
  _drawNbl(data);
}

function _setActiveSpol(sel,btn){
  document.querySelectorAll(sel+' .gran-btn').forEach(b=>{
    b.classList.toggle('active',b===btn);
    b.setAttribute('aria-pressed',b===btn?'true':'false');
  });
}

function wireNbl(){
  const wire=(sel,attr,set)=>document.querySelectorAll(sel+' .gran-btn').forEach(btn=>{
    if(btn._wired)return;btn._wired=true;
    btn.addEventListener('click',()=>{
      set(btn.dataset[attr]);
      _setActiveSpol(sel,btn);
      renderNbl();
    });
  });
  wire('#nbl-level','nlevel',v=>_nblLevel=v);
  wire('#nbl-metric','nmetric',v=>_nblMetric=v);
  wire('#nbl-sort','nsort',v=>_nblSort=v);
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
    const rawName=d.name||d.voivodeship||'';
    const name=rawName.replace(/^M\.st\.\s*/i,'').replace(/\s+od\s+\d{4}\s*$/i,'').replace(/^powiat\s+/i,'').trim();
    lbl.textContent=name?name[0].toUpperCase()+name.slice(1):rawName;
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
      const rawTip=d.name||d.voivodeship||'';
      const name=rawTip.replace(/^M\.st\.\s*/i,'').replace(/\s+od\s+\d{4}\s*$/i,'').replace(/^powiat\s+/i,'').trim()||rawTip;
      const z=(d.zabki_per_100k||0).toFixed(1);
      const p=(d.lockers_per_100k||0).toFixed(1);
      const ratio=typeof d.ratio==='number'?d.ratio.toFixed(2):String(d.ratio||'–');
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
      title.textContent='Żabka vs InPost'+(ratio?' – '+ratio.toFixed(2).replace('.',',')+' paczkomaty na każdą Żabkę w Polsce':'');
    }
    return;
  }
  const d=await fetchDumbbellLevel(_dbLevel,_DB_LIMIT);
  if(!d){renderDumbbell(M.inpost_vs_zabka);return}
  const label=_DB_LEVEL_LABEL_PL[_dbLevel]||_dbLevel;
  const title=document.querySelector('[data-debug-id="2.3"]');
  if(title)title.textContent=`Żabka vs InPost – top ${d.rows.length} ${label} alfabetycznie (${d.total} łącznie)`;
  renderDumbbell(d.rows);
}

function wireInpostLevel(){
  document.querySelectorAll('#inpost-level .gran-btn').forEach(btn=>{
    if(btn._wired)return;btn._wired=true;
    btn.addEventListener('click',()=>{
      _dbLevel=btn.dataset.ilevel;
      _setActiveSpol('#inpost-level',btn);
      renderDumbbellByLevel();
    });
  });
}

// ---- kNN histogram (Żabka a Polska) ----
function renderSpolKnn(){
  const ns=M.neighbor_stats||{};
  const dist=(ns.distribution||{buckets:[]}).buckets;
  if(!dist.length)return;
  const loner=ns.loner||{};
  const d=ns.distribution||{};

  // Gradient zieleni - najkrotsze dystanse najjasniejsze
  const n=dist.length||1;
  const bgs=dist.map((_,i)=>{
    const t=i/Math.max(n-1,1);
    const r=Math.round(132+(166-132)*(1-t));
    const g=Math.round(195+(232-195)*(1-t));
    const bl=Math.round(65+(74-65)*(1-t));
    return `rgba(${r},${g},${bl},0.85)`;
  });

  const med=d.median_m!=null?d.median_m:null;
  const avg=d.avg_m!=null?d.avg_m:null;
  const refLines=[];
  if(med!=null) refLines.push({value:med,axis:'y',color:'#86a86a',lineWidth:2});
  if(avg!=null) refLines.push({value:avg,axis:'y',color:'#c79257',lineWidth:2});

  const legEl=document.getElementById('spol-knn-legend');
  if(legEl){
    const parts=[];
    if(med!=null) parts.push(`<span class="lg-item" style="color:#86a86a"><span class="lg-line"></span>MED ${Math.round(med)} m</span>`);
    if(avg!=null) parts.push(`<span class="lg-item" style="color:#c79257"><span class="lg-line"></span>AVG ${Math.round(avg)} m</span>`);
    legEl.innerHTML=parts.join('');
  }

  destroyChart('spol-knn');
  CHARTS['spol-knn']=new Chart(document.getElementById('spol-knnChart'),{
    type:'bar',
    data:{
      labels:dist.map(d=>d.bucket),
      datasets:[{
        data:dist.map(d=>d.cnt),
        backgroundColor:bgs,
        borderWidth:0,borderRadius:[4,4,0,0]
      }]
    },
    options:{
      indexAxis:'x',responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{enabled:false},
        annot:{refLines},
        barLabels:{thousands:true,color:C.muted},
      },
      scales:{
        x:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}}
      }
    }
  });

  const maxKm=loner.nearest_neighbor_distance_meters
    ?(loner.nearest_neighbor_distance_meters/1000).toFixed(1).replace('.',',')+' km'
    :(d.max_m?(d.max_m/1000).toFixed(1).replace('.',',')+' km':'–');
  const maxEl=document.getElementById('spol-knn-stat-max');if(maxEl)maxEl.textContent=maxKm;
}

export {wireInpostLevel};
