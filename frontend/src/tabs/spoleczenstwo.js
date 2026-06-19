import Chart from 'chart.js/auto';
import L from 'leaflet';
import { C, STATE } from '../config.js';
import { M, CHARTS } from '../state.js';
import { fmt, macroCol, getFont, destroyChart, leafletDark } from '../utils.js';
import { setFilter } from '../filter.js';

export function renderSpoleczenstwo(){
  renderScatters();
  renderSundayChoropleth();
  renderDensityChoropleth();
  renderMerrychef();
  renderDumbbell();
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
      l.on('click',()=>setFilter(STATE.filter===f.properties.name?null:f.properties.name));
    }
  }).addTo(map);
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
  destroyChart('merrychef');
  CHARTS['merrychef']=new Chart(document.getElementById('chart-merrychef'),{
    type:'bar',
    data:{labels:data.map(d=>d.voivodeship),datasets:[{data:data.map(d=>d.mc_pct),backgroundColor:data.map(d=>d.voivodeship.toLowerCase().includes('dolno')||d.mc_pct<93?C.amber:C.green+'aa'),borderRadius:2,borderWidth:0}]},
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.raw}% z Merrychef`}},annot:{refLines:[{value:97.4,axis:'x',color:'rgba(255,255,255,.25)'}]}},
      scales:{x:{min:88,max:100,grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}

export function renderDumbbell(){
  const data=[...M.inpost_vs_zabka].sort((a,b)=>b.ratio-a.ratio);
  const el=document.getElementById('inpost-dumbbell');if(!el)return;
  const allVals=data.flatMap(d=>[d.zabki_per_100k||0,d.lockers_per_100k||0]);
  const maxV=Math.max(...allVals,1);
  const ROW=32,PAD_L=140,PAD_R=70,W_CHART=440,H=data.length*ROW+40;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox',`0 0 ${PAD_L+W_CHART+PAD_R} ${H}`);
  svg.style.cssText=`width:100%;min-width:520px;display:block;background:transparent`;
  function px(v){return PAD_L+v/maxV*W_CHART}
  [0.25,0.5,0.75,1.0].forEach(f=>{
    const x=px(maxV*f);
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',x);line.setAttribute('y1',20);line.setAttribute('x2',x);line.setAttribute('y2',H-10);
    line.setAttribute('stroke','#2a2a3a');line.setAttribute('stroke-width','0.8');
    svg.appendChild(line);
    const lbl=document.createElementNS('http://www.w3.org/2000/svg','text');
    lbl.setAttribute('x',x);lbl.setAttribute('y',14);lbl.setAttribute('text-anchor','middle');
    lbl.setAttribute('fill','#7a7a90');lbl.setAttribute('font-size','9');
    lbl.textContent=(maxV*f).toFixed(0);svg.appendChild(lbl);
  });
  data.forEach((d,i)=>{
    const y=28+i*ROW;
    const xz=px(d.zabki_per_100k||0),xi=px(d.lockers_per_100k||0);
    const isFiltered=STATE.filter&&d.voivodeship.toLowerCase()!==STATE.filter.toLowerCase();
    const alpha=isFiltered?'0.2':'1';
    const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
    ln.setAttribute('x1',Math.min(xz,xi));ln.setAttribute('y1',y);ln.setAttribute('x2',Math.max(xz,xi));ln.setAttribute('y2',y);
    ln.setAttribute('stroke','#3a3a4a');ln.setAttribute('stroke-width','2');ln.setAttribute('opacity',alpha);
    svg.appendChild(ln);
    const cz=document.createElementNS('http://www.w3.org/2000/svg','circle');
    cz.setAttribute('cx',xz);cz.setAttribute('cy',y);cz.setAttribute('r','6');
    cz.setAttribute('fill',C.green);cz.setAttribute('opacity',alpha);
    svg.appendChild(cz);
    const ci=document.createElementNS('http://www.w3.org/2000/svg','circle');
    ci.setAttribute('cx',xi);ci.setAttribute('cy',y);ci.setAttribute('r','6');
    ci.setAttribute('fill',C.amber);ci.setAttribute('opacity',alpha);
    svg.appendChild(ci);
    const lbl=document.createElementNS('http://www.w3.org/2000/svg','text');
    lbl.setAttribute('x',PAD_L-8);lbl.setAttribute('y',y+4);lbl.setAttribute('text-anchor','end');
    lbl.setAttribute('fill',isFiltered?'#3a3a5a':'#c8c8d8');lbl.setAttribute('font-size','11');
    lbl.textContent=d.voivodeship;svg.appendChild(lbl);
    const rb=document.createElementNS('http://www.w3.org/2000/svg','text');
    rb.setAttribute('x',PAD_L+W_CHART+6);rb.setAttribute('y',y+4);
    rb.setAttribute('fill','#7a7a90');rb.setAttribute('font-size','10');
    rb.textContent=d.ratio+'x';svg.appendChild(rb);
  });
  const LEG_Y=H-4;
  [[C.green,'Zabka/100k'],[C.amber,'InPost/100k']].forEach(([col,lbl],i)=>{
    const cx2=PAD_L+60+i*120;
    const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('cx',cx2);c.setAttribute('cy',LEG_Y);c.setAttribute('r','5');c.setAttribute('fill',col);
    svg.appendChild(c);
    const t=document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('x',cx2+9);t.setAttribute('y',LEG_Y+4);t.setAttribute('fill','#7a7a90');t.setAttribute('font-size','10');
    t.textContent=lbl;svg.appendChild(t);
  });
  el.innerHTML='';el.appendChild(svg);
}
