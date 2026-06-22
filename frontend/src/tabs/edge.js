import Chart from 'chart.js/auto';
import L from 'leaflet';
import { C } from '../config.js';
import { M, CHARTS, MAPS } from '../state.js';
import { fmt, getFont, destroyChart, projectPL, leafletDark, startTabParticles } from '../utils.js';
import { renderKraniec } from './kraniec.js';

let jumpedFact=null;

function _updateEdgeHeroLede(){
  const ledeEl=document.getElementById('hero-lede-edge');if(!ledeEl)return;
  const elevExt=(M.elevation&&M.elevation.extremes)||[];
  const top=elevExt.find(e=>e.which==='top');
  const bot=elevExt.find(e=>e.which==='bottom');
  const h24n=(M.summary&&M.summary.h24_count)||null;
  const voidVal=M.section3_rare&&M.section3_rare.void&&M.section3_rare.void.value;
  const hiStr=top?Math.round(top.elevation_meters)+' m':'963 m';
  const loStr=bot?String(bot.elevation_meters).replace('.',',')+' m':'−1,5 m';
  const h24Str=h24n!=null?h24n:35;
  const voidStr=voidVal?String(voidVal).replace('.',','):'46,5';
  ledeEl.textContent=`Od ${loStr} pod poziomem morza po ${hiStr} w Tatrach. ${h24Str} sklepów, które nigdy nie śpią. Jeden punkt w Polsce oddalony o ${voidStr} km od jakiejkolwiek Żabki.`;
}

// ===== CIEKAWOSTKI: KPI bar (frog data + min distance) =====
function renderCiekawostkiKPI(){
  const ae=M.amphibian_extremes||{};
  const ns=M.neighbor_stats||{};
  const el=id=>document.getElementById(id);

  // Most froggy
  if(ae.most_froggy){
    const mf=ae.most_froggy;
    if(el('ciek-kpi-froggy')) el('ciek-kpi-froggy').textContent=fmt(mf.amphibian_occurrences_5km||0);
    if(el('ciek-kpi-froggy-sub')) el('ciek-kpi-froggy-sub').textContent=`rekord: ${mf.city||''}`;
  }

  // Zero frogs count
  if(ae.zero_frog_count!=null&&el('ciek-kpi-dry'))
    el('ciek-kpi-dry').textContent=fmt(ae.zero_frog_count);

  // Farthest from frog
  if(ae.farthest_from_frog){
    const ff=ae.farthest_from_frog;
    const km=ff.nearest_amphibian_km?ff.nearest_amphibian_km.toFixed(2).replace('.',',')+' km':'—';
    if(el('ciek-kpi-farthest')) el('ciek-kpi-farthest').textContent=km;
    if(el('ciek-kpi-farthest-sub')) el('ciek-kpi-farthest-sub').textContent=ff.city||'';
  }

  // Zero distance count from neighbor stats
  const zeroCnt=ns.zero_distance_count||0;
  if(el('ciek-kpi-zero')){
    if(zeroCnt>0) el('ciek-kpi-zero').textContent='0 m ('+fmt(zeroCnt)+' par)';
    else el('ciek-kpi-zero').textContent='0 m';
  }
}

// ===== CIEKAWOSTKI: Elevation histogram =====
function renderCiekawostkiElev(){
  const hist=(M.elevation||{histogram:[]}).histogram.filter(d=>d.cnt>0);
  if(!hist.length){
    const wrap=document.querySelector('#ciek-c-elev .chart-wrap');
    if(wrap) wrap.innerHTML='<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;text-align:center;padding:20px">Dane wysokosciowe wymagaja uruchomienia ETL z flaga --elevation</div>';
    return;
  }
  const pcts=(M.elevation.percentiles)||{};
  const p5=pcts.p5!=null?pcts.p5:17;
  const p95=pcts.p95!=null?pcts.p95:332;
  const colors=hist.map(d=>(d.bucket_m>=p5&&d.bucket_m<=p95)?C.amber+'cc':C.amber+'30');

  // Update cnote
  const elev=M.elevation||{};
  if(elev.extremes&&elev.extremes.length>=2){
    const top=elev.extremes.find(e=>e.which==='top');
    const bot=elev.extremes.find(e=>e.which==='bottom');
    const cnoteEl=document.getElementById('ciek-elev-cnote');
    const capEl=document.getElementById('ciek-elev-cap-n');
    if(capEl){const n=hist.reduce((a,b)=>a+(b.cnt||0),0);if(n>0)capEl.textContent=n.toLocaleString('pl-PL');}
    if(cnoteEl&&top&&bot){
      const pRange=(pcts.p5!=null&&pcts.p95!=null)?`między ${pcts.p5} a ${pcts.p95} m`:'między 17 a 332 m';
      cnoteEl.innerHTML=`95% sieci mieści się ${pRange}. Rekordy: <b style="color:#f2a359">${top.city} ${(Math.round(top.elevation_meters*10)/10).toFixed(1).replace('.',',')} m</b> i <b style="color:#e8693d">${bot.city} ${bot.elevation_meters} m</b>.`;
    }
  }

  destroyChart('ciek-elev');
  CHARTS['ciek-elev']=new Chart(document.getElementById('ciek-elevChart'),{
    type:'bar',
    data:{labels:hist.map(d=>d.bucket_m+'m'),datasets:[{data:hist.map(d=>d.cnt),backgroundColor:colors,borderWidth:0,borderRadius:2}]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${fmt(ctx.raw)} sklepów`}}},
      scales:{x:{ticks:{color:C.muted,font:{size:9},maxRotation:45},grid:{display:false}},y:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:9}}}}
    }
  });
}

// ===== CIEKAWOSTKI: kNN distribution (more buckets) =====
function renderCiekawostkiKNN(){
  const ns=M.neighbor_stats||{};
  const dist=(ns.distribution||{buckets:[]}).buckets;
  const loner=ns.loner||{};

  // Per-bucket colors: green for close, amber for medium, red for far
  const bucketColor=label=>{
    if(label==='0 m') return C.lime+'cc';
    if(label.includes('<50')||label.includes('50-100')||label.includes('100-200')) return C.green+'cc';
    if(label.includes('200-350')||label.includes('350-500')) return C.amber+'aa';
    if(label.includes('500 m - 1')) return C.amber+'88';
    if(label.includes('1-3')) return '#e8916888';
    return C.red+'88';
  };

  destroyChart('ciek-knn');
  CHARTS['ciek-knn']=new Chart(document.getElementById('ciek-knnChart'),{
    type:'bar',
    data:{
      labels:dist.map(d=>d.bucket),
      datasets:[{
        data:dist.map(d=>d.cnt),
        backgroundColor:dist.map(d=>bucketColor(d.bucket)),
        borderWidth:0,borderRadius:[0,4,4,0]
      }]
    },
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${fmt(ctx.raw)} sklepów`}}},
      scales:{
        x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:9}}},
        y:{grid:{display:false},ticks:{color:C.muted,font:{size:11},font:{family:'IBM Plex Sans'}}}
      }
    }
  });

  // Update statline
  const d=ns.distribution||{};
  const med=d.median_m!=null?Math.round(d.median_m)+' m':'—';
  const avg=d.avg_m!=null?Math.round(d.avg_m)+' m':'—';
  const maxKm=loner.nearest_neighbor_distance_meters
    ?(loner.nearest_neighbor_distance_meters/1000).toFixed(1).replace('.',',')+' km'
    :(d.max_m?(d.max_m/1000).toFixed(1).replace('.',',')+' km':'—');
  const medEl=document.getElementById('ciek-stat-median');if(medEl)medEl.textContent=med;
  const avgEl=document.getElementById('ciek-stat-avg');if(avgEl)avgEl.textContent=avg;
  const maxEl=document.getElementById('ciek-stat-max');if(maxEl)maxEl.textContent=maxKm;
}

// ===== CIEKAWOSTKI: Parks donut (canvas, same style as powiat coverage in Siec tab) =====
function renderCiekawostkiParks(){
  const parks=(M.section3_rare&&M.section3_rare.parks)||{};
  const inPark=parks.count||0;
  const total=parks.total||(M.summary&&M.summary.total_active)||0;
  if(!total)return;
  const pctRaw=inPark/total*100;
  const pctStr=(Math.abs(pctRaw-Math.round(pctRaw))<0.05
    ?Math.round(pctRaw)
    :pctRaw.toFixed(1)
  ).toString().replace('.',',');

  const cnoteEl=document.getElementById('ciek-parks-cnote');
  if(cnoteEl) cnoteEl.textContent=`${fmt(inPark)} sklepów (${pctStr}%) stoi w parkach lub ich otulinach.`;
  const statEl=document.getElementById('ciek-parks-statline');
  if(statEl&&parks.top3&&parks.top3.length)
    statEl.innerHTML=parks.top3.map(p=>`<span>${p.park_name}: <b>${p.cnt}</b></span>`).join('');

  destroyChart('ciek-parks');

  const canvas=document.getElementById('ciek-parksChart');
  if(!canvas)return;
  const SIZE=200;
  canvas.width=SIZE; canvas.height=SIZE;
  canvas.style.cssText='display:block;margin:12px auto 0';

  const ctx=canvas.getContext('2d');
  const cx=SIZE/2,cy=SIZE/2,rr=SIZE/2-16;
  ctx.clearRect(0,0,SIZE,SIZE);
  ctx.lineCap='round';
  ctx.lineWidth=15;

  // Background track
  ctx.strokeStyle='rgba(132,195,65,.12)';
  ctx.beginPath();ctx.arc(cx,cy,rr,0,Math.PI*2);ctx.stroke();

  // Progress arc
  const f=Math.max(0,Math.min(1,pctRaw/100));
  ctx.strokeStyle=C.greenBright;
  ctx.beginPath();ctx.arc(cx,cy,rr,-Math.PI/2,-Math.PI/2+Math.PI*2*f);ctx.stroke();

  // Percentage label
  ctx.fillStyle=C.greenBright;
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.font=`800 ${Math.round(SIZE*0.21)}px '${getFont('display')}',sans-serif`;
  ctx.fillText(pctStr+'%',cx,cy-10);

  // Subtitle
  ctx.fillStyle=C.muted;
  ctx.font=`400 ${Math.round(SIZE*0.09)}px '${getFont('body')}',sans-serif`;
  ctx.fillText('w parkach lub otulinach',cx,cy+14);
}

// ===== CIEKAWOSTKI: Physical streets (top street+city pairs) =====
function renderCiekawostkiStreets(){
  const streets=(M.section3_rare&&M.section3_rare.physical_streets)||[];
  if(!streets.length)return;

  const top=streets.slice(0,10);

  // Strip "ul." prefix, basic normalization for all-caps names
  const cleanStreet=s=>{
    let st=s.replace(/^ul\.\s*/i,'').trim();
    if(st===st.toUpperCase()&&st.length>2) st=st[0]+st.slice(1).toLowerCase();
    return st.length>28?st.slice(0,27)+'…':st;
  };

  // Lime -> green gradient, brightest at top
  const bgs=top.map((_,i)=>{
    const t=i/Math.max(top.length-1,1);
    return `rgba(166,232,74,${0.92-t*0.52})`;
  });

  // Inline count label drawn at bar end
  const countPlugin={
    id:'ciekStreetLabels',
    afterDatasetsDraw(chart){
      const{ctx}=chart;
      const meta=chart.getDatasetMeta(0);
      ctx.save();
      ctx.textBaseline='middle';
      ctx.textAlign='left';
      ctx.font='600 11px "IBM Plex Sans",sans-serif';
      meta.data.forEach((bar,i)=>{
        const v=top[i]?top[i].cnt:0;
        ctx.fillStyle=i===0?'rgba(166,232,74,0.95)':'rgba(200,230,160,0.8)';
        ctx.fillText(v===1?'1 sklep':v+' sklepy',bar.x+6,bar.y);
      });
      ctx.restore();
    }
  };

  destroyChart('ciek-streets');
  CHARTS['ciek-streets']=new Chart(document.getElementById('ciek-streetsChart'),{
    type:'bar',
    plugins:[countPlugin],
    data:{
      labels:top.map(s=>[cleanStreet(s.street),s.city]),
      datasets:[{
        data:top.map(s=>s.cnt),
        backgroundColor:bgs,
        borderWidth:0,
        borderRadius:[0,5,5,0],
        barThickness:22,
      }]
    },
    options:{
      indexAxis:'y',
      responsive:true,
      maintainAspectRatio:false,
      layout:{padding:{right:88}},
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          title:ctx=>`${top[ctx[0].dataIndex].street}, ${top[ctx[0].dataIndex].city}`,
          label:ctx=>`${ctx.raw} ${ctx.raw===1?'sklep':'sklepy'} pod tym adresem`,
        }}
      },
      scales:{
        x:{
          grid:{color:C.axis},
          min:0,
          ticks:{color:C.muted,font:{size:9},stepSize:1,precision:0},
        },
        y:{
          grid:{display:false},
          ticks:{color:C.muted,font:{size:10},crossAlign:'far'},
        }
      }
    }
  });
}

// ===== CIEKAWOSTKI: P3 frog density by voivodeship =====
function renderCiekawostkiFrogVoiv(){
  const data=[...(M.amphibian_extremes.by_voivodeship||[])].sort((a,b)=>b.avg_occurrences-a.avg_occurrences);
  if(!data.length)return;
  const maxV=data[0].avg_occurrences;
  destroyChart('frog-voiv-edge');
  CHARTS['frog-voiv-edge']=new Chart(document.getElementById('chart-frog-voiv-edge'),{
    type:'bar',
    data:{
      labels:data.map(d=>d.voivodeship),
      datasets:[{
        data:data.map(d=>d.avg_occurrences),
        backgroundColor:data.map(d=>`rgba(0,180,200,${.25+.75*(d.avg_occurrences/maxV)})`),
        borderRadius:2,borderWidth:0
      }]
    },
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`sr. ${fmt(ctx.raw)} obserwacji`}}},
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}

// ===== CIEKAWOSTKI: P4 frog scatter =====
function _logColorScale2(dMin,dMax,cA,cB){
  const lMin=Math.log(dMin),lRange=Math.log(dMax)-lMin;
  const h=s=>[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)];
  const [ar,ag,ab]=h(cA),[br,bg,bb]=h(cB);
  return x=>{const t=Math.max(0,Math.min(1,(Math.log(Math.max(x,dMin))-lMin)/lRange));
    const r=Math.round(ar+(br-ar)*t),g=Math.round(ag+(bg-ag)*t),b=Math.round(ab+(bb-ab)*t);
    return`#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;};
}
function renderCiekawostkiFrogScatter(){
  const ae=M.amphibian_extremes||{};
  const scatter=ae.scatter_sample||[];
  const stores=ae.stores||[];
  let pts=[];
  if(scatter.length) pts=scatter.filter(p=>p[0]>0&&p[1]>0);
  else pts=stores.filter((_,i)=>i%3===0&&_[2]>0&&_[3]>0).slice(0,300).map(s=>[s[3],s[2]]);
  if(!pts.length)return;
  const maxOcc=Math.max(...pts.map(p=>p[1]),1);
  const tsc=_logColorScale2(1,maxOcc,'#0d4040','#00e0c8');
  const xLabel=scatter.length?'liczba Żabek w promieniu 5 km':'odległość do najbl. obserwacji (km)';
  destroyChart('frog-scatter-edge');
  CHARTS['frog-scatter-edge']=new Chart(document.getElementById('chart-frog-scatter-edge'),{
    type:'scatter',
    data:{datasets:[{
      data:pts.map(p=>({x:p[0],y:p[1]})),
      backgroundColor:pts.map(p=>tsc(Math.max(p[1],1))),
      pointRadius:4,pointHoverRadius:7
    }]},
    options:{
      responsive:true,maintainAspectRatio:false,
      animation:{duration:800,easing:'easeOutQuart'},
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:ctx=>`${ctx.raw.x} · ${fmt(ctx.raw.y)} obs.`}}
      },
      scales:{
        x:{type:scatter.length?'logarithmic':'linear',title:{display:true,text:xLabel,color:C.muted,font:{size:10}},ticks:{color:C.muted,font:{size:10}},grid:{color:C.axis}},
        y:{type:'logarithmic',title:{display:true,text:'obserwacje płazów w 5 km',color:C.muted,font:{size:10}},ticks:{color:C.muted,font:{size:10}},grid:{color:C.axis}}
      }
    }
  });
}

export function renderEdge(){
  startTabParticles('particles-edge',[96,200,148],42);
  _updateEdgeHeroLede();
  // Ciekawostki section
  renderCiekawostkiKPI();
  renderCiekawostkiElev();
  renderCiekawostkiKNN();
  renderCiekawostkiParks();
  renderCiekawostkiStreets();
  renderCiekawostkiFrogVoiv();
  renderCiekawostkiFrogScatter();
  // Wartosci brzegowe section
  renderKraniec();
  populateFactCards();
  renderEdgeMap();
  renderElevHist();
  renderNeighborDist();
  drawH24Mini();
  drawParksDonut();
  drawVoidMini();
  renderCivicStreets();
  fillFrogStreets();
  renderParksMap();
}

export function populateFactCards(){
  if(!M.kraniec_facts||!M.kraniec_facts.length)return;
  const byId={};M.kraniec_facts.forEach(f=>byId[f.id]=f);
  ['north','south','east','west','highest','lowest','isolated','void','frogstreet'].forEach(id=>{
    const f=byId[id];if(!f)return;
    const card=document.querySelector(`[data-fact-id="${id}"]`);if(!card)return;
    const bigEl=card.querySelector('.fact-big');
    const cityEl=card.querySelector('.fact-city');
    const streetEl=card.querySelector('.fact-street');
    if(bigEl&&f.value)bigEl.textContent=f.value;
    if(cityEl&&f.city)cityEl.textContent=f.city+(f.voivodeship?', '+f.voivodeship:'');
    if(streetEl&&f.street)streetEl.textContent=f.street;
  });

  const h24Count=M.section3_rare&&M.section3_rare.h24_cities
    ?(M.summary&&M.summary.h24_count)||0:0;
  const e1big=document.querySelector('[data-debug-id="E1"]');
  if(e1big){const fb=e1big.closest('.card')?.querySelector('.fact-big');if(fb&&h24Count)fb.textContent=fmt(h24Count);}

  const parks=(M.section3_rare&&M.section3_rare.parks)||{};
  const e2big=document.getElementById('kr-e2-parks-count');
  if(e2big&&parks.count)e2big.textContent=fmt(parks.count);
}

export function renderEdgeMap(){
  const map=leafletDark('map-edge');map.setView([52,19.4],6);
  M.points_sample.forEach(([lat,lon])=>{
    L.circleMarker([lat,lon],{radius:1.5,color:'#1f3a26',fillColor:'#1f3a26',fillOpacity:.5,weight:0}).addTo(map);
  });
  const gc={compass:C.green,elevation:C.amber,isolation:C.teal,amphibian:C.teal,street:C.teal,void:C.red};
  const markers={};
  M.kraniec_facts.forEach(fact=>{
    const col=gc[fact.group]||C.green;
    let m;
    if(fact.type==='void'){
      m=L.circleMarker([fact.lat,fact.lon],{radius:8,color:col,fillColor:col,fillOpacity:.3,weight:2});
      L.circle([fact.lat,fact.lon],{radius:46520,color:col,fill:false,weight:1.5,dashArray:'6,4'}).addTo(map);
    }else{
      m=L.circleMarker([fact.lat,fact.lon],{radius:7,color:col,fillColor:col,fillOpacity:.8,weight:2});
    }
    m.bindPopup(`<b style="color:${col}">${fact.value}</b><br>${fact.city}, ${fact.voivodeship}<br><small>${fact.street}</small>`);
    m.addTo(map);markers[fact.id]=m;
  });
  MAPS['edge-markers']=markers;MAPS.edge=map;
}

export function jumpToFact(id){
  const fact=M.kraniec_facts.find(f=>f.id===id);if(!fact||!MAPS.edge)return;
  jumpedFact=id;
  document.querySelectorAll('.fact-card').forEach(c=>c.classList.remove('jumped'));
  const card=document.querySelector(`[data-fact-id="${id}"]`);
  if(card)card.classList.add('jumped');
  const mapCard=document.getElementById('map-edge').closest('.card');
  if(mapCard)mapCard.scrollIntoView({behavior:'smooth',block:'center'});
  const back=document.getElementById('edge-back-btn');if(back)back.classList.add('visible');
  setTimeout(()=>{
    const prefRed=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    if(prefRed)MAPS.edge.setView([fact.lat,fact.lon],fact.zoom||10);
    else MAPS.edge.flyTo([fact.lat,fact.lon],fact.zoom||10,{duration:.8,easeLinearity:.5});
    const m=MAPS['edge-markers'];if(m&&m[id])m[id].openPopup();
  },500);
}

export function jumpBack(){
  if(!MAPS.edge)return;
  MAPS.edge.flyTo([52,19.4],6,{duration:.6});
  const m=MAPS['edge-markers'];if(m)Object.values(m).forEach(mk=>mk.closePopup&&mk.closePopup());
  document.querySelectorAll('.fact-card').forEach(c=>c.classList.remove('jumped'));
  const back=document.getElementById('edge-back-btn');if(back)back.classList.remove('visible');
  jumpedFact=null;
}

export function jumpToH24(){
  if(!MAPS.edge)return;
  const back=document.getElementById('edge-back-btn');if(back)back.classList.add('visible');
  const mapCard=document.getElementById('map-edge').closest('.card');
  if(mapCard)mapCard.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(()=>MAPS.edge.flyTo([51.94,15.50],8,{duration:.8}),500);
}

export function jumpToParks(){
  const pc=document.getElementById('parks-map-card');
  if(pc)pc.scrollIntoView({behavior:'smooth',block:'center'});
}

export function renderElevHist(){
  const hist=(M.elevation.histogram||[]).filter(d=>d.cnt>0);
  const pcts=(M.elevation.percentiles)||{};
  const p5=pcts.p5!=null?pcts.p5:17;
  const p95=pcts.p95!=null?pcts.p95:332;
  const colors=hist.map(d=>(d.bucket_m>=p5&&d.bucket_m<=p95)?C.amber+'99':C.amber+'30');
  destroyChart('elev-hist');
  CHARTS['elev-hist']=new Chart(document.getElementById('chart-elev-hist'),{
    type:'bar',
    data:{labels:hist.map(d=>d.bucket_m+'m'),datasets:[{data:hist.map(d=>d.cnt),backgroundColor:colors,borderWidth:0,borderRadius:2}]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:ctx=>`${fmt(ctx.raw)} sklepow`}},
        annot:{shadedBands:[{x1:p5,x2:p95,color:'rgba(245,166,35,.07)'}]}
      },
      scales:{x:{ticks:{color:C.muted,font:{size:9},maxRotation:45},grid:{display:false}},y:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:9}}}}
    }
  });
}

export function renderNeighborDist(){
  const ns=M.neighbor_stats||{};
  const dist=(ns.distribution||{buckets:[]}).buckets;
  destroyChart('neighbor-dist');
  CHARTS['neighbor-dist']=new Chart(document.getElementById('chart-neighbor-dist'),{
    type:'bar',
    data:{labels:dist.map(d=>d.bucket),datasets:[{data:dist.map(d=>d.cnt),backgroundColor:C.teal+'99',borderWidth:0,borderRadius:3}]},
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${fmt(ctx.raw)} sklepow`}}},
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
  const d=ns.distribution||{};
  const loner=ns.loner||{};
  if(d.median_m!=null){
    const med=Math.round(d.median_m)+' m';
    const avg=Math.round(d.avg_m)+' m';
    const maxKm=loner.nearest_neighbor_distance_meters
      ?(loner.nearest_neighbor_distance_meters/1000).toFixed(1).replace('.',',')+' km'
      :(d.max_m?(d.max_m/1000).toFixed(1).replace('.',',')+' km':'—');
    const medEl=document.getElementById('c2-stat-med');if(medEl)medEl.textContent=med;
    const avgEl=document.getElementById('c2-stat-avg');if(avgEl)avgEl.textContent=avg;
    const maxEl=document.getElementById('c2-stat-max');if(maxEl)maxEl.textContent=maxKm;
    const titleEl=document.getElementById('c2-card-title');
    if(titleEl)titleEl.textContent=`Połowa sieci ma sąsiada bliżej niż ${Math.round(d.median_m)} m - ogon sięga ${maxKm}`;
  }
}

export function drawH24Mini(){
  const cv=document.getElementById('canvas-h24-mini');
  const W=cv.offsetWidth||200;cv.width=W;cv.height=100;
  const ctx=cv.getContext('2d');
  ctx.fillStyle=C.surface;ctx.fillRect(0,0,W,100);
  const pts=M.section3_rare.h24_points||[];
  pts.forEach(([lat,lon])=>{
    const p=projectPL(lat,lon,W,100);
    ctx.fillStyle=C.amber+'cc';ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();
  });
  const el=document.getElementById('h24-cities-list');
  if(el)(M.section3_rare.h24_cities||[]).forEach(c=>{
    const div=document.createElement('div');div.textContent=c.city+' ('+c.cnt+')';el.appendChild(div);
  });
}

export function drawParksDonut(){
  const cv=document.getElementById('canvas-parks-donut');
  const S=100;cv.width=S;cv.height=S;
  const ctx=cv.getContext('2d');ctx.clearRect(0,0,S,S);
  const parksCount=(M.section3_rare.parks&&M.section3_rare.parks.count)||0;
  const totalAct=(M.summary&&M.summary.total_active)||0;
  if(!totalAct)return;
  const cx=S/2,cy=S/2,R=S/2-6,pct=parksCount/totalAct;
  ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.strokeStyle=C.axis;ctx.lineWidth=8;ctx.stroke();
  ctx.beginPath();ctx.arc(cx,cy,R,-Math.PI/2,-Math.PI/2+pct*2*Math.PI);ctx.strokeStyle=C.green;ctx.lineWidth=8;ctx.stroke();
  ctx.fillStyle=C.ink;ctx.font=`bold 13px '${getFont('display')}',sans-serif`;
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText((pct*100).toFixed(1)+'%',cx,cy);
  const el=document.getElementById('parks-top3');
  if(el)el.innerHTML=(M.section3_rare.parks.top3||[]).map(p=>`${p.park_name}: ${p.cnt}`).join('<br>');
}

export function drawVoidMini(){
  const cv=document.getElementById('canvas-void-mini');
  const W=cv.offsetWidth||200;cv.width=W;cv.height=100;
  const ctx=cv.getContext('2d');
  ctx.fillStyle=C.surface;ctx.fillRect(0,0,W,100);
  M.points_sample.slice(0,400).forEach(([lat,lon])=>{
    const p=projectPL(lat,lon,W,100);
    ctx.fillStyle='rgba(0,192,96,.4)';ctx.beginPath();ctx.arc(p.x,p.y,1,0,Math.PI*2);ctx.fill();
  });
  const vp=projectPL(49.01,22.89,W,100);
  ctx.beginPath();ctx.arc(vp.x,vp.y,18,0,Math.PI*2);
  ctx.strokeStyle=C.red;ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([]);
}

export function renderCivicStreets(){
  // kept for legacy calls - canvas may not exist now
  const canvas=document.getElementById('chart-civic-streets');
  if(!canvas)return;
  const cs=M.section3_rare.civic_streets;
  destroyChart('civic-streets');
  CHARTS['civic-streets']=new Chart(canvas,{
    type:'bar',
    data:{labels:['Rynek','Kosciuszki','Pilsudskiego','Wojska Polskiego','Mickiewicza','Jana Pawla II'],
          datasets:[{data:[cs.rynek,cs.kosciuszki,cs.pilsudskiego,cs.wojska_polskiego,cs.mickiewicza,cs.jana_pawla_ii],backgroundColor:C.green+'88',borderRadius:2,borderWidth:0}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:9}}},y:{grid:{display:false},ticks:{color:C.muted,font:{size:9}}}}}
  });
}

export function fillFrogStreets(){
  const list=M.section3_rare.frog_streets||[];
  const el=document.getElementById('frog-streets-list');
  if(el)el.innerHTML=list.slice(1,5).map(s=>`${s.street}, ${s.city}`).join('<br>');
}

export function renderParksMap(){
  const map=leafletDark('map-parks');map.setView([52,19.4],6);
  const parks=[
    {name:'Tatrzanski NP',lat:49.22,lon:19.97,type:'national'},
    {name:'Bialowieski NP',lat:52.70,lon:23.88,type:'national'},
    {name:'Kampinoski NP',lat:52.33,lon:20.47,type:'national'},
    {name:'Wolinski NP',lat:53.92,lon:14.50,type:'national'},
    {name:'Slowiński NP',lat:54.50,lon:17.50,type:'national'},
    {name:'Beskid Slaski LP',lat:49.70,lon:18.90,type:'landscape'},
    {name:'Kaszubski LP',lat:54.20,lon:18.00,type:'landscape'},
    {name:'Puszcza Rominiecka LP',lat:54.20,lon:22.70,type:'landscape'},
    {name:'Zalewy Warty LP',lat:52.60,lon:16.10,type:'landscape'},
    {name:'Roztocze LP',lat:50.40,lon:22.90,type:'landscape'},
  ];
  parks.forEach(p=>{
    const col=p.type==='national'?C.amber:C.teal;
    L.circleMarker([p.lat,p.lon],{radius:8,color:col,fillColor:col,fillOpacity:.7,weight:2})
      .bindTooltip(`<b>${p.name}</b><br>${p.type==='national'?'Park narodowy':'Park krajobrazowy'}`,{sticky:true})
      .addTo(map);
  });
  const legend=L.control({position:'bottomright'});
  legend.onAdd=()=>{
    const div=L.DomUtil.create('div');
    div.style.cssText='background:rgba(13,13,20,.85);padding:8px 12px;border-radius:6px;font-size:11px;color:#7a7a90;border:1px solid #2a2a3a';
    div.innerHTML=`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="width:10px;height:10px;background:${C.amber};border-radius:50%;display:inline-block"></span>Park narodowy</div><div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;background:${C.teal};border-radius:50%;display:inline-block"></span>Park krajobrazowy</div>`;
    return div;
  };
  legend.addTo(map);
  MAPS['parks']=map;
}
