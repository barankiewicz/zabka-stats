function createStateProxy(name, initial = {}) {
  return new Proxy(initial, {
    set(target, prop, value) {
      // Centralized hook for logging/validating mutations on global state
      target[prop] = value;
      return true;
    },
    get(target, prop) {
      return target[prop];
    },
    deleteProperty(target, prop) {
      delete target[prop];
      return true;
    }
  });
}

export const M = createStateProxy('M');
export const CHARTS = createStateProxy('CHARTS');
export const MAPS = createStateProxy('MAPS');

const _renderedSet = new Set();
export const RENDERED = {
  add(val) {
    _renderedSet.add(val);
    return this;
  },
  delete(val) {
    return _renderedSet.delete(val);
  },
  has(val) {
    return _renderedSet.has(val);
  },
  clear() {
    _renderedSet.clear();
  },
  get size() {
    return _renderedSet.size;
  },
  [Symbol.iterator]() {
    return _renderedSet[Symbol.iterator]();
  }
};
