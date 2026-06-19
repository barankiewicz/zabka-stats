import Chart from 'chart.js/auto';
import { C, STATE } from '../config.js';
import { M, CHARTS, MAPS } from '../state.js';
import { era, eraName, fmt, macroCol, getFont, destroyChart } from '../utils.js';
import { setFilter } from '../filter.js';

export function renderSiec(){
  renderOriginCards();
  renderGrowthStacked();
  drawSpiral();
  drawFingerprint();
  renderStackedArea();
  renderPerCapita();
  renderCityCoverage();
  renderTopCities();
  drawClock();
  renderHoursBar();
  initBurstToggle();
}

export function renderOriginCards(){
  const o=M.network_origin;if(!o||!o.oldest)return;
  document.getElementById('oldest-date').textContent=o.oldest.first_opening_date;
  document.getElementById('oldest-city').textContent=o.oldest.city;
  document.getElementById('oldest-street').textContent=o.oldest.street+', '+o.oldest.voivodeship;
  document.getElementById('newest-date').textContent=o.newest.first_opening_date;
  document.getElementById('newest-city').textContent=o.newest.city;
  document.getElementById('newest-street').textContent=o.newest.street+', '+o.newest.voivodeship;
  document.getElementById('new-month-count').textContent=o.new_this_month;
}

export function renderGrowthStacked(){
  const data=M.network_growth;
  const labels=data.map(d=>d.year);
  const barColors=data.map(d=>{if(d.year>=2023)return C.green+'dd';if(d.year>=2010)return C.green+'66';return C.green+'33'});
  const ERAS=[{x1:1998,x2:2009,color:'rgba(10,48,24,.25)',label:'Wczesna siec'},{x1:2010,x2:2019,color:'rgba(26,96,53,.2)',label:'Wzrost'},{x1:2020,x2:2022,color:'rgba(64,192,112,.12)',label:'Przyspieszenie'},{x1:2023,x2:2026,color:'rgba(128,255,144,.1)',label:'Boom'}];
  const MILESTONES=[{value:1000,yr:null},{value:2000,yr:null},{value:5000,yr:null},{value:10000,yr:null}];
  MILESTONES.forEach(m=>{const idx=data.findIndex(d=>d.cumulative>=m.value);if(idx>=0)m.yr=data[idx].year});
  destroyChart('growth-bars');destroyChart('growth-line');
  const sharedOpts={responsive:true,maintainAspectRatio:false};
  CHARTS['growth-bars']=new Chart(document.getElementById('chart-growth-bars'),{
    type:'bar',
    data:{labels,datasets:[{data:data.map(d=>d.new_stores),backgroundColor:barColors,borderRadius:2,borderWidth:0}]},
    options:{
      ...sharedOpts,
      plugins:{
        legend:{display:false},
        tooltip:{mode:'index',intersect:false,callbacks:{title:i=>'Rok '+i[0].label,label:ctx=>`Nowych: ${fmt(ctx.raw)}`,afterBody(items){return`Era: ${eraName(data[items[0].dataIndex]?.year)}`}}},
        annot:{shadedBands:ERAS}
      },
      scales:{
        x:{grid:{display:false},ticks:{display:false}},
        y:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}},title:{display:true,text:'nowych/rok',color:C.muted,font:{size:9}}}
      }
    }
  });
  CHARTS['growth-line']=new Chart(document.getElementById('chart-growth-line'),{
    type:'line',
    data:{labels,datasets:[{data:data.map(d=>d.cumulative),borderColor:C.amber,backgroundColor:'rgba(245,166,35,.05)',fill:true,borderWidth:2,pointRadius:data.map((_,j)=>MILESTONES.some(m=>m.yr===data[j]?.year)?4:0),tension:.4}]},
    options:{
      ...sharedOpts,
      plugins:{
        legend:{display:false},
        tooltip:{mode:'index',intersect:false,callbacks:{title:i=>'Rok '+i[0].label,label:ctx=>`Lacznie: ${fmt(ctx.raw)}`}},
        annot:{
          shadedBands:ERAS,
          refLines:MILESTONES.filter(m=>m.yr).map(m=>({value:m.value,axis:'y',color:'rgba(255,255,255,.12)'}))
        }
      },
      scales:{
        x:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{color:C.axis},ticks:{color:C.amber,font:{size:10}},title:{display:true,text:'lacznie aktywnych',color:C.amber,font:{size:9}}}
      }
    }
  });
}

let spiralCache=null;
let spiralRaf=null;
let spiralMouse={x:-999,y:-999};
let spiralActive=false;

export function drawSpiral(){
  const cv=document.getElementById('canvas-spiral');
  const W=cv.offsetWidth||680;
  cv.width=W;cv.height=W;
  const ctx=cv.getContext('2d');
  const cx=W/2,cy=W/2;
  const a=28,b=7.8,SCALE=0.257*(W/720);
  const stores=M.stores_timeline.stores||[];
  const byYear={};
  for(const[,,yr]of stores)byYear[yr]=(byYear[yr]||0)+1;
  spiralCache={dots:[],yearData:{}};
  const idx={};
  for(const yr in byYear)idx[yr]=0;
  for(const[,,yr]of stores){
    const i=idx[yr]++;
    const total=byYear[yr];
    const frac=total>1?i/total:0;
    const theta=(yr-1998+frac)*2*Math.PI;
    const r=(a+b*theta)*SCALE;
    const jt=theta+(Math.random()-.5)*.09;
    const jr=r+(Math.random()-.5)*2.5*SCALE;
    const ox=cx+jr*Math.cos(jt-Math.PI/2);
    const oy=cy+jr*Math.sin(jt-Math.PI/2);
    spiralCache.dots.push({ox,oy,x:ox,y:oy,vx:0,vy:0,yr});
  }
  M.network_growth.forEach(d=>{spiralCache.yearData[d.year]={new_stores:d.new_stores,cumulative:d.cumulative}});
  renderSpiralFrame(ctx,cx,cy,a,b,SCALE,W);
  cv.addEventListener('mousemove',e=>{
    const rect=cv.getBoundingClientRect();
    spiralMouse.x=(e.clientX-rect.left)*(W/rect.width);
    spiralMouse.y=(e.clientY-rect.top)*(W/rect.height);
    updateSpiralCard(a,b,SCALE,cx,cy,W);
    if(!spiralActive){spiralActive=true;spiralLoop(ctx,cx,cy,a,b,SCALE,W)}
  });
  cv.addEventListener('mouseleave',()=>{
    spiralMouse.x=-999;spiralMouse.y=-999;
    document.getElementById('sp-hint').textContent='Najedz na spirale';
    document.getElementById('sp-year').textContent='—';
  });
}

function spiralLoop(ctx,cx,cy,a,b,SCALE,W){
  if(!spiralCache)return;
  const mx=spiralMouse.x,my=spiralMouse.y;
  const R=55,REP=900,K=0.10,DAMP=0.80;
  let hasMove=false;
  spiralCache.dots.forEach(dot=>{
    const dx=dot.x-mx,dy=dot.y-my;
    const dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<R&&dist>0.5){
      const f=((R-dist)/R)*REP/Math.max(dist,1);
      dot.vx+=dx*f*0.016;dot.vy+=dy*f*0.016;
    }
    dot.vx+=(dot.ox-dot.x)*K;dot.vy+=(dot.oy-dot.y)*K;
    dot.vx*=DAMP;dot.vy*=DAMP;
    dot.x+=dot.vx;dot.y+=dot.vy;
    if(Math.abs(dot.vx)+Math.abs(dot.vy)>0.05)hasMove=true;
  });
  renderSpiralFrame(ctx,cx,cy,a,b,SCALE,W);
  if(hasMove||mx>0){spiralRaf=requestAnimationFrame(()=>spiralLoop(ctx,cx,cy,a,b,SCALE,W))}
  else{spiralActive=false}
}

function renderSpiralFrame(ctx,cx,cy,a,b,SCALE,W){
  ctx.fillStyle=C.bg;ctx.fillRect(0,0,W,W);
  if(!spiralCache)return;
  ctx.globalAlpha=0.85;
  spiralCache.dots.forEach(dot=>{
    ctx.fillStyle=era(dot.yr);
    ctx.beginPath();ctx.arc(dot.x,dot.y,1.8,0,Math.PI*2);ctx.fill();
  });
  ctx.globalAlpha=1;
  ctx.font=`500 10px '${getFont('mono')}',monospace`;
  ctx.fillStyle='#4a4a6a';
  [1998,2005,2010,2015,2020,2025].forEach(yr=>{
    const theta=(yr-1998)*2*Math.PI;
    const r=(a+b*theta)*SCALE;
    const x=cx+r*Math.cos(-Math.PI/2);
    const y=cy+r*Math.sin(-Math.PI/2)-8;
    ctx.fillText(yr,x-14,y);
  });
}

function updateSpiralCard(a,b,SCALE,cx,cy,W){
  if(!spiralCache)return;
  const mx=spiralMouse.x,my=spiralMouse.y;
  const dx=mx-cx,dy=my-cy;
  const radius=Math.sqrt(dx*dx+dy*dy);
  const rawRev=(radius/SCALE-a)/b;
  if(rawRev<0||rawRev>28.5)return;
  const yr=Math.min(2026,Math.max(1998,Math.round(1998+rawRev)));
  const yd=spiralCache.yearData[yr];if(!yd)return;
  document.getElementById('sp-year').textContent=yr;
  document.getElementById('sp-hint').textContent='rok '+yr;
  document.getElementById('sp-new').textContent=fmt(yd.new_stores);
  document.getElementById('sp-cum').textContent=fmt(yd.cumulative);
  document.getElementById('sp-era').textContent=eraName(yr);
  const months=(M.timeline_monthly||[]).filter(m=>m.month.startsWith(String(yr)));
  const monthEl=document.getElementById('sp-months');
  if(!monthEl)return;
  if(months.length>0){
    const MN=['Sty','Lut','Mar','Kwi','Maj','Cze','Lip','Sie','Wrz','Paz','Lis','Gru'];
    const maxM=Math.max(...months.map(m=>m.opened));
    monthEl.innerHTML='<div style="font-size:10px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Rozklad miesięczny</div>'+
      months.map(m=>{
        const mn=parseInt(m.month.split('-')[1])-1;
        const pct=m.opened/maxM*100;
        return`<div style="display:flex;align-items:center;gap:5px;margin:2px 0">
          <span style="font-size:10px;color:var(--muted);width:22px;flex-shrink:0">${MN[mn]}</span>
          <div style="height:5px;background:${C.green};width:${pct}%;border-radius:3px;min-width:2px;flex-shrink:0"></div>
          <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink)">${m.opened}</span>
        </div>`;
      }).join('');
  }else{monthEl.innerHTML='<div style="font-size:11px;color:var(--muted);margin-top:6px">Brak danych miesięcznych</div>'}
}

export function drawFingerprint(){
  const cv=document.getElementById('canvas-fingerprint');
  const W=cv.offsetWidth||680;
  cv.width=W;cv.height=W;
  const ctx=cv.getContext('2d');
  const cx=W/2,cy=W/2;
  ctx.fillStyle='#12121a';ctx.fillRect(0,0,W,W);
  const cg=ctx.createRadialGradient(cx,cy,0,cx,cy,35);
  cg.addColorStop(0,'rgba(40,40,60,0.9)');cg.addColorStop(1,'transparent');
  ctx.fillStyle=cg;ctx.beginPath();ctx.arc(cx,cy,35,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='rgba(42,42,58,0.6)';ctx.lineWidth=0.8;
  for(let a=0;a<8;a++){
    const ang=a*Math.PI/4-Math.PI/2;
    ctx.beginPath();ctx.moveTo(cx,cy);
    ctx.lineTo(cx+(W/2-8)*Math.cos(ang),cy+(W/2-8)*Math.sin(ang));ctx.stroke();
  }
  const BASE=28*(W/680),RING=9*(W/680),DEFORM=15*(W/680);
  const stores=M.stores_timeline.stores||[];
  const byYear={};
  for(const[lat,lon,yr]of stores){
    if(!byYear[yr])byYear[yr]=new Array(72).fill(0);
    const dlon=lon-19.52,dlat=lat-52.05;
    const bearing=((Math.atan2(dlon,dlat)*180/Math.PI)+360)%360;
    byYear[yr][Math.floor(bearing/5)]++;
  }
  const sortedYears=Object.keys(byYear).map(Number).sort();
  ctx.strokeStyle='rgba(42,42,58,0.45)';ctx.lineWidth=0.6;ctx.setLineDash([]);
  [8,16,24].forEach(i=>{
    const r=BASE+i*RING;
    ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
  });
  sortedYears.forEach((yr,i)=>{
    const bins=byYear[yr];
    const maxBin=Math.max(...bins,1);
    const baseR=BASE+i*RING;
    const N=72;
    ctx.beginPath();
    for(let j=0;j<=N;j++){
      const bi=j%N;
      const r=baseR+(bins[bi]/maxBin)*DEFORM;
      const angle=(j/N)*2*Math.PI-Math.PI/2;
      if(j===0)ctx.moveTo(cx+r*Math.cos(angle),cy+r*Math.sin(angle));
      else ctx.lineTo(cx+r*Math.cos(angle),cy+r*Math.sin(angle));
    }
    ctx.closePath();
    ctx.strokeStyle=era(yr);ctx.lineWidth=1.4;ctx.stroke();
    const ec=era(yr);const m=ec.match(/[0-9a-f]{2}/gi)||['00','00','00'];
    const rr=parseInt(m[0]||'00',16),gg=parseInt(m[1]||'00',16),bb=parseInt(m[2]||'00',16);
    ctx.fillStyle=`rgba(${rr},${gg},${bb},0.07)`;ctx.fill();
  });
  const dirs=[['N',0],['NE',45],['E',90],['SE',135],['S',180],['SW',225],['W',270],['NW',315]];
  dirs.forEach(([label,deg])=>{
    const rad=deg*Math.PI/180-Math.PI/2;
    const isMain=['N','S','E','W'].includes(label);
    const r=W/2-10;
    const x=cx+r*Math.cos(rad),y=cy+r*Math.sin(rad);
    ctx.font=`${isMain?'600':'400'} ${isMain?13:10}px '${getFont('body')}',sans-serif`;
    ctx.fillStyle=isMain?'#8a8aaa':'#4a4a6a';
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(label,x,y);
  });
  ctx.textAlign='left';ctx.textBaseline='alphabetic';
  const tt=document.getElementById('fp-tooltip');
  cv.addEventListener('mousemove',e=>{
    const rect=cv.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(W/rect.width);
    const my=(e.clientY-rect.top)*(W/rect.height);
    const r=Math.sqrt((mx-cx)**2+(my-cy)**2);
    const i=Math.round((r-BASE)/RING);
    if(i>=0&&i<sortedYears.length){
      const yr=sortedYears[i];
      const bins=byYear[yr];
      const domBin=bins.indexOf(Math.max(...bins));
      const dirs16=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
      const dirLabel=dirs16[Math.floor(domBin/(72/16))%16]||'N';
      const yd=spiralCache&&spiralCache.yearData?spiralCache.yearData[yr]:null;
      tt.style.display='block';
      tt.style.left=(e.clientX-cv.getBoundingClientRect().left+12)+'px';
      tt.style.top=(e.clientY-cv.getBoundingClientRect().top-20)+'px';
      tt.innerHTML=`<div style="color:${era(yr)};font-family:var(--font-display);font-weight:700;font-size:16px">${yr}</div>
        <div style="color:var(--muted);font-size:11px;margin-top:2px">Era: ${eraName(yr)}</div>
        ${yd?`<div style="margin-top:6px;font-size:12px">Nowych: <span style="color:var(--ink);font-family:var(--font-mono)">${fmt(yd.new_stores)}</span></div>`:''}
        <div style="font-size:12px;margin-top:2px">Kierunek: <span style="color:${C.teal};font-weight:600">${dirLabel}</span></div>`;
    }else{tt.style.display='none'}
  });
  cv.addEventListener('mouseleave',()=>{tt.style.display='none'});
}

export function renderStackedArea(){
  const raw=M.growth_by_voivodeship;
  const macros={North:[],West:[],Center:[],South:[]};
  const years=[...new Set(raw.map(r=>r.yr))].sort();
  years.forEach(yr=>{
    Object.keys(macros).forEach(mac=>{
      macros[mac].push(raw.filter(r=>r.yr===yr&&r.voivodeship&&C[mac]===macroCol(r.voivodeship)&&
        (['North','West','Center','South'].includes(mac))).reduce((a,b)=>a+b.new_stores,0));
    });
  });
  const raw2=M.growth_by_voivodeship;
  const macros2={North:[],West:[],Center:[],South:[]};
  years.forEach(yr=>{
    const MACRO_MAP={pomorskie:'North','warmińsko-mazurskie':'North','kujawsko-pomorskie':'North',podlaskie:'North','dolnośląskie':'West',zachodniopomorskie:'West',lubuskie:'West',opolskie:'West',mazowieckie:'Center','łódzkie':'Center','świętokrzyskie':'Center',wielkopolskie:'Center','śląskie':'South','małopolskie':'South',podkarpackie:'South',lubelskie:'South'};
    Object.keys(macros2).forEach(mac=>{
      macros2[mac].push(raw2.filter(r=>r.yr===yr&&MACRO_MAP[r.voivodeship]===mac).reduce((a,b)=>a+b.new_stores,0));
    });
  });
  destroyChart('stacked-area');
  CHARTS['stacked-area']=new Chart(document.getElementById('chart-stacked-area'),{
    type:'line',
    data:{labels:years,datasets:Object.entries(macros2).map(([mac,data])=>({
      label:mac,data,backgroundColor:C[mac]+'55',borderColor:C[mac],fill:true,borderWidth:1.5,pointRadius:0,tension:.4
    }))},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{labels:{color:C.muted,font:{size:11},usePointStyle:true}},
        tooltip:{mode:'index',intersect:false,callbacks:{
          title:items=>'Rok '+items[0].label,
          label:ctx=>`${ctx.dataset.label}: ${fmt(ctx.raw)} nowych`
        }}
      },
      scales:{
        x:{stacked:true,ticks:{color:C.muted,font:{size:10}},grid:{color:C.axis}},
        y:{stacked:true,ticks:{color:C.muted,font:{size:10}},grid:{color:C.axis}}
      }
    }
  });
}

export function renderPerCapita(){
  const data=[...M.per_capita].sort((a,b)=>b.per_1k-a.per_1k);
  const colors=data.map(d=>macroCol(d.voivodeship));
  destroyChart('per-capita');
  CHARTS['per-capita']=new Chart(document.getElementById('chart-per-capita'),{
    type:'bar',
    data:{labels:data.map(d=>d.voivodeship),datasets:[{data:data.map(d=>d.per_1k),backgroundColor:colors,borderRadius:2,borderWidth:0}]},
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      onClick(_e,els){if(els.length){const v=data[els[0].index].voivodeship;setFilter(STATE.filter===v?null:v)}},
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:ctx=>`${ctx.raw}/1k mieszk.`}},
        annot:{refLines:[{value:0.35,axis:'x',color:'rgba(255,255,255,.2)'}]}
      },
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},y:{grid:{display:false},ticks:{cursor:'pointer',color:C.muted,font:{size:10}}}}
    }
  });
}

export function renderCityCoverage(){
  const data=M.city_first_opening;
  const keyYears=[1998,2000,2005,2010,2015,2020,2022,2025];
  const ptR=data.map(d=>keyYears.includes(d.yr)?5:0);
  destroyChart('city-coverage');
  CHARTS['city-coverage']=new Chart(document.getElementById('chart-city-coverage'),{
    type:'line',
    data:{
      labels:data.map(d=>d.yr),
      datasets:[
        {data:data.map(d=>d.new_cities),type:'bar',backgroundColor:'rgba(0,192,96,.15)',yAxisID:'y2',label:'nowych miast',borderWidth:0},
        {data:data.map(d=>d.cumulative_cities),borderColor:C.green,backgroundColor:'rgba(0,192,96,.05)',fill:true,borderWidth:2,
         pointRadius:ptR,pointBackgroundColor:C.green,tension:.4,label:'lacznie'}
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{mode:'index',intersect:false,callbacks:{
          title:i=>'Rok '+i[0].label,
          label:ctx=>ctx.datasetIndex===1?`Lacznie: ${fmt(ctx.raw)} miast`:`Nowych: ${fmt(ctx.raw)}`
        }}
      },
      scales:{
        x:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},
        y2:{grid:{display:false},ticks:{display:false},position:'right'}
      }
    }
  });
}

export function renderTopCities(filtered=false){
  const data=filtered&&STATE.filter
    ?M.top_cities.filter(d=>d.voivodeship&&d.voivodeship.toLowerCase()===STATE.filter.toLowerCase())
    :M.top_cities;
  destroyChart('top-cities');
  CHARTS['top-cities']=new Chart(document.getElementById('chart-top-cities'),{
    type:'bar',
    data:{labels:data.map(d=>d.city),datasets:[{data:data.map(d=>d.cnt),backgroundColor:data.map(d=>macroCol(d.voivodeship)),borderRadius:2,borderWidth:0}]},
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${fmt(ctx.raw)} sklepow`}}},
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}

export function drawClock(){
  const cv=document.getElementById('canvas-clock');
  const S=Math.min(cv.offsetWidth||320,320);cv.width=S;cv.height=S;
  const ctx=cv.getContext('2d');
  const cx=S/2,cy=S/2,R=S/2-12;
  ctx.fillStyle=C.surface;ctx.fillRect(0,0,S,S);
  ctx.strokeStyle=C.axis;ctx.lineWidth=1;
  for(let h=0;h<24;h++){
    const a=(h/24)*2*Math.PI-Math.PI/2;
    ctx.beginPath();ctx.moveTo(cx+R*Math.cos(a),cy+R*Math.sin(a));
    ctx.lineTo(cx+(R-6)*Math.cos(a),cy+(R-6)*Math.sin(a));ctx.stroke();
    if(h%6===0){
      ctx.fillStyle=C.muted;ctx.font=`10px '${getFont('mono')}',monospace`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(h===0?'0':h,cx+(R-18)*Math.cos(a),cy+(R-18)*Math.sin(a));
    }
  }
  const hours=Array.isArray(M.opening_hours)?M.opening_hours:[];
  hours.forEach(p=>{
    const pts=p.pattern.split(' - ');if(pts.length<2)return;
    const[oh,om]=(pts[0]||'06:00').split(':').map(Number);
    const[ch,cm]=(pts[1]||'23:00').split(':').map(Number);
    if(isNaN(oh)||isNaN(ch))return;
    const aO=((oh*60+om)/1440)*2*Math.PI-Math.PI/2;
    const aC=((ch*60+cm)/1440)*2*Math.PI-Math.PI/2;
    const reps=Math.ceil(p.cnt/60);
    for(let k=0;k<reps;k++){
      ctx.beginPath();ctx.arc(cx,cy,R-14+(Math.random()-.5)*8,aO,aC);
      ctx.strokeStyle='rgba(0,192,96,0.022)';ctx.lineWidth=2.5;ctx.stroke();
    }
  });
  const h24pts=M.section3_rare&&M.section3_rare.h24_points&&M.section3_rare.h24_points.length?
    M.section3_rare.h24_points:null;
  const h24count=(M.opening_hours&&M.opening_hours.h24_count)||35;
  for(let i=0;i<h24count;i++){
    let ang,r=R-14;
    if(h24pts&&h24pts[i]){
      const[lat,lon]=h24pts[i];
      ang=((lon-14.1)/(24.2-14.1))*2*Math.PI-Math.PI/2;
      r=R-14+(lat-52)*4;
    }else{
      ang=(i/h24count)*2*Math.PI-Math.PI/2;
    }
    ctx.beginPath();ctx.arc(cx+r*Math.cos(ang),cy+r*Math.sin(ang),3.5,0,Math.PI*2);
    ctx.fillStyle='rgba(245,166,35,0.55)';ctx.fill();
  }
  ctx.font=`bold 22px '${getFont('display')}',sans-serif`;
  ctx.fillStyle=C.green;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('06:00',cx,cy);
  ctx.font=`10px '${getFont('body')}',sans-serif`;ctx.fillStyle=C.muted;
  ctx.fillText('91,7% otwiera sie tutaj',cx,cy+18);
}

export function renderHoursBar(){
  const data=Array.isArray(M.opening_hours)?M.opening_hours:[];
  destroyChart('hours');
  CHARTS['hours']=new Chart(document.getElementById('chart-hours'),{
    type:'bar',
    data:{labels:data.map(d=>d.pattern.substring(0,13)),datasets:[{data:data.map(d=>d.cnt),backgroundColor:data.map((_,i)=>i===0?C.green:'rgba(0,192,96,.35)'),borderRadius:2,borderWidth:0}]},
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${fmt(ctx.raw)} sklepow`}}},
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}

let burstPlayed=false;
export function initBurstToggle(){
  const btnSpiral=document.getElementById('view-spiral');
  const btnBurst=document.getElementById('view-burst');
  if(!btnSpiral||!btnBurst)return;
  btnSpiral.addEventListener('click',()=>{
    btnSpiral.classList.add('active');btnBurst.classList.remove('active');
    document.querySelector('.spiral-wrap').style.display='flex';
    document.getElementById('spiral-caveat').style.display='';
    document.getElementById('burst-wrap').style.display='none';
  });
  btnBurst.addEventListener('click',()=>{
    btnBurst.classList.add('active');btnSpiral.classList.remove('active');
    document.querySelector('.spiral-wrap').style.display='none';
    document.getElementById('spiral-caveat').style.display='none';
    document.getElementById('burst-wrap').style.display='block';
    if(!burstPlayed)playBurst();
    document.getElementById('burst-replay').onclick=playBurst;
  });
}

function playBurst(){
  burstPlayed=true;
  const cv=document.getElementById('canvas-burst');
  const W=cv.offsetWidth||960;const H=Math.round(W*0.55);
  cv.width=W;cv.height=H;
  const ctx=cv.getContext('2d');
  const stores=M.stores_timeline&&M.stores_timeline.stores||[];
  const sortedStores=[...stores].sort((a,b)=>a[2]-b[2]);
  const dots=sortedStores.map(([lat,lon,yr],i)=>{
    const tx=(lon-14.1)/(24.2-14.1)*W;
    const ty=(1-(lat-49.0)/(54.9-49.0))*H;
    return{tx,ty,x:W/2,y:H/2,yr,delay:i/sortedStores.length*1600};
  });
  const START=performance.now();const DUR=2500;
  function frame(now){
    ctx.fillStyle=C.bg;ctx.fillRect(0,0,W,H);
    let allDone=true;
    dots.forEach(d=>{
      const t=Math.max(0,Math.min(1,(now-START-d.delay)/(DUR-d.delay*0.3)));
      if(t<1)allDone=false;
      const ease=1-Math.pow(1-t,3);
      d.x=W/2+(d.tx-W/2)*ease;
      d.y=H/2+(d.ty-H/2)*ease;
      ctx.fillStyle=era(d.yr);ctx.globalAlpha=0.75;
      ctx.beginPath();ctx.arc(d.x,d.y,1.5,0,Math.PI*2);ctx.fill();
    });
    ctx.globalAlpha=1;
    if(!allDone)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
