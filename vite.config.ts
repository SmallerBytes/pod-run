import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is required for WebXR on Quest.
// Local: `npm run dev` → https://<lan-ip>:5173
// Live: GitHub Pages at /pod-run/ (base must match the repo name).
export default defineConfig({
  base: '/pod-run/',
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 5173
  },
  build: {
    target: 'es2022'
  }
});
