// Shared MapLibre GL primitives for all dashboard maps.
// Importing this module also pulls in the MapLibre CSS once; both lazy tab
// chunks (siec, spoleczenstwo) import this, so MapLibre lands in whichever
// chunk loads first and is shared.
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export { maplibregl };

// Poland bounding box [SW [lng,lat], NE [lng,lat]] and visual center.
export const PL_BOUNDS = [[14.08, 49.00], [24.16, 54.84]];
export const PL_CENTER = [19.3, 52.05];

// ---- Color ramps (green) ----
// Used by every voivodeship choropleth and the growth-map era dots.
export const WOJ_STOPS = ['#132912', '#1e4019', '#2d6324', '#4a9228', '#72c133', '#a6e84a'];
const FP_STOPS  = ['#103d1d', '#1d5a28', '#2f7d2e', '#5aa82e', '#84c341', '#a6e84a', '#c8f06a'];

function _rampGen(stops) {
  return (t) => {
    t = Math.max(0, Math.min(1, t));
    const seg = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(seg));
    const u = seg - i;
    const a = hexToRgb(stops[i]);
    const b = hexToRgb(stops[i + 1]);
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)},${Math.round(a[1] + (b[1] - a[1]) * u)},${Math.round(a[2] + (b[2] - a[2]) * u)})`;
  };
}
export const wojRamp = _rampGen(WOJ_STOPS);
export const fpRamp  = _rampGen(FP_STOPS);

export function hexToRgb(hex) {
  if (!hex || hex[0] !== '#' || hex.length !== 7) return [132, 195, 65];
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
export function hexWithAlpha(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

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

// ---- Map factory ----
// opts: { center, zoom, pitch, bearing, minZoom, maxZoom, maxBounds,
//         dragRotate, pitchWithRotate, scrollZoom, cooperativeGestures }
export function createMap(container, opts = {}) {
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
    attributionControl: opts.attributionControl || false,
    antialias: true,
  });
  return map;
}

export function fitPoland(map, padding = 6) {
  try { map.fitBounds(PL_BOUNDS, { padding }); } catch (e) { /* map not ready */ }
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

// Build a GeoJSON FeatureCollection of one centroid point per woj feature,
// each carrying the same properties as the polygon. Used for value-label
// symbol layers (the MapLibre equivalent of Leaflet's permanent tooltips).
export function wojCentroids(wojGeo, extraProps = (f) => ({})) {
  const features = (wojGeo.features || [])
    .map((f) => {
      const c = featureBBoxCenter(f);
      if (!c) return null;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: c },
        properties: { ...(f.properties || {}), ...extraProps(f) },
      };
    })
    .filter(Boolean);
  return { type: 'FeatureCollection', features };
}

// Standard dark popup style helper. Returns a configured maplibregl.Popup.
export function darkPopup(lngLat, html, opts = {}) {
  return new maplibregl.Popup({
    closeButton: opts.closeButton != null ? opts.closeButton : false,
    closeOnClick: opts.closeOnClick != null ? opts.closeOnClick : true,
    maxWidth: opts.maxWidth || '280px',
    className: 'zab-popup',
  })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(opts.map);
}

// Dark-themed HTML Marker (replaces Leaflet divIcon markers like .mk).
// elFactory(label, color) builds the marker DOM; we wrap it in a Marker.
export function htmlMarker(lngLat, el, opts = {}) {
  return new maplibregl.Marker({ element: el, anchor: opts.anchor || 'center' })
    .setLngLat(lngLat);
}
