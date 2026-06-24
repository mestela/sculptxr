import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      'gl-matrix': resolve(__dirname, 'lib/gl-matrix-wrapper.js'),
      'hammerjs': resolve(__dirname, 'lib/hammer-wrapper.js'),
      'yagui': resolve(__dirname, 'lib/yagui.js'),
      'file-saver': resolve(__dirname, 'lib/file-saver-wrapper.js'),
      'zip': resolve(__dirname, 'lib/zip-wrapper.js'),
      'sketchfab-oauth2-1.2.0': resolve(__dirname, 'lib/sketchfab-wrapper.js')
    }
  },
  plugins: [
    basicSsl()
  ],
  worker: {
    format: 'es'
  },
  build: {
    // Keep fonts/assets as separate files so the prod CSS stays small — the html-in-canvas
    // panel rasteriser inlines the WHOLE page CSS into every panel SVG on every repaint, so a
    // big CSS bundle tanks menu perf (the old assetsInlineLimit:300000 → 2.5 MB CSS did exactly
    // that, fixed in v3.3.1). The one font the panels actually need embedded for the SVG path —
    // FA Solid — is injected as a single base64 @font-face at startup by install.js (?inline),
    // which also covers Quest/GalaxyXR immersive mode (can't fetch url() fonts at paint time).
    assetsInlineLimit: 4096,
  },
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: 8080,
    https: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    }
  }
});
