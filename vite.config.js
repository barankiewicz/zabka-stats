import { defineConfig } from 'vite'
import { resolve } from 'path'
import { readFileSync, existsSync } from 'fs'
import { compression } from 'vite-plugin-compression2'

// Bake the current /api/stats/summary into the HTML at build time so the
// {{STAT_*}} placeholders show real values on the FIRST paint (before JS
// runs) - no {{TOKEN}} flash on fast refresh. Also inlines the summary
// as window.__BAKED_SUMMARY for the runtime translateDOM() pass that
// follows, so anything JS renders later (chart cards, tab content) gets
// the values too without waiting for the /api/stats/summary fetch.
//
// The bake itself is done by scripts/bake_summary.py, which runs from
// package.json before this plugin sees the HTML. Safe no-op if the JSON
// is missing (warns and falls back to runtime-only resolution).
//
// Special-case tokens handled the same way the i18n.js runtime t() does:
//   - total_stores_words: hardcoded PL phrase ("trzynaście tysięcy"),
//     mirrors the runtime's t() short-circuit so a re-translate on EN
//     switch still works (runtime overrides with "thirteen thousand")
//   - date_modified: take only the YYYY-MM-DD prefix
//   - other numbers: formatted per the HTML's default locale (pl-PL;
//     comma decimal separator, space thousands) since the page source
//     is Polish - the runtime re-formats per currentLang when the user
//     switches to EN
function bakeSummaryPlugin() {
  return {
    name: 'bake-summary',
    transformIndexHtml(html) {
      const summaryPath = resolve(__dirname, 'frontend/baked-summary.json');
      if (!existsSync(summaryPath)) {
        console.warn(
          '[bake-summary] no frontend/baked-summary.json - run `python scripts/bake_summary.py` before vite build. Falling back to runtime-only resolution (you may see a brief {{TOKEN}} flash on first paint).'
        );
        return html;
      }
      const summary = JSON.parse(readFileSync(summaryPath, 'utf-8'));
      const summaryRaw = readFileSync(summaryPath, 'utf-8');

      // 1. Replace {{STAT_*}} tokens in the HTML body with PL-formatted
      // values so the very first paint already shows the right numbers
      // (no {{TOKEN}} flash, no FOUC). Mirrors the i18n.js t() resolution
      // logic so the runtime re-translate later in the same language is
      // a no-op for the static text.
      const baked = html.replace(/\{\{([^}]+)\}\}/g, (match, token) => {
        const field = token.toLowerCase().replace(/^stat_/, '');
        if (field === 'total_stores_words') {
          return summary['total_stores_words'] || 'trzynaście tysięcy';
        }
        const val = summary[field];
        if (val === undefined || val === null) return match;
        if (field === 'date_modified') return String(val).slice(0, 10);
        if (typeof val === 'number') {
          const dec = val % 1 === 0 ? 0 : (val.toString().split('.')[1] || '').length;
          return val.toLocaleString('pl-PL', {
            minimumFractionDigits: dec,
            maximumFractionDigits: dec,
          });
        }
        return String(val);
      });

      // 2. Inject the raw JSON as window.__BAKED_SUMMARY so the runtime
      // translateDOM() (and any other JS that reads M.summary before
      // /api/stats/summary lands) sees the same values. Tiny - the
      // summary is ~50 small numbers, ~1.5 KB unminified.
      return baked.replace(
        '<head>',
        `<head>\n    <script>window.__BAKED_SUMMARY=${summaryRaw};</script>`
      );
    },
  };
}

// Precompress JS/CSS to .gz and .br at build time so nginx serves them
// statically (gzip_static / brotli_static) with zero per-request compression
// CPU on the 1-vCPU box, instead of compressing on the fly. Brotli is ~15-20%
// smaller than gzip on JS; nginx prefers .br when the client sends
// "Accept-Encoding: br" (all modern browsers do over HTTPS).
export default defineConfig({
  root: 'frontend',
  plugins: [
    bakeSummaryPlugin(),
    compression({ algorithm: 'gzip', threshold: 1024 }),
    compression({ algorithm: 'brotliCompress', threshold: 1024 }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Sourcemaps were being shipped to prod (dist/*.js.map, several MB each)
    // for zero end-user benefit - nothing in the app references them.
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'frontend/index.html'),
        methodology: resolve(__dirname, 'frontend/methodology.html'),
        faq: resolve(__dirname, 'frontend/faq.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    // vitest's default include glob also matches *.spec.js, which collides
    // with test/performance.spec.js - that file is a Playwright e2e/perf-budget
    // test (imports `test`/`expect` from @playwright/test, needs a running
    // `vite preview` server and a real browser), not a vitest unit test.
    // Without this exclude, `vitest run` (== `npm test`) fails outright with
    // "Playwright Test did not expect test.describe() to be called here."
    // before any real unit test gets a chance to run.
    exclude: ['**/node_modules/**', '**/dist/**', 'test/performance.spec.js'],
  },
})