import Chart from 'chart.js/auto';
import L from 'leaflet';
import { C, STATE } from '../config.js';
import { M, CHARTS, MAPS } from '../state.js';
import { era, fmt, getFont, destroyChart } from '../utils.js';
import { fetchJSON } from '../data.js';
import { renderBubble } from './bubble.js';
import { renderKraniec } from './kraniec.js';
import { renderEdgeKPIs } from './edge.js';

const prefersReduced = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function renderSiec(){
  renderHero();
  renderStatStrip();
  renderOrigins();
  renderBubble();
  renderGrowthMap();
  drawFingerprintFlat();
  renderGrowthChart();
  wireGranular();
  renderGranular();
  renderEdgeKPIs();
  renderKraniec();
  renderPowiatCoverage();
  const root=document.getElementById('tab-siec');
  if(root){
    const obs=new IntersectionObserver((es)=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');obs.unobserve(e.target);}}),{threshold:.12});
    root.querySelectorAll('.si-reveal').forEach(r=>obs.observe(r));
  }
  document.querySelectorAll('.tab-bridge-btn[data-goto]').forEach(btn=>{
    if(btn._wired)return;btn._wired=true;
    btn.addEventListener('click',()=>{
      document.querySelector(`.tab-btn[data-tab="${btn.dataset.goto}"]`)?.click();
    });
  });
}

/* ---------------- HERO: glowing count-up + particle field ---------------- */

let heroRaf=null;
export function renderHero(){
  const el=document.getElementById('hero-number');if(!el)return;
  const total=(M.summary&&+M.summary.total_active)||0;
  if(!total){el.textContent='–';return;}
  if(prefersReduced()){
    el.textContent=fmt(total);
  }else{
    // start the count near the top so it reads as the last sprint to the real
    // total, not a from-zero ramp
    const from=Math.max(0,total-1000);
    const dur=2000,start=performance.now();
    (function step(now){
      const t=Math.min(1,(now-start)/dur);
      // easeOutExpo with a steep factor — quick overall, but most of the time is
      // spent crawling the final approach to 13k before it settles
      const e=t>=1?1:1-Math.pow(2,-14*t);
      el.textContent=fmt(Math.round(from+(total-from)*e));
      if(t<1)requestAnimationFrame(step);
    })(performance.now());
  }
  startHeroParticles();
}

function startHeroParticles(){
  const cv=document.getElementById('hero-particles');if(!cv)return;
  if(prefersReduced())return;
  const wrap=cv.parentElement;
  const ctx=cv.getContext('2d');
  function size(){const r=wrap.getBoundingClientRect();cv.width=r.width;cv.height=r.height;}
  size();
  const N=Math.min(70,Math.max(24,Math.round(cv.width/16)));
  const ps=Array.from({length:N},()=>({
    x:Math.random()*cv.width,y:Math.random()*cv.height,
    r:Math.random()*1.8+0.4,
    vx:(Math.random()-.5)*0.18,vy:-(Math.random()*0.25+0.05),
    a:Math.random()*0.5+0.18
  }));
  if(heroRaf)cancelAnimationFrame(heroRaf);
  (function frame(){
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.shadowColor='rgba(132,195,65,.8)';ctx.shadowBlur=8;
    ps.forEach(p=>{
      p.x+=p.vx;p.y+=p.vy;
      if(p.y<-6)p.y=cv.height+6;
      if(p.x<-6)p.x=cv.width+6;else if(p.x>cv.width+6)p.x=-6;
      ctx.beginPath();ctx.fillStyle=`rgba(166,232,74,${p.a})`;
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
    });
    ctx.shadowBlur=0;
    heroRaf=requestAnimationFrame(frame);
  })();
  if(!startHeroParticles._wired){
    startHeroParticles._wired=true;
    window.addEventListener('resize',size);
  }
}

/* ---------------- STAT STRIP: milestone cadence + origins ---------------- */

const PL_MONTHS=['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'];
function plYears(n){const u=n%10,t=n%100;if(n===1)return'rok';if(u>=2&&u<=4&&(t<12||t>14))return'lata';return'lat'}
function plDate(s){if(!s)return'–';const[y,m,d]=s.split('-').map(Number);return`${d} ${PL_MONTHS[m-1]||''} ${y}`}

export function renderStatStrip(){
  const ng=M.network_growth||[];
  const yrAt=v=>{const d=ng.find(d=>d.cumulative>=v);return d?d.year:null};
  const firstYr=ng.length?ng[0].year:1998;
  const y1k=yrAt(1000),y5k=yrAt(5000),y10k=yrAt(10000);
  const toFirst=y1k!=null?y1k-firstYr:null;
  const last5=(y10k!=null&&y5k!=null)?y10k-y5k:null;
  // two split tiles: the slow first 1 000 vs the fast last 5 000
  const setYears=(id,n)=>{const el=document.getElementById(id);if(el&&n!=null)el.innerHTML=`${n}<span class="stat-unit">${plYears(n)}</span>`};
  setYears('stat-first1k',toFirst);
  setYears('stat-last5k',last5);

  const best=ng.reduce((a,b)=>b.new_stores>(a?a.new_stores:-1)?b:a,null);
  if(best){
    const bv=document.getElementById('stat-bestyear');if(bv)bv.textContent=fmt(best.new_stores);
    const perH=best.new_stores>0?8760/best.new_stores:0;
    const sub=document.getElementById('stat-bestyear-sub');
    if(sub)sub.textContent=`nowych w ${best.year} – co ~${perH.toFixed(1).replace('.',',')} h`;
  }

  const ns=M.neighbor_stats;
  if(ns&&ns.distribution&&ns.distribution.median_m!=null){
    const el=document.getElementById('stat-neighmed');
    if(el)el.innerHTML=`${fmt(Math.round(ns.distribution.median_m))}<span class="stat-unit"> m</span>`;
  }

  const no=M.network_origin;
  if(no&&no.new_this_month!=null){
    const nmEl=document.getElementById('stat-new-month');
    if(nmEl)nmEl.textContent=fmt(no.new_this_month);
  }
  const citiesFunnel=M.coverage_funnel&&M.coverage_funnel.find(f=>f.level==='miasta');
  if(citiesFunnel){
    const ce=document.getElementById('stat-cities');
    const sub=document.getElementById('stat-cities-sub');
    if(ce)ce.innerHTML=`${citiesFunnel.pct!=null?citiesFunnel.pct.toFixed(1).replace('.',','):'?'}<span class="stat-unit">%</span>`;
    if(sub)sub.textContent=`z ${(citiesFunnel.total||0).toLocaleString('pl-PL')} polskich miast ma Żabkę`;
  }
  const s=M.summary;
  if(s){
    const rEl=document.getElementById('stat-residents');
    if(rEl&&M.per_capita&&M.per_capita.length&&s.total_active){
      const totalPop=M.per_capita.reduce((a,r)=>a+(r.population||0),0);
      const perStore=Math.round(totalPop/(+s.total_active));
      rEl.innerHTML=`${perStore.toLocaleString('pl-PL')}<span class="stat-unit"> os.</span>`;
    }
  }
}

/* ---------------- ORIGINS: newest vs oldest active store ---------------- */

export function renderOrigins(){
  const o=M.network_origin;if(!o)return;
  const set=(id,v)=>{const el=document.getElementById(id);if(el&&v!=null&&v!=='')el.textContent=v};
  if(o.newest){
    set('origin-new-year',(o.newest.first_opening_date||'').slice(0,4));
    set('origin-new-city',o.newest.city);
    set('origin-new-street',o.newest.street);
    set('origin-new-date',plDate(o.newest.first_opening_date));
  }
  if(o.oldest){
    set('origin-old-year',(o.oldest.first_opening_date||'').slice(0,4));
    set('origin-old-city',o.oldest.city);
    set('origin-old-street',o.oldest.street);
    set('origin-old-date',plDate(o.oldest.first_opening_date));
  }
}

/* ---------------- BIG MAP: vector Poland + year-sweep growth ---------------- */

let growthMap=null,growthRaf=null,growthPts=null,growthSorted=null,growthLoopTimer=null,growthDensity=[];
let growthLoop=true; // auto-repeat until the user grabs the timeline
let calData=null;    // {byYM: Map(year*100+month -> cnt), max}
const GROWTH_MIN=1998,GROWTH_MAX=2026;
const MONTH_INI=['S','L','M','K','M','C','L','S','W','P','L','G']; // PL month initials

// Calendar animation state
let _calAnimMap=new Map(); // key(y*100+m) -> {born:ms, dir:-1|1}
let _calUptoYear=GROWTH_MIN;
let _calRaf=null;
const CELL_STAGGER=52;   // ms stagger between consecutive months within a year
const CELL_DUR=880;      // ms total duration of pop animation

function resetCalAnim(){
  _calAnimMap.clear();
  if(_calRaf){cancelAnimationFrame(_calRaf);_calRaf=null}
}

function buildCalData(){
  const byYM=new Map();let max=1;
  for(const d of (M.openings_monthly||[])){byYM.set(d.year*100+d.month,d.cnt);if(d.cnt>max)max=d.cnt}
  calData={byYM,max};
}

// 'Kalendarz ekspansji': cells appear L->R per year with a scale+glow pop
// (~880 ms). Overall grid proportions are square (12 cols × 29 rows scaled
// so that 12*cw ≈ 29*ch, i.e. total grid width ≈ total grid height).
function drawCalendar(uptoYear){
  const cv=document.getElementById('canvas-calendar');if(!cv||!calData)return;
  _calUptoYear=uptoYear;

  // Derive row height from the fixed map height (520 px); derive cell width so
  // the 12×29 grid is overall square: 12*cw = 29*ch  →  cw = ch*(years/12).
  const H_REF=520; // matches .growth-map{height:520px}
  const years=GROWTH_MAX-GROWTH_MIN+1; // 29
  const padL=34,padT=14,padR=6,padB=10,gap=1.5;
  const ch=(H_REF-padT-padB)/years;
  const cw=ch*(years/12);              // square overall grid
  const W=Math.round(padL+12*cw+padR);
  const H=Math.round(padT+years*ch+padB);
  cv.width=W;cv.height=H;
  cv.style.width=W+'px';

  const ctx=cv.getContext('2d');
  ctx.clearRect(0,0,W,H);

  // Month-initial header
  ctx.textAlign='center';ctx.textBaseline='alphabetic';
  ctx.fillStyle='#5d6c52';ctx.font=`9px '${getFont('mono')}',monospace`;
  for(let m=0;m<12;m++)ctx.fillText(MONTH_INI[m],padL+cw*(m+0.5),padT-3);

  const now=performance.now();
  let hasActive=false;

  for(let i=0;i<years;i++){
    const y=GROWTH_MIN+i,yy=padT+ch*i;
    // Every row gets its year label
    ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillStyle='#5d6c52';
    ctx.font=`9px '${getFont('mono')}',monospace`;
    ctx.fillText(y,padL-4,yy+ch/2);

    for(let m=1;m<=12;m++){
      const key=y*100+m;
      const visible=y<=uptoYear;

      // Register animation entry the moment a cell first becomes visible
      if(visible&&!_calAnimMap.has(key)){
        const delay=(m-1)*CELL_STAGGER;
        _calAnimMap.set(key,{born:now+delay});
      }

      const val=calData.byYM.get(key)||0;
      const color=!visible?'rgba(255,255,255,.02)'
        :(val<=0?'#0d1a0d':fpRamp(Math.sqrt(val/calData.max)));

      const x0=padL+cw*(m-1)+gap,y0=yy+gap,w0=cw-gap*2,h0=ch-gap*2;

      if(visible){
        const anim=_calAnimMap.get(key);
        const elapsed=anim?now-anim.born:Infinity;

        if(elapsed<0){
          // Still in stagger queue — dark placeholder, keep loop alive
          hasActive=true;
          ctx.fillStyle='rgba(255,255,255,.02)';
          ctx.fillRect(x0,y0,w0,h0);
        }else if(elapsed<CELL_DUR){
          // No animation — just draw at full size immediately
          hasActive=true;
          ctx.fillStyle=color;
          ctx.fillRect(x0,y0,w0,h0);
        }else{
          ctx.fillStyle=color;ctx.fillRect(x0,y0,w0,h0);
        }
      }else{
        ctx.fillStyle=color;ctx.fillRect(x0,y0,w0,h0);
      }
    }
  }

  // Self-schedule when cells are still animating (growth map may be paused)
  if(hasActive&&!_calRaf){
    _calRaf=requestAnimationFrame(()=>{_calRaf=null;drawCalendar(_calUptoYear)});
  }
}

export function renderGrowthMap(){
  const el=document.getElementById('map-growth');if(!el)return;
  const stores=(M.stores_timeline&&M.stores_timeline.stores)||[];
  if(!growthMap){
    // no zoom buttons; scroll is gated behind ctrl (see wheel handler below) so the
    // page still scrolls normally when the cursor is over the map
    growthMap=L.map('map-growth',{zoomControl:false,attributionControl:false,scrollWheelZoom:false,minZoom:5,maxZoom:9});
    MAPS['map-growth']=growthMap;
    growthMap.setView([52.0,19.3],6);
    if(M.woj_geo){
      L.geoJSON(M.woj_geo,{interactive:false,style:{fillColor:'#11240d',fillOpacity:.55,color:'rgba(140,200,80,.18)',weight:1}}).addTo(growthMap);
    }
    // ctrl + scroll to zoom, centered on the cursor
    el.addEventListener('wheel',ev=>{
      if(!ev.ctrlKey)return;
      ev.preventDefault();
      const ll=growthMap.containerPointToLatLng(growthMap.mouseEventToContainerPoint(ev));
      const z=growthMap.getZoom()+(ev.deltaY<0?1:-1);
      growthMap.setZoomAround(ll,Math.max(growthMap.getMinZoom(),Math.min(growthMap.getMaxZoom(),z)));
    },{passive:false});
    if(!el.querySelector('.map-zoom-hint')){
      const hint=document.createElement('div');
      hint.className='map-zoom-hint';
      hint.textContent='ctrl + scroll przybliża';
      el.appendChild(hint);
    }
  }
  let cv=document.getElementById('growth-dots');
  if(!cv){
    cv=document.createElement('canvas');cv.id='growth-dots';
    cv.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:450';
    el.appendChild(cv);
  }
  const ctx=cv.getContext('2d');
  growthSorted=[...stores].sort((a,b)=>a[2]-b[2]);
  buildCalData();
  const yrLabel=document.getElementById('growth-year');
  const slider=document.getElementById('growth-slider');

  function size(){const r=el.getBoundingClientRect();cv.width=r.width;cv.height=r.height}
  function project(){
    // remember the center+zoom this projection was drawn for, and drop any
    // live transform — the dots are now baked at their true positions
    growthMap._drawnCenter=growthMap.getCenter();
    growthMap._drawnZoom=growthMap.getZoom();
    cv.style.transition='';cv.style.transform='';
    growthPts=growthSorted.map(s=>{const p=growthMap.latLngToContainerPoint([s[0],s[1]]);return[p.x,p.y,s[2]]});
    // build spatial-density grid: which dots are in a cluster (>=5 neighbors within 25px)?
    const CS=25;
    const grid=new Map();
    growthPts.forEach(([x,y])=>{
      const k=`${Math.floor(x/CS)},${Math.floor(y/CS)}`;
      grid.set(k,(grid.get(k)||0)+1);
    });
    growthDensity=growthPts.map(([x,y])=>{
      const cx=Math.floor(x/CS),cy=Math.floor(y/CS);
      let n=0;
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)n+=grid.get(`${cx+dx},${cy+dy}`)||0;
      return n;
    });
  }
  // map old (drawn) pixels onto a target view via an affine transform, so the dot
  // canvas tracks both pan AND zoom instead of snapping only after the gesture ends
  function applyTransform(center,zoom){
    if(growthMap._drawnCenter==null)return;
    const dz=growthMap._drawnZoom;
    const scale=growthMap.getZoomScale(zoom,dz);
    const half=growthMap.getSize().divideBy(2);
    const otl=growthMap.project(growthMap._drawnCenter,dz).subtract(half);
    const ntl=growthMap.project(center,zoom).subtract(half);
    const off=otl.multiplyBy(scale).subtract(ntl);
    cv.style.transformOrigin='0 0';
    cv.style.transform=`translate(${off.x}px,${off.y}px) scale(${scale})`;
  }
  function drawUpTo(yr,hi,now){
    ctx.clearRect(0,0,cv.width,cv.height);
    if(!growthPts)return;
    const progress=(yr-GROWTH_MIN)/(GROWTH_MAX-GROWTH_MIN);
    const glowGain=Math.max(0,(progress-0.65)/0.35); // ramp in over the last ~35%
    const glow=3+4*Math.sin((now||performance.now())/600);
    let di=0;
    for(const[x,y,yy]of growthPts){
      if(yy>yr)break;
      ctx.beginPath();
      ctx.fillStyle=era(yy);
      ctx.globalAlpha=(hi&&yy===hi)?1:0.7;
      const dense=growthDensity[di++]>=12;
      if(dense&&glowGain>0){
        ctx.shadowColor='rgba(166,232,74,.45)';
        ctx.shadowBlur=glow*glowGain;
      }else ctx.shadowBlur=0;
      ctx.arc(x,y,1.6,0,Math.PI*2);ctx.fill();
    }
    ctx.shadowBlur=0;
    ctx.globalAlpha=1;
    drawCalendar(yr);
  }
  function redrawStatic(){
    size();project();
    const yr=slider?+slider.value:GROWTH_MAX;
    drawUpTo(yr);
    if(yrLabel)yrLabel.textContent=yr;
  }

  const playBtn=document.getElementById('growth-replay');
  const setPlaying=on=>{if(playBtn)playBtn.classList.toggle('is-playing',on)};

  // pause: freeze on the current year, stop looping, flip the button back to play
  function pauseAnim(){
    growthLoop=false;
    if(growthRaf){cancelAnimationFrame(growthRaf);growthRaf=null}
    if(growthLoopTimer){clearTimeout(growthLoopTimer);growthLoopTimer=null}
    setPlaying(false);
    startGlowLoop(); // keep the glow alive while static
  }
  // play/resume: sweep from `fromYear` (default the start) to 2026, then loop
  function play(fromYear){
    stopGlowLoop();
    if(growthRaf)cancelAnimationFrame(growthRaf);
    if(growthLoopTimer){clearTimeout(growthLoopTimer);growthLoopTimer=null}
    growthLoop=true;
    size();project();
    // Reset calendar pop-animations when replaying from the beginning
    if(fromYear==null||fromYear<=GROWTH_MIN)resetCalAnim();
    if(prefersReduced()){drawUpTo(GROWTH_MAX);if(yrLabel)yrLabel.textContent=GROWTH_MAX;if(slider)slider.value=GROWTH_MAX;growthLoop=false;setPlaying(false);startGlowLoop();return}
    setPlaying(true);
    const span=GROWTH_MAX-GROWTH_MIN,DUR=2800;
    let t0=0;
    if(fromYear!=null){const f=Math.max(GROWTH_MIN,Math.min(GROWTH_MAX,fromYear));t0=(f-GROWTH_MIN)/span;if(t0>=1)t0=0}
    const start=performance.now()-t0*DUR;
    (function frame(now){
      const t=Math.min(1,(now-start)/DUR);
      const yr=Math.round(GROWTH_MIN+span*t);
      drawUpTo(yr,yr);
      if(yrLabel)yrLabel.textContent=yr;
      if(slider)slider.value=yr;
      if(t<1)growthRaf=requestAnimationFrame(frame);
      else{
        drawUpTo(GROWTH_MAX);
        startGlowLoop();
        if(yrLabel)yrLabel.textContent=GROWTH_MAX;
        if(slider)slider.value=GROWTH_MAX;
        growthRaf=null;
        // brief hold on the full map, then sweep again from the start
        if(growthLoop)growthLoopTimer=setTimeout(()=>{if(growthLoop)play()},1000);
      }
    })(performance.now());
  }

  function startGlowLoop(){
    if(growthRaf)return;
    if(cv._glowRaf)return;
    let last=0;
    function tick(now){
      cv._glowRaf=requestAnimationFrame(tick);
      if(now-last<100)return; // ~10 fps
      last=now;
      const yr=slider?+slider.value:GROWTH_MAX;
      drawUpTo(yr,null,now);
    }
    cv._glowRaf=requestAnimationFrame(tick);
    if(!cv._visWired){
      cv._visWired=true;
      document.addEventListener('visibilitychange',()=>{
        if(document.hidden){stopGlowLoop()}
        else if(!growthRaf){startGlowLoop()}
      });
    }
  }
  function stopGlowLoop(){
    if(cv._glowRaf){cancelAnimationFrame(cv._glowRaf);cv._glowRaf=null}
  }

  if(!growthMap._growthWired){
    growthMap._growthWired=true;
    growthMap.on('moveend zoomend',redrawStatic);
    window.addEventListener('resize',redrawStatic);
    // live tracking: slide the already-drawn dot canvas with the map while
    // dragging, and scale+slide it through the zoom animation, so the dots follow
    // the gesture instead of snapping into place only after it ends.
    growthMap.on('zoomstart',()=>{growthMap._zooming=true});
    growthMap.on('zoomend',()=>{growthMap._zooming=false});
    growthMap.on('move',()=>{
      if(growthMap._zooming)return;
      cv.style.transition='';
      applyTransform(growthMap.getCenter(),growthMap.getZoom());
    });
    // match Leaflet's zoom-animation easing so the canvas scales in sync
    growthMap.on('zoomanim',e=>{
      cv.style.transition='transform .25s cubic-bezier(0,0,.25,1)';
      applyTransform(e.center,e.zoom);
    });
  }
  // play/pause toggle: pause freezes on the current year, play resumes from it
  if(playBtn&&!playBtn._wired){
    playBtn._wired=true;
    playBtn.addEventListener('click',()=>{
      if(playBtn.classList.contains('is-playing'))pauseAnim();
      else play(slider?+slider.value:GROWTH_MIN);
    });
  }

  // timeline slider: grabbing it stops the auto-loop (button reverts to play) and
  // scrubs years manually
  if(slider&&!slider._wired){
    slider._wired=true;
    const scrub=()=>{
      pauseAnim();
      size();project();
      const yr=+slider.value;
      drawUpTo(yr);
      if(yrLabel)yrLabel.textContent=yr;
    };
    slider.addEventListener('pointerdown',pauseAnim);
    slider.addEventListener('input',scrub);
  }

  setTimeout(()=>{growthMap.invalidateSize();play()},150);
}

/* ---------------- 1.1f-flat: fingerprint unrolled (X=direction, Y=year) ----- */

let fpfData=null;

// per-year color ramp: deep green -> green -> lime -> yellow -> amber. More stops
// than the 4 eras, so each year reads as its own shade along the timeline.
const FP_STOPS=['#103d1d','#1d5a28','#2f7d2e','#5aa82e','#84c341','#a6e84a','#c8f06a'];
function fpRamp(t){
  t=Math.max(0,Math.min(1,t));
  const seg=t*(FP_STOPS.length-1),i=Math.min(FP_STOPS.length-2,Math.floor(seg)),u=seg-i;
  const h=k=>[parseInt(k.slice(1,3),16),parseInt(k.slice(3,5),16),parseInt(k.slice(5,7),16)];
  const a=h(FP_STOPS[i]),b=h(FP_STOPS[i+1]);
  return`rgb(${Math.round(a[0]+(b[0]-a[0])*u)},${Math.round(a[1]+(b[1]-a[1])*u)},${Math.round(a[2]+(b[2]-a[2])*u)})`;
}

export function drawFingerprintFlat(){
  const cv=document.getElementById('canvas-fingerprint-flat');if(!cv)return;
  const W=cv.offsetWidth||900;
  const ctx=cv.getContext('2d');
  // bins per year, identical bearing math to the radial fingerprint
  const stores=(M.stores_timeline&&M.stores_timeline.stores)||[];
  const byYear={};
  for(const[lat,lon,yr]of stores){
    if(!byYear[yr])byYear[yr]=new Array(72).fill(0);
    const dlon=lon-19.52,dlat=lat-52.05;
    const bearing=((Math.atan2(dlon,dlat)*180/Math.PI)+360)%360;
    byYear[yr][Math.floor(bearing/5)]++;
  }
  const sortedYears=Object.keys(byYear).map(Number).sort();
  const yearData={};(M.network_growth||[]).forEach(d=>{yearData[d.year]={new_stores:d.new_stores,cumulative:d.cumulative}});
  const n=sortedYears.length;
  // fixed spacing per year so every curve gets its own band + room for a label;
  // the canvas height is derived from the year count so nothing is cramped or clipped
  const rowH=22,DEFORM=rowH*0.85,padL=54,padR=16,padT=16,padB=30;
  const plotW=W-padL-padR;
  const H=padT+DEFORM+(n-1)*rowH+padB;
  cv.width=W;cv.height=H;cv.style.height=H+'px';
  fpfData={W,H,padL,padR,padT,padB,plotW,rowH,DEFORM,byYear,sortedYears,yearData};
  renderFpFlat(ctx);

  const tt=document.getElementById('fpf-tooltip');
  if(tt&&!cv._fpfWired){
    cv._fpfWired=true;
    cv.addEventListener('mousemove',e=>{
      if(!fpfData)return;
      const{padL,padB,plotW,rowH,sortedYears,byYear,yearData}=fpfData;
      const rect=cv.getBoundingClientRect();
      const mx=(e.clientX-rect.left)*(fpfData.W/rect.width);
      const my=(e.clientY-rect.top)*(fpfData.H/rect.height);
      const n=sortedYears.length;
      const i=Math.round((fpfData.H-padB-my)/rowH);
      const fx=(mx-padL)/plotW;
      // vertical guide follows the cursor whenever it is over the plot
      fpfData.hoverX=(fx>=0&&fx<=1)?mx:null;
      renderFpFlat(ctx);
      if(i>=0&&i<n&&fx>=0&&fx<=1){
        const yr=sortedYears[i],bins=byYear[yr];
        const bin=Math.min(71,Math.max(0,Math.floor(fx*72)));
        const dirs16=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
        const dirLabel=dirs16[Math.floor((bin*5)/(360/16))%16]||'N';
        const domBin=bins.indexOf(Math.max(...bins));
        const domLabel=dirs16[Math.floor((domBin*5)/(360/16))%16]||'N';
        const yd=yearData[yr];
        const col=fpRamp(n>1?i/(n-1):0);
        tt.style.display='block';
        tt.style.left=Math.min(e.clientX-rect.left+12,fpfData.W-190)+'px';
        tt.style.top=(e.clientY-rect.top-20)+'px';
        tt.innerHTML=`<div style="color:${col};font-family:var(--font-display);font-weight:700;font-size:16px">${yr}</div>
          ${yd?`<div style="margin-top:6px;font-size:12px">Nowych: <span style="color:var(--ink);font-family:var(--font-mono)">${fmt(yd.new_stores)}</span></div>`:''}
          <div style="font-size:12px;margin-top:2px">Kursor: <span style="color:${C.teal};font-weight:600">${dirLabel}</span> (${fmt(bins[bin])})</div>
          <div style="font-size:12px;margin-top:2px">dominanta ROKU: <span style="color:${C.green};font-weight:600">${domLabel}</span></div>`;
      }else tt.style.display='none';
    });
    cv.addEventListener('mouseleave',()=>{tt.style.display='none';if(fpfData){fpfData.hoverX=null;renderFpFlat(ctx)}});
    const hint=document.getElementById('fpf-hint');
    if(hint)cv.addEventListener('mousemove',()=>hint.classList.add('hidden'),{once:true});
  }
  if(!cv._fpfResize){cv._fpfResize=true;window.addEventListener('resize',()=>drawFingerprintFlat())}
}

function renderFpFlat(ctx){
  if(!fpfData)return;
  const{W,H,padL,padB,plotW,rowH,DEFORM,byYear,sortedYears}=fpfData;
  ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);

  const n=sortedYears.length;
  const N=72;
  const baseY=i=>H-padB-i*rowH; // i=0 oldest at bottom, newest on top
  const plotTop=baseY(n-1)-DEFORM,plotBottom=baseY(0);

  // direction gridlines + X labels (N E S W N)
  const dirs=[['N',0],['E',90],['S',180],['W',270],['N',360]];
  ctx.lineWidth=0.8;ctx.textAlign='center';
  dirs.forEach(([lab,deg])=>{
    const x=padL+(deg/360)*plotW;
    ctx.strokeStyle='rgba(132,195,65,.10)';
    ctx.beginPath();ctx.moveTo(x,plotTop);ctx.lineTo(x,plotBottom);ctx.stroke();
    ctx.fillStyle='#9ab088';ctx.font=`600 11px '${getFont('body')}',sans-serif`;
    ctx.textBaseline='top';ctx.fillText(lab,x,plotBottom+8);
  });

  // one curve per year, colored along the timeline ramp (era as color only)
  ctx.textAlign='right';ctx.textBaseline='middle';
  for(let i=n-1;i>=0;i--){
    const yr=sortedYears[i],bins=byYear[yr];
    const maxBin=Math.max(...bins,1);
    const yBase=baseY(i);
    const col=fpRamp(n>1?i/(n-1):0);
    ctx.beginPath();
    for(let j=0;j<=N;j++){
      const bi=j%N;
      const x=padL+(j/N)*plotW;
      const y=yBase-(bins[bi]/maxBin)*DEFORM;
      if(j===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.strokeStyle=col;ctx.lineWidth=1.3;ctx.stroke();
    // every curve gets its year on the left, in its own shade
    ctx.fillStyle=col;ctx.font=`10px '${getFont('mono')}',monospace`;
    ctx.fillText(yr,padL-8,yBase);
  }
  ctx.textAlign='left';ctx.textBaseline='alphabetic';

  // tasteful vertical guide through the cursor on hover
  if(fpfData.hoverX!=null){
    const hx=Math.max(padL,Math.min(padL+plotW,fpfData.hoverX));
    ctx.save();
    ctx.setLineDash([3,4]);
    ctx.strokeStyle='rgba(230,242,220,.38)';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(hx,plotTop-6);ctx.lineTo(hx,plotBottom+2);ctx.stroke();
    ctx.restore();
  }
}

/* ---------------- 1.1 growth chart: bars (new/yr, right) + YoY line (left) --- */

export function renderGrowthChart(){
  const data=M.network_growth||[];
  const labels=data.map(d=>d.year);
  const ERAS=[
    {x1:1998,x2:2009,color:'rgba(31,61,18,.25)'},
    {x1:2010,x2:2019,color:'rgba(53,102,21,.18)'},
    {x1:2020,x2:2022,color:'rgba(116,189,42,.12)'},
    {x1:2023,x2:2026,color:'rgba(166,232,74,.10)'}
  ];
  const yoyVals=data.map((d,i)=>{
    if(d.year<2002||i===0||!d.cumulative||d.cumulative===d.new_stores)return null;
    const prev=d.cumulative-d.new_stores;
    return Math.round(d.new_stores/prev*1000)/10;
  });
  const barColors=data.map(d=>d.year>=2023?C.green:d.year>=2010?C.green+'88':C.green+'44');
  const yoyLabelPlugin={
    id:'yoyPtLabels',
    afterDatasetsDraw(chart){
      const ds=chart.data.datasets[0];
      const meta=chart.getDatasetMeta(0);
      if(meta.hidden)return;
      const{ctx}=chart;
      ctx.save();
      ctx.font='600 10px JetBrains Mono,monospace';
      ctx.fillStyle=C.teal;
      ctx.textAlign='center';
      ctx.textBaseline='bottom';
      meta.data.forEach((el,i)=>{
        const raw=ds.data[i];
        if(raw==null)return;
        const txt=String(raw).replace('.',',')+' %';
        ctx.fillText(txt,el.x,el.y-7);
      });
      ctx.restore();
    }
  };
  destroyChart('growth');
  CHARTS['growth']=new Chart(document.getElementById('chart-growth'),{
    type:'bar',
    plugins:[yoyLabelPlugin],
    data:{labels,datasets:[
      {type:'line',label:'zmiana r/r %',data:yoyVals,borderColor:C.teal,backgroundColor:'transparent',fill:false,borderWidth:2,pointRadius:2,pointBackgroundColor:C.teal,tension:.4,yAxisID:'y0',order:1},
      {type:'bar', label:'nowych/rok', data:data.map(d=>d.new_stores),backgroundColor:barColors,borderRadius:2,borderWidth:0,yAxisID:'y1',order:2}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true,labels:{color:C.muted,usePointStyle:true,font:{size:11}}},
        tooltip:{enabled:false},
        barLabels:{thousands:true,color:'#ffffff',onlyBars:true,inside:true},
        annot:{shadedBands:ERAS}
      },
      scales:{
        x:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}},
        y0:{position:'left', grid:{color:C.axis},ticks:{color:C.teal,font:{size:10},callback:v=>v+'%'},title:{display:true,text:'zmiana r/r %',color:C.teal,font:{size:9}}},
        y1:{position:'right',grid:{display:false},ticks:{color:C.muted,font:{size:10}},title:{display:true,text:'nowych/rok',color:C.muted,font:{size:9}}}
      }
    }
  });
}


/* ---------------- powiat coverage tile: 380/380 + dot map ----- */

let _pcLevel='powiaty';
const _PC_CAP={powiaty:'powiatów ma Żabkę',miasta:'miast ma Żabkę',gminy:'gmin ma Żabkę'};
let _pcState=null;   // persistent so a level switch animates instead of jumping

export function renderPowiatCoverage(){
  const pc=M.powiat_coverage||{};
  const funnel=M.coverage_funnel||[];
  const node=funnel.find(f=>f.level===_pcLevel)
    || (_pcLevel==='powiaty'?{with:pc.covered,total:pc.total,pct:100}:{with:0,total:0,pct:0});
  const pct=node.pct!=null?node.pct:0;
  const setT=(id,v)=>{const el=document.getElementById(id);if(el&&v!=null)el.textContent=v};
  setT('powiat-cap',_PC_CAP[_pcLevel]||'');   // label can snap
  wirePowiatLevel();

  const cv=document.getElementById('canvas-powiat-map');if(!cv)return;
  const donut=document.getElementById('powiat-donut');
  const W=cv.offsetWidth||420,H=cv.offsetHeight||Math.round(W*0.62);
  // resize only when the size actually changed — avoids a clear/flash on switch
  if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}
  const ctx=cv.getContext('2d');
  const dctx=donut?donut.getContext('2d'):null;

  const COS=Math.cos(52*Math.PI/180);
  const loMin=14.1,loMax=24.2,laMin=49.0,laMax=54.9;
  const projW=(loMax-loMin)*COS,projH=(laMax-laMin);
  const sc=Math.min(W/projW,H/projH)*0.96;
  const ox=(W-projW*sc)/2,oy=(H-projH*sc)/2;
  const P=(lat,lon)=>[ox+(lon-loMin)*COS*sc, oy+(laMax-lat)*sc];
  const dots=(pc.dots||[]).map(([lat,lon])=>P(lat,lon));

  // green = covered share of the level (golden-ratio scatter), red = the rest;
  // fixed dot count — only the green/red split changes
  const frac=pct/100;
  const target=dots.map((_,i)=>((i*0.6180339887)%1)<frac);

  if(!_pcState){
    _pcState={dots,target,greenness:target.map(g=>g?1:0),
      pct,cov:node.with||0,tot:node.total||0,
      pctT:pct,covT:node.with||0,totT:node.total||0,hover:null,raf:0};
  }else{
    Object.assign(_pcState,{dots,target,pctT:pct,covT:node.with||0,totT:node.total||0});
  }
  const S=_pcState;

  const RED=[232,105,61],GRN=[132,195,65],LIME=[166,232,74];
  const lerp=(a,b,t)=>Math.round(a+(b-a)*t);

  function drawMap(now){
    ctx.clearRect(0,0,W,H);
    const wg=M.woj_geo;
    if(wg&&wg.features){
      ctx.strokeStyle='rgba(132,195,65,.16)';ctx.lineWidth=0.8;
      wg.features.forEach(f=>{const g=f.geometry||{};
        const polys=g.type==='MultiPolygon'?g.coordinates:g.type==='Polygon'?[g.coordinates]:[];
        polys.forEach(poly=>{const ring=poly[0];if(!ring)return;ctx.beginPath();
          ring.forEach((pt,k)=>{const[x,y]=P(pt[1],pt[0]);k?ctx.lineTo(x,y):ctx.moveTo(x,y)});
          ctx.closePath();ctx.stroke()})});
    }
    const EFFECT_R=46,BASE_R=1.6,MAX_R=2.5,hover=S.hover;
    S.dots.forEach(([x,y],i)=>{
      const gn=S.greenness[i];
      const dist=hover?Math.hypot(x-hover[0],y-hover[1]):999;
      const t=dist<EFFECT_R?1-dist/EFFECT_R:0;
      const breathe=t>0?0.2*Math.sin(now/280+dist/18):0;
      const jx=t>0?0.5*Math.sin(now/370+dist/22):0;
      const jy=t>0?0.5*Math.cos(now/340+dist/28):0;
      const r=Math.max(0.5,BASE_R+t*(MAX_R-BASE_R)+breathe);
      const gtop=[lerp(GRN[0],LIME[0],t),lerp(GRN[1],LIME[1],t),lerp(GRN[2],LIME[2],t)];
      const col=[lerp(RED[0],gtop[0],gn),lerp(RED[1],gtop[1],gn),lerp(RED[2],gtop[2],gn)];
      ctx.beginPath();ctx.arc(x+jx,y+jy,r,0,Math.PI*2);
      ctx.fillStyle=`rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.shadowColor=gn>0.5?`rgba(166,232,74,${0.5+0.3*t})`:`rgba(232,105,61,${0.45+0.3*t})`;
      ctx.shadowBlur=3+t*7;ctx.fill();ctx.shadowBlur=0;
    });
  }
  function drawDonut(){
    if(!dctx)return;
    const w=donut.width,h=donut.height,cx=w/2,cy=h/2,rr=Math.min(w,h)/2-14;
    dctx.clearRect(0,0,w,h);
    dctx.lineCap='round';dctx.lineWidth=15;
    dctx.strokeStyle='rgba(132,195,65,.12)';
    dctx.beginPath();dctx.arc(cx,cy,rr,0,Math.PI*2);dctx.stroke();
    const f2=Math.max(0,Math.min(1,S.pct/100));
    dctx.strokeStyle=C.greenBright;
    dctx.beginPath();dctx.arc(cx,cy,rr,-Math.PI/2,-Math.PI/2+Math.PI*2*f2);dctx.stroke();
    dctx.fillStyle=C.greenBright;dctx.textAlign='center';dctx.textBaseline='middle';
    dctx.font=`800 ${Math.round(w*0.21)}px '${getFont('display')}',sans-serif`;
    const ptxt=(Math.abs(S.pct-Math.round(S.pct))<0.05?Math.round(S.pct):S.pct.toFixed(1)).toString().replace('.',',');
    dctx.fillText(ptxt+'%',cx,cy);
  }
  function step(now){
    const k=0.07;let moving=false;
    S.pct+=(S.pctT-S.pct)*k; if(Math.abs(S.pctT-S.pct)>0.04)moving=true;else S.pct=S.pctT;
    S.cov+=(S.covT-S.cov)*k; if(Math.abs(S.covT-S.cov)>0.4)moving=true;else S.cov=S.covT;
    S.tot+=(S.totT-S.tot)*k; if(Math.abs(S.totT-S.tot)>0.4)moving=true;else S.tot=S.totT;
    for(let i=0;i<S.greenness.length;i++){const tg=S.target[i]?1:0;
      S.greenness[i]+=(tg-S.greenness[i])*k;
      if(Math.abs(tg-S.greenness[i])>0.004)moving=true;else S.greenness[i]=tg}
    drawMap(now);drawDonut();
    setT('powiat-covered',fmt(Math.round(S.cov)));
    setT('powiat-total',fmt(Math.round(S.tot)));
    S.raf=(moving||S.hover)?requestAnimationFrame(step):0;
  }
  if(!S.raf)S.raf=requestAnimationFrame(step);

  if(!cv._pcHoverInit){
    cv._pcHoverInit=true;
    cv.addEventListener('mousemove',e=>{const r=cv.getBoundingClientRect();
      _pcState.hover=[e.clientX-r.left,e.clientY-r.top];
      if(!_pcState.raf)_pcState.raf=requestAnimationFrame(step)});
    cv.addEventListener('mouseleave',()=>{_pcState.hover=null;
      if(!_pcState.raf)_pcState.raf=requestAnimationFrame(step)});
  }
  if(!cv._pcResize){cv._pcResize=true;window.addEventListener('resize',()=>{_pcState=null;renderPowiatCoverage()})}
}

function wirePowiatLevel(){
  document.querySelectorAll('#powiat-level .gran-btn').forEach(btn=>{
    if(btn._wired)return;btn._wired=true;
    btn.addEventListener('click',()=>{
      _pcLevel=btn.dataset.plevel;
      document.querySelectorAll('#powiat-level .gran-btn').forEach(b=>b.classList.toggle('active',b===btn));
      renderPowiatCoverage();
    });
  });
}

/* ---------------- 1.2/1.3 bars (left) + voivodeship choropleth (right) ----- */

const GRAN_WORD={voivodeship:'województwa',powiat:'powiaty',city:'miasta'};
const PAGE=20;
// Default dim is powiat (not voivodeship) per design spec
let _gDim='powiat',_gMetric='count',_gSort='desc',_gRows=[],_gTotal=0,_gOffset=0;
let _gAvg=null,_gMedian=null,_gSum=0;

const _dimCache=new Map();
function fetchDim(dim,metric,sort,limit,offset){
  const key=`${dim}|${metric}|${sort}|${limit}|${offset}`;
  if(_dimCache.has(key))return _dimCache.get(key);
  const p=fetch(`/api/stats/by-dimension?dim=${dim}&metric=${metric}&sort=${sort}&limit=${limit}&offset=${offset}`)
    .then(r=>r.json()).catch(()=>({rows:[],total:0}));
  _dimCache.set(key,p);
  return p;
}
const _vKey=()=>_gMetric==='per1k'?'per_1k':_gMetric==='per_km2'?'per_km2':'cnt';
const _isCount=()=>_gMetric==='count';

// cross-filter passes a truthy non-string (legacy); ignore and re-render current view.
// skipMap: pass true when only the dimension changed — the right choropleth is
// voivodeship-only and doesn't care which dim the left chart shows.
export async function renderGranular(arg,{skipMap=false}={}){
  if(typeof arg==='string'&&GRAN_WORD[arg])_gDim=arg;
  _gOffset=0;
  const pageLimit=_gDim==='voivodeship'?16:PAGE;
  const res=await fetchDim(_gDim,_gMetric,_gSort,pageLimit,0);
  _gRows=res.rows||[];_gTotal=res.total||0;
  _gAvg=res.avg;_gMedian=res.median;_gSum=res.sum||0;
  drawGranularChart();
  updateMoreBtn();
  if(!skipMap)renderWojMap();
  else if(_wojMap)_wojMap.invalidateSize();
}

async function loadMoreGranular(){
  _gOffset+=PAGE;
  const res=await fetchDim(_gDim,_gMetric,_gSort,PAGE,_gOffset);
  _gRows=_gRows.concat(res.rows||[]);
  drawGranularChart();updateMoreBtn();
}

function updateMoreBtn(){
  const b=document.getElementById('gran-more');if(!b)return;
  const more=_gDim!=='voivodeship'&&_gRows.length<_gTotal;
  b.hidden=!more;
  if(more)b.textContent=`Załaduj więcej (${_gRows.length}/${_gTotal})`;
}

function drawGranularChart(){
  const vk=_vKey();
  const f=STATE.filter?STATE.filter.toLowerCase():null;
  let rows=_gRows;
  if(f&&_gDim!=='voivodeship')rows=rows.filter(d=>d.voivodeship&&d.voivodeship.toLowerCase()===f);
  const n=rows.length;
  const colors=rows.map((d,i)=>{
    if(f&&_gDim==='voivodeship'&&d.name&&d.name.toLowerCase()!==f)return'rgba(132,195,65,.22)';
    return fpRamp(n>1?1-i/(n-1):1);
  });
  const word=GRAN_WORD[_gDim];
  const mlabel=_gMetric==='per1k'?'sklepy na 1000 mieszkańców':_gMetric==='per_km2'?'sklepy na km²':'liczba aktywnych sklepów';
  const tEl=document.getElementById('gran-title');
  if(tEl)tEl.textContent=`${_gSort==='asc'?'Najmniej':'Najwięcej'} Żabek – ${word}`;
  const sEl=document.getElementById('gran-sub');
  if(sEl)sEl.textContent=mlabel+(f&&_gDim!=='voivodeship'?` – ${STATE.filter}`:'');
  // grow the chart with the row count so load-more rows are not squished
  const wrap=document.getElementById('gran-chart-wrap');
  if(wrap)wrap.style.height=Math.max(320,n*22+44)+'px';
  // right-side map height is governed by CSS (gran-split stretch); just refresh it
  if(_wojMap)setTimeout(()=>_wojMap.invalidateSize(),0);

  // Labels + data: optionally append POZOSTALE for powiat/city with count metric
  let labels=rows.map(d=>d.name);
  let data=rows.map(d=>d[vk]);
  let _hasPozostale=false;
  if(_isCount()&&_gDim!=='voivodeship'&&!_gOffset&&_gRows.length<_gTotal){
    const visibleSum=data.reduce((a,b)=>a+b,0);
    const pozostale=_gSum-visibleSum;
    const remainingCount=_gTotal-_gRows.length;
    if(pozostale>0&&remainingCount>0){
      const avgPozostale=Math.round(pozostale/remainingCount);
      labels=labels.concat('Pozostałe (śr.)');
      data=data.concat(avgPozostale);
      colors.push('rgba(132,195,65,.15)');
      _hasPozostale=true;
    }
  }

  // Reference lines: AVG + MED from full dataset (skip vertical lines for city)
  const refLines=[];
  let avgLabel='',medLabel='';
  if(_gAvg!=null){
    if(_gDim!=='city') refLines.push({value:_gAvg,axis:'x',color:'#86a86a',lineWidth:2});
    avgLabel=`śr. ${_isCount()?fmt(Math.round(_gAvg)):_gAvg}`;
  }
  if(_gMedian!=null){
    if(_gDim!=='city') refLines.push({value:_gMedian,axis:'x',color:'#c79257',lineWidth:2});
    medLabel=`mediana ${_isCount()?fmt(Math.round(_gMedian)):_gMedian.toFixed(_gMetric==='per_km2'?3:2)}`;
  }
  const legEl=document.getElementById('gran-ref-legend');
  if(legEl){
    const parts=[];
    if(avgLabel)parts.push(`<span class="lg-item" style="color:#86a86a"><span class="lg-line"></span>${avgLabel}</span>`);
    if(medLabel)parts.push(`<span class="lg-item" style="color:#c79257"><span class="lg-line"></span>${medLabel}</span>`);
    legEl.innerHTML=parts.join('');
  }

  destroyChart('granular');
  CHARTS['granular']=new Chart(document.getElementById('chart-granular'),{
    type:'bar',
    data:{labels,datasets:[{
      data,backgroundColor:colors,
      hoverBackgroundColor:colors.map(()=>C.greenBright),borderRadius:2,borderWidth:0
    }]},
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:{right:48,top:28}},
      plugins:{
        legend:{display:false},
        tooltip:{enabled:false},
        barLabels:_isCount()?{thousands:true,color:C.muted}:{decimals:_gMetric==='per_km2'?3:2,color:C.muted},
        annot:{refLines},
      },
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}

/* ---- Right-side: locked voivodeship choropleth, styled like the reference --- */

// Green gradient matching the reference: very dark -> bright lime
const WOJ_STOPS=['#132912','#1e4019','#2d6324','#4a9228','#72c133','#a6e84a'];
function wojRamp(t){
  t=Math.max(0,Math.min(1,t));
  const seg=t*(WOJ_STOPS.length-1),i=Math.min(WOJ_STOPS.length-2,Math.floor(seg)),u=seg-i;
  const h=k=>[parseInt(k.slice(1,3),16),parseInt(k.slice(3,5),16),parseInt(k.slice(5,7),16)];
  const a=h(WOJ_STOPS[i]),b=h(WOJ_STOPS[i+1]);
  return`rgb(${Math.round(a[0]+(b[0]-a[0])*u)},${Math.round(a[1]+(b[1]-a[1])*u)},${Math.round(a[2]+(b[2]-a[2])*u)})`;
}

// Module-level state so hover handlers always use the live metric/sort
// even after the closure that created them is gone.
let _wojMap=null,_wojLayer=null,_wojPairs=null;
let _wojByName=new Map(),_wojById=new Map();
let _wojVmin=0,_wojVmax=1,_wojInverted=false,_wojMetricLive='count';

function _wFindRow(f){
  const p=f.properties||{};
  return _wojById.get(String(p.id??p.ID))||_wojById.get(String(p.nazwa))
    ||_wojByName.get((p.nazwa||'').toLowerCase())||_wojByName.get((p.name||'').toLowerCase());
}
function _wNorm(v){
  const t=(_wojVmax>_wojVmin)?(v-_wojVmin)/(_wojVmax-_wojVmin):0.5;
  return _wojInverted?1-t:t;
}
function _wVk(){return _wojMetricLive==='per1k'?'per_1k':_wojMetricLive==='per_km2'?'per_km2':'cnt'}
function _wFmtVal(r){
  const vk=_wVk();
  return _wojMetricLive==='count'?`${fmt(r[vk]||r.cnt)} sklepów`
    :_wojMetricLive==='per1k'?`${r.per_1k}/1k mieszk.`:`${r.per_km2}/km²`;
}
function _wStyle(f,opacity=0.9){
  const r=_wFindRow(f);const v=r?r[_wVk()]:null;
  return{weight:1,color:'#08110a',
    fillColor:v!=null?wojRamp(_wNorm(v)):'#0e1e0c',fillOpacity:opacity};
}

async function renderWojMap(){
  const el=document.getElementById('map-granular-woj');if(!el||!M.woj_geo)return;

  if(!_wojMap){
    _wojMap=L.map('map-granular-woj',{
      zoomControl:false,attributionControl:false,
      scrollWheelZoom:false,dragging:false,
      doubleClickZoom:false,boxZoom:false,keyboard:false
    });
    MAPS['map-granular-woj']=_wojMap;
    _wojMap.setView([52.0,19.3],6);
    _wojMap.invalidateSize();
  }

  const res=await fetchDim('voivodeship',_gMetric,'desc',16,0);
  const rows=res.rows||[];

  // Update module-level state so hover + style fns always see current data
  _wojMetricLive=_gMetric;
  _wojInverted=(_gSort==='asc');
  _wojByName=new Map();_wojById=new Map();
  rows.forEach(r=>{
    if(r.name)_wojByName.set(r.name.toLowerCase(),r);
    if(r.geo_id!=null)_wojById.set(String(r.geo_id),r);
  });
  const vk=_wVk();
  const vals=rows.map(r=>r[vk]).filter(v=>v!=null);
  _wojVmin=Math.min(...vals);_wojVmax=Math.max(...vals);

  // Color scale legend (same style as spoleczenstwo InPost map)
  const mapContainer=document.getElementById('map-granular-woj');
  if(mapContainer){
    const parent=mapContainer.parentElement;
    let leg=parent.querySelector('.map-legend');
    const fmtLeg=v=>{
      if(_wojMetricLive==='count')return Math.round(v).toLocaleString('pl-PL');
      if(_wojMetricLive==='per1k')return v.toFixed(2).replace('.',',');
      return v.toFixed(3).replace('.',',');
    };
    if(!leg){
      leg=document.createElement('div');
      leg.className='map-legend';
      leg.innerHTML='<div class="map-legend-axis map-legend-axis--vert" id="gran-leg-max"></div><div class="map-legend-bar" id="gran-leg-bar"></div><div class="map-legend-axis map-legend-axis--vert" id="gran-leg-min"></div>';
      parent.appendChild(leg);
    }
    const maxEl=leg.querySelector('#gran-leg-max')||leg.querySelector('.map-legend-axis');
    const minEl=leg.querySelector('#gran-leg-min')||leg.querySelectorAll('.map-legend-axis')[1];
    if(maxEl)maxEl.textContent=_wojInverted?fmtLeg(_wojVmin):fmtLeg(_wojVmax);
    if(minEl)minEl.textContent=_wojInverted?fmtLeg(_wojVmax):fmtLeg(_wojVmin);
  }

  // ── Fast path: layers already exist — just update styles + tooltips ────────
  if(_wojPairs){
    _wojPairs.forEach(({layer,f})=>{
      const r=_wFindRow(f);const v=r?r[vk]:null;
      layer.setStyle(_wStyle(f));
      layer.unbindTooltip();
      if(r)layer.bindTooltip(
        `<div style="font-family:var(--font-display);font-weight:700;font-size:13px;margin-bottom:3px">${r.name}</div>`+
        `<div style="font-size:12px;color:#93a487">${_wFmtVal(r)}</div>`,
        {sticky:true,className:'gran-tooltip',opacity:1}
      );
    });
    return;
  }

  // ── First render: create layers with short fade-in stagger ─────────────────
  _wojPairs=[];
  _wojLayer=L.geoJSON(M.woj_geo,{
    style:f=>_wStyle(f,0),   // start transparent
    onEachFeature:(f,layer)=>{
      _wojPairs.push({layer,f});
      const r=_wFindRow(f);
      if(r)layer.bindTooltip(
        `<div style="font-family:var(--font-display);font-weight:700;font-size:13px;margin-bottom:3px">${r.name}</div>`+
        `<div style="font-size:12px;color:#93a487">${_wFmtVal(r)}</div>`,
        {sticky:true,className:'gran-tooltip',opacity:1}
      );
      layer.on('mouseover',()=>{
        const rv=_wFindRow(f);const v=rv?rv[_wVk()]:null;
        layer.setStyle({weight:2.5,color:'rgba(166,232,74,.85)',
          fillColor:v!=null?wojRamp(Math.min(1,_wNorm(v)+0.18)):'#1c3a1c',fillOpacity:1});
        layer.bringToFront();
        const el=layer.getElement&&layer.getElement();
        if(el){
          const b=layer.getBounds().getCenter();
          const pt=_wojMap.latLngToLayerPoint(b);
          el.style.transformOrigin=`${pt.x}px ${pt.y}px`;
          el.style.transform='scale(1.06)';
        }
      });
      layer.on('mouseout',()=>{
        layer.setStyle(_wStyle(f));
        const el=layer.getElement&&layer.getElement();
        if(el){el.style.transform='scale(1)';}
      });
  }}).addTo(_wojMap);

  // Short stagger: 16 voivodeships × 14ms = ~220ms total
  _wojPairs.forEach(({layer},i)=>setTimeout(()=>{
    const svg=layer.getElement&&layer.getElement();
    if(svg)svg.style.transition='fill-opacity .25s ease,fill .25s ease';
    layer.setStyle({fillOpacity:0.9});
  },10+i*14));

  try{_wojMap.fitBounds(L.geoJSON(M.woj_geo).getBounds(),{padding:[6,6]})}catch(e){}
  setTimeout(()=>_wojMap&&_wojMap.invalidateSize(),60);
}

function _setActive(group,btn){
  document.querySelectorAll(`#${group} .gran-btn`).forEach(b=>{
    b.classList.toggle('active',b===btn);
    b.setAttribute('aria-pressed',b===btn?'true':'false');
  });
}

export function wireGranular(){
  const grp=(id,attr,cb)=>document.querySelectorAll(`#${id} .gran-btn`).forEach(btn=>{
    if(btn._wired)return;btn._wired=true;
    btn.addEventListener('click',()=>{if(!btn.classList.contains('is-disabled'))cb(btn.dataset[attr],btn)});
  });
  grp('gran-dim','dim',(v,btn)=>{_gDim=v;_setActive('gran-dim',btn);renderGranular(null,{skipMap:true})});
  grp('gran-metric','metric',(v,btn)=>{
    _gMetric=v;_setActive('gran-metric',btn);
    // per-capita / per-km2 have no city data — disable Miasta, bounce off it
    const noCity=(v==='per1k'||v==='per_km2');
    const cityBtn=document.querySelector('#gran-dim .gran-btn[data-dim="city"]');
    if(cityBtn)cityBtn.classList.toggle('is-disabled',noCity);
    if(noCity&&_gDim==='city'){
      _gDim='powiat';
      _setActive('gran-dim',document.querySelector('#gran-dim .gran-btn[data-dim="powiat"]'));
    }
    renderGranular();
  });
  grp('gran-sort','sort',(v,btn)=>{_gSort=v;_setActive('gran-sort',btn);renderGranular()});
  const more=document.getElementById('gran-more');
  if(more&&!more._wired){more._wired=true;more.addEventListener('click',loadMoreGranular)}
}

/* ---------------- 1.4a clock -> donut "Niedziela handlowa po zabkowemu" ----- */

export function drawClock(){
  const cv=document.getElementById('canvas-clock');if(!cv)return;
  const S=220;
  cv.width=S;cv.height=S;
  const ctx=cv.getContext('2d');
  ctx.clearRect(0,0,S,S);
  const cx=S/2,cy=S/2;

  const sum=M.summary||{};
  const total=+(sum.total_active||sum.total||0);
  const sunOpen=+(sum.open_sunday||0);
  const pctOpen=total>0?Math.min(1,sunOpen/total):0;

  const R0=S/2-10;
  const r0=Math.round(R0*0.60);
  const s=cv._clockAnimScale||1;
  const R=Math.round(R0*s);
  const r=Math.round(r0*s);
  const startA=-Math.PI/2;
  const openEnd=startA+2*Math.PI*pctOpen;
  const closedEnd=startA+2*Math.PI;

  // Background ring (closed stores grey/dark)
  ctx.beginPath();
  ctx.arc(cx,cy,R,openEnd,closedEnd);
  ctx.arc(cx,cy,r,closedEnd,openEnd,true);
  ctx.closePath();
  ctx.fillStyle='#2d3a29';
  ctx.fill();

  // Open-sunday arc (green, ~95%)
  ctx.beginPath();
  ctx.arc(cx,cy,R,startA,openEnd);
  ctx.arc(cx,cy,r,openEnd,startA,true);
  ctx.closePath();
  ctx.fillStyle='#84c341';
  ctx.fill();

  // Subtle inner highlight on green arc
  ctx.beginPath();
  ctx.arc(cx,cy,R-1,startA,openEnd);
  ctx.arc(cx,cy,r+1,openEnd,startA,true);
  ctx.closePath();
  ctx.fillStyle='rgba(166,232,74,0.10)';
  ctx.fill();

  // Center: percentage + label (stays same size/position when ring scales)
  const pctStr=`${(pctOpen*100).toFixed(1).replace('.',',')}%`;
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#eef3e6';
  ctx.font=`800 ${Math.round(S*0.145)}px '${getFont('display')}',sans-serif`;
  ctx.fillText(pctStr,cx,cy-S*0.065);
  ctx.font=`500 ${Math.round(S*0.063)}px '${getFont('body')}',sans-serif`;
  ctx.fillStyle='#93a487';
  ctx.fillText('otwarte',cx,cy+S*0.08);

  // Hover handlers — ring smoothly scales on canvas, text stays
  if(!cv._clockHoverInit){
    cv._clockHoverInit=true;
    cv.addEventListener('mouseenter',()=>ringScaleAnim(cv,1.1,350));
    cv.addEventListener('mouseleave',()=>ringScaleAnim(cv,1.0,350));
  }
}

function ringScaleAnim(cv,target,dur){
  if(cv._ringRaf){cancelAnimationFrame(cv._ringRaf);cv._ringRaf=0}
  const startS=cv._clockAnimScale||1;
  const t0=performance.now();
  function tick(){
    const t=Math.min((performance.now()-t0)/dur,1);
    const e=1-Math.pow(1-t,3); // easeOutCubic
    cv._clockAnimScale=startS+(target-startS)*e;
    drawClock();
    if(t<1)cv._ringRaf=requestAnimationFrame(tick);
    else{cv._clockAnimScale=target;cv._ringRaf=0}
  }
  tick();
}
