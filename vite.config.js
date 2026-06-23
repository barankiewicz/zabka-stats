import { defineConfig } from 'vite'
import { resolve } from 'path'
export default defineConfig({
  root: 'frontend',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: 'hidden',
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