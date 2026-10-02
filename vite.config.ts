import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/tts': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Item photos are stored on the API server, not in the web app. Without
      // this the dev server answers /item-images/* with index.html, so the
      // browser gets HTML where it expects image bytes and shows a broken
      // image on the laptop while the phone (which talks to the API directly)
      // works fine.
      '/item-images': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});