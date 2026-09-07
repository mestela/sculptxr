import fs from 'fs';
const SOLID = 'node_modules/@fortawesome/fontawesome-free/svgs/solid/';
const NAMES = [
  // panel markup
  'backward-step','backward','play','stop','forward','forward-step','circle',
  'rotate-left','rotate-right','chevron-right','chevron-down','link','link-slash',
  'cake-candles','copy','eye','eye-slash','pen','trash','lock','lock-open','cube',
  'asterisk','arrows-rotate',
  // tab + chip icons (resolved from their codepoints)
  'thumbtack','arrow-left','sitemap','photo-film','draw-polygon','toolbox','sliders',
  'film','layer-group','bezier-curve',
];
const out = {};
for (const n of NAMES) {
  const src = fs.readFileSync(SOLID + n + '.svg', 'utf8');
  const vb = /viewBox="([^"]+)"/.exec(src)[1];
  const ds = [...src.matchAll(/ d="([^"]+)"/g)].map(m => m[1]);
  if (!ds.length) throw new Error('no path in ' + n);
  out[n] = { vb, d: ds.join(' ') };
}
const body = Object.entries(out)
  .map(([n, v]) => `  '${n}': ['${v.vb}', '${v.d}'],`).join('\n');
const js = `// GENERATED from @fortawesome/fontawesome-free/svgs/solid — do not hand-edit.
// Regenerate with scratchpad/gen_faicons.mjs when an icon is added to ICON_NAMES there.
//
// WHY THESE ARE PATHS AND NOT GLYPHS. The VR panels rasterise by serialising their DOM into an
// SVG, and that SVG carries an inline copy of every stylesheet in the document. install.js
// injected the FontAwesome woff2 as a base64 @font-face so panel icons would survive that trip,
// which meant 206KB of font rode along in EVERY panel's SVG on EVERY paint. Measured on the dev
// server, same panel, cold decode: 462KB / 36.5ms with the font, 256KB / 25.5ms without.
//
// An inline path needs no font at all, so the font leaves document.styleSheets entirely and the
// cost goes to nothing rather than merely shrinking. ${NAMES.length} icons, ${(js_len(body)/1024).toFixed(1)}KB of path data.
const P = {
${body}
};

// One <svg> shaped like the <i> it replaces: 1em square, inheriting colour through currentColor,
// and sitting on the text baseline the way a glyph did (-0.125em is FontAwesome's own figure).
export function faIcon(name, opts = {}) {
  const key = String(name || '').replace(/^fa-/, '');
  const p = P[key];
  if (!p) return '';
  const cls = opts.cls ? ' ' + opts.cls : '';
  const size = opts.size ? \`width:\${opts.size}px;height:\${opts.size}px;\` : '';
  const style = size + (opts.style || '');
  const title = opts.title ? \`<title>\${opts.title}</title>\` : '';
  return \`<svg class="fa-i\${cls}" viewBox="\${p[0]}" xmlns="http://www.w3.org/2000/svg"\`
    + (style ? \` style="\${style}"\` : '') + \`>\${title}<path d="\${p[1]}"/></svg>\`;
}

// Swap the icon inside an element that already has one, for the runtime toggles (eye/eye-slash,
// lock/lock-open) that used to just rewrite a className.
export function setFaIcon(host, name, opts) {
  if (!host) return;
  const cur = host.querySelector('svg.fa-i');
  const next = faIcon(name, opts);
  if (!next) return;
  if (cur) cur.outerHTML = next; else host.insertAdjacentHTML('afterbegin', next);
}

export const FA_ICON_NAMES = Object.keys(P);
`;
function js_len(s){ return s.length; }
fs.writeFileSync('src/gui/htmlvr/faIcons.js', js);
console.log('wrote src/gui/htmlvr/faIcons.js —', (js.length/1024).toFixed(1) + 'KB for', NAMES.length, 'icons');
