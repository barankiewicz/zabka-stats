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

export function renderEdge(){
  // Cool seafoam green — slightly cooler/more geographic feel
  startTabParticles('particles-edge',[96,200,148],42);
  _updateEdgeHeroLede();
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
  // include void + frogstreet so those cards also get API values
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

  // E1: h24 count (fact-big + canvas caption + mini card)
  const h24Count = M.section3_rare && M.section3_rare.h24_cities
    ? (M.summary && M.summary.h24_count) || 0
    : 0;
  const h24el = document.querySelector('[data-debug-id="E1"] + .fact-big');
  // The E1 card has the count in .fact-big with amber color
  const e1big = document.querySelector('[data-debug-id="E1"]');
  if(e1big){
    const fb=e1big.closest('.card')?.querySelector('.fact-big');
    if(fb&&h24Count)fb.textContent=fmt(h24Count);
  }
  // E2: parks count via section3_rare
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
  const colors=hist.map(d=>(d.bucket_m>=0&&d.bucket_m<=350)?C.amber+'99':C.amber+'30');
  destroyChart('elev-hist');
  CHARTS['elev-hist']=new Chart(document.getElementById('chart-elev-hist'),{
    type:'bar',
    data:{labels:hist.map(d=>d.bucket_m+'m'),datasets:[{data:hist.map(d=>d.cnt),backgroundColor:colors,borderWidth:0,borderRadius:2}]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:ctx=>`${fmt(ctx.raw)} sklepow`}},
        annot:{shadedBands:[{x1:17,x2:332,color:'rgba(245,166,35,.07)'}]}
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
  const cs=M.section3_rare.civic_streets;
  destroyChart('civic-streets');
  CHARTS['civic-streets']=new Chart(document.getElementById('chart-civic-streets'),{
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
