import { C, MACRO } from './config.js';
import { CHARTS } from './state.js';
import { t, getLang } from './i18n.js';

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
export function era(yr){if(yr<=2009)return'#2b531a';if(yr<=2019)return'#4a8a22';if(yr<=2022)return'#74bd2a';return'#a6e84a'}
export function fmt(n){return(+n).toLocaleString(getLang()==='en'?'en-US':'pl-PL')}
// Backend sends "YYYY-MM-DD HH:MM:SS.ffffff" (str() of a Python datetime) - keep only
// the minute precision the footer needs.
export function fmtLastUpdated(raw){
  const m = String(raw||'').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : '';
}
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

// Run fn once, when el first scrolls near the viewport (400px pre-margin). Used
// to defer the heavy MapLibre chunk (~280 KB gz) until a map is actually about
// to be seen, instead of loading it on first paint. Falls back to running
// immediately where IntersectionObserver is unavailable.
export function whenVisible(el, fn, rootMargin='400px'){
  if(!el)return;
  if (el._visible) {
    fn();
    return;
  }
  if (el._pending_fns) {
    el._pending_fns.push(fn);
    return;
  }
  el._pending_fns = [fn];
  if(typeof IntersectionObserver==='undefined'){
    el._visible = true;
    el._pending_fns.forEach(f => f());
    el._pending_fns = null;
    return;
  }
  const io=new IntersectionObserver((entries,obs)=>{
    for(const e of entries){
      if(e.isIntersecting){
        el._visible = true;
        obs.disconnect();
        if (el._pending_fns) {
          el._pending_fns.forEach(f => f());
          el._pending_fns = null;
        }
        break;
      }
    }
  },{rootMargin});
  io.observe(el);
}

// Short count-up for the hero number. Kept snappy (700ms) and callable straight
// from main.js the moment the core data lands - so the LCP element (the big hero
// number) finishes its last paint early instead of after the lazy siec chunk
// loads and runs a long animation. Sets data-hero-done so the chunk's renderHero
// doesn't re-animate (which would push LCP back out).
export function heroCount(el, total, dur=700){
  if(!el) return;
  if(!total){ el.textContent='–'; return; }
  el.dataset.heroDone='1';
  const f=n=>n.toLocaleString(getLang()==='en'?'en-US':'pl-PL');
  const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce){ el.textContent=f(total); return; }
  const from=Math.max(0,total-800),t0=performance.now();
  (function step(now){
    const t=Math.min(1,(now-t0)/dur);
    const e=t>=1?1:1-Math.pow(2,-14*t);
    el.textContent=f(Math.round(from+(total-from)*e));
    if(t<1)requestAnimationFrame(step);
  })(t0);
}

// Run fn once the browser is idle AFTER the initial load - deliberately not
// during the FCP/LCP/TBT-critical window. Waits for the load event, then a
// requestIdleCallback (timeout fallback). Use for heavy, non-critical init
// (MapLibre/WebGL) that would otherwise run on the load path whenever its
// container happens to be on-screen at first paint.
export function afterIdle(fn, timeout=2500){
  const idle=()=> (typeof requestIdleCallback!=='undefined')
    ? requestIdleCallback(fn,{timeout})
    : setTimeout(fn, 300);
  if(document.readyState==='complete') idle();
  else window.addEventListener('load', idle, {once:true});
}

// whenVisible + afterIdle: build only when the target nears the viewport, and
// even then defer the heavy work to the next post-load idle - so an element that
// is already on-screen at load does not drag its init into the load path.
export function whenVisibleIdle(el, fn, rootMargin){
  whenVisible(el, ()=>afterIdle(fn), rootMargin);
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
    const f=v=>v.toLocaleString(getLang()==='en'?'en-US':'pl-PL',{minimumFractionDigits:dec,maximumFractionDigits:dec})+suf;
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

export function showChartStatus(canvasElOrId, type, retryFn) {
  const canvas = typeof canvasElOrId === 'string' ? document.getElementById(canvasElOrId) : canvasElOrId;
  if (!canvas) return;
  const wrap = canvas.parentElement;
  if (!wrap) return;
  
  const old = wrap.querySelector('.chart-status-overlay');
  if (old) old.remove();

  if (!type) {
    canvas.style.display = '';
    return;
  }

  canvas.style.display = 'none';

  const overlay = document.createElement('div');
  overlay.className = 'chart-status-overlay';
  overlay.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--c-muted);font-size:13px;padding:20px;text-align:center';

  if (type === 'error') {
    overlay.innerHTML = `<p style="margin-bottom:12px">${t('econ_error_load')}</p>` +
                        `<button type="button" class="gran-btn" style="background:var(--c-green);color:var(--c-bg);border:none;padding:6px 12px;border-radius:4px;cursor:pointer">${t('econ_error_retry')}</button>`;
    if (retryFn) {
      overlay.querySelector('button').addEventListener('click', async () => {
        overlay.innerHTML = '<span class="spinner" style="display:inline-block;width:16px;height:16px;border:2px solid var(--c-green);border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite"></span>';
        await retryFn();
      });
    }
  } else if (type === 'empty') {
    overlay.innerHTML = `<p>${t('chart_empty')}</p>`;
  }

  wrap.appendChild(overlay);
}
