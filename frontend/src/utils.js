import { C, MACRO } from './config.js';
import { CHARTS } from './state.js';

export function era(yr){if(yr<=2009)return'#2b531a';if(yr<=2019)return'#4a8a22';if(yr<=2022)return'#74bd2a';return'#a6e84a'}
export function eraName(yr){if(yr<=2009)return'Wczesna siec';if(yr<=2019)return'Wzrost';if(yr<=2022)return'Przyspieszenie';return'Boom'}
export function fmt(n){return(+n).toLocaleString('pl-PL')}
// Display-case a place name and strip GUS naming artefacts. The dictionary
// carries names like "Powiat bocheński", "M.st. Warszawa" and "... od 2013";
// none of that belongs on a chart label. After stripping: voivodeship names
// arrive ALL-CAPS ("MAZOWIECKIE") and become "Mazowieckie" (capital per
// space-separated word, lowercase tail so hyphenated names stay Polish-correct:
// "WARMIŃSKO-MAZURSKIE" -> "Warmińsko-mazurskie"); names that are not all-caps
// (lowercase powiats like "bocheński", already title-cased cities like
// "Nowy Sącz") only get their first letter capitalised, rest left intact.
export function capName(n){
  if(!n)return n;
  n=String(n).replace(/^powiat\s+/i,'').replace(/^M\.st\.\s*/i,'').replace(/\s+od\s+\d{4}\s*$/i,'').trim();
  if(!n)return n;
  if(n===n.toUpperCase())
    return n.toLowerCase().split(' ').map(w=>w?w[0].toUpperCase()+w.slice(1):w).join(' ');
  return n[0].toUpperCase()+n.slice(1);
}
export function macroCol(v){return C[MACRO[v]]||C.green}
// single production font set (the live switcher was removed; see CLAUDE.md ch.4)
export function getFont(r){
  return{display:'Bricolage Grotesque',body:'IBM Plex Sans',mono:'JetBrains Mono'}[r];
}
export function destroyChart(id){
  if(CHARTS[id]){
    if(typeof CHARTS[id].destroy === 'function'){
      CHARTS[id].destroy();
    }
    delete CHARTS[id];
  }
}

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

// Run fn once, when el first scrolls near the viewport (400px pre-margin). Used
// to defer the heavy MapLibre chunk (~280 KB gz) until a map is actually about
// to be seen, instead of loading it on first paint. Falls back to running
// immediately where IntersectionObserver is unavailable.
export function whenVisible(el, fn, rootMargin='400px'){
  if(!el)return;
  if(typeof IntersectionObserver==='undefined'){fn();return;}
  const io=new IntersectionObserver((entries,obs)=>{
    for(const e of entries){if(e.isIntersecting){obs.disconnect();fn();break;}}
  },{rootMargin});
  io.observe(el);
}

// Coalesce a rapid-fire event (resize in particular) into one call after
// `wait` ms of quiet. A drag-resize fires dozens of native 'resize' events per
// second; without this every chart/map resize handler (Chart.js relayout,
// MapLibre re-render, manual canvas rebuild) ran on every single one of them.
export function debounce(fn, wait=150){
  let t=null;
  return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); };
}

// Animate KPI numbers climbing to their target once they scroll into view.
// Elements are found via `root.querySelectorAll('[data-count]')`. Reads
// el.dataset.count (target number), .dataset.dec (decimal places, default 0),
// .dataset.suffix (plain string appended after the formatted number). Call
// after setting .dataset.count so the target is ready when the observer fires.
export function wireCountUp(root){
  if(!root)return;
  const nodes=root.querySelectorAll('[data-count]');
  if(!nodes.length)return;
  const prefersReduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const countUp=el=>{
    const target=parseFloat(el.dataset.count);
    if(Number.isNaN(target))return;
    const dec=parseInt(el.dataset.dec||'0',10),suf=el.dataset.suffix||'';
    const f=v=>v.toLocaleString('pl-PL',{minimumFractionDigits:dec,maximumFractionDigits:dec})+suf;
    if(prefersReduced){el.textContent=f(target);return;}
    const dur=1300,t0=performance.now();
    (function step(t){let p=Math.min(1,(t-t0)/dur);p=1-Math.pow(1-p,3);el.textContent=f(target*p);if(p<1)requestAnimationFrame(step);})(t0);
  };
  if(typeof IntersectionObserver==='undefined'){nodes.forEach(countUp);return;}
  const obs=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){countUp(e.target);obs.unobserve(e.target);}}),{threshold:.6});
  nodes.forEach(el=>obs.observe(el));
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
    window.addEventListener('resize',debounce(size));
  }
  return()=>cancelAnimationFrame(raf);
}
