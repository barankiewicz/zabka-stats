// S1+S3: per-panel "copy image" / "download PNG" export, shared by every
// panel that holds a Chart.js canvas, a plain Canvas 2D scene, or a MapLibre
// GL map (wired up from main.js's EXPORTABLES + panel-toolbar registry).
// Composes the whole panel - title, subtitle, caveat, every visual it holds -
// onto a fresh canvas with a discreet domain watermark, at 2x scale - people
// will screenshot these regardless, this just makes the shared artifact
// carry the domain and look deliberate.

const WATERMARK = 'zabkozbior.barankiewicz.dev';
const BG = '#0a120a';
const INK = '#eef3e6';
const MUTED = 'rgba(147,164,135,.75)';

// MapLibre canvases only hold valid pixels for the instant a 'render' event
// fires (no preserveDrawingBuffer, on purpose - that flag costs memory/perf
// for every frame just to support the rare export click). triggerRepaint()
// forces one more frame; grabbing the canvas synchronously inside the
// 'render' callback catches it before the buffer clears.
export function getMapLibreCanvas(map){
  return new Promise((resolve, reject)=>{
    if(!map) return reject(new Error('map not ready'));
    map.triggerRepaint();
    map.once('render', ()=>resolve(map.getCanvas()));
  });
}

// Rasterize an SVG element to a canvas at 2x scale, so it can be drawn
// alongside the rest of the panel by composePanelCanvas. The SVG is
// cloned first (so the live DOM is untouched) and the styles that
// normally come from the page stylesheet (font-family via CSS var, the
// remainder stroke, the text-anchor for labels) are inlined into a
// <style> block inside the clone - when the SVG is loaded standalone
// via an Image, it has no access to the parent stylesheet, so anything
// that lived there needs to come along in the serialization. Dynamic
// attributes set by D3 (fill, font-size, the bubble radius r) are
// already on the elements and survive the round trip.
const _SVG_EMBED_STYLES = `
  text { text-anchor: middle; }
  .bubble { stroke: none; }
  .bubble.rem { stroke: #a6e84a8c; stroke-width: 1.2; stroke-dasharray: 5 3; }
  .b-main { font-family: "IBM Plex Sans", sans-serif; font-weight: 700; fill: #fff; }
  .b-sub  { font-family: "JetBrains Mono", monospace; font-weight: 700; fill: #84c341; }
  .b-sub.bright { fill: #a6e84a; }
  .b-sub2 { font-family: "JetBrains Mono", monospace; fill: #a6e84a; }
`;

export async function svgToCanvas(svgEl, { scale = 2 } = {}){
  // Some D3 SVGs only set viewBox + the live-render width/height attributes
  // (or no width at all), so clone and pin explicit dimensions before
  // serializing - otherwise the rasterized image comes out at 0x0.
  const rect = svgEl.getBoundingClientRect();
  const w = rect.width || parseFloat(svgEl.getAttribute('width')) || 0;
  const h = rect.height || parseFloat(svgEl.getAttribute('height')) || 0;
  if (!w || !h) throw new Error('svg has no measurable size');

  const clone = svgEl.cloneNode(true);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  styleEl.textContent = _SVG_EMBED_STYLES;
  clone.insertBefore(styleEl, clone.firstChild);

  // XMLSerializer produces a self-contained SVG document. Base64-encode and
  // hand it to an Image - loading the SVG as an image is what drops access
  // to the parent stylesheet, hence the embedded <style> above.
  const xml = new XMLSerializer().serializeToString(clone);
  const svg64 = btoa(unescape(encodeURIComponent(xml)));
  const dataUrl = 'data:image/svg+xml;base64,' + svg64;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('svg rasterization failed'));
    img.src = dataUrl;
  });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines){
  const words = text.split(' ');
  let line = '', ly = y, lines = 0;
  for(const w of words){
    const test = line ? line+' '+w : w;
    if(ctx.measureText(test).width > maxWidth && line){
      ctx.fillText(line, x, ly);
      line = w; ly += lineHeight; lines++;
      if(maxLines && lines >= maxLines-1){ line += '…'; break; }
    } else line = test;
  }
  if(line) ctx.fillText(line, x, ly);
  return ly + lineHeight;
}

// Compose a whole panel - title, subtitle, caveat, and every chart/map it
// holds - onto one offscreen canvas at `scale`x, using each piece's real
// on-screen position relative to `panelEl` (so a two-visual panel like GRAN's
// chart+choropleth or MAPA's map+calendar comes out laid out the way it
// actually looks, without hand-coding every panel's layout here).
// `visuals` is [{canvas, el}] - `canvas` the bitmap to draw, `el` the DOM
// element whose bounding box gives its position/size within the panel.
export async function composePanelCanvas(panelEl, visuals, {scale=2}={}){
  const panelRect = panelEl.getBoundingClientRect();
  const padSide = 20*scale, padBottom = 40*scale;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(panelRect.width*scale));
  out.height = Math.max(1, Math.round(panelRect.height*scale)) + padBottom;
  const ctx = out.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, out.width, out.height);

  const rel = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: (r.left - panelRect.left) * scale,
      y: (r.top - panelRect.top) * scale,
      w: r.width * scale,
      h: r.height * scale,
    };
  };

  const drawText = (el, {font, size, color, maxLines}) => {
    const text = el && el.textContent && el.textContent.trim();
    if(!text) return;
    const p = rel(el);
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textBaseline = 'top';
    wrapText(ctx, text, p.x, p.y, out.width - p.x - padSide, size*1.35, maxLines);
  };

  drawText(panelEl.querySelector('.card-title'), {
    font: `700 ${15*scale}px "Bricolage Grotesque", sans-serif`, size: 15*scale, color: INK, maxLines: 2,
  });
  drawText(panelEl.querySelector('.card-sub'), {
    font: `500 ${13*scale}px "IBM Plex Sans", sans-serif`, size: 13*scale, color: MUTED, maxLines: 2,
  });
  drawText(panelEl.querySelector('.caveat'), {
    font: `500 ${12*scale}px "IBM Plex Sans", sans-serif`, size: 12*scale, color: MUTED, maxLines: 3,
  });

  visuals.forEach(({canvas, el}) => {
    if(!canvas || !el) return;
    const p = rel(el);
    if(p.w <= 0 || p.h <= 0) return;
    ctx.drawImage(canvas, p.x, p.y, p.w, p.h);
  });

  ctx.fillStyle = MUTED;
  ctx.font = `500 ${12*scale}px "JetBrains Mono", monospace`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'right';
  ctx.fillText(WATERMARK, out.width - padSide, out.height - 12*scale);
  ctx.textAlign = 'left';

  return out;
}

export function canvasToPngBlob(canvas){
  return new Promise((resolve, reject)=>{
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
  });
}

export function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

export async function copyBlobToClipboard(blob){
  if(!navigator.clipboard || !window.ClipboardItem) throw new Error('Clipboard image API unavailable');
  await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
}
