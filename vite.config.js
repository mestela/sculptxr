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
