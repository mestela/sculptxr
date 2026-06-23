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
    // assetsInlineLimit was 300000 to inline fonts as base64 in the CSS bundle so Font
    // Awesome would render inside the html-in-canvas polyfill's SVG foreignObject (Quest
    // immersive mode blocks external font fetches). But that ballooned the prod CSS to ~2.5 MB,
    // and the polyfill inlines the WHOLE page CSS into EVERY panel SVG on every repaint — so
    // each menu paint serialized/decoded 2.5 MB (huge buildSvg + set-src + style-recalc; tanked
    // the GalaxyXR). It's also redundant: install.js already injects the FA Solid woff2 as a
    // base64 @font-face at runtime for the polyfill. Back to the Vite default so fonts ship as
    // separate files and the inlined per-paint CSS is small. (Dev was unaffected — it serves
    // fonts as url() files — which is why prod alone was slow.)
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
