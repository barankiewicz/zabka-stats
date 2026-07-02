// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock WebGL context on canvas before imports so webglAvailable evaluates to true
vi.mock('maplibre-gl', () => {
  if (typeof document !== 'undefined') {
    const originalCreate = document.createElement;
    document.createElement = function(tag) {
      const el = originalCreate.call(document, tag);
      if (tag === 'canvas') {
        el.getContext = function(type) {
          if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
            return {};
          }
          return null;
        };
      }
      return el;
    };
  }

  return {
    default: {
      Map: class {
        constructor() {
          this._sources = {};
          this._layers = {};
        }
        on() {}
        addSource(id, src) { this._sources[id] = src; }
        addLayer(lay) { this._layers[lay.id] = lay; }
        getSource(id) { return this._sources[id]; }
        getLayer(id) { return this._layers[id]; }
        fitBounds() {}
      },
      Popup: class {
        setLngLat() { return this; }
        setHTML() { return this; }
        addTo() { return this; }
      },
      Marker: class {
        setLngLat() { return this; }
        addTo() { return this; }
      }
    }
  };
});

import {
  era,
  fmt,
  capName,
  macroCol,
  getFont,
  destroyChart,
  debounce,
  whenVisible,
  afterIdle,
  whenVisibleIdle,
  heroCount,
  wireCountUp,
  startTabParticles
} from '../src/utils.js';

import {
  destination,
  boundsOf,
  geoCircle,
  featureBBoxCenter,
  WebGLUnavailableError,
  webglAvailable,
  darkStyle,
  createMap,
  showMapUnavailable,
  fitPoland,
  addVoivodeshipLayers,
  pointsToFC
} from '../src/maplibre-map.js';

import { CHARTS } from '../src/state.js';
import { fpRamp, barValueLabels, annotPlugin } from '../src/config.js';

describe('Frontend Utilities', () => {
  it('formats numbers correctly (Polish locale style)', () => {
    const formatted = fmt(1234567);
    expect(formatted.replace(/\s/g, ' ')).toBe('1 234 567');
  });

  it('identifies era bands correctly', () => {
    expect(era(1999)).toBe('#2b531a');
    expect(era(2015)).toBe('#4a8a22');
    expect(era(2021)).toBe('#74bd2a');
    expect(era(2025)).toBe('#a6e84a');
  });

  describe('capName', () => {
    it('handles empty or null input', () => {
      expect(capName('')).toBe('');
      expect(capName(null)).toBe(null);
    });

    it('removes GUS prefix and postfix artefacts', () => {
      expect(capName('powiat bocheński')).toBe('Bocheński');
      expect(capName('M.st. Warszawa')).toBe('Warszawa');
      expect(capName('powiat bocheński od 2013')).toBe('Bocheński');
    });

    it('transforms all-caps string correctly', () => {
      expect(capName('WARMIŃSKO-MAZURSKIE')).toBe('Warmińsko-mazurskie');
      expect(capName('DOLNOŚLĄSKIE')).toBe('Dolnośląskie');
    });

    it('replaces only first letter if not all-caps', () => {
      expect(capName('bocheński')).toBe('Bocheński');
      expect(capName('Nowy Sącz')).toBe('Nowy Sącz');
    });
  });

  describe('macroCol', () => {
    it('returns colors matching config settings', () => {
      expect(macroCol('pomorskie')).toBe('#4dd0b1');
      expect(macroCol('dolnośląskie')).toBe('#a6e84a');
      expect(macroCol('śląskie')).toBe('#f2a359');
      expect(macroCol('unknown')).toBe('#84c341'); // fallback C.green
    });
  });

  describe('getFont', () => {
    it('returns the correct fonts', () => {
      expect(getFont('display')).toBe('Bricolage Grotesque');
      expect(getFont('body')).toBe('IBM Plex Sans');
      expect(getFont('mono')).toBe('JetBrains Mono');
    });
  });

  describe('destroyChart', () => {
    it('safely destroys chart if exists', () => {
      const mockDestroy = vi.fn();
      CHARTS['chart_test'] = { destroy: mockDestroy };
      destroyChart('chart_test');
      expect(mockDestroy).toHaveBeenCalled();
      expect(CHARTS['chart_test']).toBeUndefined();
    });

    it('does not throw if chart key does not exist or lacks destroy function', () => {
      expect(() => destroyChart('nonexistent')).not.toThrow();
      CHARTS['no_destroy'] = {};
      expect(() => destroyChart('no_destroy')).not.toThrow();
      expect(CHARTS['no_destroy']).toBeUndefined();
    });
  });

  describe('debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('coalesces rapid function calls', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 150);
      
      debounced('a');
      debounced('b');
      debounced('c');
      
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(150);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('c'); // debounce fires with the parameters of the last call
    });
  });

  describe('whenVisible, afterIdle, whenVisibleIdle', () => {
    it('runs whenVisible immediately if IntersectionObserver is undefined', () => {
      const originalIO = global.IntersectionObserver;
      delete global.IntersectionObserver;
      
      const fn = vi.fn();
      whenVisible(document.createElement('div'), fn);
      expect(fn).toHaveBeenCalled();
      
      global.IntersectionObserver = originalIO;
    });

    it('uses IntersectionObserver when available', () => {
      let callback = null;
      class MockObserver {
        constructor(cb) {
          callback = cb;
        }
        observe() {}
        disconnect() {}
      }
      global.IntersectionObserver = MockObserver;
      
      const fn = vi.fn();
      const el = document.createElement('div');
      whenVisible(el, fn);
      
      expect(fn).not.toHaveBeenCalled();
      // Simulate intersection
      callback([{ isIntersecting: true }], { disconnect: vi.fn() });
      expect(fn).toHaveBeenCalled();
    });

    it('runs afterIdle via requestIdleCallback if available', () => {
      const originalIdle = global.requestIdleCallback;
      const mockIdle = vi.fn(fn => fn());
      global.requestIdleCallback = mockIdle;
      
      const fn = vi.fn();
      afterIdle(fn);
      expect(mockIdle).toHaveBeenCalled();
      expect(fn).toHaveBeenCalled();
      
      global.requestIdleCallback = originalIdle;
    });

    it('runs afterIdle via setTimeout if requestIdleCallback is undefined', () => {
      vi.useFakeTimers();
      const originalIdle = global.requestIdleCallback;
      delete global.requestIdleCallback;

      const fn = vi.fn();
      afterIdle(fn);
      vi.advanceTimersByTime(300);
      expect(fn).toHaveBeenCalled();

      global.requestIdleCallback = originalIdle;
      vi.useRealTimers();
    });

    it('runs afterIdle via window load event if document.readyState is not complete', () => {
      vi.useFakeTimers();
      const originalIdle = global.requestIdleCallback;
      delete global.requestIdleCallback;

      Object.defineProperty(document, 'readyState', {
        get() { return 'loading'; },
        configurable: true
      });

      const fn = vi.fn();
      afterIdle(fn);
      expect(fn).not.toHaveBeenCalled();

      window.dispatchEvent(new Event('load'));
      vi.advanceTimersByTime(300);
      expect(fn).toHaveBeenCalled();

      Object.defineProperty(document, 'readyState', {
        get() { return 'complete'; },
        configurable: true
      });
      global.requestIdleCallback = originalIdle;
      vi.useRealTimers();
    });

    it('combines them in whenVisibleIdle', () => {
      vi.useFakeTimers();
      const originalIO = global.IntersectionObserver;
      delete global.IntersectionObserver;
      const originalIdle = global.requestIdleCallback;
      delete global.requestIdleCallback;

      const fn = vi.fn();
      const el = document.createElement('div');
      whenVisibleIdle(el, fn);

      // Dispatch load event in case readyState is loading, then advance timers
      window.dispatchEvent(new Event('load'));
      vi.advanceTimersByTime(300);
      expect(fn).toHaveBeenCalled();

      global.IntersectionObserver = originalIO;
      global.requestIdleCallback = originalIdle;
      vi.useRealTimers();
    });
  });

  describe('heroCount', () => {
    it('does nothing if element is missing', () => {
      expect(() => heroCount(null, 100)).not.toThrow();
    });

    it('sets element text to dash if total is falsy', () => {
      const el = document.createElement('div');
      heroCount(el, 0);
      expect(el.textContent).toBe('–');
    });

    it('animates count-up under normal motion preferences', () => {
      vi.useFakeTimers();
      const el = document.createElement('div');
      heroCount(el, 1000, 100);
      expect(el.dataset.heroDone).toBe('1');
      
      // Step the animation forward
      vi.advanceTimersByTime(100);
      expect(el.textContent).not.toBe('');
      vi.useRealTimers();
    });
  });

  describe('wireCountUp', () => {
    it('does nothing if root is missing or has no nodes', () => {
      expect(() => wireCountUp(null)).not.toThrow();
      const div = document.createElement('div');
      expect(() => wireCountUp(div)).not.toThrow();
    });

    it('wires up nodes and triggers count-up', () => {
      const div = document.createElement('div');
      div.innerHTML = `<span class="cnt" data-count="123.45" data-dec="2" data-suffix="%"></span>`;
      
      let callback = null;
      class MockObserver {
        constructor(cb) {
          callback = cb;
        }
        observe() {}
        unobserve() {}
      }
      global.IntersectionObserver = MockObserver;

      wireCountUp(div);
      
      // Trigger callback after wireCountUp registers it
      if (callback) {
        callback([{ isIntersecting: true, target: div.querySelector('.cnt') }]);
      }

      const el = div.querySelector('.cnt');
      expect(el.textContent).toContain('%');
    });
  });

  describe('startTabParticles', () => {
    it('returns immediately if canvas not found', () => {
      const cancel = startTabParticles('nonexistent');
      expect(typeof cancel).toBe('function');
      cancel();
    });

    it('starts animation loop and registers resize handler', () => {
      const cv = document.createElement('canvas');
      cv.id = 'particle-cv';
      const mockCtx = {
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
      };
      cv.getContext = () => mockCtx;
      
      const parent = document.createElement('div');
      parent.appendChild(cv);
      parent.getBoundingClientRect = () => ({ width: 200, height: 100 });
      
      document.body.appendChild(parent);

      const cancel = startTabParticles('particle-cv');
      expect(typeof cancel).toBe('function');
      cancel();
      
      document.body.removeChild(parent);
    });
  });
});

describe('MapLibre Helper Functions', () => {
  it('calculates destination points using haversine formula', () => {
    const [lon, lat] = destination(52.0, 20.0, 90, 1000);
    expect(lon).toBeCloseTo(20.0146, 3);
    expect(lat).toBeCloseTo(52.0, 3);
  });

  it('computes bounds of multiple points correctly', () => {
    const points = [
      [50.0, 19.0],
      [53.0, 22.0]
    ];
    const bounds = boundsOf(points);
    expect(bounds).toEqual([[19.0, 50.0], [22.0, 53.0]]);
  });

  it('generates geodesic circles for visual highlight layers', () => {
    const circle = geoCircle(52.0, 20.0, 5000, 32);
    expect(circle.type).toBe('FeatureCollection');
    expect(circle.features[0].geometry.type).toBe('Polygon');
    expect(circle.features[0].geometry.coordinates[0].length).toBe(33); // 32 segments + closed endpoint
  });

  describe('featureBBoxCenter', () => {
    it('calculates feature centroid centers for map label placement', () => {
      const polygonFeature = {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [[19.0, 50.0], [20.0, 50.0], [20.0, 51.0], [19.0, 51.0], [19.0, 50.0]]
          ]
        }
      };
      const center = featureBBoxCenter(polygonFeature);
      expect(center).toEqual([19.5, 50.5]);
    });

    it('calculates center for MultiPolygon geometries correctly by picking the largest ring', () => {
      const multiPolygonFeature = {
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [[[19.0, 50.0], [20.0, 50.0], [20.0, 51.0], [19.0, 51.0], [19.0, 50.0]]],
            [[[21.0, 52.0], [22.0, 52.0], [23.0, 52.0], [23.0, 54.0], [21.0, 54.0], [21.0, 52.0]]] // this one is larger (6 points vs 5 points)
          ]
        }
      };
      const center = featureBBoxCenter(multiPolygonFeature);
      expect(center).toEqual([22.0, 53.0]);
    });

    it('returns null if coordinates are empty', () => {
      expect(featureBBoxCenter({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] } })).toBeNull();
    });
  });

  describe('WebGLUnavailableError', () => {
    it('has standard error structure and message', () => {
      const err = new WebGLUnavailableError();
      expect(err.message).toBe('WebGL is currently disabled');
      expect(err.name).toBe('WebGLUnavailableError');
    });
  });

  describe('darkStyle', () => {
    it('returns the basic style configuration', () => {
      const style = darkStyle();
      expect(style.version).toBe(8);
      expect(style.layers[0].id).toBe('bg');
    });
  });

  describe('createMap', () => {
    it('creates or throws depending on WebGL availability', () => {
      const container = document.createElement('div');
      if (webglAvailable) {
        const map = createMap(container);
        expect(map).toBeDefined();
      } else {
        expect(() => createMap(container)).toThrow(WebGLUnavailableError);
      }
    });
  });

  describe('showMapUnavailable', () => {
    it('injects error message into container', () => {
      const div = document.createElement('div');
      showMapUnavailable(div, { message: 'Blad', hint: 'Pomoc' });
      expect(div.innerHTML).toContain('Blad');
      expect(div.innerHTML).toContain('Pomoc');
    });
  });

  describe('fitPoland', () => {
    it('calls fitBounds on the map instance', () => {
      const mockMap = { fitBounds: vi.fn() };
      fitPoland(mockMap, 10);
      expect(mockMap.fitBounds).toHaveBeenCalled();
    });
  });

  describe('addVoivodeshipLayers', () => {
    it('adds geojson source and layers', () => {
      const mockMap = {
        getSource: vi.fn().mockReturnValue(false),
        getLayer: vi.fn().mockReturnValue(false),
        addSource: vi.fn(),
        addLayer: vi.fn()
      };
      const wojGeo = { type: 'FeatureCollection', features: [] };
      addVoivodeshipLayers(mockMap, wojGeo, 'test-woj');

      expect(mockMap.addSource).toHaveBeenCalledWith('test-woj', expect.any(Object));
      expect(mockMap.addLayer).toHaveBeenCalledTimes(2);
    });
  });

  describe('pointsToFC', () => {
    it('maps coordinate pairs to point FeatureCollection', () => {
      const points = [
        [50.1, 19.1, 'extra1'],
        [51.2, 20.2]
      ];
      const fc = pointsToFC(points, (lat, lon, p, idx) => ({ id: idx, extra: p[2] }));
      expect(fc.type).toBe('FeatureCollection');
      expect(fc.features[0].geometry.coordinates).toEqual([19.1, 50.1]);
      expect(fc.features[0].properties.id).toBe(0);
      expect(fc.features[0].properties.extra).toBe('extra1');
    });
  });
});

describe('Config Utilities & Plugins', () => {
  describe('fpRamp', () => {
    it('returns colors correctly mapped to ranges', () => {
      expect(fpRamp(0)).toContain('rgb(');
      expect(fpRamp(0.5)).toContain('rgb(');
      expect(fpRamp(1)).toContain('rgb(');
      expect(fpRamp(-1)).toEqual(fpRamp(0));
      expect(fpRamp(2)).toEqual(fpRamp(1));
    });
  });

  describe('barValueLabels Plugin', () => {
    it('does nothing if plugin config is empty or missing', () => {
      const chart = {
        options: { plugins: {} },
        ctx: {},
      };
      expect(() => barValueLabels.afterDatasetsDraw(chart)).not.toThrow();
    });

    it('renders labels on vertical bar chart', () => {
      const fillText = vi.fn();
      const save = vi.fn();
      const restore = vi.fn();
      
      const chart = {
        options: {
          indexAxis: 'x',
          plugins: {
            barLabels: {
              color: '#ffffff',
              thousands: true,
              inside: true
            }
          }
        },
        ctx: {
          save,
          restore,
          fillText,
          font: '',
          fillStyle: '',
          textAlign: '',
          textBaseline: ''
        },
        data: {
          datasets: [
            { data: [1234, 0, null, 50] }
          ]
        },
        getDatasetMeta(di) {
          return {
            hidden: false,
            type: 'bar',
            data: [
              { x: 10, y: 20, base: 30 }, // barH = 10 (less than 18)
              { x: 15, y: 15, base: 15 },
              { x: 20, y: 20, base: 20 },
              { x: 25, y: 5, base: 30 }   // barH = 25 (greater than 18)
            ]
          };
        }
      };

      barValueLabels.afterDatasetsDraw(chart);
      expect(save).toHaveBeenCalled();
      expect(restore).toHaveBeenCalled();
      expect(fillText).toHaveBeenCalled();
    });

    it('renders labels on horizontal bar chart with custom options', () => {
      const fillText = vi.fn();
      const save = vi.fn();
      const restore = vi.fn();

      const chart = {
        options: {
          indexAxis: 'y',
          plugins: {
            barLabels: {
              decimals: 2,
              suffix: '%'
            }
          }
        },
        ctx: {
          save,
          restore,
          fillText,
          font: '',
          fillStyle: '',
          textAlign: '',
          textBaseline: ''
        },
        data: {
          datasets: [
            { data: [95.5] }
          ]
        },
        getDatasetMeta(di) {
          return {
            hidden: false,
            type: 'bar',
            data: [
              { x: 50, y: 10 }
            ]
          };
        }
      };

      barValueLabels.afterDatasetsDraw(chart);
      expect(fillText).toHaveBeenCalledWith('95,50%', 55, 10);
    });

    it('renders labels outside bars (inside: false) and handles default formatting', () => {
      const fillText = vi.fn();
      const save = vi.fn();
      const restore = vi.fn();

      const chart = {
        options: {
          indexAxis: 'x',
          plugins: {
            barLabels: {
              inside: false
            }
          }
        },
        ctx: {
          save,
          restore,
          fillText,
          font: '',
          fillStyle: '',
          textAlign: '',
          textBaseline: ''
        },
        data: {
          datasets: [
            { data: [50] }
          ]
        },
        getDatasetMeta(di) {
          return {
            hidden: false,
            type: 'bar',
            data: [
              { x: 25, y: 5, base: 30 }
            ]
          };
        }
      };

      barValueLabels.afterDatasetsDraw(chart);
      expect(fillText).toHaveBeenCalledWith('50', 25, 1);
    });
  });

  describe('annotPlugin Plugin', () => {
    it('renders shaded bands in beforeDraw', () => {
      const fillRect = vi.fn();
      const save = vi.fn();
      const restore = vi.fn();
      const getPixelForValue = vi.fn(val => val * 10);

      const chart = {
        chartArea: { top: 0, height: 100 },
        scales: {
          x: { getPixelForValue }
        },
        options: {
          plugins: {
            annot: {
              shadedBands: [
                { x1: 5, x2: 10, color: 'rgba(0,0,0,0.5)' }
              ]
            }
          }
        },
        ctx: {
          save,
          restore,
          fillRect,
          fillStyle: ''
        }
      };

      annotPlugin.beforeDraw(chart);
      expect(save).toHaveBeenCalled();
      expect(restore).toHaveBeenCalled();
      expect(getPixelForValue).toHaveBeenCalledWith(5);
      expect(getPixelForValue).toHaveBeenCalledWith(10);
      expect(fillRect).toHaveBeenCalledWith(50, 0, 50, 100);
    });

    it('renders reference lines in afterDraw', () => {
      const stroke = vi.fn();
      const fillText = vi.fn();
      const save = vi.fn();
      const restore = vi.fn();
      const getPixelForValue = vi.fn(val => val * 10);

      const chart = {
        chartArea: { top: 0, bottom: 100, left: 0, right: 100, height: 100 },
        scales: {
          x: { getPixelForValue },
          y: { getPixelForValue }
        },
        data: {
          datasets: [
            { data: [5] }
          ]
        },
        getDatasetMeta(di) {
          return {
            data: [
              { x: 50, base: 0 }
            ]
          };
        },
        options: {
          plugins: {
            annot: {
              refLines: [
                { value: 5, axis: 'x', label: 'X-Ref', color: 'red' },
                { value: 8, axis: 'y', label: 'Y-Ref' }
              ]
            }
          }
        },
        ctx: {
          save,
          restore,
          stroke,
          fillText,
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          translate: vi.fn(),
          rotate: vi.fn(),
          setLineDash: vi.fn(),
          strokeStyle: '',
          lineWidth: 1,
          fillStyle: '',
          font: '',
          textAlign: '',
          textBaseline: ''
        }
      };

      annotPlugin.afterDraw(chart);
      expect(stroke).toHaveBeenCalledTimes(2);
      expect(fillText).toHaveBeenCalled();
    });
  });
});

