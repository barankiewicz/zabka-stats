export const MACRO = {
  pomorskie:'North','warmińsko-mazurskie':'North','kujawsko-pomorskie':'North',podlaskie:'North',
  'dolnośląskie':'West',zachodniopomorskie:'West',lubuskie:'West',opolskie:'West',
  mazowieckie:'Center','łódzkie':'Center','świętokrzyskie':'Center',wielkopolskie:'Center',
  'śląskie':'South','małopolskie':'South',podkarpackie:'South',lubelskie:'South',
};

export const C = {
  green:'#00c060',amber:'#f5a623',red:'#e85d2f',teal:'#00b4c8',
  bg:'#0d0d14',surface:'#16161f',s2:'#1e1e2e',muted:'#7a7a90',axis:'#2a2a3a',ink:'#e8e8f0',
  North:'#4a9eff',West:'#00c8a0',Center:'#00c060',South:'#f5a623'
};

export const STATE = { tab:'siec', filter:null };

export const annotPlugin = {
  id:'annot',
  beforeDraw(chart){
    const{ctx,chartArea:ca,scales,options:{refLines=[],shadedBands=[]}}=chart;
    shadedBands.forEach(({x1,x2,color})=>{
      const s=scales.x;if(!s)return;
      const px1=s.getPixelForValue(x1),px2=s.getPixelForValue(x2);
      ctx.save();ctx.fillStyle=color||'rgba(255,255,255,.08)';
      ctx.fillRect(Math.min(px1,px2),ca.top,Math.abs(px2-px1),ca.height);ctx.restore();
    });
    refLines.forEach(({value,axis='y',color='#7a7a90'})=>{
      const s=axis==='x'?scales.x:scales.y;if(!s)return;
      const p=s.getPixelForValue(value);
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=1;ctx.setLineDash([5,4]);
      ctx.beginPath();
      if(axis==='x'){ctx.moveTo(p,ca.top);ctx.lineTo(p,ca.bottom)}
      else{ctx.moveTo(ca.left,p);ctx.lineTo(ca.right,p)}
      ctx.stroke();ctx.restore();
    });
  }
};
