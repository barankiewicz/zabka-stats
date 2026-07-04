import Chart from './chartjs-setup.js';
import './style.css';
import { annotPlugin, barValueLabels, C, STATE } from './config.js';
import { M, MAPS, RENDERED } from './state.js';
import { getFont, destroyChart, heroCount, fmtLastUpdated, fmt } from './utils.js';
import { setFilter, clearFilter, registerFilterCallbacks } from './filter.js';
import { loadCore, loadTabData, loadSiec } from './data.js';
import { translateDOM, setLang, t, getLang } from './i18n.js';
import { getMapLibreCanvas, composeExportCanvas, canvasToPngBlob, downloadBlob, copyBlobToClipboard } from './export-image.js';


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

function activateTab(btn,{skipScrollTop=false}={}){
  _tabBtns.forEach(b=>{b.classList.remove('active');b.setAttribute('aria-selected','false');b.setAttribute('tabindex','-1');});
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  btn.setAttribute('aria-selected','true');
  btn.setAttribute('tabindex','0');
  const tab=btn.dataset.tab;
  const tabEl=document.getElementById('tab-'+tab);
  // Skipped when a section deep link is about to scroll somewhere specific -
  // jumping to top first would just be an extra visible flash before that.
  if(!skipScrollTop) window.scrollTo({top:0,behavior:'instant'});
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
        writeLangToURL(lang);
        translateDOM();
        // Copy-link buttons are icon-only with no data-t of their own (their
        // aria-label is plain text set at creation), so translateDOM() alone
        // wouldn't catch them - refresh explicitly.
        document.querySelectorAll('.copy-link-btn').forEach(b => b.setAttribute('aria-label', t('copy_link_aria')));
        document.querySelectorAll('.export-toolbar .export-btn').forEach((b,i) => {
          b.setAttribute('aria-label', t(i%2===0 ? 'export_copy_aria' : 'export_download_aria'));
        });
        // FAQ answers are templates filled with t() at render time (see
        // renderFAQCore/renderFAQCities below) - re-run so they pick up the
        // new language, same reasoning as the copy-link aria-label above.
        renderFAQCore();
        renderFAQCities();
        // Clear rendered tab state and re-render
        RENDERED.delete(STATE.tab);
        renderTab(STATE.tab);
      }
    });
  }
});

// S2: a shared link should render in the language the sharer intended, and a
// link copied from the address bar should carry the current language forward
// (?lang=en, not just in-memory state) - otherwise every link posted to an
// English-speaking channel lands the reader in Polish.
function langFromURL() {
  const p = new URLSearchParams(window.location.search).get('lang');
  return (p === 'en' || p === 'pl') ? p : null;
}
function writeLangToURL(lang) {
  const url = new URL(window.location.href);
  if (lang === 'pl') url.searchParams.delete('lang'); // pl is the default - keep the URL clean
  else url.searchParams.set('lang', lang);
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}
const _urlLang = langFromURL();
if (_urlLang) setLang(_urlLang);

// Translate DOM immediately to the resolved language (URL override, else Polish default)
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

// S1: per-section deep links (#siec/atlas, #polska/econ) + a copy-link button
// on every registered section. Hash tab slugs are short/user-facing (siec,
// polska) rather than the internal tab ids (siec, spoleczenstwo) - TAB_SLUG
// maps between them. Section slugs mostly reuse the existing data-debug-id
// values (already a de facto stable section registry, previously dev-only).
const TAB_SLUG = { siec: 'siec', spoleczenstwo: 'polska' };
const TAB_SLUG_REV = { siec: 'siec', polska: 'spoleczenstwo' };
const SECTIONS = {
  siec: {
    mapa:        { title: '[data-debug-id="MAPA"]' },
    growth:      { title: '[data-debug-id="1.1"]' },
    fingerprint: { title: '[data-debug-id="1.1f-flat"]' },
    gran:        { title: '[data-debug-id="GRAN"]' },
    atlas:       { title: '[data-debug-id="ATLAS"]', anchor: '.kr .btnrow', scrollTarget: '#kr-root' },
    powiaty:     { title: '[data-debug-id="POWIATY"]' },
    bubble:      { title: '[data-debug-id="BUBBLE"]' },
  },
  spoleczenstwo: {
    inpost:        { title: '[data-debug-id="2.3"]' },
    nbl:           { title: '[data-debug-id="NBL"]' },
    streets:       { title: '[data-debug-id="STREETS"]' },
    'gmina-lead':  { title: '[data-debug-id="GMINA-LEAD"]' },
    econ:          { title: '[data-debug-id="ECON"]' },
  },
};

function sectionAnchorEl(entry){
  if(entry.anchor) return document.querySelector(entry.anchor);
  const titleEl = document.querySelector(entry.title);
  return titleEl && (titleEl.closest('.card') || titleEl.closest('.econ-maps__intro') || titleEl.parentElement);
}
function sectionScrollTarget(entry){
  if(entry.scrollTarget) return document.querySelector(entry.scrollTarget);
  const titleEl = document.querySelector(entry.title);
  return titleEl && (titleEl.closest('.card') || titleEl.closest('.econ-maps__intro') || titleEl);
}

let _linkToastTimer = null;
function showLinkToast(msg){
  let el = document.getElementById('link-toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'link-toast';
    el.className = 'link-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_linkToastTimer);
  _linkToastTimer = setTimeout(()=>el.classList.remove('show'), 1600);
}

function copyLinkFor(tabSlug, sectionSlug){
  const url = new URL(window.location.href);
  url.hash = `${tabSlug}/${sectionSlug}`;
  navigator.clipboard.writeText(url.toString())
    .then(()=>showLinkToast(t('link_copied')))
    .catch(()=>showLinkToast(t('link_copy_failed')));
}

function makeCopyLinkBtn(tabSlug, sectionSlug){
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'copy-link-btn';
  b.setAttribute('aria-label', t('copy_link_aria'));
  b.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M6.35 9.65a1 1 0 0 1 0-1.4l3-3a3 3 0 1 1 4.24 4.24l-1.3 1.3a1 1 0 1 1-1.42-1.4l1.3-1.3a1 1 0 1 0-1.42-1.42l-3 3a1 1 0 0 1-1.4 0Zm3.3-3.3a1 1 0 0 1 0 1.4l-3 3a3 3 0 1 1-4.24-4.24l1.3-1.3a1 1 0 0 1 1.42 1.42l-1.3 1.3a1 1 0 1 0 1.42 1.4l3-3a1 1 0 0 1 1.4 0Z"/></svg>';
  b.addEventListener('click', e => { e.stopPropagation(); copyLinkFor(tabSlug, sectionSlug); });
  return b;
}

function initCopyLinkButtons(){
  Object.entries(SECTIONS).forEach(([tab, sections])=>{
    const tabSlug = TAB_SLUG[tab];
    Object.entries(sections).forEach(([slug, entry])=>{
      const anchor = sectionAnchorEl(entry);
      if(!anchor || anchor.querySelector(':scope > .copy-link-btn')) return;
      anchor.appendChild(makeCopyLinkBtn(tabSlug, slug));
    });
  });
}

function parseSectionHash(){
  const m = window.location.hash.match(/^#([a-z]+)\/([a-z0-9.-]+)$/i);
  if(!m) return null;
  const tab = TAB_SLUG_REV[m[1].toLowerCase()];
  if(!tab) return null;
  return { tab, slug: m[2].toLowerCase() };
}

// Disable the browser's own scroll restoration on back/forward - it fights
// with the programmatic scrollIntoView below (edge case called out up front:
// "keeping scroll restoration sane").
if('scrollRestoration' in history) history.scrollRestoration = 'manual';

function goToHashSection(){
  const target = parseSectionHash();
  if(!target) return;
  const entry = SECTIONS[target.tab]?.[target.slug];
  if(!entry) return;

  const btn = document.querySelector(`.tab-btn[data-tab="${target.tab}"]`);
  // activateTab() itself kicks off renderTab() when the tab hasn't rendered
  // yet (same path a real click takes) - skipScrollTop since we're about to
  // scroll somewhere specific, not to the top of the newly-active tab.
  if(btn && !btn.classList.contains('active')) activateTab(btn, {skipScrollTop:true});

  // Edge case: the hash can arrive before the lazy tab chunk has rendered
  // (cold load straight into #polska/econ). Poll RENDERED rather than
  // assuming synchronous completion - same pattern as initFactDeepLink above.
  const poll = (tries) => {
    if (RENDERED.has(target.tab)) return scrollToSection(entry);
    if (tries <= 0) return;
    setTimeout(() => poll(tries - 1), 100);
  };
  poll(60); // ~6s ceiling
}

function scrollToSection(entry){
  const el = sectionScrollTarget(entry);
  if(!el) return;
  // Scrolling into view is also what triggers a section's own lazy map/chart
  // build for scenes gated on IntersectionObserver - same as a user scrolling
  // there by hand, no special-casing needed per section.
  requestAnimationFrame(()=>{
    el.scrollIntoView({ behavior:'smooth', block:'start' });
    el.classList.add('section-highlight');
    setTimeout(()=>el.classList.remove('section-highlight'), 2400);
  });
}

initCopyLinkButtons();
window.addEventListener('hashchange', goToHashSection);
goToHashSection();

// S3: per-visual "copy image" / "download PNG" toolbar, on hover/focus, for
// almost every chart and map - everything EXCEPT the Atlas krancow (its own
// interactive multi-layer scene, not a single exportable bitmap) and the
// BUBBLE force chart (D3-driven SVG, not a canvas - rasterizing it cleanly
// is a different problem than the other two kinds here).
// kind:'canvas' -> the element itself is the source canvas (Chart.js reuses
// the same <canvas> it was constructed on; plain Canvas 2D scenes are just
// that canvas). kind:'maplibre' -> the element is MapLibre's container div;
// the actual canvas lives in MAPS[id] (registered by each tab module) and
// needs the triggerRepaint()+once('render') dance from export-image.js.
const EXPORTABLES = [
  { id:'chart-growth', kind:'canvas', filename:'zabka-wzrost-sieci' },
  { id:'canvas-fingerprint-flat', kind:'canvas', filename:'zabka-odcisk' },
  { id:'chart-granular', kind:'canvas', filename:'zabka-ranking' },
  { id:'map-granular-woj', kind:'maplibre', filename:'zabka-mapa-ranking' },
  { id:'powiat-donut', kind:'canvas', filename:'zabka-pokrycie-donut' },
  { id:'canvas-powiat-map', kind:'canvas', filename:'zabka-pokrycie-mapa' },
  { id:'map-growth', kind:'maplibre', filename:'zabka-mapa-wzrostu' },
  { id:'canvas-calendar', kind:'canvas', filename:'zabka-kalendarz' },
  { id:'map-inpost', kind:'maplibre', filename:'zabka-inpost-mapa' },
  { id:'chart-nbl', kind:'canvas', filename:'zabka-sasiedztwo' },
  { id:'spol-knnChart', kind:'canvas', filename:'zabka-knn' },
  { id:'chart-streets', kind:'canvas', filename:'zabka-ulice' },
  { id:'chart-gmina-lead', kind:'canvas', filename:'zabka-gminy' },
  { id:'map-econ-unemp', kind:'maplibre', filename:'zabka-econ-bezrobocie' },
  { id:'map-econ-salary', kind:'maplibre', filename:'zabka-econ-placa' },
];

// Whatever wrapper the toolbar gets appended to needs position:relative to
// anchor the absolutely-positioned buttons - force it on rather than
// requiring every one of these 15 different card layouts to already have it.
function ensureRelative(el){
  if(el && getComputedStyle(el).position === 'static') el.style.position = 'relative';
}
// Title comes from whichever .card-title is closest, matching the S1 section
// registry's own de-facto rule: every one of these visuals lives inside a
// .card whose title already describes it (nested econ-map-card titles for
// the two ECON maps, the shared GRAN/MAPA/POWIATY title for their paired
// visuals). Read at click time, not registration time, so it always
// reflects whatever language is currently active.
function exportTitleFor(anchorEl){
  const card = anchorEl.closest('.card');
  const titleEl = card && card.querySelector('.card-title');
  return titleEl ? titleEl.textContent.trim() : '';
}

async function getSourceCanvas(entry){
  if(entry.kind === 'maplibre'){
    const map = MAPS[entry.id];
    if(!map) throw new Error('map not ready');
    return await getMapLibreCanvas(map);
  }
  const canvas = document.getElementById(entry.id);
  if(!canvas || !canvas.width) throw new Error('canvas not ready');
  return canvas;
}

async function runExport(entry, anchorEl, action){
  try {
    const source = await getSourceCanvas(entry);
    const title = exportTitleFor(anchorEl);
    const composed = composeExportCanvas(source, { title });
    const blob = await canvasToPngBlob(composed);
    if(action === 'download'){
      downloadBlob(blob, `${entry.filename}.png`);
    } else {
      await copyBlobToClipboard(blob);
      showLinkToast(t('export_copied'));
    }
  } catch(err){
    showLinkToast(err && err.message === 'Clipboard image API unavailable'
      ? t('export_copy_failed') : t('export_not_ready'));
  }
}

function makeExportToolbar(entry){
  const wrap = document.createElement('div');
  wrap.className = 'export-toolbar';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'export-btn';
  copyBtn.setAttribute('aria-label', t('export_copy_aria'));
  copyBtn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M5 1a1 1 0 0 0-1 1v1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H5Zm6 12H3V4h1v8a1 1 0 0 0 1 1h6v0Zm2-2H6V3h7v8Z"/></svg>';
  const dlBtn = document.createElement('button');
  dlBtn.type = 'button';
  dlBtn.className = 'export-btn';
  dlBtn.setAttribute('aria-label', t('export_download_aria'));
  dlBtn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 1a1 1 0 0 1 1 1v6.59l1.79-1.8a1 1 0 1 1 1.42 1.42l-3.5 3.5a1 1 0 0 1-1.42 0l-3.5-3.5a1 1 0 1 1 1.42-1.42L7 8.59V2a1 1 0 0 1 1-1ZM3 13a1 1 0 1 0 0 2h10a1 1 0 1 0 0-2H3Z"/></svg>';
  wrap.appendChild(copyBtn);
  wrap.appendChild(dlBtn);
  return { wrap, copyBtn, dlBtn };
}

function initExportToolbars(){
  EXPORTABLES.forEach(entry=>{
    const el = document.getElementById(entry.id);
    if(!el) return;
    const anchor = entry.kind === 'maplibre' ? el : el.parentElement;
    if(!anchor || anchor.querySelector(':scope > .export-toolbar')) return;
    ensureRelative(anchor);
    anchor.classList.add('has-export-toolbar');
    const { wrap, copyBtn, dlBtn } = makeExportToolbar(entry);
    copyBtn.addEventListener('click', e => { e.stopPropagation(); runExport(entry, anchor, 'copy'); });
    dlBtn.addEventListener('click', e => { e.stopPropagation(); runExport(entry, anchor, 'download'); });
    anchor.appendChild(wrap);
  });
}
initExportToolbars();

// S9: SEO FAQ answers. The 3 core-bucket answers (total, farthest, yearly)
// come from loadCore(); "most stores" needs top_cities, which lives in the
// SIEC-specific bucket - siec is the default tab so loadSiec() resolves on
// every normal pageview anyway, just slightly later than core. Each setter
// only touches its own paragraph, so a slow/failed bucket leaves the other
// answers' baked-in HTML fallback in place rather than blanking everything.
function setFAQAnswer(id, text){
  const el = document.getElementById(id);
  if(el && text) el.textContent = text;
}
function renderFAQCore(){
  const s = M.summary || {};
  const s3 = M.section3_rare || {};
  const ng = M.network_growth || [];
  if(s.total_active){
    const date = (fmtLastUpdated(s.last_updated) || '').split(' ')[0];
    setFAQAnswer('faq-a-total', t('faq_a_total')
      .replace('{total}', fmt(s.total_active)).replace('{cities}', fmt(s.cities_count||0)).replace('{date}', date || '-'));
  }
  const voidFact = s3.void;
  if(voidFact && voidFact.value){
    const km = getLang() === 'en' ? String(voidFact.value) : String(voidFact.value).replace('.', ',');
    setFAQAnswer('faq-a-farthest', t('faq_a_farthest').replace('{km}', km));
  }
  if(ng.length){
    const peak = ng.reduce((a,b)=> (b.new_stores>a.new_stores?b:a), ng[0]);
    setFAQAnswer('faq-a-yearly', t('faq_a_yearly').replace('{year}', peak.year).replace('{count}', fmt(peak.new_stores)));
  }
}
function renderFAQCities(){
  const top = (M.top_cities||[])[0];
  if(top) setFAQAnswer('faq-a-most', t('faq_a_most').replace('{city}', top.city).replace('{count}', fmt(top.cnt)));
}

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
    renderFAQCore();
  })
  .catch(err=>console.error('loadCore failed:',err));

// "Most stores" FAQ answer needs top_cities (SIEC-bucket only). loadSiec()
// caches its promise, so this is a no-op await on the fetch renderSiec()
// already triggers for the default tab, not a second request.
loadSiec().then(renderFAQCities).catch(()=>{});
