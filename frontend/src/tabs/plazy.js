import Chart from 'chart.js/auto';
import * as d3 from 'd3';
import L from 'leaflet';
import 'leaflet.heat';
import { C } from '../config.js';
import { M, CHARTS, MAPS } from '../state.js';
import { fmt, getFont, destroyChart, leafletDark } from '../utils.js';

export function renderPlazy(){
  drawBeeswarm();
  renderPlazyMap();
  renderFrogVoiv();
  renderFrogScatter();
  renderFrogTop10();
}

export function drawBeeswarm(){
  const cv=document.getElementById('canvas-beeswarm');
  const W=cv.offsetWidth||1200;cv.width=W;cv.height=300;
  const ctx=cv.getContext('2d');
  ctx.fillStyle=C.bg;ctx.fillRect(0,0,W,300);
  const stores=M.amphibian_extremes.stores||[];
  const logScale=d3.scaleLog().domain([1,2100]).range([60,W-60]).clamp(true);
  const teals=['#0a2a2a','#0d4040','#0f5a52','#00b4c8','#00e0d0'];
  const tealsScale=d3.scaleLog().domain([1,2100]).range([0,4]).clamp(true);
  const bucketStacks={};const BW=Math.ceil(W/120);
  stores.forEach(([,,occ])=>{if(occ===0)return;const bx=Math.floor(logScale(occ)/BW);bucketStacks[bx]=(bucketStacks[bx]||0)+1});
  const bucketCurr={};
  stores.forEach(([lat,lon,occ])=>{
    if(occ===0)return;
    const x=Math.round(logScale(occ));
    const bx=Math.floor(x/BW);
    const si=(bucketCurr[bx]||0);bucketCurr[bx]=si+1;
    const cy2=150+(si%2===0?1:-1)*Math.ceil(si/2)*4.5;
    if(cy2<20||cy2>280)return;
    const ti=Math.floor(tealsScale(occ));
    ctx.fillStyle=teals[Math.min(ti,4)];ctx.globalAlpha=.75;
    ctx.beginPath();ctx.arc(x,cy2,2,0,Math.PI*2);ctx.fill();
  });
  ctx.globalAlpha=1;
  const urx=Math.round(logScale(2028));
  ctx.beginPath();ctx.arc(urx,150,6,0,Math.PI*2);ctx.fillStyle=C.teal;ctx.fill();
  ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;ctx.stroke();
  ctx.font=`11px '${getFont('body')}',sans-serif`;ctx.fillStyle=C.ink;
  ctx.textAlign='left';ctx.fillText('Ursynow (2 028)',urx+10,148);
  [1,10,100,1000].forEach(v=>{
    const x=logScale(v);
    ctx.fillStyle=C.muted;ctx.font=`10px '${getFont('mono')}',monospace`;
    ctx.textAlign='center';ctx.fillText(v,x,288);
    ctx.strokeStyle=C.axis;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,280);ctx.lineTo(x,284);ctx.stroke();
  });
  ctx.textAlign='left';
}

export function renderPlazyMap(){
  const map=leafletDark('map-plazy-main');map.setView([52,19.4],6);
  const stores=M.amphibian_extremes.stores||[];
  const maxOcc=Math.max(...stores.map(s=>s[2]),1);
  const tealScale=d3.scaleLog().domain([1,maxOcc]).range(['#0d3535','#00e0c8']);
  stores.forEach(([lat,lon,occ])=>{
    L.circleMarker([lat,lon],{radius:3,color:occ>0?tealScale(occ):'#2a2a3a',fillColor:occ>0?tealScale(occ):'#2a2a3a',fillOpacity:.7,weight:0})
     .bindTooltip(`${fmt(occ)} obserwacji plazow w 5 km`,{sticky:true}).addTo(map);
  });
  if(M.amphibian_extremes.gbif_obs&&typeof L.heatLayer==='function'){
    L.heatLayer(M.amphibian_extremes.gbif_obs.map(([lat,lon])=>[lat,lon,.5]),
      {radius:18,blur:15,maxZoom:12,gradient:{0:'transparent',.5:'rgba(0,180,200,.25)',1:'rgba(0,224,200,.55)'}}).addTo(map);
  }
  MAPS['plazy']=map;
}

export function renderFrogVoiv(){
  const data=[...(M.amphibian_extremes.by_voivodeship||[])].sort((a,b)=>b.avg_occurrences-a.avg_occurrences);
  if(!data.length)return;
  const maxV=data[0].avg_occurrences;
  destroyChart('frog-voiv');
  CHARTS['frog-voiv']=new Chart(document.getElementById('chart-frog-voiv'),{
    type:'bar',
    data:{labels:data.map(d=>d.voivodeship),datasets:[{data:data.map(d=>d.avg_occurrences),backgroundColor:data.map(d=>`rgba(0,180,200,${.25+.75*(d.avg_occurrences/maxV)})`),borderRadius:2,borderWidth:0}]},
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},annot:{refLines:[{value:84,axis:'x',color:'rgba(255,255,255,.2)'}]},tooltip:{callbacks:{label:ctx=>`sr. ${fmt(ctx.raw)} obserwacji`}}},
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}

export function renderFrogScatter(){
  const stores=M.amphibian_extremes.stores||[];
  const sample=stores.filter((s,i)=>i%3===0&&s[2]>0).slice(0,800);
  const maxOcc=Math.max(...sample.map(s=>s[2]),1);
  const tsc=d3.scaleLog().domain([1,maxOcc]).range(['#0d4040','#00e0c8']);
  destroyChart('frog-scatter');
  CHARTS['frog-scatter']=new Chart(document.getElementById('chart-frog-scatter'),{
    type:'scatter',
    data:{datasets:[{
      data:sample.map(s=>({x:+s[3].toFixed(2),y:Math.log10(s[2]+1),occ:s[2]})),
      backgroundColor:sample.map(s=>tsc(Math.max(s[2],1))),
      pointRadius:3,pointHoverRadius:7
    }]},
    options:{
      responsive:true,maintainAspectRatio:false,
      animation:{duration:800,easing:'easeOutQuart'},
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          label:ctx=>{const d=ctx.raw;return`${d.x.toFixed(1)} km od zaby — ${fmt(d.occ)} obs. w 5 km`}
        }}
      },
      scales:{
        x:{title:{display:true,text:'odleglosc do najblizszej obserwacji (km)',color:C.muted,font:{size:10}},ticks:{color:C.muted,font:{size:10}},grid:{color:C.axis}},
        y:{title:{display:true,text:'log10(obserwacje)',color:C.muted,font:{size:10}},ticks:{color:C.muted,font:{size:10}},grid:{color:C.axis}}
      }
    }
  });
}

export function renderFrogTop10(){
  const top10=M.amphibian_extremes.top10||[];
  destroyChart('frog-top10');
  CHARTS['frog-top10']=new Chart(document.getElementById('chart-frog-top10'),{
    type:'bar',
    data:{labels:top10.map(d=>d.city),datasets:[{data:top10.map(d=>d.occ),backgroundColor:C.teal+'cc',borderRadius:2,borderWidth:0}]},
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${fmt(ctx.raw)} obserwacji w 5 km`}}},
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}
