import L from 'leaflet';
import { C, MACRO } from './config.js';
import { CHARTS, MAPS } from './state.js';

export function era(yr){if(yr<=2009)return'#2b531a';if(yr<=2019)return'#4a8a22';if(yr<=2022)return'#74bd2a';return'#a6e84a'}
export function eraName(yr){if(yr<=2009)return'Wczesna siec';if(yr<=2019)return'Wzrost';if(yr<=2022)return'Przyspieszenie';return'Boom'}
export function fmt(n){return(+n).toLocaleString('pl-PL')}
export function macroCol(v){return C[MACRO[v]]||C.green}
// single production font set (the live switcher was removed; see CLAUDE.md ch.4)
export function getFont(r){
  return{display:'Bricolage Grotesque',body:'IBM Plex Sans',mono:'JetBrains Mono'}[r];
}
export function destroyChart(id){if(CHARTS[id]){CHARTS[id].destroy();delete CHARTS[id]}}

// Render a "no data" error state inside a chart or map container.
// id: the canvas/div element id. msg: optional override message.
export function showNoData(id, msg){
  const el=document.getElementById(id);
  if(!el)return;
  const wrap=el.closest('.chart-wrap')||el.closest('.map-container')||el.parentElement;
  const target=wrap||el;
  // If it's a canvas, hide it and add a sibling; if it's a div, replace innerHTML
  if(el.tagName==='CANVAS'){el.style.display='none';}
  const existing=target.querySelector('.no-data-msg');
  if(existing){existing.textContent=msg||'Brak danych – uruchom ETL z pełnym wzbogacaniem.';return;}
  const div=document.createElement('div');
  div.className='no-data-msg';
  div.textContent=msg||'Brak danych – uruchom ETL z pełnym wzbogacaniem.';
  div.style.cssText='display:flex;align-items:center;justify-content:center;height:100%;min-height:80px;color:var(--muted);font-family:var(--font-mono);font-size:12px;text-align:center;padding:16px;';
  target.appendChild(div);
}
export function projectPL(lat,lon,W,H){return{x:(lon-14.1)/(24.2-14.1)*W,y:(1-(lat-49)/(54.9-49))*H}}
export function leafletDark(id){
  if(MAPS[id])return MAPS[id];
  const map=L.map(id,{zoomControl:true,attributionControl:false});
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:18}).addTo(map);
  MAPS[id]=map;return map;
}

// Ambient particle field for tab hero sections.
// rgb: [r,g,b] base color; count: number of particles.
// Returns a cancel function.
export function startTabParticles(canvasId,[r,g,b]=[132,195,65],count=55){
  const cv=document.getElementById(canvasId);if(!cv)return()=>{};
  const wrap=cv.parentElement;
  const ctx=cv.getContext('2d');
  function size(){const rc=wrap.getBoundingClientRect();cv.width=rc.width;cv.height=rc.height}
  size();
  const ps=Array.from({length:count},()=>({
    x:Math.random()*cv.width,y:Math.random()*cv.height,
    rad:Math.random()*1.6+0.3,
    vx:(Math.random()-.5)*.14,vy:-(Math.random()*.2+.04),
    a:Math.random()*.42+.12
  }));
  let raf,last=0;
  function frame(now){
    raf=requestAnimationFrame(frame);
    if(document.hidden||now-last<42)return; // ~24 fps, pause when tab hidden
    last=now;
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.shadowColor=`rgb(${r},${g},${b})`;ctx.shadowBlur=7;
    ps.forEach(p=>{
      p.x+=p.vx;p.y+=p.vy;
      if(p.y<-6)p.y=cv.height+6;
      if(p.x<-6)p.x=cv.width+6;else if(p.x>cv.width+6)p.x=-6;
      ctx.beginPath();
      ctx.fillStyle=`rgba(${r},${g},${b},${p.a})`;
      ctx.arc(p.x,p.y,p.rad,0,Math.PI*2);ctx.fill();
    });
    ctx.shadowBlur=0;
  }
  raf=requestAnimationFrame(frame);
  if(!cv._tabParticleResize){
    cv._tabParticleResize=true;
    window.addEventListener('resize',size);
  }
  return()=>cancelAnimationFrame(raf);
}
