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
// forces one more frame; copying the pixels to a plain 2D canvas synchronously
// inside the 'render' callback catches them before the buffer clears - and,
// unlike handing back the live canvas itself, survives whatever async work
// (rasterizing another visual in the same panel, e.g.) happens before the
// composed export actually gets drawn.
export function getMapLibreCanvas(map){
  return new Promise((resolve, reject)=>{
    if(!map) return reject(new Error('map not ready'));
    map.triggerRepaint();
    map.once('render', ()=>{
      const src = map.getCanvas();
      const copy = document.createElement('canvas');
      copy.width = src.width;
      copy.height = src.height;
      copy.getContext('2d').drawImage(src, 0, 0);
      resolve(copy);
    });
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
// text-anchor is scoped to bubble's own classes rather than a blanket `text`
// rule - other SVGs registered later (the InPost dumbbell chart) set
// text-anchor via attribute per-element, and a blanket CSS rule would
// override those attributes and wreck their alignment.
const _SVG_EMBED_STYLES = `
  text { font-family: "IBM Plex Sans", sans-serif; }
  .bubble { stroke: none; }
  .bubble.rem { stroke: #a6e84a8c; stroke-width: 1.2; stroke-dasharray: 5 3; }
  .b-main { font-family: "IBM Plex Sans", sans-serif; font-weight: 700; fill: #fff; text-anchor: middle; }
  .b-sub  { font-family: "JetBrains Mono", monospace; font-weight: 700; fill: #84c341; text-anchor: middle; }
  .b-sub.bright { fill: #a6e84a; }
  .b-sub2 { font-family: "JetBrains Mono", monospace; fill: #a6e84a; text-anchor: middle; }
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

  // Stat call-outs that sit next to (or, for the growth map's year readout,
  // directly on top of) a chart's canvas - the kNN "maks." line, the
  // coverage donut's raw count/caption, the big year number over the growth
  // map. Drawn after the visuals above so an overlay like the year readout
  // doesn't get painted over by the map canvas underneath it.
  [
    { sel: '.statline', size: 13, weight: 600, family: '"JetBrains Mono", monospace', color: INK },
    { sel: '.powiat-frac', size: 21, weight: 700, family: '"JetBrains Mono", monospace', color: INK },
    { sel: '.powiat-cap', size: 13, weight: 500, family: '"IBM Plex Sans", sans-serif', color: MUTED },
    { sel: '.growth-year', size: 35, weight: 800, family: '"Bricolage Grotesque", sans-serif', color: '#a6e84a' },
  ].forEach(({sel, size, weight, family, color}) => {
    drawText(panelEl.querySelector(sel), { font: `${weight} ${size*scale}px ${family}`, size: size*scale, color, maxLines: 1 });
  });

  // Ref-line / trend-color legends (GRAN + kNN + elevation's avg/median,
  // the econ maps' below/on/above-trend swatches, InPost's dot legend) -
  // each is a row of small items with a color swatch (a dashed line, a
  // filled chip, or a dot) next to a label. Every item keeps its own
  // on-screen rect, so a flex-wrapped legend lays out the way it actually
  // looks without reimplementing that wrapping here.
  const drawLegendItems = (items, font) => {
    items.forEach(item => {
      const text = item.textContent && item.textContent.trim();
      if(!text) return;
      const p = rel(item);
      if(p.w<=0 || p.h<=0) return;
      const swatch = item.querySelector('.lg-line, .econ-lg-swatch, .dot-legend-swatch');
      const itemColor = getComputedStyle(item).color;
      let swatchColor = itemColor;
      if(swatch){
        const cs = getComputedStyle(swatch);
        if(cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent'){
          swatchColor = cs.backgroundColor;
        } else if(cs.borderTopColor){
          swatchColor = cs.borderTopColor;
        }
      }
      const sw = 12*scale, sh = 6*scale;
      let textX = p.x;
      if(swatch){
        ctx.fillStyle = swatchColor;
        ctx.fillRect(p.x, p.y + (p.h-sh)/2, sw, sh);
        textX = p.x + sw + 6*scale;
      }
      ctx.fillStyle = itemColor;
      ctx.font = font;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, textX, p.y + p.h/2);
    });
  };
  drawLegendItems(panelEl.querySelectorAll('.gran-ref-legend .lg-item'), `500 ${11.5*scale}px "JetBrains Mono", monospace`);
  drawLegendItems(panelEl.querySelectorAll('.econ-map-legend .econ-lg-item'), `500 ${13.5*scale}px "IBM Plex Sans", sans-serif`);
  drawLegendItems(panelEl.querySelectorAll('.dot-legend .dot-legend-item'), `500 ${12*scale}px "IBM Plex Sans", sans-serif`);
  ctx.textBaseline = 'top';

  // Per-region value labels on the GRAN/InPost choropleths are MapLibre
  // Markers - real DOM nodes MapLibre repositions to track the map's pan/
  // zoom, not pixels baked into the WebGL canvas above. Drawn last (on top
  // of the map already drawn in visuals) with a dark stroke behind the fill
  // for the same reason the CSS has a text-shadow: the map color underneath
  // varies, so plain fill text can vanish over a light tile.
  panelEl.querySelectorAll('.woj-val-label-marker').forEach(el => {
    const text = el.textContent && el.textContent.trim();
    if(!text) return;
    const p = rel(el);
    if(p.w<=0 || p.h<=0) return;
    ctx.font = `600 ${11*scale}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3*scale;
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeText(text, p.x + p.w/2, p.y + p.h/2);
    ctx.fillStyle = '#c8d4c0';
    ctx.fillText(text, p.x + p.w/2, p.y + p.h/2);
  });
  ctx.textAlign = 'left';

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
