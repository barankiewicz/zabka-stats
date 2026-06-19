import L from 'leaflet';
import { C, MACRO } from './config.js';
import { CHARTS, MAPS } from './state.js';

export function era(yr){if(yr<=2009)return'#0a3018';if(yr<=2019)return'#1a6035';if(yr<=2022)return'#40c070';return'#80ff90'}
export function eraName(yr){if(yr<=2009)return'Wczesna siec';if(yr<=2019)return'Wzrost';if(yr<=2022)return'Przyspieszenie';return'Boom'}
export function fmt(n){return(+n).toLocaleString('pl-PL')}
export function macroCol(v){return C[MACRO[v]]||C.green}
// single production font set (the live switcher was removed; see CLAUDE.md ch.4)
export function getFont(r){
  return{display:'Bricolage Grotesque',body:'IBM Plex Sans',mono:'JetBrains Mono'}[r];
}
export function destroyChart(id){if(CHARTS[id]){CHARTS[id].destroy();delete CHARTS[id]}}
export function projectPL(lat,lon,W,H){return{x:(lon-14.1)/(24.2-14.1)*W,y:(1-(lat-49)/(54.9-49))*H}}
export function leafletDark(id){
  if(MAPS[id])return MAPS[id];
  const map=L.map(id,{zoomControl:true,attributionControl:false});
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:18}).addTo(map);
  MAPS[id]=map;return map;
}
