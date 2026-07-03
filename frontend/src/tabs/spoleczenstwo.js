import Chart from '../chartjs-setup.js';
import { loadMaplibre } from '../maplibre-lazy.js';
// MapLibre (~280 KB gz) loaded lazily, only when the InPost choropleth nears view.
let maplibregl, createMap, fitPoland, featureBBoxCenter, showMapUnavailable, WebGLUnavailableError;
function ensureMaplibre(){
  return loadMaplibre().then(m=>{
    ({ maplibregl, createMap, fitPoland, featureBBoxCenter, showMapUnavailable, WebGLUnavailableError } = m);
    return m;
  });
}
import { C, STATE } from '../config.js';
import { M, CHARTS, MAPS } from '../state.js';
import { fmt, getFont, destroyChart, startTabParticles, capName, whenVisible, wireCountUp } from '../utils.js';
import { t, getLang } from '../i18n.js';
import { fetchJSON } from '../data.js';

// econ.js pulls in ECharts (~180 KB gz); its two scatter chapters sit at the
// very bottom of this tab, well below the fold, so load it only once that
// section nears the viewport instead of on every tab-open.
let _econModP;
function ensureEcon(){
  return _econModP ??= import('./econ.js');
}


function renderSpolecKPIs(){
  const s=M.summary, pc=M.per_capita||[], dens=M.voivodeship_density||[];
  const gminaLeadersObj=M.gmina_leaders||{}, gminaLeaders=gminaLeadersObj.per_1k||[], iv=M.inpost_vs_zabka||[], sunday=M.sunday_by_voivodeship||[];

  const setCount=(id,v)=>{const el=document.getElementById(id);if(el&&v!=null)el.dataset.count=v};
  const setSub=(id,key,name)=>{const el=document.getElementById(id);if(el&&name)el.textContent=t(key).replace('{name}',capName(name))};

  if(s&&pc.length&&s.total_active){
    const totalPop=pc.reduce((a,r)=>a+(r.population||0),0);
    const perStore=Math.round(totalPop/(+s.total_active));
    setCount('spol-kpi-residents',perStore);
  }

  const gminy=(M.coverage_funnel||[]).find(r=>r.level==='gminy');
  if(gminy&&gminy.pct!=null){
    setCount('spol-kpi-gminy',gminy.pct);
  }

  // Density outlier (F4): the voivodeship whose stores/km2 towers over the
  // national average, not the flat average itself.
  if(dens.length){
    const rows=dens.map(r=>({voivodeship:r.voivodeship,perKm2:r.area_km2>0?r.stores/r.area_km2:0}));
    const totalStores=dens.reduce((a,r)=>a+(r.stores||0),0);
    const totalArea=dens.reduce((a,r)=>a+(r.area_km2||0),0);
    const nationalPerKm2=totalArea>0?totalStores/totalArea:0;
    const top=rows.reduce((a,r)=>r.perKm2>(a?a.perKm2:-1)?r:a,null);
    if(top&&nationalPerKm2>0){
      setCount('spol-kpi-density',top.perKm2/nationalPerKm2);
      setSub('spol-kpi-density-sub','spol_kpi_density_sub_tpl',top.voivodeship);
    }
  }

  // Per-capita record (F2): the resort commune that beats every other gmina,
  // against the national national_per_1k the endpoint already computes.
  if(gminaLeaders.length){
    const top=gminaLeaders[0];
    setCount('spol-kpi-gminaleader',top.per_1k);
    if(gminaLeadersObj.national_per_1k!=null)setCount('spol-kpi-gminaleader-nat',gminaLeadersObj.national_per_1k);
    setSub('spol-kpi-gminaleader-sub','spol_kpi_gminaleader_sub_tpl',top.name);
  }

  // InPost extreme (F5): already sorted desc by ratio, so [0] is the max.
  // National ratio = total lockers / total stores across all voivodeships.
  if(iv.length){
    const top=iv[0];
    setCount('spol-kpi-inpostmax',top.ratio);
    const totZ=iv.reduce((a,r)=>a+(r.zabki||0),0), totP=iv.reduce((a,r)=>a+(r.paczkomaty||0),0);
    if(totZ)setCount('spol-kpi-inpostmax-nat',Math.round(totP/totZ*100)/100);
    setSub('spol-kpi-inpostmax-sub','spol_kpi_inpostmax_sub_tpl',top.voivodeship);
  }

  // Sunday Wall (F3): already sorted desc by closed_pct. Shown as a direct
  // "leader vs national average" comparison, not a bare percentage.
  if(sunday.length&&s&&s.sunday_pct!=null){
    const top=sunday[0];
    setCount('spol-kpi-sunday',top.closed_pct);
    setCount('spol-kpi-sunday-nat',Math.round((100-s.sunday_pct)*10)/10);
    setSub('spol-kpi-sunday-sub','spol_kpi_sunday_sub_tpl',top.voivodeship);
  }
}

const _IP_STOPS=['#132912','#1e4019','#2d6324','#4a9228','#72c133','#a6e84a'];
function _ipRamp(t){
  t=Math.max(0,Math.min(1,t));
  const seg=t*(_IP_STOPS.length-1),i=Math.min(_IP_STOPS.length-2,Math.floor(seg)),u=seg-i;
  const h=k=>[parseInt(k.slice(1,3),16),parseInt(k.slice(3,5),16),parseInt(k.slice(5,7),16)];
  const a=h(_IP_STOPS[i]),b=h(_IP_STOPS[i+1]);
  return`rgb(${Math.round(a[0]+(b[0]-a[0])*u)},${Math.round(a[1]+(b[1]-a[1])*u)},${Math.round(a[2]+(b[2]-a[2])*u)})`;
}

let _ipMap=null,_ipSrcReady=false,_ipPending=false;
let _ipMapMode='2d';
let _powGeo=null;
let _ipTip=null;
let _ipLabelMarkers=[];
let _ipLevelLive='voivodeship';  // level actually drawn on the map (see _fillInpost)

const _IP_FILL_STOPS=[
  'interpolate',['linear'],['get','_t'],
  0,'#132912', 0.2,'#1e4019', 0.4,'#2d6324', 0.6,'#4a9228', 0.8,'#72c133', 1,'#a6e84a'];

function _refreshIpLabels(features){
  _ipLabelMarkers.forEach(m=>{try{m.remove()}catch(e){}});
  _ipLabelMarkers=[];
  if(!_ipMap || _ipLevelLive!=='voivodeship')return;
  features.forEach(f=>{
    const c=featureBBoxCenter(f);
    const lab=f.properties&&f.properties._label;
    if(!c||!lab)return;
    const el=document.createElement('div');
    el.className='woj-val-label-marker';
    el.textContent=lab;
    _ipLabelMarkers.push(new maplibregl.Marker({element:el,anchor:'center'}).setLngLat(c).addTo(_ipMap));
  });
}

function _ipFindRow(f, byName, byId) {
  const p = f.properties || {};
  let name = (p.nazwa || p.name || '');
  name = name.replace(/^powiat\s+/i, '').toLowerCase();
  return byId.get(String(p.id ?? p.ID)) || byId.get(String(p.nazwa))
    || byName.get(name) || byName.get((p.nazwa || '').toLowerCase()) || byName.get((p.name || '').toLowerCase());
}

function _setIpData(data, geojson) {
  const byName = new Map();
  const byId = new Map();
  data.forEach(d => {
    const n = d.name || d.voivodeship || '';
    if (n) {
      let clean = n.replace(/^powiat\s+/i, '').toLowerCase();
      byName.set(clean, d);
      byName.set(n.toLowerCase(), d);
    }
    if (d.geo_id != null) byId.set(String(d.geo_id), d);
  });

  const vals = data.map(d => +d.ratio || 0);
  const vmin = Math.min(...vals), vmax = Math.max(...vals, vmin + 0.01);

  const features = (geojson.features || []).map((f, i) => {
    const d = _ipFindRow(f, byName, byId);
    const nf = { type: 'Feature', geometry: f.geometry, properties: { ...(f.properties || {}), _fid: i } };
    if (d) {
      const r0 = (+d.ratio || 0);
      const norm = (r0 - vmin) / (vmax - vmin);
      nf.properties._t = Math.max(0, Math.min(1, 1 - (isNaN(norm) ? 0.5 : norm)));
      
      const rr = typeof d.ratio === 'number' ? d.ratio.toFixed(2) : String(d.ratio);
      nf.properties._label = (getLang() === 'en' ? rr : rr.replace('.', ',')) + 'x';
      
      const _rn = f.properties.nazwa || '';
      let dispName = _rn;
      if (_dbLevel !== 'voivodeship') {
        dispName = dispName.replace(/^powiat\s+/i, '');
      }
      nf.properties._name = dispName ? dispName[0].toUpperCase() + dispName.slice(1) : dispName;
      
      const z = (d.zabki_per_100k || 0).toFixed(1), p = (d.lockers_per_100k || 0).toFixed(1);
      const zabkaLabel = getLang() === 'en' ? 'Zabka' : 'Żabka';
      const ratioLabel = getLang() === 'en' ? 'ratio' : 'stosunek';
      
      nf.properties._tip = `<div style="font-weight:700;font-size:13px;margin-bottom:3px">${nf.properties._name}</div>` +
        `<div style="font-size:12px;color:#93a487">${zabkaLabel}: ${(getLang() === 'en' ? z : z.replace('.', ','))}/100k</div>` +
        `<div style="font-size:12px;color:#93a487">InPost: ${(getLang() === 'en' ? p : p.replace('.', ','))}/100k</div>` +
        `<div style="font-size:12px;color:#93a487">${ratioLabel}: ${(getLang() === 'en' ? rr : rr.replace('.', ','))}x</div>`;
    } else {
      nf.properties._t = 0;
      nf.properties._label = '';
      nf.properties._tip = '';
    }
    return nf;
  });

  const fc = { type: 'FeatureCollection', features };
  if (_ipMap && _ipMap.getSource('ip-woj')) {
    _ipMap.getSource('ip-woj').setData(fc);
  }
  _refreshIpLabels(features);
}

async function renderInpostMap(){
  const el=document.getElementById('map-inpost');if(!el)return;
  if(!_ipMap){
    if(_ipPending)return;
    _ipPending=true;
    await ensureMaplibre();
    _buildInpostMap(el);
    return;
  }
  _fillInpost();
}

function _updateIpMapMode(){
  if(!_ipMap)return;
  const is3d=(_ipMapMode==='3d');
  if(_ipMap.getLayer('ip-woj-fill')) _ipMap.setLayoutProperty('ip-woj-fill','visibility',is3d?'none':'visible');
  if(_ipMap.getLayer('ip-woj-line')) _ipMap.setLayoutProperty('ip-woj-line','visibility',is3d?'none':'visible');
  if(_ipMap.getLayer('ip-woj-extrusion')) _ipMap.setLayoutProperty('ip-woj-extrusion','visibility',is3d?'visible':'none');
  
  _ipMap.dragPan.enable();
  _ipMap.scrollZoom.enable();
  _ipMap.doubleClickZoom.enable();
  _ipMap.touchZoomRotate.enable();

  if(is3d){
    _ipMap.dragRotate.enable();
    _ipMap.easeTo({pitch:50,bearing:10,duration:1000});
  }else{
    _ipMap.dragRotate.disable();
    _ipMap.easeTo({center:[19.3,52.05],zoom:5.6,pitch:0,bearing:0,duration:1000});
  }
}

async function _buildInpostMap(el){
  try {
    _ipMap=createMap('map-inpost',{
      center:[19.3,52.05],zoom:5.6,minZoom:5,maxZoom:9,
      dragPan:true,scrollZoom:true,dragRotate:false,doubleClickZoom:true,touchZoom:true,keyboard:true,
    });
    MAPS['map-inpost']=_ipMap;
    
    // Wire 2D/3D toggle buttons
    const toggleContainer=document.getElementById('inpost-map-mode');
    if(toggleContainer){
      toggleContainer.querySelectorAll('.mode-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const mode=btn.dataset.mode;
          if(mode===_ipMapMode)return;
          _ipMapMode=mode;
          toggleContainer.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b===btn));
          _updateIpMapMode();
        });
      });
    }

    _ipMap.on('load',()=>{
      _ipMap.addSource('ip-woj',{type:'geojson',data:{type:'FeatureCollection',features:[]},promoteId:'_fid'});
      _ipMap.addLayer({id:'ip-woj-fill',type:'fill',source:'ip-woj',paint:{
        'fill-color':_IP_FILL_STOPS,
        'fill-opacity':['case',['boolean',['feature-state','hover'],false],1,0.9],
      }});
      _ipMap.addLayer({id:'ip-woj-line',type:'line',source:'ip-woj',paint:{
        'line-color':['case',['boolean',['feature-state','hover'],false],'#a6e84a','#08110a'],
        'line-width':['case',['boolean',['feature-state','hover'],false],2.5,1],
      }});
      _ipMap.addLayer({
        id:'ip-woj-extrusion',type:'fill-extrusion',source:'ip-woj',
        paint:{
          'fill-extrusion-color':_IP_FILL_STOPS,
          'fill-extrusion-height':['*', ['get','_t'], 60000],
          'fill-extrusion-base':0,
          'fill-extrusion-opacity':0.85
        },
      });
      
      _updateIpMapMode();

      let _hoverFid=null;
      if(!_ipTip){
        _ipTip=document.createElement('div');
        _ipTip.className='gran-tooltip maplibre-hover-tip';_ipTip.style.display='none';
        document.body.appendChild(_ipTip);
      }
      
      const onMove=e=>{
        const fs=e.features&&e.features[0];if(!fs)return;
        if(_hoverFid!=null)_ipMap.setFeatureState({source:'ip-woj',id:_hoverFid},{hover:false});
        _hoverFid=fs.id;_ipMap.setFeatureState({source:'ip-woj',id:_hoverFid},{hover:true});
        _ipMap.getCanvas().style.cursor='pointer';
        const p=fs.properties||{};
        if(p._tip){_ipTip.innerHTML=p._tip;_ipTip.style.left=(e.originalEvent.clientX+14)+'px';_ipTip.style.top=(e.originalEvent.clientY+14)+'px';_ipTip.style.display='block';}
      };
      
      const onLeave=()=>{
        if(_hoverFid!=null)_ipMap.setFeatureState({source:'ip-woj',id:_hoverFid},{hover:false});
        _hoverFid=null;_ipMap.getCanvas().style.cursor='';_ipTip.style.display='none';
      };

      _ipMap.on('mousemove','ip-woj-fill',onMove);
      _ipMap.on('mouseleave','ip-woj-fill',onLeave);
      _ipMap.on('mousemove','ip-woj-extrusion',onMove);
      _ipMap.on('mouseleave','ip-woj-extrusion',onLeave);
      
      _ipMap.on('click',e=>{
        const features = _ipMap.queryRenderedFeatures(e.point, { layers: ['ip-woj-fill', 'ip-woj-extrusion'] });
        if (!features.length) {
          if(_hoverFid!=null)_ipMap.setFeatureState({source:'ip-woj',id:_hoverFid},{hover:false});
          _hoverFid=null;_ipMap.getCanvas().style.cursor='';_ipTip.style.display='none';
        }
      });
      
      fitPoland(_ipMap,4);
      _ipSrcReady=true;
    });
  } catch (e) {
    if (e instanceof WebGLUnavailableError) {
      showMapUnavailable(el, { message: getLang() === 'en' ? 'Zabka vs InPost map unavailable' : 'Mapa Żabka vs InPost niedostępna' });
      _ipMap = null;
      return;
    }
    throw e;
  }
  _fillInpost();
}

async function ensurePowGeo() {
  if (_powGeo) return _powGeo;
  _powGeo = await fetchJSON('/api/geo/powiats');
  return _powGeo;
}

async function _fillInpost(){
  // There is no per-city boundary GeoJSON (only /api/geo/voivodeships and
  // /api/geo/powiats), so "Miasto" can't get its own choropleth - it falls
  // back to the voivodeship view rather than joining city-level rows onto
  // powiat polygons (which used to just leave the map looking empty/dark,
  // since almost no city name matches a powiat name).
  const level = (_dbLevel === 'powiat') ? 'powiat' : 'voivodeship';
  _ipLevelLive = level;
  let data;
  if (level === 'voivodeship') {
    data = M.inpost_vs_zabka || [];
  } else {
    const res = await fetchDumbbellLevel('powiat', 400);
    data = res ? res.rows : [];
  }
  if (!data.length) return;

  const geojson = level === 'voivodeship' ? M.woj_geo : await ensurePowGeo();

  const push=()=>{ if(_ipMap&&_ipMap.getSource('ip-woj')) _setIpData(data,geojson); };
  if(_ipSrcReady)push(); else if(_ipMap)_ipMap.once('load',push);
}
export function renderSpoleczenstwo(){
  if(!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)){
    startTabParticles('particles-spoleczenstwo',[188,224,58],60);
  }
  renderSpolecKPIs();
  wireCountUp(document.getElementById('spol-kpi-strip'));
  whenVisible(document.getElementById('map-inpost'), renderInpostMap);   // defer MapLibre until on-screen
  // Update lead paragraph with live totals
  const leadEl=document.getElementById('ec-lead-totals');
  if(leadEl&&M.summary&&M.section3_rare){
    const total=M.summary.total_active?(+M.summary.total_active).toLocaleString(getLang() === 'en' ? 'en-US' : 'pl-PL'):null;
    const powiats=M.section3_rare.powiats_covered||null;
    if(total&&powiats){
      leadEl.innerHTML=t('lead_totals_template').replace('{total}', total).replace('{powiats}', powiats);
    }
  }
  const hEl=document.getElementById('hero-num-spoleczenstwo');
  if(hEl){
    const voidData=(M.section3_rare&&M.section3_rare.void)||null;
    if(voidData&&voidData.value!=null){
      const target=+voidData.value;
      const prefersReduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(prefersReduced){
        hEl.innerHTML=`${getLang() === 'en' ? String(target) : String(target).replace('.',',')}<span class="stat-unit"> km</span>`;
      }else{
        const from=0,dur=1800,start=performance.now();
        (function step(now){
          const t=Math.min(1,(now-start)/dur);
          const e=t>=1?1:1-Math.pow(2,-14*t);
          const v=from+(target-from)*e;
          const vVal=Math.round(v*100)/100;
          hEl.innerHTML=`${getLang() === 'en' ? String(vVal) : String(vVal).replace('.',',')}<span class="stat-unit"> km</span>`;
          if(t<1)requestAnimationFrame(step);
        })(performance.now());
      }
    }
  }
  whenVisible(document.getElementById('ec-root'), async () => { const { renderEcon } = await ensureEcon(); renderEcon(); });
  renderDumbbellByLevel();
  renderSpolKnn();
  renderStreets();
  renderGminaLeaders();
  renderNbl();
  wireStreetsAndGmina();
  wireNbl();
}

// ---- common-streets bar (Zabka stoi tam, gdzie Polska stawia pomniki) ----
export function renderStreets(){
  const ps=M.section3_rare&&M.section3_rare.physical_streets;
  const rows=(ps||[]).slice(0,15);
  if(!rows.length)return;
  const distEl=document.getElementById('streets-distinct');
  if(distEl){
    const total=(M.summary&&M.summary.total_active)||0;
    if(total) distEl.textContent=fmt(total);
  }
  destroyChart('streets');
  const monoFont=getFont('mono');
  // Plugin: rysuj tick labels z ulica duzym fontem + miasto mniejszym
  const streetsData=rows;
  const dualLabelPlugin={
    id:'dualLabelSpoleczenstwo',
    afterDatasetsDraw(chart){
      const yScale=chart.scales.y;
      const ctx=chart.ctx;
      ctx.save();
      ctx.textAlign='right';
      ctx.textBaseline='middle';
      const items=(yScale._labelItems&&yScale._labelItems.length)?yScale._labelItems:null;
      const drawOne=(y,i)=>{
        const s=streetsData[i];if(!s)return;
        const x=yScale.left-8;
        ctx.font=`600 13px '${getFont('body')}',sans-serif`;
        ctx.fillStyle='#c8d4c0';
        const st=s.street.replace(/^ul\.\s*/i,'').trim();
        ctx.fillText(st.length>28?st.slice(0,27)+'…':st, x, y-4);
        ctx.font=`400 10px '${getFont('body')}',sans-serif`;
        ctx.fillStyle='#93a487';
        ctx.fillText(s.city, x, y+10);
      };
      if(items){items.forEach((it,i)=>drawOne(it.y,i));}
      else{const m=chart.getDatasetMeta(0);if(m&&m.data)m.data.forEach((b,i)=>drawOne(b.y,i));}
      ctx.restore();
    }
  };
  CHARTS['streets']=new Chart(document.getElementById('chart-streets'),{
    type:'bar',
    data:{labels:rows.map((s,i)=>i),datasets:[{
      data:rows.map(d=>d.cnt),
      backgroundColor:rows.map((_,i)=>i===0?C.greenBright:C.green+'aa'),
      borderWidth:0,borderRadius:2,maxBarThickness:20
    }]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      layout:{padding:{right:60,left:180,top:8,bottom:8}},
      plugins:{legend:{display:false},
        tooltip:{enabled:false},
        barLabels:{thousands:true,color:C.muted},
        dualLabelSpoleczenstwo:{}},
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{display:false},ticks:{display:false}}}},
    plugins:[dualLabelPlugin],
  });
}

// ---- gmina leaders (kurorty) per_1k / per_km2 ----
let _gminaMetric='per_1k';
export function renderGminaLeaders(){
  const gl=M.gmina_leaders||{};
  const rows=(_gminaMetric==='per_1k'?gl.per_1k:gl.per_km2)||[];
  if(!rows.length)return;
  const r12=rows.slice(0,12);
  const per1k=_gminaMetric==='per_1k';
  const sub=document.getElementById('gmina-lead-sub');
  if(sub)sub.textContent=per1k ? t('resort_sub_per1k') : t('resort_sub_perkm2');
  const cav=document.getElementById('gmina-lead-caveat');
  if(cav)cav.style.display=per1k?'':'none';
  const natRef=per1k&&gl.national_per_1k?[{
    value:gl.national_per_1k,
    axis:'x',
    color:'rgba(255,255,255,.3)',
    label: (getLang() === 'en' ? 'nat. avg. ' : 'śr. kraj ') + (getLang() === 'en' ? String(gl.national_per_1k) : String(gl.national_per_1k).replace('.',','))
  }]:[];
  destroyChart('gmina-lead');
  CHARTS['gmina-lead']=new Chart(document.getElementById('chart-gmina-lead'),{
    type:'bar',
    data:{labels:r12.map(d=>d.name),datasets:[{
      data:r12.map(d=>per1k?d.per_1k:d.per_km2),
      backgroundColor:r12.map((_,i)=>_ipRamp(1-i/Math.max(r12.length-1,1))),
      borderRadius:2,borderWidth:0,maxBarThickness:20
    }]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      animation:{duration:0},
      layout:{padding:{right:60,top:8,bottom:8}},
      plugins:{legend:{display:false},
        tooltip:{enabled:false},
        barLabels:{decimals:2,color:C.muted},
        annot:{refLines:natRef}},
      scales:{x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}

function wireStreetsAndGmina(){
  document.querySelectorAll('#gmina-metric .gran-btn').forEach(btn=>{
    if(btn._wired)return;btn._wired=true;
    btn.addEventListener('click',()=>{
      _gminaMetric=btn.dataset.gmetric;
      _setActiveSpol('#gmina-metric',btn);
      renderGminaLeaders();
    });
  });
}

// ---- neighbor-by-level ranking (median/avg, level, sort) ----
let _nblLevel='voivodeship', _nblMetric='median_m', _nblSort='asc';
const _nblCache={};
const _NBL_LABEL={
  voivodeship: getLang() === 'en' ? 'voivodeships' : 'województw',
  powiat: getLang() === 'en' ? 'districts' : 'powiatów',
  city: getLang() === 'en' ? 'cities' : 'miast'
};

async function _fetchNbl(level,metric,sort){
  const key=`${level}_${metric}_${sort}`;
  if(_nblCache[key])return _nblCache[key];
  try{
    const r=await fetch(`/api/stats/neighbor-by-level?level=${level}&metric=${metric}&sort=${sort}&limit=20`);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();_nblCache[key]=d;return d;
  }catch(e){console.error('nbl fetch',e);return null}
}

function _drawNbl(data){
  const rows=(data&&data.rows||[]).slice(0,20);
  if(!rows.length)return;
  const metric=_nblMetric;
  const total=data&&data.total||rows.length;
  const sub=document.getElementById('nbl-sub');
  if(sub) {
    const metricName = metric === 'median_m' ? t('knn_median') : t('knn_mean');
    sub.textContent = t('nbl_sub_template').replace('{metric}', metricName).replace('{level}', _NBL_LABEL[_nblLevel]);
  }

  const labels=rows.map(d=>capName(d.name));
  const vals=rows.map(d=>d[metric]);
  const bgs=rows.map((_,i)=>_ipRamp(1-i/Math.max(rows.length-1,1)));

  if(total>rows.length){
    const ns=(M.neighbor_stats&&M.neighbor_stats.distribution)||{};
    const natVal=metric==='median_m'?(ns.median_m||null):(ns.avg_m||null);
    if(natVal!=null){
      labels.push(getLang() === 'en' ? 'Others' : 'Pozostałe');
      vals.push(Math.round(natVal));
      bgs.push('rgba(147,164,135,0.35)');
    }
  }

  destroyChart('nbl');
  CHARTS['nbl']=new Chart(document.getElementById('chart-nbl'),{
    type:'bar',
    data:{labels,datasets:[{
      data:vals,
      backgroundColor:bgs,
      borderRadius:2,borderWidth:0
    }]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      layout:{padding:{right:72,top:4}},
      plugins:{legend:{display:false},
        tooltip:{callbacks:{label:ctx=>{const d=rows[ctx.dataIndex];if(!d)return[];return [
          `${t('knn_median').toLowerCase()} ${d.median_m.toLocaleString(getLang() === 'en' ? 'en-US' : 'pl-PL')} m`,
          `${t('knn_mean').toLowerCase()} ${d.avg_m.toLocaleString(getLang() === 'en' ? 'en-US' : 'pl-PL')} m`,
          `${d.n} ${getLang() === 'en' ? 'stores' : 'sklepów'}`]}}},
        barLabels:{thousands:true,color:C.muted,suffix:' m'}},
      scales:{x:{grid:{color:C.axis},title:{display:true,text: getLang() === 'en' ? 'meters to nearest Zabka' : 'metry do najbliższej Żabki',color:C.muted,font:{size:11}},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}}}
    }
  });
}

export async function renderNbl(){
  let data;
  if(_nblLevel==='voivodeship'&&_nblMetric==='median_m'&&_nblSort==='asc'
     &&M.neighbor_by_level&&(M.neighbor_by_level.rows||[]).length){
    data=M.neighbor_by_level;
  }else{
    data=await _fetchNbl(_nblLevel,_nblMetric,_nblSort)||M.neighbor_by_level;
  }
  _drawNbl(data);
}

function _setActiveSpol(sel,btn){
  document.querySelectorAll(sel+' .gran-btn').forEach(b=>{
    b.classList.toggle('active',b===btn);
    b.setAttribute('aria-pressed',b===btn?'true':'false');
  });
}

function wireNbl(){
  const wire=(sel,attr,set)=>document.querySelectorAll(sel+' .gran-btn').forEach(btn=>{
    if(btn._wired)return;btn._wired=true;
    btn.addEventListener('click',()=>{
      set(btn.dataset[attr]);
      _setActiveSpol(sel,btn);
      renderNbl();
    });
  });
  wire('#nbl-level','nlevel',v=>_nblLevel=v);
  wire('#nbl-metric','nmetric',v=>_nblMetric=v);
  wire('#nbl-sort','nsort',v=>_nblSort=v);
}



let _dbTip=null;
const _DB_LIMIT=20;
let _dbLevel='voivodeship';
let _dbDataCache={};

const _DB_LEVEL_MAP={'voivodeship':'voivodeship','powiat':'powiat','city':'city','gmina':'gmina'};
const _DB_LEVEL_LABEL_PL={
  voivodeship: getLang() === 'en' ? 'voivodeships' : 'województw',
  powiat: getLang() === 'en' ? 'districts' : 'powiatów',
  city: getLang() === 'en' ? 'cities' : 'miast',
  gmina: getLang() === 'en' ? 'communes' : 'gmin'
};

async function fetchDumbbellLevel(level,limit){
  const key=`${level}_${limit}`;
  if(_dbDataCache[key])return _dbDataCache[key];
  const apiLevel=_DB_LEVEL_MAP[level]||level;
  try{
    const r=await fetch(`/api/stats/inpost-vs-zabka-by-level?level=${encodeURIComponent(apiLevel)}&limit=${limit}`);
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const d=await r.json();
    _dbDataCache[key]=d;
    return d;
  }catch(e){console.error('dumbbell fetch error',e);return null}
}

export function renderDumbbell(data){
  if(!data)data=M.inpost_vs_zabka;
  const arr=(data||[]).filter(d=>{
    const z=d.zabki_per_100k||0, p=d.lockers_per_100k||0;
    if(!z||!p) return false;
    // require at least 5% relative difference so the line is actually visible
    return Math.abs(p-z)/Math.max(z,p)>=0.05;
  }).sort((a,b)=>{
    const na=(a.name||a.voivodeship||'').toLowerCase();
    const nb=(b.name||b.voivodeship||'').toLowerCase();
    return na.localeCompare(nb,'pl');
  });
  const el=document.getElementById('inpost-dumbbell');if(!el)return;
  const allVals=arr.flatMap(d=>[d.zabki_per_100k||0,d.lockers_per_100k||0]);
  const maxV=Math.max(...allVals,1);
  const ROW=24;
  const PAD_L=130;
  const PAD_R=80;
  const W_CHART=420;
  const DOT_R=5;
  const FONT_LABEL=10;
  const FONT_RATIO=9;
  const FONT_GRID=8;
  const H=arr.length*ROW+30;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  const VBW=PAD_L+W_CHART+PAD_R;
  svg.setAttribute('viewBox',`0 0 ${VBW} ${H}`);
  svg.setAttribute('height', H);
  svg.style.cssText=`display:block;width:100%;max-width:${VBW}px`;
  function px(v){return PAD_L+v/maxV*W_CHART}
  [0.25,0.5,0.75,1.0].forEach(f=>{
    const x=px(maxV*f);
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',x);line.setAttribute('y1',16);line.setAttribute('x2',x);line.setAttribute('y2',H-10);
    line.setAttribute('stroke','#2a2a3a');line.setAttribute('stroke-width','0.6');
    svg.appendChild(line);
    const lbl=document.createElementNS('http://www.w3.org/2000/svg','text');
    lbl.setAttribute('x',x);lbl.setAttribute('y',12);lbl.setAttribute('text-anchor','middle');
    lbl.setAttribute('fill','#93a487');lbl.setAttribute('font-size',FONT_GRID);
    lbl.textContent=(maxV*f).toFixed(0);svg.appendChild(lbl);
  });
  arr.forEach((d,i)=>{
    const y=22+i*ROW;
    const xz=px(d.zabki_per_100k||0),xi=px(d.lockers_per_100k||0);
    const isFiltered=STATE.filter&&d.voivodeship&&d.voivodeship.toLowerCase()!==STATE.filter.toLowerCase();
    const alpha=isFiltered?'0.15':'1';
    const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
    ln.setAttribute('x1',Math.min(xz,xi));ln.setAttribute('y1',y);ln.setAttribute('x2',Math.max(xz,xi));ln.setAttribute('y2',y);
    ln.setAttribute('stroke','#3a3a4a');ln.setAttribute('stroke-width','1.5');ln.setAttribute('opacity',alpha);
    svg.appendChild(ln);
    const cz=document.createElementNS('http://www.w3.org/2000/svg','circle');
    cz.setAttribute('cx',xz);cz.setAttribute('cy',y);cz.setAttribute('r',DOT_R);
    cz.setAttribute('fill','#84c341');cz.setAttribute('opacity',alpha);
    svg.appendChild(cz);
    const ci=document.createElementNS('http://www.w3.org/2000/svg','circle');
    ci.setAttribute('cx',xi);ci.setAttribute('cy',y);ci.setAttribute('r',DOT_R);
    ci.setAttribute('fill','#f2a359');ci.setAttribute('opacity',alpha);
    svg.appendChild(ci);
    const lbl=document.createElementNS('http://www.w3.org/2000/svg','text');
    lbl.setAttribute('x',PAD_L-6);lbl.setAttribute('y',y+3.5);lbl.setAttribute('text-anchor','end');
    lbl.setAttribute('fill',isFiltered?'#3a3a5a':'#c8c8d8');lbl.setAttribute('font-size',FONT_LABEL);
    const rawName=d.name||d.voivodeship||'';
    const name=rawName.replace(/^M\.st\.\s*/i,'').replace(/\s+od\s+\d{4}\s*$/i,'').replace(/^powiat\s+/i,'').trim();
    lbl.textContent=name?capName(name):rawName;
    svg.appendChild(lbl);
    const rb=document.createElementNS('http://www.w3.org/2000/svg','text');
    rb.setAttribute('x',PAD_L+W_CHART+4);rb.setAttribute('y',y+3);
    rb.setAttribute('fill','#93a487');rb.setAttribute('font-size',FONT_RATIO);
    const ratioTxt=typeof d.ratio==='number'?(getLang() === 'en' ? d.ratio.toFixed(2) : d.ratio.toFixed(2).replace('.',',')):String(d.ratio||'–');
    rb.textContent=ratioTxt+'x';svg.appendChild(rb);
  });
  if(!_dbTip){
    _dbTip=document.createElement('div');
    _dbTip.style.cssText='position:fixed;pointer-events:none;opacity:0;transition:opacity .12s;background:rgba(12,22,11,.95);border:1px solid rgba(140,200,80,.3);border-radius:8px;padding:8px 12px;font-size:12px;color:#eef3e6;white-space:nowrap;z-index:9999;line-height:1.6';
    document.body.appendChild(_dbTip);
  }
  if(_dbTip)_dbTip.style.opacity='0';
  const handleMove = (e)=>{
    const r=svg.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const svgY=clientY-r.top;
    const idx=Math.round((svgY-22)/ROW);
    if(idx>=0&&idx<arr.length){
      const d=arr[idx];
      const rawTip=d.name||d.voivodeship||'';
      const name=rawTip.replace(/^M\.st\.\s*/i,'').replace(/\s+od\s+\d{4}\s*$/i,'').replace(/^powiat\s+/i,'').trim()||rawTip;
      const z=(d.zabki_per_100k||0).toFixed(1);
      const p=(d.lockers_per_100k||0).toFixed(1);
      const ratio=typeof d.ratio==='number'?(getLang() === 'en' ? d.ratio.toFixed(2) : d.ratio.toFixed(2).replace('.',',')):String(d.ratio||'–');
      const ratioLabel = getLang() === 'en' ? 'ratio' : 'stosunek';
      _dbTip.innerHTML=`<div style="font-weight:700;margin-bottom:2px">${name}</div>`+
        `<span style="color:#84c341">${getLang() === 'en' ? 'Zabka' : 'Żabka'}: ${(getLang() === 'en' ? z : z.replace('.', ','))}/100k</span>&nbsp;&nbsp;`+
        `<span style="color:#f2a359">InPost: ${(getLang() === 'en' ? p : p.replace('.', ','))}/100k</span>`+
        `<div style="color:#93a487;margin-top:2px">${ratioLabel}: ${ratio}x</div>`;
      _dbTip.style.opacity='1';
      _dbTip.style.top=(clientY+14)+'px';
      _dbTip.style.left=(clientX+14)+'px';
    } else {
      _dbTip.style.opacity='0';
    }
  };
  const handleLeave = ()=>{if(_dbTip)_dbTip.style.opacity='0';};
  svg.addEventListener('mousemove', handleMove);
  svg.addEventListener('mouseleave', handleLeave);
  svg.addEventListener('touchstart', handleMove, {passive:true});
  svg.addEventListener('touchmove', handleMove, {passive:true});
  svg.addEventListener('touchend', handleLeave);
  el.innerHTML='';el.appendChild(svg);
}

export async function renderDumbbellByLevel(){
  if(_dbLevel==='voivodeship'){
    renderDumbbell(M.inpost_vs_zabka);
    const title=document.querySelector('[data-debug-id="2.3"]');
    if(title){
      const inpostRows=M.inpost_vs_zabka||[];
      const sumZ=inpostRows.reduce((s,d)=>s+(d.zabki_per_100k||0),0);
      const sumI=inpostRows.reduce((s,d)=>s+(d.lockers_per_100k||0),0);
      const ratio=sumZ>0?sumI/sumZ:null;
      const ratioStr = ratio ? (getLang() === 'en' ? ratio.toFixed(2) : ratio.toFixed(2).replace('.', ',')) : '';
      const suffix = getLang() === 'en' ? ' parcel lockers per Zabka in Poland' : ' paczkomaty na każdą Żabkę w Polsce';
      title.textContent='Żabka vs InPost'+(ratio?' – '+ratioStr+suffix:'');
    }
    return;
  }
  const d=await fetchDumbbellLevel(_dbLevel,_DB_LIMIT);
  if(!d){renderDumbbell(M.inpost_vs_zabka);return}
  const label=_DB_LEVEL_LABEL_PL[_dbLevel]||_dbLevel;
  const title=document.querySelector('[data-debug-id="2.3"]');
  if(title) title.textContent = t('dumbbell_title_template').replace('{length}', d.rows.length).replace('{label}', label).replace('{total}', d.total);
  renderDumbbell(d.rows);
}

function wireInpostLevel(){
  document.querySelectorAll('#inpost-level .gran-btn').forEach(btn=>{
    if(btn._wired)return;btn._wired=true;
    btn.addEventListener('click',()=>{
      _dbLevel=btn.dataset.ilevel;
      _setActiveSpol('#inpost-level',btn);
      renderDumbbellByLevel();
      renderInpostMap();
    });
  });
}

// ---- kNN histogram (Żabka a Polska) ----
function renderSpolKnn(){
  const ns=M.neighbor_stats||{};
  const dist=(ns.distribution||{buckets:[]}).buckets;
  if(!dist.length)return;
  const loner=ns.loner||{};
  const d=ns.distribution||{};

  // Gradient zieleni - najkrotsze dystanse najjasniejsze
  const n=dist.length||1;
  const bgs=dist.map((_,i)=>{
    const t=i/Math.max(n-1,1);
    const r=Math.round(132+(166-132)*(1-t));
    const g=Math.round(195+(232-195)*(1-t));
    const bl=Math.round(65+(74-65)*(1-t));
    return `rgba(${r},${g},${bl},0.85)`;
  });

  const med=d.median_m!=null?d.median_m:null;
  const avg=d.avg_m!=null?d.avg_m:null;
  const refLines=[];
  if(med!=null) refLines.push({value:med,axis:'y',color:'#86a86a',lineWidth:2});
  if(avg!=null) refLines.push({value:avg,axis:'y',color:'#c79257',lineWidth:2});

  const legEl=document.getElementById('spol-knn-legend');
  if(legEl){
    const parts=[];
    if(med!=null) parts.push(`<span class="lg-item" style="color:#86a86a"><span class="lg-line"></span>MED ${Math.round(med)} m</span>`);
    if(avg!=null) parts.push(`<span class="lg-item" style="color:#c79257"><span class="lg-line"></span>AVG ${Math.round(avg)} m</span>`);
    legEl.innerHTML=parts.join('');
  }

  destroyChart('spol-knn');
  CHARTS['spol-knn']=new Chart(document.getElementById('spol-knnChart'),{
    type:'bar',
    data:{
      labels:dist.map(d=>d.bucket),
      datasets:[{
        data:dist.map(d=>d.cnt),
        backgroundColor:bgs,
        borderWidth:0,borderRadius:[4,4,0,0]
      }]
    },
    options:{
      indexAxis:'x',responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{enabled:false},
        annot:{refLines},
        barLabels:{thousands:true,color:C.muted},
      },
      scales:{
        x:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:10}}}
      }
    }
  });

  const rawMax = loner.nearest_neighbor_distance_meters
    ? (loner.nearest_neighbor_distance_meters/1000).toFixed(1)
    : (d.max_m ? (d.max_m/1000).toFixed(1) : null);
  const maxKm = rawMax
    ? (getLang() === 'en' ? rawMax : rawMax.replace('.', ',')) + ' km'
    : '–';
  const maxEl=document.getElementById('spol-knn-stat-max');if(maxEl)maxEl.textContent=maxKm;
}

export {wireInpostLevel};
