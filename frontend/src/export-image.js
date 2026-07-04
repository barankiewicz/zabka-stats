// S3: per-visual "copy image" / "download PNG" export, shared by every
// Chart.js canvas, plain Canvas 2D scene, and MapLibre GL map on the
// dashboard (wired up from main.js's EXPORTABLES registry). Composes the
// chart's own bitmap onto a fresh canvas with a title line and a discreet
// domain watermark, at 2x scale - people will screenshot these regardless,
// this just makes the shared artifact carry the domain and look deliberate.

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

// Compose title + source canvas bitmap + watermark footer onto one offscreen
// canvas at `scale`x. Returns the composed canvas (not yet a Blob).
export function composeExportCanvas(sourceCanvas, {title='', scale=2}={}){
  const srcW = sourceCanvas.width, srcH = sourceCanvas.height;
  const padX = 28*scale, padTop = title ? 64*scale : 28*scale, padBottom = 40*scale;
  const out = document.createElement('canvas');
  out.width = srcW + padX*2;
  out.height = srcH + padTop + padBottom;
  const ctx = out.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, out.width, out.height);

  if(title){
    ctx.fillStyle = INK;
    ctx.font = `700 ${17*scale}px "Bricolage Grotesque", sans-serif`;
    ctx.textBaseline = 'top';
    wrapText(ctx, title, padX, 22*scale, out.width - padX*2, 23*scale, 2);
  }

  ctx.drawImage(sourceCanvas, padX, padTop, srcW, srcH);

  ctx.fillStyle = MUTED;
  ctx.font = `500 ${11*scale}px "JetBrains Mono", monospace`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'right';
  ctx.fillText(WATERMARK, out.width - padX, out.height - 12*scale);
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
