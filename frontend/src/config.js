import { getLang } from './i18n.js';

export const MACRO = {
  pomorskie:'North','warmińsko-mazurskie':'North','kujawsko-pomorskie':'North',podlaskie:'North',
  'dolnośląskie':'West',zachodniopomorskie:'West',lubuskie:'West',opolskie:'West',
  mazowieckie:'Center','łódzkie':'Center','świętokrzyskie':'Center',wielkopolskie:'Center',
  'śląskie':'South','małopolskie':'South',podkarpackie:'South',lubelskie:'South',
};

export const C = {
  green:'#84c341',greenBright:'#a6e84a',amber:'#f2a359',red:'#e8693d',teal:'#4dd0b1',
  bg:'#0a120a',surface:'#0f1b0e',s2:'#0c160b',muted:'#93a487',axis:'rgba(140,200,80,.14)',ink:'#eef3e6',
  North:'#4dd0b1',West:'#a6e84a',Center:'#84c341',South:'#f2a359'
};

export const STATE = { tab:'siec' };

export function interpolateColorRamp(stops, t) {
  t=Math.max(0,Math.min(1,t));
  const seg=t*(stops.length-1),i=Math.min(stops.length-2,Math.floor(seg)),u=seg-i;
  const h=k=>[parseInt(k.slice(1,3),16),parseInt(k.slice(3,5),16),parseInt(k.slice(5,7),16)];
  const a=h(stops[i]),b=h(stops[i+1]);
  return`rgb(${Math.round(a[0]+(b[0]-a[0])*u)},${Math.round(a[1]+(b[1]-a[1])*u)},${Math.round(a[2]+(b[2]-a[2])*u)})`;
}

// Green "fingerprint" color ramp, single source of truth. Lives here (a
// dependency-light module) rather than in maplibre-map.js so the bubble chart
// and the siec canvas scenes can use it without pulling in the ~280 KB MapLibre
// chunk. Consumers: bubble.js, siec.js, and the maplibre choropleths.
export const FP_STOPS = ['#103d1d','#1d5a28','#2f7d2e','#5aa82e','#84c341','#a6e84a','#c8f06a'];
export function fpRamp(t){
  return interpolateColorRamp(FP_STOPS, t);
}

// GRAN ramp: dark forest green (least) up to the Zabka brand green #84c341
// (most) - capped there rather than running up to fpRamp's brighter lime.
// Single source of truth for every "more/higher = lighter" choropleth+bar
// pairing: the GRAN map/bar chart (siec.js) and the InPost ratio choropleth
// (spoleczenstwo.js) both read off this exact ramp, so a color always means
// the same thing across both. t=1 is always the highest value in view.
export const GRAN_RAMP_STOPS=['#233d1a','#3b5f24','#54802e','#6ca237','#84c341'];
export function granRamp(t){
  return interpolateColorRamp(GRAN_RAMP_STOPS, t);
}
// Same stops as a MapLibre 'interpolate' expression, for fill-color/fill-extrusion-color paint properties.
export const GRAN_FILL_STOPS=[
  'interpolate',['linear'],['get','_t'],
  0,GRAN_RAMP_STOPS[0], 0.25,GRAN_RAMP_STOPS[1], 0.5,GRAN_RAMP_STOPS[2], 0.75,GRAN_RAMP_STOPS[3], 1,GRAN_RAMP_STOPS[4]];

// draws small value labels at the end of each bar; opt-in per chart via
// options.plugins.barLabels = { decimals?: number, thousands?: boolean, color?: hex }
//
// IMPORTANT: never put a function in this option object. Chart.js wraps
// options.plugins.<id> in a scriptable-resolution proxy, and reading a
// function-valued key calls it with a chart-context arg (not a number). A
// formatter like `v=>v.toFixed(2)` then throws inside draw(), which kills
// Chart's shared animator and freezes the entry animation of every chart on the
// page. So formatting is described declaratively (decimals/thousands) instead.
export const barValueLabels = {
  id:'barLabels',
  afterDatasetsDraw(chart){
    const opt=chart.options.plugins&&chart.options.plugins.barLabels;
    // Chart.js auto-creates an empty {} for every registered plugin, and {} is
    // truthy — so only draw when a chart actually opted in with a config key.
    if(!opt||Object.keys(opt).length===0)return;
    const{ctx}=chart;
    const horizontal=chart.options.indexAxis==='y';
    const format=v=>{
      if(typeof v!=='number'||isNaN(v))return'';
      let s;
      if(opt.decimals!=null) s=getLang()==='en'?v.toFixed(opt.decimals):v.toFixed(opt.decimals).replace('.',',');
      else if(opt.thousands) s=v.toLocaleString(getLang()==='en'?'en-US':'pl-PL');
      else s=String(v);
      if(opt.suffix) s+=opt.suffix;
      return s;
    };
    ctx.save();
    ctx.fillStyle=opt.color||C.muted;
    ctx.font=`500 10px 'JetBrains Mono',monospace`;
    chart.data.datasets.forEach((ds,di)=>{
      const meta=chart.getDatasetMeta(di);
      if(meta.hidden||(opt.onlyBars&&meta.type==='line'))return;
      meta.data.forEach((el,i)=>{
        const raw=ds.data[i];if(raw==null||raw===0)return;
        const txt=format(raw);
        if(horizontal){
          ctx.textAlign='left';ctx.textBaseline='middle';
          ctx.fillStyle=opt.color||C.muted;
          ctx.fillText(txt,el.x+5,el.y);
        }else if(opt.inside){
          const barH=el.base-el.y;
          if(barH<18){
            ctx.textAlign='center';ctx.textBaseline='bottom';
            ctx.fillStyle=opt.color||C.muted;
            ctx.fillText(txt,el.x,el.y-20);
          }else{
            ctx.textAlign='center';ctx.textBaseline='top';
            ctx.fillStyle='rgba(10,18,10,.85)';
            ctx.fillText(txt,el.x,el.y+5);
          }
        }else{
          ctx.textAlign='center';ctx.textBaseline='bottom';
          ctx.fillStyle=opt.color||C.muted;
          ctx.fillText(txt,el.x,el.y-4);
        }
      });
    });
    ctx.restore();
  }
};

export const annotPlugin = {
  id:'annot',
  beforeDraw(chart){
    const{ctx,chartArea:ca,scales}=chart;
    if(!ca)return;
    const pluginOpts=(chart.options.plugins&&chart.options.plugins.annot)||{};
    const{shadedBands=[]}=pluginOpts;
    shadedBands.forEach(({x1,x2,color})=>{
      const s=scales.x;if(!s)return;
      const px1=s.getPixelForValue(x1),px2=s.getPixelForValue(x2);
      ctx.save();ctx.fillStyle=color||'rgba(255,255,255,.08)';
      ctx.fillRect(Math.min(px1,px2),ca.top,Math.abs(px2-px1),ca.height);ctx.restore();
    });
  },
  afterDraw(chart){
    const{ctx,chartArea:ca,scales}=chart;
    if(!ca)return;
    const pluginOpts=(chart.options.plugins&&chart.options.plugins.annot)||{};
    const{refLines=[]}=pluginOpts;
    if(!refLines.length)return;
    // derive animation progress from the first visible bar element
    let ap=1;
    const meta0=chart.getDatasetMeta(0);
    if(meta0&&meta0.data&&meta0.data.length){
      const e=meta0.data[0];
      if(e&&e.x!=null&&e.base!=null){
        const finalX=chart.scales.x&&chart.scales.x.getPixelForValue(chart.data.datasets[0].data[0]);
        const span=finalX-e.base;
        if(finalX!=null&&span>0.5){ap=(e.x-e.base)/span;ap=Math.max(0,Math.min(1,ap))}
      }
    }
    refLines.forEach(({value,axis='y',color='#7a7a90',lineWidth=1,label,labelColor})=>{
      const s=axis==='x'?scales.x:scales.y;if(!s)return;
      const p=s.getPixelForValue(value);
      const fromBottom=ca.bottom-(ca.bottom-ca.top)*ap;
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.setLineDash([5,4]);
      ctx.beginPath();
      if(axis==='x'){
        ctx.moveTo(p,ca.bottom);
        ctx.lineTo(p,Math.max(fromBottom,ca.top));
      }else{
        ctx.moveTo(ca.left,p);
        ctx.lineTo(ca.right,p);
      }
      ctx.stroke();
      if(label){
        const lc=labelColor||color;
        ctx.save();
        if(axis==='x'){
          ctx.translate(p,ca.top-8);ctx.rotate(-Math.PI/2);
        }else{
          ctx.translate(p,ca.top+14);ctx.rotate(-Math.PI/2);
        }
        ctx.fillStyle=lc;ctx.font='bold 10px JetBrains Mono,monospace';
        ctx.textAlign='center';ctx.textBaseline='bottom';
        ctx.fillText(label,0,-2);ctx.restore();
      }
      ctx.restore();
    });
  }
};


