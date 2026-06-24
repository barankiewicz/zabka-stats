import Chart from 'chart.js/auto';
import { C } from '../config.js';
import { M, CHARTS } from '../state.js';
import { fmt, getFont, destroyChart, startTabParticles } from '../utils.js';
import { selectFact } from './kraniec.js';

function _updateEdgeHeroLede(){
  const ledeEl=document.getElementById('hero-lede-edge');if(!ledeEl)return;
  const elevExt=(M.elevation&&M.elevation.extremes)||[];
  const top=elevExt.find(e=>e.which==='top');
  const bot=elevExt.find(e=>e.which==='bottom');
  const h24n=(M.summary&&M.summary.h24_count)||null;
  const voidVal=M.section3_rare&&M.section3_rare.void&&M.section3_rare.void.value;
  const hiStr=top?Math.round(top.elevation_meters)+' m':'963 m';
  const loStr=bot?String(bot.elevation_meters).replace('.',',')+' m':'−1,5 m';
  const h24Str=h24n!=null?h24n:35;
  const voidStr=voidVal?String(voidVal).replace('.',','):'46,5';
  ledeEl.textContent=`Od ${loStr} pod poziomem morza po ${hiStr} w Tatrach. ${h24Str} sklepów, które nigdy nie śpią. Jeden punkt w Polsce oddalony o ${voidStr} km od jakiejkolwiek Żabki.`;
}

// ===== CIEKAWOSTKI: kNN distribution (more buckets) =====
function renderCiekawostkiKNN(){
  const ns=M.neighbor_stats||{};
  const dist=(ns.distribution||{buckets:[]}).buckets;
  const loner=ns.loner||{};
  const d=ns.distribution||{};

  // Green gradient: lime at short distances, darker green at long
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

  // Legend below (gran-ref-legend style)
  const legEl=document.getElementById('ciek-knn-legend');
  if(legEl){
    const parts=[];
    if(med!=null) parts.push(`<span class="lg-item" style="color:#86a86a"><span class="lg-line"></span>MED ${Math.round(med)} m</span>`);
    if(avg!=null) parts.push(`<span class="lg-item" style="color:#c79257"><span class="lg-line"></span>AVG ${Math.round(avg)} m</span>`);
    legEl.innerHTML=parts.join('');
  }

  destroyChart('ciek-knn');
  CHARTS['ciek-knn']=new Chart(document.getElementById('ciek-knnChart'),{
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
        tooltip:{callbacks:{label:ctx=>`${fmt(ctx.raw)} sklepów`}},
        annot:{refLines},
        barLabels:{thousands:true,color:C.muted},
      },
      scales:{
        x:{grid:{display:false},ticks:{color:C.muted,font:{size:10}}},
        y:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:9}}}
      }
    }
  });

  const maxKm=loner.nearest_neighbor_distance_meters
    ?(loner.nearest_neighbor_distance_meters/1000).toFixed(1).replace('.',',')+' km'
    :(d.max_m?(d.max_m/1000).toFixed(1).replace('.',',')+' km':'–');
  const maxEl=document.getElementById('ciek-stat-max');if(maxEl)maxEl.textContent=maxKm;
}

// Donuty usuniete - logika kart 720/668 przeniesiona lub zbedna

// ===== CIEKAWOSTKI: Farthest-from-frog info card =====
function renderCiekawostkiFarthestFrog(){
  const ae=M.amphibian_extremes||{};
  const ff=ae.farthest_from_frog||{};
  if(!ff.city)return;
  const valEl=document.getElementById('edge-kpi-farthestfrog');
  if(valEl&&ff.nearest_amphibian_km!=null){
    const km=(Math.round(ff.nearest_amphibian_km*100)/100).toFixed(2).replace('.',',');
    valEl.innerHTML=km+'<span class="stat-unit"> km</span>';
  }
  const subEl=document.getElementById('edge-kpi-farthestfrog-sub');
  if(subEl)
    subEl.textContent=ff.city+(ff.voivodeship?', '+ff.voivodeship:'');
}

// ===== CIEKAWOSTKI: Physical streets (top street+city pairs) =====
function renderCiekawostkiStreets(){
  const streets=(M.section3_rare&&M.section3_rare.physical_streets)||[];
  if(!streets.length)return;

  const top=streets.slice(0,14);
  const canvas=document.getElementById('ciek-streetsChart');
  if(!canvas)return;
  destroyChart('ciek-streets');
  CHARTS['ciek-streets']=null;

  // Canvas 2D: rysujemy recznie (ulica duzym fontem, miasto mniejszym)
  const dpr=window.devicePixelRatio||1;
  const rowGap=12;  // px miedzy wierszami
  function fit(){
    const w=canvas.parentElement.clientWidth;
    const h=Math.max(420, top.length*36 + 60);  // rosnie z liczba wierszy
    canvas.width=w*dpr;
    canvas.height=h*dpr;
    canvas.style.width=w+'px';
    canvas.style.height=h+'px';
  }
  fit();

  const displayFont=getFont('display');
  const monoFont=getFont('mono');
  const padL=200, padR=64, padT=8, padB=24;
  const streetFont=s=>{
    let st=s.replace(/^ul\.\s*/i,'').trim();
    if(st===st.toUpperCase()&&st.length>2) st=st[0]+st.slice(1).toLowerCase();
    return st.length>28?st.slice(0,27)+'…':st;
  };

  const maxCnt=Math.max(...top.map(s=>s.cnt));
  const niceMax=Math.ceil(maxCnt/5)*5;
  const yAxisVals=[0, Math.round(niceMax*0.25), Math.round(niceMax*0.5), Math.round(niceMax*0.75), niceMax];

  function draw(){
    fit();
    const w=canvas.width/dpr, h=canvas.height/dpr;
    const ctx=canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);

    const chartL=padL, chartR=w-padR, chartT=padT, chartB=h-padB;
    const chartW=chartR-chartL, chartH=chartB-chartT;
    const totalGap=rowGap*(top.length-1);
    const rowH=(chartH-totalGap)/top.length;
    const barH=Math.min(26, rowH*0.55);

    // os X (dol)
    ctx.strokeStyle='rgba(140,200,80,.06)';
    ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(chartL,chartB);ctx.lineTo(chartR,chartB);ctx.stroke();
    // os X labels
    ctx.fillStyle='#93a487';
    ctx.textAlign='center';
    ctx.textBaseline='top';
    ctx.font=`400 10px 'JetBrains Mono',monospace`;
    yAxisVals.forEach(v=>{
      const x=chartL+chartW*(v/niceMax);
      ctx.fillText(v,x,chartB+5);
      ctx.strokeStyle='rgba(140,200,80,.06)';
      ctx.beginPath();ctx.moveTo(x,chartT);ctx.lineTo(x,chartB);ctx.stroke();
    });

    // bary + labels
    top.forEach((s,i)=>{
      const rowY=chartT+(rowH+rowGap)*i+rowH/2;
      // Label ulica (duzy)
      ctx.fillStyle='#eef3e6';
      ctx.font=`800 15px '${displayFont}',sans-serif`;
      ctx.textAlign='right';
      ctx.textBaseline='middle';
      ctx.fillText(streetFont(s.street), chartL-12, rowY-4);
      // Label miasto (maly)
      ctx.fillStyle='#93a487';
      ctx.font=`500 11px '${monoFont}',monospace`;
      ctx.fillText(s.city, chartL-12, rowY+10);

      // Poziomy słupek: rośnie w prawo od chartL
      const barW=chartW*(s.cnt/niceMax);
      const barH=Math.min(22, rowH*0.55);
      const barY=rowY-barH/2;
      const t=i/Math.max(top.length-1,1);
      const alpha=0.88-t*0.48;
      ctx.fillStyle=`rgba(166,232,74,${alpha})`;
      ctx.beginPath();
      const r=Math.min(4,barH/2);
      ctx.moveTo(chartL+r,barY);
      ctx.lineTo(chartL+barW-r,barY);
      ctx.arcTo(chartL+barW,barY,chartL+barW,barY+r,r);
      ctx.lineTo(chartL+barW,barY+barH-r);
      ctx.arcTo(chartL+barW,barY+barH,chartL+barW-r,barY+barH,r);
      ctx.lineTo(chartL+r,barY+barH);
      ctx.arcTo(chartL,barY+barH,chartL,barY+barH-r,r);
      ctx.lineTo(chartL,barY+r);
      ctx.arcTo(chartL,barY,chartL+r,barY,r);
      ctx.closePath();
      ctx.fill();

      // value label za slupkiem
      ctx.fillStyle='#93a487';
      ctx.font=`400 11px 'JetBrains Mono',monospace`;
      ctx.textAlign='left';
      ctx.textBaseline='middle';
      ctx.fillText(s.cnt, chartL+barW+6, rowY);
    });
  }

  draw();
  // Tooltip - delegujemy na canvas
  const tip=document.createElement('div');
  tip.className='kr-tip-canvas';
  tip.style.cssText='position:absolute;background:#0c160b;color:#eef3e6;border:1px solid rgba(140,200,80,.3);border-radius:9px;box-shadow:0 6px 26px rgba(0,0,0,.55);padding:8px 11px;font-family:IBM Plex Sans,sans-serif;font-size:12px;pointer-events:none;opacity:0;transition:opacity .15s ease;z-index:50;white-space:nowrap';
  canvas.parentElement.style.position='relative';
  canvas.parentElement.appendChild(tip);
  canvas.addEventListener('mousemove',(e)=>{
    const r=canvas.getBoundingClientRect();
    const x=e.clientX-r.left, y=e.clientY-r.top;
    const w=r.width, h=r.height;
    const chartL=padL, chartR=w-padR, chartT=padT, chartB=h-padB;
    const chartH=chartB-chartT;
    const totalGap=rowGap*(top.length-1);
    const rowH=(chartH-totalGap)/top.length;
    if(x<chartL||x>chartR){tip.style.opacity='0';return;}
    const i=Math.floor((y-chartT)/(rowH+rowGap));
    if(i<0||i>=top.length){tip.style.opacity='0';return;}
    const s=top[i];
    tip.innerHTML=`<b>${streetFont(s.street)}</b><br>${s.city}<br><span style="color:#93a487">${s.cnt} ${s.cnt===1?'sklep':'sklepy'} pod tym adresem</span>`;
    tip.style.left=(x+12)+'px';
    tip.style.top=(y+12)+'px';
    tip.style.opacity='1';
  });
  canvas.addEventListener('mouseleave',()=>{tip.style.opacity='0';});
  window.addEventListener('resize',()=>{draw();});
}

export function renderEdgeKPIs() {
  const s = M.summary || {};
  const s3 = M.section3_rare || {};
  const parks = s3.parks || {};
  const ns = M.neighbor_stats || {};
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  if (s.h24_count != null) set('edge-kpi-h24', String(s.h24_count));
  if (parks.count != null) set('edge-kpi-parks', fmt(parks.count));
  const mf = (M.amphibian_extremes && M.amphibian_extremes.most_froggy) || {};
  if (mf.amphibian_occurrences_5km != null) set('edge-kpi-frogrecord', fmt(mf.amphibian_occurrences_5km));

  // ep-zerofrog-val / ep-zerofrog-note (panel "Bez żadnej żaby w pobliżu")
  const ae = M.amphibian_extremes || {};
  if (ae.zero_frog_count != null) {
    set('ep-zerofrog-val', fmt(ae.zero_frog_count));
    if (s.total_active) {
      const pct = ((ae.zero_frog_count / s.total_active) * 100).toFixed(1).replace('.', ',');
      set('ep-zerofrog-note', `sklepów (${pct}%) bez ani jednej obserwacji płaza w 5 km`);
    }
  }

  // ep-isolated-val from neighbor_stats loner (panel under map, ep-isolated)
  const loner = ns.loner || {};
  if (loner.nearest_neighbor_distance_meters) {
    const km = (loner.nearest_neighbor_distance_meters / 1000).toFixed(1).replace('.', ',');
    set('ep-isolated-val', `${km} km`);
    if (loner.city) set('ep-isolated-city', `${loner.city}${loner.voivodeship ? ', ' + loner.voivodeship : ''}`);
    if (loner.street) set('ep-isolated-street', loner.street);
  }

  // oldest KPI tile from network_origin
  const no = M.network_origin || {};
  const oldest = no.oldest || {};
  if (oldest.first_opening_date) {
    const yr = oldest.first_opening_date.slice(0, 4);
    const age = new Date().getFullYear() - parseInt(yr, 10);
    set('edge-kpi-oldest', yr);
    const subEl = document.getElementById('edge-kpi-oldest-sub');
    if (subEl && oldest.city) subEl.textContent = oldest.city + ' · dziala od ' + age + ' lat';
  }

  // void KPI from section3_rare
  const vd = s3.void;
  if (vd && vd.value) {
    set('edge-kpi-void', `${String(vd.value).replace('.', ',')}<span class="stat-unit"> km</span>`);
  }

  // Elevation panels from M.elevation.extremes
  const elev = M.elevation || {};
  if (elev.extremes && elev.extremes.length) {
    const top = elev.extremes.find(e => e.which === 'top');
    const bot = elev.extremes.find(e => e.which === 'bottom');
    if (top) {
      const val = (Math.round(top.elevation_meters * 10) / 10).toFixed(1).replace('.', ',') + ' m';
      set('ep-highest-val', val);
      if (top.city) set('ep-highest-city', `${top.city}${top.voivodeship ? ', ' + top.voivodeship : ''}`);
      if (top.street) set('ep-highest-street', top.street);
    }
    if (bot) {
      const val = String(bot.elevation_meters).replace('.', ',') + ' m';
      set('ep-lowest-val', val);
      if (bot.city) set('ep-lowest-city', `${bot.city}${bot.voivodeship ? ', ' + bot.voivodeship : ''}`);
      if (bot.street) set('ep-lowest-street', bot.street);
    }
  }

  // Frog street panel
  const frogStreets = s3.frog_streets || [];
  if (frogStreets.length) {
    const crown = frogStreets[0];
    if (crown.city) set('ep-frogstreet-city', `${crown.city}${crown.voivodeship ? ', ' + crown.voivodeship : ''}`);
    const cnt = s3.frog_streets_count || frogStreets.length;
    set('ep-frogstreet-note', `Żabka przy ulicy Zielonej Żabki – jeden z ${cnt} sklepów na ulicach z żabim motywem.`);
  }

  // Farthest from any amphibian observation
  const ff = (M.amphibian_extremes && M.amphibian_extremes.farthest_from_frog) || {};
  if (ff.city && ff.nearest_amphibian_km != null) {
    const km = (Math.round(ff.nearest_amphibian_km * 100) / 100).toFixed(2).replace('.', ',');
    set('edge-kpi-farthestfrog', km + '<span class="stat-unit"> km</span>');
    const subEl = document.getElementById('edge-kpi-farthestfrog-sub');
    if (subEl) subEl.textContent = ff.city + (ff.voivodeship ? ', ' + ff.voivodeship : '');
  }
}

export function renderEdge(){
  startTabParticles('particles-edge',[96,200,148],42);
  _updateEdgeHeroLede();
  renderCiekawostkiKNN();
  renderCiekawostkiStreets();
}

export function jumpToFact(id) { selectFact(id); }
export function jumpBack() {}
export function jumpToH24() {}
export function jumpToParks() {}

