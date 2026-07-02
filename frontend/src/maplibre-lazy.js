// Lazy, cached loader for the heavy maplibre-map module (which pulls in
// maplibre-gl, ~280 KB gz). Every tab that draws a map called `import(
// '../maplibre-map.js')` behind its own `_mlibP ??= ...` guard; this centralizes
// that one-shot import so the pattern is not copy-pasted per tab.
//
// ES module imports are singletons, so the returned promise resolves to the same
// module instance for every caller. Each tab still destructures the exact
// exports it uses from the resolved module.
let _p;
export function loadMaplibre() {
  return _p ??= import('./maplibre-map.js');
}
