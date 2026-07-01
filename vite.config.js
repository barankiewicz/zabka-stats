import { defineConfig } from 'vite'
import { resolve } from 'path'
import { compression } from 'vite-plugin-compression2'

// Precompress JS/CSS to .gz and .br at build time so nginx serves them
// statically (gzip_static / brotli_static) with zero per-request compression
// CPU on the 1-vCPU box, instead of compressing on the fly. Brotli is ~15-20%
// smaller than gzip on JS; nginx prefers .br when the client sends
// "Accept-Encoding: br" (all modern browsers do over HTTPS).
export default defineConfig({
  root: 'frontend',
  plugins: [
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

      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})