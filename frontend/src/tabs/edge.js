import Chart from 'chart.js/auto';
import { C } from '../config.js';
import { M, CHARTS } from '../state.js';
import { fmt, getFont, destroyChart, startTabParticles } from '../utils.js';
import { renderKraniec, selectFact } from './kraniec.js';

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

  // Per-bucket colors: green for close, amber for medium, red for far
  const bucketColor=label=>{
    if(label==='0 m') return C.lime+'cc';
    if(label.includes('<50')||label.includes('50-100')||label.includes('100-200')) return C.green+'cc';
    if(label.includes('200-350')||label.includes('350-500')) return C.amber+'aa';
    if(label.includes('500 m - 1')) return C.amber+'88';
    if(label.includes('1-3')) return '#e8916888';
    return C.red+'88';
  };

  destroyChart('ciek-knn');
  CHARTS['ciek-knn']=new Chart(document.getElementById('ciek-knnChart'),{
    type:'bar',
    data:{
      labels:dist.map(d=>d.bucket),
      datasets:[{
        data:dist.map(d=>d.cnt),
        backgroundColor:dist.map(d=>bucketColor(d.bucket)),
        borderWidth:0,borderRadius:[0,4,4,0]
      }]
    },
    options:{
      indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${fmt(ctx.raw)} sklepów`}}},
      scales:{
        x:{grid:{color:C.axis},ticks:{color:C.muted,font:{size:9}}},
        y:{grid:{display:false},ticks:{color:C.muted,font:{size:11},font:{family:'IBM Plex Sans'}}}
      }
    }
  });

  // Update statline
  const d=ns.distribution||{};
  const med=d.median_m!=null?Math.round(d.median_m)+' m':'—';
  const avg=d.avg_m!=null?Math.round(d.avg_m)+' m':'—';
  const maxKm=loner.nearest_neighbor_distance_meters
    ?(loner.nearest_neighbor_distance_meters/1000).toFixed(1).replace('.',',')+' km'
    :(d.max_m?(d.max_m/1000).toFixed(1).replace('.',',')+' km':'—');
  const medEl=document.getElementById('ciek-stat-median');if(medEl)medEl.textContent=med;
  const avgEl=document.getElementById('ciek-stat-avg');if(avgEl)avgEl.textContent=avg;
  const maxEl=document.getElementById('ciek-stat-max');if(maxEl)maxEl.textContent=maxKm;
}

// ===== CIEKAWOSTKI: Parks donut (canvas, same style as powiat coverage in Siec tab) =====
function renderCiekawostkiParks(){
  const parks=(M.section3_rare&&M.section3_rare.parks)||{};
  const inPark=parks.count||0;
  const total=parks.total||(M.summary&&M.summary.total_active)||0;
  if(!total)return;
  const pctRaw=inPark/total*100;
  const pctStr=(Math.abs(pctRaw-Math.round(pctRaw))<0.05
    ?Math.round(pctRaw)
    :pctRaw.toFixed(1)
  ).toString().replace('.',',');

  const cnoteEl=document.getElementById('ciek-parks-cnote');
  if(cnoteEl) cnoteEl.textContent=`${fmt(inPark)} sklepów (${pctStr}%) stoi w parkach lub ich otulinach.`;
  const statEl=document.getElementById('ciek-parks-statline');
  if(statEl&&parks.top3&&parks.top3.length)
    statEl.innerHTML=parks.top3.map(p=>`<span>${p.park_name}: <b>${p.cnt}</b></span>`).join('');

  destroyChart('ciek-parks');

  const canvas=document.getElementById('ciek-parksChart');
  if(!canvas)return;
  const SIZE=200;
  canvas.width=SIZE; canvas.height=SIZE;
  canvas.style.cssText='display:block;margin:12px auto 0';

  const ctx=canvas.getContext('2d');
  const cx=SIZE/2,cy=SIZE/2,rr=SIZE/2-16;
  ctx.clearRect(0,0,SIZE,SIZE);
  ctx.lineCap='round';
  ctx.lineWidth=15;

  // Background track
  ctx.strokeStyle='rgba(132,195,65,.12)';
  ctx.beginPath();ctx.arc(cx,cy,rr,0,Math.PI*2);ctx.stroke();

  // Progress arc
  const f=Math.max(0,Math.min(1,pctRaw/100));
  ctx.strokeStyle=C.greenBright;
  ctx.beginPath();ctx.arc(cx,cy,rr,-Math.PI/2,-Math.PI/2+Math.PI*2*f);ctx.stroke();

  // Percentage label
  ctx.fillStyle=C.greenBright;
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.font=`800 ${Math.round(SIZE*0.21)}px '${getFont('display')}',sans-serif`;
  ctx.fillText(pctStr+'%',cx,cy-10);

  // Subtitle
  ctx.fillStyle=C.muted;
  ctx.font=`400 ${Math.round(SIZE*0.09)}px '${getFont('body')}',sans-serif`;
  ctx.fillText('w parkach lub otulinach',cx,cy+14);
}

// ===== CIEKAWOSTKI: Physical streets (top street+city pairs) =====
function renderCiekawostkiStreets(){
  const streets=(M.section3_rare&&M.section3_rare.physical_streets)||[];
  if(!streets.length)return;

  const top=streets.slice(0,10);

  // Strip "ul." prefix, basic normalization for all-caps names
  const cleanStreet=s=>{
    let st=s.replace(/^ul\.\s*/i,'').trim();
    if(st===st.toUpperCase()&&st.length>2) st=st[0]+st.slice(1).toLowerCase();
    return st.length>28?st.slice(0,27)+'…':st;
  };

  // Lime -> green gradient, brightest at top
  const bgs=top.map((_,i)=>{
    const t=i/Math.max(top.length-1,1);
    return `rgba(166,232,74,${0.92-t*0.52})`;
  });

  // Inline count label drawn at bar end
  const countPlugin={
    id:'ciekStreetLabels',
    afterDatasetsDraw(chart){
      const{ctx}=chart;
      const meta=chart.getDatasetMeta(0);
      ctx.save();
      ctx.textBaseline='middle';
      ctx.textAlign='left';
      ctx.font='600 11px "IBM Plex Sans",sans-serif';
      meta.data.forEach((bar,i)=>{
        const v=top[i]?top[i].cnt:0;
        ctx.fillStyle=i===0?'rgba(166,232,74,0.95)':'rgba(200,230,160,0.8)';
        ctx.fillText(v===1?'1 sklep':v+' sklepy',bar.x+6,bar.y);
      });
      ctx.restore();
    }
  };

  destroyChart('ciek-streets');
  CHARTS['ciek-streets']=new Chart(document.getElementById('ciek-streetsChart'),{
    type:'bar',
    plugins:[countPlugin],
    data:{
      labels:top.map(s=>[cleanStreet(s.street),s.city]),
      datasets:[{
        data:top.map(s=>s.cnt),
        backgroundColor:bgs,
        borderWidth:0,
        borderRadius:[0,5,5,0],
        barThickness:22,
      }]
    },
    options:{
      indexAxis:'y',
      responsive:true,
      maintainAspectRatio:false,
      layout:{padding:{right:88}},
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          title:ctx=>`${top[ctx[0].dataIndex].street}, ${top[ctx[0].dataIndex].city}`,
          label:ctx=>`${ctx.raw} ${ctx.raw===1?'sklep':'sklepy'} pod tym adresem`,
        }}
      },
      scales:{
        x:{
          grid:{color:C.axis},
          min:0,
          ticks:{color:C.muted,font:{size:9},stepSize:1,precision:0},
        },
        y:{
          grid:{display:false},
          ticks:{color:C.muted,font:{size:10},crossAlign:'far'},
        }
      }
    }
  });
}

function renderEdgeKPIs() {
  const s = M.summary || {};
  const s3 = M.section3_rare || {};
  const parks = s3.parks || {};
  const ns = M.neighbor_stats || {};
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  if (s.h24_count != null) set('edge-kpi-h24', String(s.h24_count));
  if (parks.count != null) set('edge-kpi-parks', fmt(parks.count));
  if (s3.powiats_covered != null) set('edge-kpi-powiats', `${s3.powiats_covered}<span class="stat-unit">/381</span>`);
  if (s3.frog_streets_count != null) set('edge-kpi-frogstreets', String(s3.frog_streets_count));

  // ep-parks-val / ep-parks-note
  if (parks.count != null) {
    set('ep-parks-val', fmt(parks.count));
    if (s.total_active) {
      const pct = ((parks.count / s.total_active) * 100).toFixed(1).replace('.', ',');
      set('ep-parks-note', `sklepow (${pct}%) w parkach krajobrazowych i otulinach`);
    }
  }

  // ep-isolated-val from neighbor_stats loner
  const loner = ns.loner || {};
  if (loner.nearest_neighbor_distance_meters) {
    const km = (loner.nearest_neighbor_distance_meters / 1000).toFixed(1).replace('.', ',');
    set('edge-kpi-isolated', `${km}<span class="stat-unit"> km</span>`);
    set('ep-isolated-val', `${km} km`);
    if (loner.city) set('ep-isolated-city', `${loner.city}${loner.voivodeship ? ', ' + loner.voivodeship : ''}`);
    if (loner.street) set('ep-isolated-street', loner.street);
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
    set('ep-frogstreet-note', `Zabka przy ulicy Zielonej Zabki - jeden z ${cnt} sklepow na ulicach z zabim motywem.`);
  }
}

export function renderEdge(){
  startTabParticles('particles-edge',[96,200,148],42);
  _updateEdgeHeroLede();
  renderEdgeKPIs();
  renderCiekawostkiKNN();
  renderCiekawostkiParks();
  renderCiekawostkiStreets();
  renderKraniec();
}

export function jumpToFact(id) { selectFact(id); }
export function jumpBack() {}
export function jumpToH24() {}
export function jumpToParks() {}

