import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import devRelay from './tools/dev-relay-plugin.mjs';

// HTTP=1 npm run dev  → serve plain HTTP (no self-signed cert). Use this for the
// `adb reverse` → GalaxyXR workflow: the headset hits http://localhost:8080, and
// localhost is a secure context, so WebXR + SharedArrayBuffer still work with no cert
// warning. Default (unset) stays HTTPS so at-home LAN-IP testing keeps a secure context
// (HTTP over a LAN IP would NOT be a secure context and would break WebXR/SAB).
const useHttp = process.env.HTTP === '1';

// A LOCALLY-TRUSTED CERT IF ONE HAS BEEN MADE, the self-signed plugin otherwise.
//
// basic-ssl's cert is untrusted, which is fine for a browser a human can click "advanced" in
// and fatal for an automated one -- Claude's built-in browser refuses the origin outright, so
// nothing on the flagged WebGPU path could be checked on the desktop before going to a
// headset. Two device round-trips were spent on faults a desktop load would have shown.
//
// Generate the pair once (mkcert -install needs your password, so it is not something a tool
// can do for you):
//     mkcert -install
//     mkcert -cert-file .certs/dev.pem -key-file .certs/dev-key.pem 192.168.86.197 localhost 127.0.0.1
// The CA is trusted on THIS mac only; the headset will still warn, exactly as it does now.
const certDir = resolve(__dirname, '.certs');
const certFile = resolve(certDir, 'dev.pem');
const keyFile = resolve(certDir, 'dev-key.pem');
const haveCert = !useHttp && existsSync(certFile) && existsSync(keyFile);

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
    ...(useHttp || haveCert ? [] : [basicSsl()]),
    // Console + eval for devices with no debugging protocol (iPad, Vision Pro). `apply: 'serve'`
    // inside the plugin keeps it out of every build. See tools/dev-relay-plugin.mjs.
    devRelay()
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
    // THE TSL SPIKE IS A SECOND ENTRY, not part of the app. WebGPURenderer cannot render a
    // ShaderMaterial, so the renderer question has to be answered somewhere the app is not --
    // and it needs bundling like the app does, because `three/webgpu` is a bare import.
    // Lands at dist/spike/tsl/ and costs the app nothing: it shares no module with it.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        tslSpike: resolve(__dirname, 'spike/tsl/index.html'),
      },
    },
  },
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: 8080,
    // The mkcert pair when it exists, basic-ssl's untrusted one otherwise. `true` here means
    // "let the plugin do it"; an object is the cert itself.
    https: haveCert ? { cert: readFileSync(certFile), key: readFileSync(keyFile) } : !useHttp,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    }
  }
});
