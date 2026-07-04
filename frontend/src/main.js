import Chart from './chartjs-setup.js';
import './style.css';
import { annotPlugin, barValueLabels, C, STATE } from './config.js';
import { M, MAPS, RENDERED } from './state.js';
import { getFont, destroyChart, heroCount, fmtLastUpdated } from './utils.js';
import { loadCore, loadTabData } from './data.js';
import { translateDOM, setLang, t } from './i18n.js';
import { getMapLibreCanvas, composePanelCanvas, canvasToPngBlob, downloadBlob, copyBlobToClipboard } from './export-image.js';


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
    if (tab === 'siec') {
      const p = mod.renderSiec();
      if (p && typeof p.catch === 'function') {
        p.catch(err => {
          console.error(`Async renderSiec failed:`, err);
          RENDERED.delete('siec');
          if (tabEl) showTabError(tabEl, () => renderTab('siec'));
        });
      }
    } else if(tab==='spoleczenstwo'){
      await loadTabData(tab);          // fetch this tab's endpoints (cached after first open)
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
  // The tab that's inactive at page load renders at zero size, so any panel
  // toolbar collision check that ran while it was hidden saw degenerate
  // (0,0,0,0) rects - recheck now that it actually has real layout.
  setTimeout(recheckToolbarCollisions, 250);
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


  // Wire up language switcher
  const langToggle = document.getElementById('lang-toggle');
  if(langToggle) {
    langToggle.addEventListener('click', e => {
      const btn = e.target.closest('.lang-btn');
      if (btn) {
        const lang = btn.getAttribute('data-lang');
        setLang(lang);
        localStorage.setItem('lang', lang);
        writeLangToURL(lang);
        translateDOM();
        // Panel-toolbar buttons are icon-only with no data-t of their own
        // (their aria-label is plain text set at creation), so translateDOM()
        // alone wouldn't catch them - refresh explicitly, keyed by the
        // data-role each button was tagged with at creation.
        document.querySelectorAll('[data-role="share"]').forEach(b => b.setAttribute('aria-label', t('copy_link_aria')));
        document.querySelectorAll('[data-role="export-copy"]').forEach(b => b.setAttribute('aria-label', t('export_copy_aria')));
        document.querySelectorAll('[data-role="export-download"]').forEach(b => b.setAttribute('aria-label', t('export_download_aria')));
        // Clear rendered tab state and re-render
        RENDERED.clear();
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
const _storedLang = localStorage.getItem('lang');
const resolvedLang = _urlLang || _storedLang || 'pl';
setLang(resolvedLang);
if (resolvedLang !== 'pl' && !_urlLang) {
  writeLangToURL(resolvedLang);
}

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
    citygap:     { title: '[data-debug-id="CITY-GAP"]' },
  },
  spoleczenstwo: {
    inpost:        { title: '[data-debug-id="2.3"]' },
    nbl:           { title: '[data-debug-id="NBL"]' },
    elevation:     { title: '[data-debug-id="ELEVATION"]' },
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

function makeCopyLinkBtn(tabSlug, sectionSlug, cls='panel-btn'){
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.dataset.role = 'share';
  b.setAttribute('aria-label', t('copy_link_aria'));
  b.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M6.35 9.65a1 1 0 0 1 0-1.4l3-3a3 3 0 1 1 4.24 4.24l-1.3 1.3a1 1 0 1 1-1.42-1.4l1.3-1.3a1 1 0 1 0-1.42-1.42l-3 3a1 1 0 0 1-1.4 0Zm3.3-3.3a1 1 0 0 1 0 1.4l-3 3a3 3 0 1 1-4.24-4.24l1.3-1.3a1 1 0 0 1 1.42 1.42l-1.3 1.3a1 1 0 1 0 1.42 1.4l3-3a1 1 0 0 1 1.4 0Z"/></svg>';
  b.addEventListener('click', e => { e.stopPropagation(); copyLinkFor(tabSlug, sectionSlug); });
  return b;
}

// Atlas krancow is the one section whose "share" button lives inline in a
// static row of controls (.kr .btnrow), not floating over a canvas - it stays
// its own always-visible button rather than joining the hover-only panel
// toolbar below (there's nothing to hover: the Atlas isn't in EXPORTABLES,
// it's its own interactive multi-layer scene, not a single exportable bitmap).
function initAtlasShareButton(){
  const entry = SECTIONS.siec.atlas;
  const anchor = sectionAnchorEl(entry);
  if(!anchor || anchor.querySelector(':scope > .copy-link-btn')) return;
  anchor.appendChild(makeCopyLinkBtn(TAB_SLUG.siec, 'atlas', 'copy-link-btn'));
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

window.addEventListener('hashchange', goToHashSection);
goToHashSection();

// S1+S3 merged: one hover-only toolbar per panel, top-right, holding
// whichever of "copy image" / "download PNG" / "share link" apply to that
// panel - everything EXCEPT the Atlas krancow (its own interactive
// multi-layer scene, not a single exportable bitmap, handled above) and the
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
  { id:'chart-elevation', kind:'canvas', filename:'zabka-wysokosc' },
  { id:'chart-streets', kind:'canvas', filename:'zabka-ulice' },
  { id:'chart-gmina-lead', kind:'canvas', filename:'zabka-gminy' },
  { id:'map-econ-unemp', kind:'maplibre', filename:'zabka-econ-bezrobocie' },
  { id:'map-econ-salary', kind:'maplibre', filename:'zabka-econ-placa' },
];

// Whatever wrapper the toolbar gets appended to needs position:relative to
// anchor the absolutely-positioned buttons - force it on rather than
// requiring every one of these panel layouts to already have it.
function ensureRelative(el){
  if(el && getComputedStyle(el).position === 'static') el.style.position = 'relative';
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

// Exports the whole panel (title, subtitle, caveat, every chart/map it
// holds - not just one canvas), composed at the panel's own on-screen
// layout. `entries` is every EXPORTABLES item that lives inside `panelEl`
// (GRAN's chart + choropleth, MAPA's map + calendar, POWIATY's donut +
// mini-map are each one panel with two visuals; most panels have just one).
async function runPanelExport(panelEl, entries, action){
  try {
    const visuals = [];
    for (const entry of entries){
      const canvas = await getSourceCanvas(entry);
      visuals.push({ canvas, el: document.getElementById(entry.id) });
    }
    const composed = await composePanelCanvas(panelEl, visuals);
    const blob = await canvasToPngBlob(composed);
    if(action === 'download'){
      downloadBlob(blob, `${entries[0].filename}.png`);
    } else {
      await copyBlobToClipboard(blob);
      showLinkToast(t('export_copied'));
    }
  } catch(err){
    showLinkToast(err && err.message === 'Clipboard image API unavailable'
      ? t('export_copy_failed') : t('export_not_ready'));
  }
}

function makePanelToolbar({ tabSlug, slug, exportEntries }){
  const wrap = document.createElement('div');
  wrap.className = 'panel-toolbar';
  let copyBtn = null, dlBtn = null;
  if(exportEntries && exportEntries.length){
    copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'panel-btn';
    copyBtn.dataset.role = 'export-copy';
    copyBtn.setAttribute('aria-label', t('export_copy_aria'));
    copyBtn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M5 1a1 1 0 0 0-1 1v1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H5Zm6 12H3V4h1v8a1 1 0 0 0 1 1h6v0Zm2-2H6V3h7v8Z"/></svg>';
    dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'panel-btn';
    dlBtn.dataset.role = 'export-download';
    dlBtn.setAttribute('aria-label', t('export_download_aria'));
    dlBtn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 1a1 1 0 0 1 1 1v6.59l1.79-1.8a1 1 0 1 1 1.42 1.42l-3.5 3.5a1 1 0 0 1-1.42 0l-3.5-3.5a1 1 0 1 1 1.42-1.42L7 8.59V2a1 1 0 0 1 1-1ZM3 13a1 1 0 1 0 0 2h10a1 1 0 1 0 0-2H3Z"/></svg>';
    wrap.appendChild(copyBtn);
    wrap.appendChild(dlBtn);
  }
  if(tabSlug && slug){
    wrap.appendChild(makeCopyLinkBtn(tabSlug, slug));
  }
  return { wrap, copyBtn, dlBtn };
}

// Groups every EXPORTABLES entry by its panel (nearest .card - GRAN's chart
// + choropleth, MAPA's map + calendar and POWIATY's donut + mini-map each
// share one card and so end up in the same group, which is exactly the
// "whole panel, not just the chart" unit the toolbar should export).
function groupExportablesByPanel(){
  const groups = new Map();
  EXPORTABLES.forEach(entry=>{
    const el = document.getElementById(entry.id);
    const card = el && el.closest('.card');
    if(!card) return;
    if(!groups.has(card)) groups.set(card, []);
    groups.get(card).push(entry);
  });
  return groups;
}

// Reverse-maps every registered section's anchor element to its share slug
// (skips 'atlas', which keeps its own always-visible button, see above).
function buildShareAnchorMap(){
  const map = new Map();
  Object.entries(SECTIONS).forEach(([tab, sections])=>{
    const tabSlug = TAB_SLUG[tab];
    Object.entries(sections).forEach(([slug, entry])=>{
      if(tab === 'siec' && slug === 'atlas') return;
      const anchor = sectionAnchorEl(entry);
      if(anchor) map.set(anchor, { tabSlug, slug });
    });
  });
  return map;
}

// Some panels have their own top-right control living at the same corner as
// the toolbar - a 2D/3D map-mode-toggle (GRAN, InPost - a different subtree
// entirely, the map's own column) or an inline level toggle sharing the
// title's row (POWIATY's Powiaty/Miasta/Gminy switcher, which unlike NBL's
// three toggle groups is short enough to never wrap onto its own line).
// Rather than hardcode a per-card offset, measure what's actually there and
// nudge the toolbar down just enough to clear it.
const _toolbarPlacements = [];
function avoidToolbarCollisions(panelEl, wrap){
  wrap.style.top = '';
  const wrapRect = wrap.getBoundingClientRect();
  const panelTop = panelEl.getBoundingClientRect().top;
  let clearBottom = null;
  panelEl.querySelectorAll('.map-mode-toggle, .gran-toggle').forEach(el=>{
    if(wrap.contains(el)) return;
    const r = el.getBoundingClientRect();
    const overlaps = r.left < wrapRect.right && r.right > wrapRect.left
      && r.top < wrapRect.bottom && r.bottom > wrapRect.top;
    if(!overlaps) return;
    const bottomRel = r.bottom - panelTop;
    if(clearBottom == null || bottomRel > clearBottom) clearBottom = bottomRel;
  });
  if(clearBottom != null) wrap.style.top = `${Math.ceil(clearBottom) + 8}px`;
}
function recheckToolbarCollisions(){
  _toolbarPlacements.forEach(({ panelEl, wrap }) => avoidToolbarCollisions(panelEl, wrap));
}
let _resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(recheckToolbarCollisions, 200);
});

function initPanelToolbars(){
  const exportGroups = groupExportablesByPanel();
  const shareByAnchor = buildShareAnchorMap();
  const handled = new Set();

  exportGroups.forEach((entries, panelEl)=>{
    if(panelEl.querySelector(':scope > .panel-toolbar')) return;
    ensureRelative(panelEl);
    const share = shareByAnchor.get(panelEl);
    const { wrap, copyBtn, dlBtn } = makePanelToolbar({ tabSlug: share?.tabSlug, slug: share?.slug, exportEntries: entries });
    copyBtn.addEventListener('click', e => { e.stopPropagation(); runPanelExport(panelEl, entries, 'copy'); });
    dlBtn.addEventListener('click', e => { e.stopPropagation(); runPanelExport(panelEl, entries, 'download'); });
    panelEl.appendChild(wrap);
    handled.add(panelEl);
    avoidToolbarCollisions(panelEl, wrap);
    _toolbarPlacements.push({ panelEl, wrap });
  });

  // Registered sections with no exportable visual (the ECON intro, which
  // just introduces the two map panels below it) still get a share-only
  // toolbar, same hover-only styling.
  shareByAnchor.forEach(({ tabSlug, slug }, anchor)=>{
    if(handled.has(anchor)) return;
    if(anchor.querySelector(':scope > .panel-toolbar')) return;
    ensureRelative(anchor);
    const { wrap } = makePanelToolbar({ tabSlug, slug, exportEntries: null });
    anchor.appendChild(wrap);
    avoidToolbarCollisions(anchor, wrap);
    _toolbarPlacements.push({ panelEl: anchor, wrap });
  });
}
initAtlasShareButton();
initPanelToolbars();

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
