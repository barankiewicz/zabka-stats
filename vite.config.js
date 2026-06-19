import { defineConfig } from 'vite'
export default defineConfig({
  root: 'frontend',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
