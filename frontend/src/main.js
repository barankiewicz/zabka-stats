import Chart from './chartjs-setup.js';
import './style.css';
import { annotPlugin, barValueLabels, C, STATE } from './config.js';
import { M, MAPS, RENDERED } from './state.js';
import { getFont, destroyChart, heroCount, fmtLastUpdated } from './utils.js';
import { setFilter, clearFilter, registerFilterCallbacks } from './filter.js';
import { loadCore, loadTabData } from './data.js';
import { translateDOM, setLang } from './i18n.js';


// Tabs are loaded on demand. Each dynamic import() becomes its own Rollup chunk,
// so the heavy per-tab libs (echarts in econ/kraniec, d3 in the siec
// bubble) stay out of the initial bundle and only ship
// when their tab is first opened.
const TAB_LOADERS = {
  siec:          () => import('./tabs/siec.js'),
  spoleczenstwo: () => import('./tabs/spoleczenstwo.js'),
};
const _mods = {};
function tabModule(tab) {
  if (!_mods[tab]) _mods[tab] = TAB_LOADERS[tab]();
  return _mods[tab];
}
const _pending = new Set(); // tabs with a renderTab() currently in flight - blocks re-entrant double-clicks without permanently blocking retries after a failure

Chart.register(annotPlugin);
Chart.register(barValueLabels);

// flip to false to hide all chart/map id labels
const DEBUG_SHOW_IDS = true;

function initIdOverlays(){
  document.body.classList.toggle('debug-ids',DEBUG_SHOW_IDS);
}

function chartDefaults(){
  Chart.defaults.color=C.muted;
  Chart.defaults.borderColor=C.axis;
  Chart.defaults.font.family=`'${getFont('body')}',sans-serif`;
  Chart.defaults.font.size=12;
}
chartDefaults();

// renderGranular (siec) and renderDumbbellByLevel (spoleczenstwo) register
// themselves when their tab module loads via renderTab(). The global header KPI
// strip was removed, so the first cross-filter slot stays null.
registerFilterCallbacks(null, null, null);

function revealAll(){document.querySelectorAll('.reveal').forEach((el,i)=>setTimeout(()=>el.classList.add('shown'),80+i*50))}
setTimeout(revealAll,100);

// One IntersectionObserver per tab panel, reused across activations - without
// this, every tab click created a brand new observer watching the same
// (never-unmounted) elements, and the old ones just kept piling up.
const _revealObservers=new WeakMap();

function resetTabReveals(tabEl){
  const revEls=Array.from(tabEl.querySelectorAll('[class*="-reveal"]'));
  const showEls=Array.from(tabEl.querySelectorAll('.reveal'));
  revEls.forEach(el=>el.classList.remove('in'));
  showEls.forEach(el=>el.classList.remove('shown'));
  const prevObs=_revealObservers.get(tabEl);
  if(prevObs)prevObs.disconnect();
  requestAnimationFrame(()=>{
    const obs=new IntersectionObserver((entries)=>{
      entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');obs.unobserve(e.target);}});
    },{threshold:.12});
    _revealObservers.set(tabEl,obs);
    revEls.forEach(el=>obs.observe(el));
    showEls.forEach((el,i)=>setTimeout(()=>el.classList.add('shown'),60+i*50));
  });
}

// Tab-level error banner: shown when a tab fails to load/render so the user
// isn't left staring at a permanently blank panel with no recourse. aria-live
// so screen reader users hear about the failure without hunting for it.
function showTabError(tabEl, onRetry){
  hideTabError(tabEl);
  const banner=document.createElement('div');
  banner.className='tab-load-error';
  banner.setAttribute('role','alert');
  banner.setAttribute('aria-live','polite');
  banner.style.cssText='margin:24px;padding:16px 18px;border:1px solid rgba(232,105,61,.35);'+
    'background:rgba(232,105,61,.08);border-radius:10px;color:var(--ink);font-family:var(--font-body);';
  banner.innerHTML='<div style="margin-bottom:10px">Nie udało się załadować danych tej zakładki. Sprawdź połączenie i spróbuj ponownie.</div>';
  const btn=document.createElement('button');
  btn.type='button';btn.className='btn';btn.textContent='Spróbuj ponownie';
  btn.addEventListener('click',()=>{hideTabError(tabEl);onRetry();});
  banner.appendChild(btn);
  tabEl.prepend(banner);
}
function hideTabError(tabEl){
  const el=tabEl.querySelector('.tab-load-error');
  if(el)el.remove();
}

async function renderTab(tab){
  if(_pending.has(tab))return;   // already loading this tab - ignore a re-entrant call
  _pending.add(tab);
  const tabEl=document.getElementById('tab-'+tab);
  try {
    const mod = await tabModule(tab); // download + parse this tab's chunk
    if(tab==='siec'){
      // Do NOT await the heavy SIEC bucket here: renderSiec paints the
      // above-the-fold hero from the already-loaded core bucket immediately, and
      // kicks/gates the heavy below-fold data (loadSiec) itself. Awaiting it here
      // would push the LCP hero behind ~187 KB of API on slow mobile.
      registerFilterCallbacks(null, mod.renderGranular, null);
      mod.renderSiec();
    } else if(tab==='spoleczenstwo'){
      await loadTabData(tab);          // fetch this tab's endpoints (cached after first open)
      registerFilterCallbacks(null, null, mod.renderDumbbellByLevel);
      mod.renderSpoleczenstwo();
      mod.wireInpostLevel();
    }
    RENDERED.add(tab);
    if(tabEl)hideTabError(tabEl);
  } catch(err){
    console.error(`renderTab(${tab}) failed:`, err);
    RENDERED.delete(tab);   // allow a retry - do NOT leave the tab permanently blank
    _mods[tab]=null;        // the chunk import may have been what failed; let it retry too
    if(tabEl)showTabError(tabEl,()=>renderTab(tab));
    return;
  } finally {
    _pending.delete(tab);
  }
  setTimeout(initIdOverlays,300);
}

const _tabBtns=Array.from(document.querySelectorAll('.tab-btn'));

function activateTab(btn){
  _tabBtns.forEach(b=>{b.classList.remove('active');b.setAttribute('aria-selected','false');b.setAttribute('tabindex','-1');});
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  btn.setAttribute('aria-selected','true');
  btn.setAttribute('tabindex','0');
  const tab=btn.dataset.tab;
  const tabEl=document.getElementById('tab-'+tab);
  window.scrollTo({top:0,behavior:'instant'});
  tabEl.classList.add('active');
  STATE.tab=tab;
  resetTabReveals(tabEl);
  if(!RENDERED.has(tab)){setTimeout(()=>renderTab(tab),60)}
  setTimeout(()=>Object.values(MAPS).forEach(m=>m&&(m.resize&&m.resize())),200);
}

_tabBtns.forEach((btn,i)=>{
  btn.addEventListener('click',()=>activateTab(btn));
  // WAI-ARIA tablist keyboard pattern: Left/Right/Home/End move focus AND
  // activate (automatic-activation model - fine for two tabs), with roving
  // tabindex so only the active tab is a Tab-key stop.
  btn.addEventListener('keydown',e=>{
    let j=null;
    if(e.key==='ArrowRight'||e.key==='ArrowDown')j=(i+1)%_tabBtns.length;
    else if(e.key==='ArrowLeft'||e.key==='ArrowUp')j=(i-1+_tabBtns.length)%_tabBtns.length;
    else if(e.key==='Home')j=0;
    else if(e.key==='End')j=_tabBtns.length-1;
    if(j==null)return;
    e.preventDefault();
    _tabBtns[j].focus();
    activateTab(_tabBtns[j]);
  });
});

document.addEventListener('DOMContentLoaded',()=>{
  const btn=document.getElementById('filter-clear');if(btn)btn.addEventListener('click',clearFilter);

  // Wire up language switcher
  const langToggle = document.getElementById('lang-toggle');
  if(langToggle) {
    langToggle.addEventListener('click', e => {
      const btn = e.target.closest('.lang-btn');
      if (btn) {
        const lang = btn.getAttribute('data-lang');
        setLang(lang);
        translateDOM();
        // Clear rendered tab state and re-render
        RENDERED.delete(STATE.tab);
        renderTab(STATE.tab);
      }
    });
  }
});

// Translate DOM immediately to the default language (Polish)
translateDOM();

// /fakt/<slug> deep links: land on the highlighted fact instead of a generic
// homepage. All 5 facts live in the (default) siec tab, so this just waits
// for it to finish rendering, then either flies the Atlas map to the fact
// (selectFact queues itself if the map isn't built yet - see kraniec.js) or,
// for the one fact with no map point (the network-wide neighbor median),
// scrolls its stat tile into view with a brief highlight.
const FACT_SLUGS = {
  'pustka-bieszczadzka': 'void',
  'samotna-zabka': 'isolated',
  'najstarsza-zabka': 'oldest',
  'zielonej-zabki': 'frog',
};
function initFactDeepLink(){
  const m = window.location.pathname.match(/^\/fakt\/([a-z-]+)\/?$/);
  if (!m) return;
  const slug = m[1];
  const poll = (tries) => {
    if (RENDERED.has('siec')) return act();
    if (tries <= 0) return;
    setTimeout(() => poll(tries - 1), 100);
  };
  function act(){
    if (slug === 'mediana-odleglosci') {
      const tile = document.getElementById('stat-neighmed')?.closest('.stat-tile');
      if (!tile) return;
      tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
      tile.classList.add('fact-highlight');
      setTimeout(() => tile.classList.remove('fact-highlight'), 2400);
      return;
    }
    const factId = FACT_SLUGS[slug];
    if (!factId) return;
    document.getElementById('kr-root')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    tabModule('siec').then(mod => mod.selectFact && mod.selectFact(factId));
  }
  poll(40); // ~4s ceiling - loadCore + the siec chunk should render well within this
}
initFactDeepLink();

// SIEC is the default tab. loadCore() fetches only what SIEC needs for first
// paint; per-tab heavy payloads (spoleczenstwo economics etc.) load on first
// click. renderTab() itself adds 'siec' to RENDERED once it actually succeeds
// (see renderTab) - not marked eagerly, so a failure here can still be retried
// via the tab button.
loadCore()
  .then(()=>{
    // Count up the hero number straight away, from the tiny core bucket - the
    // hero is the LCP element, so painting it here (not after the lazy siec chunk
    // loads and runs a 2s animation) is what pulls mobile LCP down.
    heroCount(document.getElementById('hero-number'), M.summary&&+M.summary.total_active);
    const updated = fmtLastUpdated(M.summary&&M.summary.last_updated);
    if(updated){
      const updEl=document.getElementById('foot-updated');
      const updVal=document.getElementById('foot-updated-value');
      if(updEl&&updVal){updVal.textContent=updated;updEl.hidden=false;}
    }
    setTimeout(()=>{
      renderTab('siec');
      const siecEl=document.getElementById('tab-siec');
      if(siecEl)resetTabReveals(siecEl);
    },120);
  })
  .catch(err=>console.error('loadCore failed:',err));
