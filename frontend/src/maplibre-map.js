// Shared MapLibre GL primitives for all dashboard maps.
// Importing this module also pulls in the MapLibre CSS once; both lazy tab
// chunks (siec, spoleczenstwo) import this, so MapLibre lands in whichever
// chunk loads first and is shared.
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { t } from './i18n.js';

export { maplibregl };

// Thrown by createMap() when the browser refuses to give us a WebGL context
// (headless / RDP / hardware acceleration disabled). Callers catch this and
// render a static "mapa niedostępna" notice instead so the rest of the page
// keeps working.
export class WebGLUnavailableError extends Error {
  constructor() {
    super('WebGL is currently disabled');
    this.name = 'WebGLUnavailableError';
  }
}

// Probe once at module load. We try WebGL2 first (which MapLibre prefers)
// and fall back to WebGL1, the same way the library does internally.
// Browsers report the capability but refuse the actual context until GPU
// acceleration is enabled - the only reliable check is to ask for one.
function _probeWebGL() {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
    return !!gl;
  } catch (e) {
    return false;
  }
}
export const webglAvailable = _probeWebGL();

// Poland bounding box [SW [lng,lat], NE [lng,lat]] and visual center.
export const PL_BOUNDS = [[14.08, 49.00], [24.16, 54.84]];
export const PL_CENTER = [19.3, 52.05];

// ---- Dark, tile-free base style ----
// No raster sources. Background near-black green; voivodeship polygons are
// added per-map via addVoivodeshipLayers. Keeps the maps offline-friendly.
export function darkStyle() {
  return {
    version: 8,
    sources: {},
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#08110a' } },
    ],
  };
}

// Text for the overlay MapLibre shows when a scroll/touch gesture is blocked
// by cooperativeGestures (e.g. "ctrl + scroll to zoom"). Matches the wording
// of the custom .map-zoom-hint labels already on the growth map / Atlas.
function cooperativeLocale() {
  return {
    'CooperativeGesturesHandler.WindowsHelpText': t('map_coop_win'),
    'CooperativeGesturesHandler.MacHelpText': t('map_coop_mac'),
    'CooperativeGesturesHandler.MobileHelpText': t('map_coop_mobile'),
  };
}

// ---- Map factory ----
// opts: { center, zoom, pitch, bearing, minZoom, maxZoom, maxBounds,
//         dragRotate, pitchWithRotate, scrollZoom, cooperativeGestures }
// cooperativeGestures defaults to true everywhere: plain scroll never hijacks
// the page, only ctrl/Cmd + scroll (or two-finger touch) zooms the map.
export function createMap(container, opts = {}) {
  if (!webglAvailable) throw new WebGLUnavailableError();
  const map = new maplibregl.Map({
    container,
    style: darkStyle(),
    center: opts.center || PL_CENTER,
    zoom: opts.zoom != null ? opts.zoom : 5.7,
    pitch: opts.pitch || 0,
    bearing: opts.bearing || 0,
    minZoom: opts.minZoom != null ? opts.minZoom : 5,
    maxZoom: opts.maxZoom != null ? opts.maxZoom : 14,
    maxBounds: opts.maxBounds || null,
    dragRotate: opts.dragRotate != null ? opts.dragRotate : false,
    pitchWithRotate: opts.pitchWithRotate != null ? opts.pitchWithRotate : false,
    touchPitch: opts.touchPitch != null ? opts.touchPitch : false,
    scrollZoom: opts.scrollZoom != null ? opts.scrollZoom : true,
    doubleClickZoom: opts.doubleClickZoom != null ? opts.doubleClickZoom : true,
    cooperativeGestures: opts.cooperativeGestures != null ? opts.cooperativeGestures : true,
    locale: opts.locale || cooperativeLocale(),
    attributionControl: opts.attributionControl || false,
    antialias: true,
  });
  return map;
}

// Render a small dark "mapa niedostępna" notice inside the map container.
// The container keeps its CSS height so the rest of the layout doesn't jump;
// the notice explains the missing GPU and what to do.
export function showMapUnavailable(container, opts = {}) {
  if (!container) return;
  const msg = opts.message || t('map_unavailable_default');
  const hint = opts.hint || t('map_unavailable_hint');
  // Clear anything MapLibre / a previous render left behind
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'map-unavailable';
  wrap.innerHTML = `
    <div class="map-unavailable-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/>
        <path d="M9 4v16"/><path d="M15 6v16"/>
      </svg>
    </div>
    <div class="map-unavailable-title">${msg}</div>
    <div class="map-unavailable-hint">${hint}</div>
  `;
  container.appendChild(wrap);
}

export function fitPoland(map, padding = 6, opts = {}) {
  try {
    map.fitBounds(PL_BOUNDS, { padding, ...opts });
  } catch (e) {
    console.debug('fitPoland skipped (map not fully loaded):', e.message);
  }
}

// ---- Voivodeship base layers ----
// Adds a geojson source + a fill layer + a line layer. Returns the ids.
// paint overrides let choropleths drive the fill color.
export function addVoivodeshipLayers(map, wojGeo, sourceId = 'woj', {
  fillColor = '#11240d',
  fillOpacity = 0.55,
  lineColor = 'rgba(140,200,80,.18)',
  lineWidth = 1,
  fillId = sourceId + '-fill',
  lineId = sourceId + '-line',
  before,
} = {}) {
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, { type: 'geojson', data: wojGeo });
  }
  if (!map.getLayer(fillId)) {
    map.addLayer({
      id: fillId, type: 'fill', source: sourceId, before,
      paint: { 'fill-color': fillColor, 'fill-opacity': fillOpacity },
    });
  }
  if (!map.getLayer(lineId)) {
    map.addLayer({
      id: lineId, type: 'line', source: sourceId, before,
      paint: { 'line-color': lineColor, 'line-width': lineWidth },
    });
  }
  return { sourceId, fillId, lineId };
}

// Compute a bounding-box center per feature for label placement. Good enough
// for the 16 Polish voivodeships (all roughly convex).
export function featureBBoxCenter(feature) {
  const g = feature.geometry || {};
  let coords = [];
  if (g.type === 'Polygon') coords = g.coordinates[0] || [];
  else if (g.type === 'MultiPolygon') {
    let maxLen = 0, biggest = [];
    for (const poly of g.coordinates) { if ((poly[0] || []).length > maxLen) { maxLen = poly[0].length; biggest = poly[0]; } }
    coords = biggest;
  }
  if (!coords.length) return null;
  let loX = Infinity, loY = Infinity, hiX = -Infinity, hiY = -Infinity;
  for (const [x, y] of coords) { if (x < loX) loX = x; if (y < loY) loY = y; if (x > hiX) hiX = x; if (y > hiY) hiY = y; }
  return [(loX + hiX) / 2, (loY + hiY) / 2];
}

// [[lat,lon],...] or [[lat,lon,extra],...] -> Point FeatureCollection.
// propFn(lat,lon,extra,index) returns the per-feature properties (optional).
export function pointsToFC(pairs, propFn) {
  const features = pairs.map((p, i) => {
    const lat = Array.isArray(p) ? p[0] : (p && p.lat);
    const lon = Array.isArray(p) ? p[1] : (p && p.lon);
    const props = propFn ? propFn(lat, lon, p, i) : {};
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props || {} };
  }).filter((f) => typeof f.geometry.coordinates[0] === 'number');
  return { type: 'FeatureCollection', features };
}

// Destination point on a sphere (haversine). Returns [lng,lat].
export function destination(lat, lon, bearingDeg, distM) {
  const R = 6371000, br = bearingDeg * Math.PI / 180;
  const l1 = lat * Math.PI / 180, ln1 = lon * Math.PI / 180;
  const dr = distM / R;
  const l2 = Math.asin(Math.sin(l1) * Math.cos(dr) + Math.cos(l1) * Math.sin(dr) * Math.cos(br));
  const ln2 = ln1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(l1), Math.cos(dr) - Math.sin(l1) * Math.sin(l2));
  return [ln2 * 180 / Math.PI, l2 * 180 / Math.PI];
}

// Geodesic circle as a closed Polygon FeatureCollection - the MapLibre
// equivalent of Leaflet's L.circle(latlng, {radius}). Used for the Bieszczady
// "void" highlight.
export function geoCircle(lat, lon, radiusM, n = 64) {
  const ring = [];
  for (let i = 0; i <= n; i++) {
    ring.push(destination(lat, lon, (i / n) * 360, radiusM));
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] };
}

// Compute a [SW,NE] bounds pair [[minLng,minLat],[maxLng,maxLat]] from a list
// of [lat,lon] points (or {lat,lon}). MapLibre fitBounds-friendly.
export function boundsOf(points) {
  let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180;
  for (const p of points) {
    const lat = Array.isArray(p) ? p[0] : p.lat;
    const lon = Array.isArray(p) ? p[1] : p.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    if (lat < minLat) minLat = lat;
    if (lon < minLng) minLng = lon;
    if (lat > maxLat) maxLat = lat;
    if (lon > maxLng) maxLng = lon;
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}
