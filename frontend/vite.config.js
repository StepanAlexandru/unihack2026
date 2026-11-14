import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend (M4) origin for the dev-server proxy. The phone only ever sees the
// Vite origin (through the HTTPS tunnel), so there is no CORS / mixed content.
const BACKEND = process.env.BACKEND_ORIGIN || 'http://localhost:3001';
const proxied = ['/analyze', '/narrate', '/audio', '/health'];

export default defineConfig({
  plugins: [react()],
  // One shared .env lives in the repo root (CLAUDE.md §5).
  envDir: '..',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: Object.fromEntries(proxied.map((p) => [p, { target: BACKEND, changeOrigin: true }])),
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    proxy: Object.fromEntries(proxied.map((p) => [p, { target: BACKEND, changeOrigin: true }])),
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
