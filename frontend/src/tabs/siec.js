import Chart from '../chartjs-setup.js';
import { C, STATE, fpRamp } from '../config.js';
import { M, CHARTS, MAPS } from '../state.js';
import { era, fmt, getFont, destroyChart, capName as capCase, whenVisible, whenVisibleIdle, debounce, wireCountUp, heroCount } from '../utils.js';
import { loadMaplibre } from '../maplibre-lazy.js';

// MapLibre is ~280 KB gz; load it lazily (only when a map nears the viewport)
// instead of on first paint. These bindings are filled by ensureMaplibre().
let maplibregl, createMap, addVoivodeshipLayers, fitPoland, _bboxCenter, showMapUnavailable, WebGLUnavailableError;
function ensureMaplibre(){
  return loadMaplibre().then(m=>{
    ({ maplibregl, createMap, addVoivodeshipLayers, fitPoland, showMapUnavailable, WebGLUnavailableError } = m);
    _bboxCenter = m.featureBBoxCenter;
    return m;
  });
}
import { fetchJSON, loadSiec } from '../data.js';
import { renderBubble } from './bubble.js';
import { renderKraniec, selectFact } from './kraniec.js';
import { renderEdgeKPIs } from './edge.js';

// Re-exported so main.js can drive a /fakt/<slug> deep link through the
// already-loaded siec chunk without importing kraniec.js separately (which
// would change its bundling - it's meant to stay inlined into this chunk).
export { selectFact };
import { t, getLang } from '../i18n.js';

const prefersReduced = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function renderSiec(){
  // Above the fold, from the already-loaded core bucket - paints immediately so
  // the hero (LCP element) is not blocked on the heavy SIEC data.
  renderHero();
  renderStatStrip();
  renderOrigins();
  renderGrowthChart();
  // The GRAN bar fetches its own by-dimension data; render it now.
  wireGranular();
  renderGranular();
  // Bubble pulls its own by-dimension data, so it only needs visibility.
  whenVisible(document.getElementById('bubble-stage'), renderBubble);
  // Everything below feeds off the heavy SIEC bucket (stores-timeline,
  // amphibians, woj_geo, Atlas data). Kick it once and gate each scene on it, so
  // the fetch runs in the background after the hero paints instead of blocking
  // it. Scenes that also render maps stay whenVisibleIdle (past-load) with a
  // tight 80px rootMargin so the 229 KB MapLibre chunk is not pre-fetched on
  // mobile where these sit just below the fold.
  const ready = loadSiec();
  whenVisibleIdle(document.getElementById('map-growth'), ()=>ready.then(renderGrowthMap), '80px');
  whenVisible(document.getElementById('canvas-fingerprint-flat'), ()=>ready.then(drawFingerprintFlat));
  whenVisible(document.getElementById('powiat-donut'), ()=>ready.then(renderPowiatCoverage));
  ready.then(()=>{
    renderEdgeKPIs(); renderKraniec();
    // The edge-KPI tiles start at data-count="0" placeholders and only get
    // their real value here, once the SIEC bucket resolves. wireCountUp(root)
    // below already ran and, if a tile was visible early (e.g. a fast
    // scroll), fired-and-unobserved its count-up against that placeholder -
    // so re-wire just this strip now that the values are real, or it stays
    // stuck on "0" forever even though dataset.count is correct.
    wireCountUp(document.querySelector('.atlas-kpis'));
  });
  const root=document.getElementById('tab-siec');
  if(root){
    const obs=new IntersectionObserver((es)=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');obs.unobserve(e.target);}}),{threshold:.12});
    root.querySelectorAll('.si-reveal').forEach(r=>obs.observe(r));
    wireCountUp(root);
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
  // main.js already counts the hero up the moment core data lands (data-hero-done),
  // so the LCP paint happens early - don't re-animate here. Only run the count-up
  // if it hasn't been done yet (e.g. this tab re-rendered standalone).
  if(!el.dataset.heroDone){
    heroCount(el, (M.summary&&+M.summary.total_active)||0);
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
  let running=false,last=0;
  function frame(now){
    if(!running)return;
    heroRaf=requestAnimationFrame(frame);
    if(document.hidden||now-last<33)return;   // ~30fps, pause when tab hidden
    last=now;
    ctx.clearRect(0,0,cv.width,cv.height);
    // No per-particle shadowBlur: it forced a blur pass on every one of ~70
    // fills each frame (a continuous main-thread cost that kept the page from
    // going idle). On sub-2px dots the glow was barely visible anyway.
    ps.forEach(p=>{
      p.x+=p.vx;p.y+=p.vy;
      if(p.y<-6)p.y=cv.height+6;
      if(p.x<-6)p.x=cv.width+6;else if(p.x>cv.width+6)p.x=-6;
      ctx.beginPath();ctx.fillStyle=`rgba(166,232,74,${p.a})`;
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
    });
  }
  const start=()=>{if(!running){running=true;last=0;heroRaf=requestAnimationFrame(frame);}};
  const stop=()=>{running=false;if(heroRaf){cancelAnimationFrame(heroRaf);heroRaf=null;}};
  // Only animate while the hero is on-screen; stop entirely once scrolled past.
  if(typeof IntersectionObserver!=='undefined'){
    new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting?start():stop())).observe(cv);
  } else { start(); }
  if(!startHeroParticles._wired){
    startHeroParticles._wired=true;
    window.addEventListener('resize',debounce(size));
  }
}

/* ---------------- STAT STRIP: milestone cadence + origins ---------------- */

const PL_MONTHS=['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'];
const EN_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];

function formatYears(n){
  if(getLang()==='en') return n===1?'year':'years';
  const u=n%10,t=n%100;
  if(n===1)return'rok';
  if(u>=2&&u<=4&&(t<12||t>14))return'lata';
  return'lat';
}

function formatDate(s){
  if(!s)return'–';
  const[y,m,d]=s.split('-').map(Number);
  if(getLang()==='en') return `${EN_MONTHS[m-1]||''} ${d}, ${y}`;
  return `${d} ${PL_MONTHS[m-1]||''} ${y}`;
}

export function renderStatStrip(){
  const ng=M.network_growth||[];
  const yrAt=v=>{const d=ng.find(d=>d.cumulative>=v);return d?d.year:null};
  const firstYr=ng.length?ng[0].year:1998;
  const y1k=yrAt(1000),y5k=yrAt(5000),y10k=yrAt(10000);
  const toFirst=y1k!=null?y1k-firstYr:null;
  const last5=(y10k!=null&&y5k!=null)?y10k-y5k:null;
  // two split tiles: the slow first 1 000 vs the fast last 5 000
  const setYears=(id,n)=>{
    const el=document.getElementById(id);if(!el||n==null)return;
    const num=el.querySelector('.stat-num'),unit=document.getElementById(id+'-unit');
    if(num)num.dataset.count=n;
    if(unit)unit.textContent=formatYears(n);
  };
  setYears('stat-first1k',toFirst);
  setYears('stat-last5k',last5);

  // Standard hours (F7): the share of stores running the plain 06:00-23:00
  // Mon-Sat pattern - replaces a "best year" tile that just previewed the
  // 1.1 growth chart a few cards below.
  const oh=M.opening_hours||[];
  const total=M.summary&&M.summary.total_active;
  if(oh.length&&total){
    const standard=oh.find(p=>p.pattern==='06:00:00 - 23:00:00');
    if(standard){
      const hv=document.getElementById('stat-hoursstd');
      if(hv)hv.dataset.count=Math.round(standard.cnt/total*1000)/10;
    }
  }

  const ns=M.neighbor_stats;
  if(ns&&ns.distribution&&ns.distribution.median_m!=null){
    const el=document.getElementById('stat-neighmed');
    if(el)el.dataset.count=Math.round(ns.distribution.median_m);
  }

  const no=M.network_origin;
  if(no&&no.new_this_month!=null){
    const nmEl=document.getElementById('stat-new-month');
    if(nmEl)nmEl.dataset.count=no.new_this_month;
  }
  const citiesFunnel=M.coverage_funnel&&M.coverage_funnel.find(f=>f.level==='miasta');
  if(citiesFunnel){
    const ce=document.getElementById('stat-cities');
    const sub=document.getElementById('stat-cities-sub');
    if(ce&&citiesFunnel.pct!=null)ce.dataset.count=citiesFunnel.pct;
    if(sub) {
      const formattedTotal = (citiesFunnel.total||0).toLocaleString(getLang() === 'en' ? 'en-US' : 'pl-PL');
      sub.textContent = t('cities_funnel_text').replace('{total}', formattedTotal);
    }
  }
  const s=M.summary;
  if(s){
    const rEl=document.getElementById('stat-residents');
    if(rEl&&M.per_capita&&M.per_capita.length&&s.total_active){
      const totalPop=M.per_capita.reduce((a,r)=>a+(r.population||0),0);
      const perStore=Math.round(totalPop/(+s.total_active));
      const unitText = getLang() === 'en' ? ' people' : ' os.';
      rEl.innerHTML=`${perStore.toLocaleString(getLang() === 'en' ? 'en-US' : 'pl-PL')}<span class="stat-unit">${unitText}</span>`;
    }
  }
}

/* ---------------- ORIGINS: newest vs oldest active store ---------------- */

export function renderOrigins(){
  const o=M.network_origin;if(!o)return;
  const set=(id,v)=>{const el=document.getElementById(id);if(el&&v!=null&&v!=='')el.textContent=v};
  const setYear=(id,v)=>{const el=document.getElementById(id);if(el&&v)el.dataset.count=v};
  if(o.newest){
    setYear('origin-new-year',(o.newest.first_opening_date||'').slice(0,4));
    set('origin-new-city',o.newest.city);
    set('origin-new-street',o.newest.street);
    set('origin-new-date',formatDate(o.newest.first_opening_date));
  }
  if(o.oldest){
    setYear('origin-old-year',(o.oldest.first_opening_date||'').slice(0,4));
    set('origin-old-city',o.oldest.city);
    set('origin-old-street',o.oldest.street);
    set('origin-old-date',formatDate(o.oldest.first_opening_date));
  }
}

/* ---------------- BIG MAP: vector Poland + year-sweep growth ---------------- */

let growthMap=null,growthRaf=null,growthLoopTimer=null;
let growthLoop=true; // auto-repeat until the user grabs the timeline
let calData=null;    // {byYM: Map(year*100+month -> cnt), max}
const GROWTH_MIN=1998,GROWTH_MAX=2026;
const MONTH_INI= getLang() === 'en'
  ? ['J','F','M','A','M','J','J','A','S','O','N','D']
  : ['S','L','M','K','M','C','L','S','W','P','L','G'];

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

  // Derive row height from the map's actual rendered height (not a hardcoded
  // constant, so this still matches .growth-map on narrower mobile breakpoints);
  // derive cell width so the 12×29 grid is overall square: 12*cw = 29*ch  →
  // cw = ch*(years/12).
  const H_REF=document.getElementById('map-growth')?.offsetHeight||520;
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

// Convert [[lat,lon,year],...] into a Point FeatureCollection for the WebGL
// circle layer. Built once per render; the year property drives both the era
// colour and the sweep filter.
function _storesToGeoJSON(stores){
  const features=stores.map(([lat,lon,yr])=>({
    type:'Feature',
    geometry:{type:'Point',coordinates:[lon,lat]},
    properties:{year:(yr|0)||GROWTH_MIN}
  }));
  return {type:'FeatureCollection',features};
}

export async function renderGrowthMap(){
  const el=document.getElementById('map-growth');if(!el)return;
  await ensureMaplibre();
  const stores=(M.stores_timeline&&M.stores_timeline.stores)||[];
  buildCalData();
  const yrLabel=document.getElementById('growth-year');
  const slider=document.getElementById('growth-slider');
  const playBtn=document.getElementById('growth-replay');
  const setPlaying=on=>{if(playBtn)playBtn.classList.toggle('is-playing',on)};

  // First-time init: dark vector base + a single WebGL circle layer for all
  // 13k+ stores. The old Canvas-2D overlay and its pan/zoom transform sync
  // (applyTransform / _drawnCenter / _drawnZoom) are gone — MapLibre tracks
  // the dots natively at 60 fps.
  if(!growthMap){
    try {
      growthMap=createMap('map-growth',{
        center:[19.3,52.05],zoom:5.0,minZoom:4.5,maxZoom:9,
        pitch:0,bearing:0,
        dragRotate:false,pitchWithRotate:false,touchPitch:false,
        maxBounds:[[13.6,48.8],[24.2,55.0]],
        cooperativeGestures:true,
      });
      MAPS['map-growth']=growthMap;

      if(!el.querySelector('.map-zoom-hint')){
        const hint=document.createElement('div');
        hint.className='map-zoom-hint';
        hint.innerHTML='<span class="hint-mouse">ctrl + scroll przybliża</span><span class="hint-touch">dwoma palcami przesuwasz i przybliżasz</span>';
        el.appendChild(hint);
      }
      if(!el.querySelector('.map-reset-btn')){
        const rb=document.createElement('button');
        rb.className='map-reset-btn';rb.type='button';
        rb.textContent='Reset widoku';
        rb.setAttribute('aria-label','Resetuj widok mapy');
        rb.addEventListener('click',()=>{growthMap.easeTo({pitch:0,bearing:0,zoom:5.0,center:[19.3,52.05],duration:600})});
        el.appendChild(rb);
      }

      growthMap.on('load',()=>{
        if(M.woj_geo){
          addVoivodeshipLayers(growthMap,M.woj_geo,'woj-base',{
            fillColor:'#11240d',fillOpacity:.55,
            lineColor:'rgba(140,200,80,.18)',lineWidth:1,
          });
        }
        growthMap.addSource('stores',{type:'geojson',data:_storesToGeoJSON(stores)});
        // era colour steps mirror the old era() helper; circle-blur produces the
        // density halo that used to be hand-painted onto Canvas 2D per cluster.
        // circle-pitch-alignment:map lays the dots on the tilted surface (3D).
        // glow halo layer — same dots, larger + blurry, drawn first so the sharp dot sits on top
        growthMap.addLayer({
          id:'stores-glow',type:'circle',source:'stores',
          paint:{
            'circle-radius':4.5,
            'circle-color':['step',['get','year'],
              '#2b531a', 2010,'#4a8a22', 2020,'#74bd2a', 2023,'#a6e84a'],
            'circle-opacity':0.18,
            'circle-blur':1,
          },
        });
        growthMap.addLayer({
          id:'stores-dots',type:'circle',source:'stores',
          paint:{
            'circle-radius':1.7,
            'circle-color':['step',['get','year'],
              '#2b531a', 2010,'#4a8a22', 2020,'#74bd2a', 2023,'#a6e84a'],
            'circle-opacity':0.82,
            'circle-blur':0.2,
          },
        });
        // Show the final state immediately (one setFilter, not ~29) with a
        // static glow - no perpetual rAF loop, so the page can reach idle and
        // the TBT window can close. The intro sweep plays once on the first
        // genuine user scroll, never automatically: on desktop the map sits in
        // the initial viewport, so an on-view trigger would fire during load and
        // hammer the main thread. Bots/Lighthouse don't scroll, so they keep the
        // cheap static state. The replay button triggers it on demand too.
        setYear(GROWTH_MAX);
        if(slider)slider.value=GROWTH_MAX;
        setPlaying(false);
        setStaticGlow();
        if(!prefersReduced()){
          const kick=()=>{window.removeEventListener('scroll',kick);play(GROWTH_MIN);};
          window.addEventListener('scroll',kick,{once:true,passive:true});
        }
      });
      window.addEventListener('resize',debounce(()=>{drawCalendar(slider?+slider.value:GROWTH_MAX)}));
    } catch (e) {
      if (e instanceof WebGLUnavailableError) {
        showMapUnavailable(el, { message: getLang() === 'en' ? 'Expansion map unavailable' : 'Mapa ekspansji niedostępna' });
        growthMap = null;
        return;
      }
      throw e;
    }
  }

  // Single entry for "show year Y": filter the WebGL dots, sync the calendar
  // grid, and shimmer the glow across the last 35% of the timeline.
  let _lastYr=null;
  function setYear(yr,now){
    // Only rebuild the 13k-feature filter + calendar when the year actually
    // changes. The sweep runs at 60fps but the year steps ~29 times, and the
    // glow loop calls this 10x/s with an unchanged year - so this skips a huge
    // amount of redundant setFilter work. The glow paint below still updates.
    if(yr!==_lastYr){
      if(growthMap.getLayer('stores-dots'))growthMap.setFilter('stores-dots',['<=',['get','year'],yr]);
      if(growthMap.getLayer('stores-glow'))growthMap.setFilter('stores-glow',['<=',['get','year'],yr]);
      if(yrLabel)yrLabel.textContent=yr;
      drawCalendar(yr);
      _lastYr=yr;
    }
    if(now&&growthMap.getLayer('stores-dots')){
      const progress=(yr-GROWTH_MIN)/(GROWTH_MAX-GROWTH_MIN);
      const glowGain=Math.max(0,(progress-0.65)/0.35);
      const glowOpacity=0.18+0.12*glowGain;
      const blur=glowGain>0?0.35+0.25*Math.sin(now/600)*glowGain:0.35;
      growthMap.setPaintProperty('stores-dots','circle-blur',blur*0.5);
      growthMap.setPaintProperty('stores-glow','circle-opacity',glowOpacity);
    }
  }

  // pause: freeze on the current year, stop looping, flip the button back to play
  function pauseAnim(){
    growthLoop=false;
    if(growthRaf){cancelAnimationFrame(growthRaf);growthRaf=null}
    if(growthLoopTimer){clearTimeout(growthLoopTimer);growthLoopTimer=null}
    setPlaying(false);
    setStaticGlow(); // freeze the glow at its final look
  }
  // play/resume: sweep from `fromYear` (default the start) to 2026, then rest
  function play(fromYear){
    if(growthRaf)cancelAnimationFrame(growthRaf);
    if(growthLoopTimer){clearTimeout(growthLoopTimer);growthLoopTimer=null}
    growthLoop=true;
    if(fromYear==null||fromYear<=GROWTH_MIN)resetCalAnim();
    if(prefersReduced()){setYear(GROWTH_MAX);if(slider)slider.value=GROWTH_MAX;growthLoop=false;setPlaying(false);setStaticGlow();return}
    setPlaying(true);
    const span=GROWTH_MAX-GROWTH_MIN,DUR=2800;
    let t0=0;
    if(fromYear!=null){const f=Math.max(GROWTH_MIN,Math.min(GROWTH_MAX,fromYear));t0=(f-GROWTH_MIN)/span;if(t0>=1)t0=0}
    const start=performance.now()-t0*DUR;
    (function frame(now){
      const t=Math.min(1,(now-start)/DUR);
      const yr=Math.round(GROWTH_MIN+span*t);
      setYear(yr,now);
      if(slider)slider.value=yr;
      if(t<1)growthRaf=requestAnimationFrame(frame);
      else{
        setYear(GROWTH_MAX);
        if(slider)slider.value=GROWTH_MAX;
        growthRaf=null;
        growthLoop=false;      // play the intro sweep once, then rest (replay via the button)
        setPlaying(false);
        setStaticGlow();       // settle to the static final glow
      }
    })(performance.now());
  }

  // Static final glow: set the paint once instead of running a perpetual rAF
  // shimmer. The old 10fps loop kept MapLibre repainting 13k circles forever,
  // so the page never went idle and the TBT window never closed - the single
  // biggest main-thread cost on desktop. The breathing shimmer is gone; the
  // static glow reads the same at rest.
  function setStaticGlow(){
    if(!growthMap.getLayer||!growthMap.getLayer('stores-dots'))return;
    growthMap.setPaintProperty('stores-dots','circle-blur',0.35*0.5);
    growthMap.setPaintProperty('stores-glow','circle-opacity',0.30);
  }

  // play/pause toggle: pause freezes on the current year, play resumes from it
  if(playBtn&&!playBtn._wired){
    playBtn._wired=true;
    playBtn.addEventListener('click',()=>{
      if(playBtn.classList.contains('is-playing'))pauseAnim();
      else play(slider?+slider.value:GROWTH_MIN);
    });
  }
  // timeline slider: grabbing it stops the auto-loop and scrubs years manually
  if(slider&&!slider._wired){
    slider._wired=true;
    slider.addEventListener('pointerdown',pauseAnim);
    slider.addEventListener('input',()=>{pauseAnim();setYear(+slider.value)});
  }
}
/* ---------------- 1.1f-flat: fingerprint unrolled (X=direction, Y=year) ----- */

let fpfData=null;

// per-year color ramp (deep green -> green -> lime -> yellow -> amber) lives in
// config.js now; imported above as fpRamp so the ramp has one source of truth.

let _fpfStatic=null; // offscreen canvas: background + gridlines + all year curves (redrawn only on data/resize)

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
  _drawFpfStatic();
  renderFpFlat(ctx);

  const tt=document.getElementById('fpf-tooltip');
  if(tt&&!cv._fpfWired){
    cv._fpfWired=true;
    const handleMove = e => {
      if(!fpfData)return;
      const{padL,padB,plotW,rowH,sortedYears,byYear,yearData}=fpfData;
      const rect=cv.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const mx=(clientX-rect.left)*(fpfData.W/rect.width);
      const my=(clientY-rect.top)*(fpfData.H/rect.height);
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
        tt.style.left=Math.min(clientX-rect.left+12,fpfData.W-190)+'px';
        tt.style.top=(clientY-rect.top-20)+'px';
        tt.innerHTML=`<div style="color:${col};font-family:var(--font-display);font-weight:700;font-size:16px">${yr}</div>
          ${yd?`<div style="margin-top:6px;font-size:12px">Nowych: <span style="color:var(--ink);font-family:var(--font-mono)">${fmt(yd.new_stores)}</span></div>`:''}
          <div style="font-size:12px;margin-top:2px">Kursor: <span style="color:${C.teal};font-weight:600">${dirLabel}</span> (${fmt(bins[bin])})</div>
          <div style="font-size:12px;margin-top:2px">dominanta ROKU: <span style="color:${C.green};font-weight:600">${domLabel}</span></div>`;
      }else tt.style.display='none';
    };
    const handleLeave = () => {
      tt.style.display='none';
      if(fpfData){fpfData.hoverX=null;renderFpFlat(ctx)}
    };
    cv.addEventListener('mousemove', handleMove);
    cv.addEventListener('mouseleave', handleLeave);
    cv.addEventListener('touchstart', handleMove, {passive:true});
    cv.addEventListener('touchmove', handleMove, {passive:true});
    cv.addEventListener('touchend', handleLeave);
    const hint=document.getElementById('fpf-hint');
    if(hint){
      const hideHint=()=>hint.classList.add('hidden');
      cv.addEventListener('mousemove',hideHint,{once:true});
      cv.addEventListener('touchstart',hideHint,{once:true});
    }
  }
  if(!cv._fpfResize){cv._fpfResize=true;window.addEventListener('resize',debounce(()=>drawFingerprintFlat()))}
}

// Background + gridlines + all N-year curves, drawn once into an offscreen
// canvas. This is the expensive part (n years x 72 segments each); mousemove
// used to re-run all of it on every event just to move a guide line. Now
// mousemove only blits this cached bitmap + strokes one dashed line.
function _drawFpfStatic(){
  const{W,H,padL,padB,plotW,rowH,DEFORM,byYear,sortedYears}=fpfData;
  if(!_fpfStatic)_fpfStatic=document.createElement('canvas');
  _fpfStatic.width=W;_fpfStatic.height=H;
  const ctx=_fpfStatic.getContext('2d');
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
}

function renderFpFlat(ctx){
  if(!fpfData||!_fpfStatic)return;
  const{W,H,padL,padB,plotW,DEFORM,sortedYears}=fpfData;
  ctx.clearRect(0,0,W,H);
  ctx.drawImage(_fpfStatic,0,0);

  const n=sortedYears.length;
  const baseY=i=>H-padB-i*fpfData.rowH;
  const plotTop=baseY(n-1)-DEFORM,plotBottom=baseY(0);

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
  const container = document.getElementById('chart-growth');
  if(!container) return;

  const yoyVals=data.map((d,i)=>{
    if(d.year<2002||i===0||!d.cumulative||d.cumulative===d.new_stores)return null;
    const prev=d.cumulative-d.new_stores;
    return Math.round(d.new_stores/prev*1000)/10;
  });

  const plotData = data.map((d, i) => ({
    year: d.year,
    new_stores: d.new_stores,
    cumulative: d.cumulative,
    yoy: yoyVals[i]
  }));

  const maxStores = Math.max(...plotData.map(d => d.new_stores || 0));
  const maxYoy = Math.max(...plotData.map(d => d.yoy || 0));

  destroyChart('growth');

  // container is a <canvas id="chart-growth"> (see index.html); Chart.js needs
  // its 2D context, not a container div to append an SVG into (as Plot did).
  const ctx = container.getContext ? container.getContext('2d') : null;
  if(!ctx) return;

  const years = plotData.map(d => d.year);
  const tipFor = d => {
    const lines = [
      t('tooltip_year').replace('{year}', d.year),
      t('tooltip_new_stores').replace('{count}', d.new_stores.toLocaleString(getLang() === 'en' ? 'en-US' : 'pl-PL'))
    ];
    lines.push(t('tooltip_yoy').replace('{pct}', d.yoy != null ? d.yoy + '%' : '–'));
    return lines;
  };

  CHARTS['growth'] = new Chart(ctx, {
    data: {
      labels: years,
      datasets: [
        {
          type: 'bar',
          label: t('chart_growth_legend_new'),
          data: plotData.map(d => d.new_stores),
          backgroundColor: plotData.map(d => d.year >= 2023 ? C.green : d.year >= 2010 ? C.green + '88' : C.green + '44'),
          borderRadius: 2,
          yAxisID: 'y',
          order: 2,
        },
        {
          type: 'line',
          label: t('chart_growth_legend_yoy'),
          data: plotData.map(d => d.yoy),
          borderColor: C.teal,
          backgroundColor: C.bg,
          borderWidth: 2,
          pointRadius: 3,
          pointBorderWidth: 1.5,
          pointBorderColor: C.teal,
          pointBackgroundColor: C.bg,
          cubicInterpolationMode: 'monotone',
          spanGaps: true,
          yAxisID: 'y1',
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        annot: {
          // Very faint background tint per growth era - matches the original
          // rgba values 1:1 (2009/2019/2022 cutoffs, same alpha per band).
          shadedBands: [
            { x1: 1998, x2: 2009, color: 'rgba(31,61,18,.08)' },
            { x1: 2010, x2: 2019, color: 'rgba(53,102,21,.06)' },
            { x1: 2020, x2: 2022, color: 'rgba(116,189,42,.04)' },
            { x1: 2023, x2: 2026, color: 'rgba(166,232,74,.03)' },
          ],
        },
        tooltip: {
          callbacks: {
            title: () => '',
            label: ctx => ctx.datasetIndex === 0 ? tipFor(plotData[ctx.dataIndex]) : [],
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Rok →', color: C.muted },
          grid: { display: false },
          ticks: { color: C.muted },
        },
        y: {
          // No explicit max: let Chart.js pick a round tick ceiling (matching
          // Plot's rounder-looking axis) instead of clamping exactly to
          // maxStores. Safe to do independently of the line, since yoy lives
          // on its own hidden y1 axis scaled to maxYoy regardless of this one.
          title: { display: true, text: '↑ Nowe sklepy', color: C.muted },
          beginAtZero: true,
          grid: { color: C.axis },
          ticks: { color: C.muted },
        },
        y1: {
          display: false,
          beginAtZero: true,
          max: maxYoy || 100,
        },
      },
    },
  });
}


/* ---------------- powiat coverage tile: 380/380 + dot map ----- */

let _pcLevel='powiaty';
const _PC_CAP={powiaty:'powiatów ma Żabkę',miasta:'miast ma Żabkę',gminy:'gmin ma Żabkę'};
let _pcState=null;   // persistent so a level switch animates instead of jumping
let _pcOutline=null; // cached offscreen render of the static voivodeship outline

export function renderPowiatCoverage(){
  const pc=M.powiat_coverage||{};
  const funnel=M.coverage_funnel||[];
  const node=funnel.find(f=>f.level===_pcLevel)
    || (_pcLevel==='powiaty'?{covered:pc.covered,total:pc.total,pct:100}:{covered:0,total:0,pct:0});
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
      pct,cov:node.covered||0,tot:node.total||0,
      pctT:pct,covT:node.covered||0,totT:node.total||0,hover:null,raf:0};
  }else{
    Object.assign(_pcState,{dots,target,pctT:pct,covT:node.covered||0,totT:node.total||0});
  }
  const S=_pcState;

  const RED=[232,105,61],GRN=[132,195,65],LIME=[166,232,74];
  const lerp=(a,b,t)=>Math.round(a+(b-a)*t);

  // The voivodeship outline never changes frame-to-frame (only the dot colors
  // do), so it's traced once per size into an offscreen canvas and blitted -
  // instead of re-stroking every ring of every polygon on every animation
  // frame (which used to run for as long as a hover was active).
  if(!_pcOutline||_pcOutline.width!==W||_pcOutline.height!==H){
    _pcOutline=document.createElement('canvas');
    _pcOutline.width=W;_pcOutline.height=H;
    const octx=_pcOutline.getContext('2d');
    const wg=M.woj_geo;
    if(wg&&wg.features){
      octx.strokeStyle='rgba(132,195,65,.16)';octx.lineWidth=0.8;
      wg.features.forEach(f=>{const g=f.geometry||{};
        const polys=g.type==='MultiPolygon'?g.coordinates:g.type==='Polygon'?[g.coordinates]:[];
        polys.forEach(poly=>{const ring=poly[0];if(!ring)return;octx.beginPath();
          ring.forEach((pt,k)=>{const[x,y]=P(pt[1],pt[0]);k?octx.lineTo(x,y):octx.moveTo(x,y)});
          octx.closePath();octx.stroke()})});
    }
  }
  function drawMap(now){
    ctx.clearRect(0,0,W,H);
    ctx.drawImage(_pcOutline,0,0);
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
    const handleMove = e=>{
      if(!_pcState)return;
      const r=cv.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      _pcState.hover=[clientX-r.left,clientY-r.top];
      if(!_pcState.raf)_pcState.raf=requestAnimationFrame(step)};
    const handleLeave = ()=>{
      if(!_pcState)return;
      _pcState.hover=null;
      if(!_pcState.raf)_pcState.raf=requestAnimationFrame(step)};
    cv.addEventListener('mousemove', handleMove);
    cv.addEventListener('mouseleave', handleLeave);
    cv.addEventListener('touchstart', handleMove, {passive:true});
    cv.addEventListener('touchmove', handleMove, {passive:true});
    cv.addEventListener('touchend', handleLeave);
  }
  if(!cv._pcResize){cv._pcResize=true;window.addEventListener('resize',debounce(()=>{_pcOutline=null;renderPowiatCoverage()}))}
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
// Full-dataset value range for bar coloring, independent of pagination/sort -
// see the comment above drawGranularChart's color mapping for why.
let _gVmin=0,_gVmax=1;
const _FULL_RANGE_LIMIT={voivodeship:16};

// Strip GUS naming artefacts (M.st., " od YYYY", "powiat ") then display-case.
function capName(n){
  if(!n)return n;
  n=String(n).replace(/^M\.st\.\s*/i,'').replace(/\s+od\s+\d{4}\s*$/i,'').replace(/^powiat\s+/i,'').trim();
  return capCase(n);
}

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
  // Bar color must reflect each row's actual value against the WHOLE
  // dataset, not just the current page/sort - a paginated top-20-largest and
  // a paginated bottom-20-smallest are different rows entirely, so coloring
  // by position within them made the meaning of "dark" flip with the sort
  // toggle. Fetch (or reuse from cache) the full unpaginated range once per
  // dim/metric change; this is the same request _fillWoj already makes for
  // voivodeship/powiat, so it's usually a cache hit, not an extra round trip.
  const fullRes=await fetchDim(_gDim,_gMetric,'desc',_FULL_RANGE_LIMIT[_gDim]||500,0);
  const vk=_vKey();
  const fullVals=(fullRes.rows||[]).map(r=>r[vk]).filter(v=>v!=null);
  _gVmin=fullVals.length?Math.min(...fullVals):0;
  _gVmax=fullVals.length?Math.max(...fullVals):_gVmin+1;
  drawGranularChart();
  updateMoreBtn();
  if(!skipMap)renderWojMap();
  else if(_wojMap)_wojMap.resize&&_wojMap.resize();
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
  if(more)b.textContent = t('load_more_format').replace('{current}', _gRows.length).replace('{total}', _gTotal);
}

function drawGranularChart(){
  const vk=_vKey();
  const f=STATE.filter?STATE.filter.toLowerCase():null;
  let rows=_gRows;
  if(f&&_gDim!=='voivodeship')rows=rows.filter(d=>d.voivodeship&&d.voivodeship.toLowerCase()===f);
  const n=rows.length;
  // Color by each bar's actual value against the full-dataset range
  // (_gVmin/_gVmax), not by its position in the current page/sort - so a
  // powiat's color never changes when you flip Najwieksze/Najmniejsze, and
  // lighter (up to the Zabka green cap) always means more Zabek, matching
  // the map's _granRamp.
  const colors=rows.map(d=>{
    if(f&&_gDim==='voivodeship'&&d.name&&d.name.toLowerCase()!==f)return'rgba(132,195,65,.22)';
    const v=d[vk];
    if(v==null)return _granRamp(0);
    const norm=(_gVmax>_gVmin)?(v-_gVmin)/(_gVmax-_gVmin):0.5;
    return _granRamp(norm);
  });
  const word = t('gran_word_' + _gDim);
  const mlabel = _gMetric === 'per1k' 
    ? t('gran_metric_per1k_label') 
    : _gMetric === 'per_km2' 
      ? t('gran_metric_per_km2_label') 
      : t('gran_sub');
  const tEl=document.getElementById('gran-title');
  if(tEl) {
    const titlePattern = _gSort === 'asc' ? t('gran_title_format_asc') : t('gran_title_format_desc');
    tEl.textContent = titlePattern.replace('{word}', word);
  }
  const sEl=document.getElementById('gran-sub');
  if(sEl)sEl.textContent=mlabel+(f&&_gDim!=='voivodeship'?` – ${STATE.filter}`:'');
  // grow the chart with the row count so load-more rows are not squished
  const wrap=document.getElementById('gran-chart-wrap');
  if(wrap)wrap.style.height=Math.max(320,n*22+44)+'px';
  // right-side map height is governed by CSS (gran-split stretch); just refresh it
  if(_wojMap)setTimeout(()=>{_wojMap.resize&&_wojMap.resize();},0);

  // Labels + data: append POZOSTALE for non-count metrics when not all rows are shown
  let labels=rows.map(d=>capName(d.name));
  let data=rows.map(d=>d[vk]);
  let _hasPozostale=false;
  if(!_isCount()&&_gDim!=='voivodeship'&&!_gOffset&&_gRows.length<_gTotal&&_gAvg!=null){
    labels=labels.concat(t('gran_ref_others'));
    data=data.concat(+_gAvg.toFixed(_gMetric==='per_km2'?3:2));
    colors.push('rgba(147,164,135,0.35)');
    _hasPozostale=true;
  }

  // Reference lines: AVG + MED from full dataset (skip vertical lines for city)
  const refLines=[];
  let avgLabel='',medLabel='';
  if(_gAvg!=null){
    if(_gDim!=='city') refLines.push({value:_gAvg,axis:'x',color:'#86a86a',lineWidth:2});
    const valFormatted = _isCount() 
      ? fmt(Math.round(_gAvg)) 
      : (getLang() === 'en' ? _gAvg.toFixed(2) : _gAvg.toFixed(2).replace('.', ','));
    avgLabel = t('legend_avg').replace('{val}', valFormatted);
  }
  if(_gMedian!=null){
    if(_gDim!=='city') refLines.push({value:_gMedian,axis:'x',color:'#c79257',lineWidth:2});
    const medVal = _isCount() 
      ? fmt(Math.round(_gMedian)) 
      : (getLang() === 'en' 
          ? _gMedian.toFixed(_gMetric === 'per_km2' ? 3 : 2) 
          : _gMedian.toFixed(_gMetric === 'per_km2' ? 3 : 2).replace('.', ','));
    medLabel = t('legend_median').replace('{val}', medVal);
  }
  const legEl=document.getElementById('gran-ref-legend');
  if(legEl){
    const parts=[];
    if(avgLabel)parts.push(`<span class="lg-item" style="color:#86a86a"><span class="lg-line"></span>${avgLabel}</span>`);
    if(medLabel)parts.push(`<span class="lg-item" style="color:#c79257"><span class="lg-line"></span>${medLabel}</span>`);
    legEl.innerHTML=parts.join('');
  }

  const barLabelsOpt=_isCount()?{thousands:true,color:C.muted}
    :_gMetric==='per1k'?{decimals:2,color:C.muted,suffix: ' ' + t('suffix_per1k')}
    :{decimals:3,color:C.muted,suffix: ' ' + t('suffix_per_km2')};

  // Every dim/metric/sort/filter change used to destroy+recreate this chart,
  // paying a full teardown + entry animation on each click. Update the
  // existing instance in place (new labels/data/colors, no animation) instead
  // - only build fresh on first render. Row COUNT can change freely between
  // updates (voivodeship=16 vs powiat=314); Chart.js handles a shrinking or
  // growing labels/data array fine as long as both arrays are replaced together.
  const existing=CHARTS['granular'];
  if(existing){
    existing.data.labels=labels;
    const ds=existing.data.datasets[0];
    ds.data=data;ds.backgroundColor=colors;ds.hoverBackgroundColor=colors.map(()=>C.greenBright);
    existing.options.plugins.barLabels=barLabelsOpt;
    existing.options.plugins.annot.refLines=refLines;
    existing.update('none');
    return;
  }
  CHARTS['granular']=new Chart(document.getElementById('chart-granular'),{
    type:'bar',
    data:{labels,datasets:[{
      data,backgroundColor:colors,
      hoverBackgroundColor:colors.map(()=>C.greenBright),borderRadius:2,borderWidth:0
    }]},
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:{right:48,top:28}},
      animation:{duration:0},
      plugins:{
        legend:{display:false},
        tooltip:{enabled:false},
        barLabels:barLabelsOpt,
        annot:{refLines},
      },
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}

/* ---- Right-side: locked voivodeship choropleth (MapLibre, no tiles) ---- */

// GRAN ramp: near-black (fewest Zabek) up to the Zabka brand green #84c341
// (most) - capped there rather than running up to the brighter lime used
// elsewhere (fpRamp's #a6e84a/#c8f06a), per design direction. Shared by the
// map fill/extrusion (MapLibre expression below) and the bar chart
// (_granRamp, a plain JS interpolator over the same stops). t=1 is always
// the highest value in the current view, regardless of the
// Najwieksze/Najmniejsze sort toggle (that only reorders the bars) - so
// lighter green consistently reads as "more Zabek" everywhere in GRAN.
const _GRAN_RAMP_STOPS=['#0a120a','#16291a','#2c4d27','#559433','#84c341'];
function _granRamp(t){
  t=Math.max(0,Math.min(1,t));
  const seg=t*(_GRAN_RAMP_STOPS.length-1),i=Math.min(_GRAN_RAMP_STOPS.length-2,Math.floor(seg)),u=seg-i;
  const h=k=>[parseInt(k.slice(1,3),16),parseInt(k.slice(3,5),16),parseInt(k.slice(5,7),16)];
  const a=h(_GRAN_RAMP_STOPS[i]),b=h(_GRAN_RAMP_STOPS[i+1]);
  return`rgb(${Math.round(a[0]+(b[0]-a[0])*u)},${Math.round(a[1]+(b[1]-a[1])*u)},${Math.round(a[2]+(b[2]-a[2])*u)})`;
}
const _WOJ_FILL_STOPS=[
  'interpolate',['linear'],['get','_t'],
  0,_GRAN_RAMP_STOPS[0], 0.25,_GRAN_RAMP_STOPS[1], 0.5,_GRAN_RAMP_STOPS[2], 0.75,_GRAN_RAMP_STOPS[3], 1,_GRAN_RAMP_STOPS[4]];

// Module-level state so hover handlers always see the live metric/sort even
// after the closure that created them is gone.
let _wojMap=null,_wojSrcReady=false,_wojPending=false;
let _wojByName=new Map(),_wojById=new Map();
let _wojVmin=0,_wojVmax=1,_wojMetricLive='count';
let _wojTip=null;
let _wojLabelMarkers=[];   // MapLibre HTML markers carrying the value labels
let _mapMode='2d';
let _powGeo=null;
let _wojLevelLive='voivodeship';  // level actually drawn on the right map (see _fillWoj)

function _wVk(){return _wojMetricLive==='per1k'?'per_1k':_wojMetricLive==='per_km2'?'per_km2':'cnt'}
function _wFmtVal(r){
  const vk=_wVk();
  if (_wojMetricLive==='count') {
    const suffix = getLang() === 'en' ? ' stores' : ' sklepów';
    return `${fmt(r[vk]||r.cnt)}${suffix}`;
  }
  if (_wojMetricLive==='per1k') {
    const suffix = getLang() === 'en' ? '/1k res.' : '/1k mieszk.';
    return `${getLang() === 'en' ? r.per_1k : String(r.per_1k).replace('.', ',')}${suffix}`;
  }
  return `${getLang() === 'en' ? r.per_km2 : String(r.per_km2).replace('.', ',')}/km²`;
}
function _wFindRow(f){
  const p=f.properties||{};
  let name=(p.nazwa||p.name||'');
  name=name.replace(/^powiat\s+/i,'').toLowerCase();
  return _wojById.get(String(p.id??p.ID))||_wojById.get(String(p.nazwa))
    ||_wojByName.get(name)||_wojByName.get((p.nazwa||'').toLowerCase())||_wojByName.get((p.name||'').toLowerCase());
}

// Inject the normalized ramp position (_t) + name/val into each woj feature,
// push the updated GeoJSON to the source, and refresh the value-label markers.
function _setWojData(rows,geojson,metric){
  _wojMetricLive=metric;
  _wojByName=new Map();_wojById=new Map();
  rows.forEach(r=>{
    if(r.name)_wojByName.set(r.name.toLowerCase(),r);
    if(r.geo_id!=null)_wojById.set(String(r.geo_id),r);
  });
  const vk=_wVk();
  const vals=rows.map(r=>r[vk]).filter(v=>v!=null);
  const vmin=vals.length?Math.min(...vals):0, vmax=vals.length?Math.max(...vals):vmin+0.01;
  _wojVmin=vmin;_wojVmax=vmax;

  const features=(geojson.features||[]).map((f,i)=>{
    const r=_wFindRow(f);
    const nf={type:'Feature',geometry:f.geometry,properties:{...(f.properties||{}),_fid:i}};
    // A matched powiat can still have a null metric value (e.g. missing area
    // for per_km2 when the geojson name-match misses) - treat it like an
    // unmatched feature rather than crashing .toFixed() on null below.
    if(r&&r[vk]!=null){
      const v=r[vk];
      const t=(vmax>vmin)?(v-vmin)/(vmax-vmin):0.5;
      nf.properties._t=t;
      nf.properties._name=capName(r.name||f.properties.nazwa||'');
      nf.properties._val=_wFmtVal(r);
      let label;
      if(metric==='count')label=fmt(Math.round(v));
      else if(metric==='per1k')label=(getLang() === 'en' ? v.toFixed(2) : v.toFixed(2).replace('.',','))+'/1k';
      else label=(getLang() === 'en' ? v.toFixed(3) : v.toFixed(3).replace('.',','))+'/km²';
      nf.properties._label=label;
    }else{
      nf.properties._t=0;nf.properties._label='';
    }
    return nf;
  });
  const geo={type:'FeatureCollection',features};
  if(_wojMap&&_wojMap.getSource('gran-woj'))_wojMap.getSource('gran-woj').setData(geo);
  _refreshWojLabels(features);
  return geo;
}

// Value labels as MapLibre HTML markers at each voivodeship centroid. This
// avoids pulling a glyph atlas into our tile-free style (keeps it offline).
function _refreshWojLabels(features){
  // clear previous markers
  _wojLabelMarkers.forEach(m=>{try{m.remove()}catch(e){}});
  _wojLabelMarkers=[];
  if(!_wojMap||_wojLevelLive!=='voivodeship')return;
  const { Marker } = maplibregl;
  features.forEach(f=>{
    const c=_bboxCenter(f);
    const lab=f.properties&&f.properties._label;
    if(!c||!lab)return;
    const el=document.createElement('div');
    el.className='woj-val-label-marker';
    el.textContent=lab;
    const m=new Marker({element:el,anchor:'center'}).setLngLat(c).addTo(_wojMap);
    _wojLabelMarkers.push(m);
  });
}

async function renderWojMap(){
  const el=document.getElementById('map-granular-woj');if(!el)return;
  if(!_wojMap){
    if(_wojPending)return;              // build scheduled / in progress
    _wojPending=true;
    whenVisibleIdle(el, ()=>loadSiec().then(()=>_buildWojMap(el)), '80px');   // defer MapLibre until on-screen + past load
    return;
  }
  _fillWoj();
}

function _updateMapMode(){
  if(!_wojMap)return;
  const is3d=(_mapMode==='3d');
  if(_wojMap.getLayer('gran-woj-fill')) _wojMap.setLayoutProperty('gran-woj-fill','visibility',is3d?'none':'visible');
  if(_wojMap.getLayer('gran-woj-line')) _wojMap.setLayoutProperty('gran-woj-line','visibility',is3d?'none':'visible');
  if(_wojMap.getLayer('gran-woj-extrusion')) _wojMap.setLayoutProperty('gran-woj-extrusion','visibility',is3d?'visible':'none');
  
  _wojMap.dragPan.enable();
  _wojMap.scrollZoom.enable();
  _wojMap.doubleClickZoom.enable();
  _wojMap.touchZoomRotate.enable();

  if(is3d){
    _wojMap.dragRotate.enable();
    _wojMap.easeTo({pitch:50,bearing:10,duration:1000});
  }else{
    _wojMap.dragRotate.disable();
    _wojMap.easeTo({center:[19.3,52.05],zoom:5.7,pitch:0,bearing:0,duration:1000});
  }
}

async function _buildWojMap(el){
  await ensureMaplibre();
  try {
    _wojMap=createMap('map-granular-woj',{
      center:[19.3,52.05],zoom:5.7,minZoom:4,maxZoom:9,
      dragPan:true,scrollZoom:true,dragRotate:false,doubleClickZoom:true,touchZoom:true,keyboard:true,
    });
    MAPS['map-granular-woj']=_wojMap;
    
    // Wire 2D/3D toggle buttons
    const toggleContainer=document.getElementById('gran-map-mode');
    if(toggleContainer){
      toggleContainer.querySelectorAll('.mode-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const mode=btn.dataset.mode;
          if(mode===_mapMode)return;
          _mapMode=mode;
          toggleContainer.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b===btn));
          _updateMapMode();
        });
      });
    }

    _wojMap.on('load',()=>{
      // promoteId lets feature-state key off _fid without top-level feature ids
      _wojMap.addSource('gran-woj',{type:'geojson',data:{type:'FeatureCollection',features:[]},promoteId:'_fid'});
      _wojMap.addLayer({
        id:'gran-woj-fill',type:'fill',source:'gran-woj',
        paint:{
          'fill-color':_WOJ_FILL_STOPS,
          'fill-opacity':['case',['boolean',['feature-state','hover'],false],0.98,0.86],
        },
      });
      _wojMap.addLayer({
        id:'gran-woj-line',type:'line',source:'gran-woj',
        paint:{
          'line-color':['case',['boolean',['feature-state','hover'],false],'#a6e84a','#08110a'],
          'line-width':['case',['boolean',['feature-state','hover'],false],2.5,1],
        },
      });
      _wojMap.addLayer({
        id:'gran-woj-extrusion',type:'fill-extrusion',source:'gran-woj',
        paint:{
          'fill-extrusion-color':_WOJ_FILL_STOPS,
          'fill-extrusion-height':['*', ['get','_t'], 60000],
          'fill-extrusion-base':0,
          'fill-extrusion-opacity':0.85
        },
      });
      
      _updateMapMode();

      let _hoverFid=null;
      const ensureTip=()=>{
        if(!_wojTip){
          _wojTip=document.createElement('div');
          _wojTip.className='gran-tooltip maplibre-hover-tip';
          _wojTip.style.display='none';
          document.body.appendChild(_wojTip);
        }
      };
      
      const onMove=e=>{
        const fs=e.features&&e.features[0];
        if(!fs)return;
        if(_hoverFid!=null)_wojMap.setFeatureState({source:'gran-woj',id:_hoverFid},{hover:false});
        _hoverFid=fs.id;
        _wojMap.setFeatureState({source:'gran-woj',id:_hoverFid},{hover:true});
        _wojMap.getCanvas().style.cursor='pointer';
        const p=fs.properties||{};
        if(p._name){
          ensureTip();
          _wojTip.innerHTML=`<div style="font-family:var(--font-display);font-weight:700;font-size:13px;margin-bottom:3px">${capName(p._name)}</div>`+
            `<div style="font-size:12px;color:#93a487">${p._val||''}</div>`;
          _wojTip.style.left=(e.originalEvent.clientX+14)+'px';
          _wojTip.style.top=(e.originalEvent.clientY+14)+'px';
          _wojTip.style.display='block';
        }
      };
      
      const onLeave=()=>{
        if(_hoverFid!=null)_wojMap.setFeatureState({source:'gran-woj',id:_hoverFid},{hover:false});
        _hoverFid=null;
        _wojMap.getCanvas().style.cursor='';
        if(_wojTip)_wojTip.style.display='none';
      };

      _wojMap.on('mousemove','gran-woj-fill',onMove);
      _wojMap.on('mouseleave','gran-woj-fill',onLeave);
      _wojMap.on('mousemove','gran-woj-extrusion',onMove);
      _wojMap.on('mouseleave','gran-woj-extrusion',onLeave);
      
      _wojMap.on('click',e=>{
        const features = _wojMap.queryRenderedFeatures(e.point, { layers: ['gran-woj-fill', 'gran-woj-extrusion'] });
        if (!features.length) {
          if(_hoverFid!=null)_wojMap.setFeatureState({source:'gran-woj',id:_hoverFid},{hover:false});
          _hoverFid=null;
          _wojMap.getCanvas().style.cursor='';
          if(_wojTip)_wojTip.style.display='none';
        }
      });
      
      fitPoland(_wojMap,6);
      _wojSrcReady=true;
    });
  } catch (e) {
    if (e instanceof WebGLUnavailableError) {
      showMapUnavailable(el, { message: getLang() === 'en' ? 'Voivodeship map unavailable' : 'Mapa województw niedostępna' });
      _wojMap = null; _wojPending = false;
      return;
    }
    throw e;
  }
  _fillWoj();
}

async function ensurePowGeo() {
  if (_powGeo) return _powGeo;
  _powGeo = await fetchJSON('/api/geo/powiats');
  return _powGeo;
}

async function _fillWoj(){
  // There is no per-city boundary GeoJSON (only /api/geo/voivodeships and
  // /api/geo/powiats), so "Miasta" can't get its own choropleth - it falls
  // back to the voivodeship view rather than aliasing to powiat (which used
  // to make Powiaty/Miasta render as pixel-identical maps).
  const level = _gDim === 'powiat' ? 'powiat' : 'voivodeship';
  _wojLevelLive = level;
  const limit = level === 'voivodeship' ? 16 : 400;

  const res = await fetchDim(level, _gMetric, 'desc', limit, 0);
  const rows = res.rows || [];

  const geojson = level === 'voivodeship' ? M.woj_geo : await ensurePowGeo();

  const push=()=>{ if(_wojMap&&_wojMap.getSource('gran-woj')) _setWojData(rows,geojson,_gMetric); };
  if(_wojSrcReady)push(); else if(_wojMap)_wojMap.once('load',push);
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
  grp('gran-dim','dim',(v,btn)=>{_gDim=v;_setActive('gran-dim',btn);renderGranular()});
  grp('gran-metric','metric',(v,btn)=>{
    _gMetric=v;_setActive('gran-metric',btn);
    renderGranular();
  });
  grp('gran-sort','sort',(v,btn)=>{_gSort=v;_setActive('gran-sort',btn);renderGranular()});
  const more=document.getElementById('gran-more');
  if(more&&!more._wired){more._wired=true;more.addEventListener('click',loadMoreGranular)}
}
