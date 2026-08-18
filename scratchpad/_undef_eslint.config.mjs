export default [{
  files: ['**/*.js'],
  languageOptions: {
    ecmaVersion: 2023, sourceType: 'module',
    globals: { window: 'readonly', document: 'readonly', console: 'readonly', navigator: 'readonly',
      requestAnimationFrame: 'readonly', performance: 'readonly', setTimeout: 'readonly',
      clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
      localStorage: 'readonly', fetch: 'readonly', Image: 'readonly', FileReader: 'readonly',
      Blob: 'readonly', URL: 'readonly', XMLHttpRequest: 'readonly', self: 'readonly',
      alert: 'readonly', prompt: 'readonly', confirm: 'readonly', OffscreenCanvas: 'readonly',
      Path2D: 'readonly', ResizeObserver: 'readonly', WebGL2RenderingContext: 'readonly' },
  },
  rules: { 'no-undef': 'error' },
}];
