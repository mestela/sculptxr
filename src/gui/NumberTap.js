// CLICK ANY SLIDER'S NUMBER TO TYPE IT. One capture listener instead of a handler per slider:
// every panel (VR menu, wrist panel, bone panel, torn-off copies, desktop sidebar) draws the same
// shape -- an <input type=range> with a text readout beside it -- so the readout is recognised by
// SHAPE, and a new slider gets this for free.
//
// The readout is not always the slider's raw value (it may say "50%", "0.25x", "120mm" for a
// slider that runs 0..100 / 0..25 / ...). So the numpad is pre-filled with the NUMBER SHOWN, and
// what is typed is mapped back through the ratio raw/shown. That is exact for the linear
// scalings these panels use; where it cannot be worked out (shown 0, or "Off") it falls back to
// typing in the slider's own units.

const stepDecimals = (step) => {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

function sliderFor(target) {
  if (!target || target.nodeType !== 1 || target.matches('input, select, textarea, button')) return null;
  const p = target.parentElement;
  if (!p) return null;
  const range = p.querySelector(':scope > input[type=range]');
  if (!range || range.disabled || range.matches(':disabled')) return null;
  const txt = (target.textContent || '').trim();
  if (target.children.length || !/^[-+]?\d*\.?\d+/.test(txt) && txt !== 'Off') return null;
  return { range, txt };
}

function panelOf(el) {
  for (let n = el; n; n = n.parentElement) if (n._vrPanel) return n._vrPanel;
  return null;
}

function labelOf(range, target) {
  const row = target.parentElement;
  const l = row && row.querySelector(':scope > [class*=lbl]');
  return (l && l.textContent.trim()) || 'Value';
}

export function openNumberFor(range, target, txt) {
  const np = window._vrNumpad;
  if (!np || np.isBlockingOpen) return;
  const raw = parseFloat(range.value);
  const shown = parseFloat(txt);
  const lo = parseFloat(range.min), hi = parseFloat(range.max), step = parseFloat(range.step) || 1;
  // k: raw units per shown unit.
  const k = Number.isFinite(shown) && Math.abs(shown) > 1e-9 && Math.abs(raw) > 1e-9 ? raw / shown : 1;
  const cur = k === 1 || !Number.isFinite(shown) ? raw : shown;
  const dec = stepDecimals(range.step);
  np.open(cur, { label: labelOf(range, target), integer: step >= 1 && k === 1 },
    (val) => {
      let r = (k === 1 ? val : val * k);
      r = Math.min(hi, Math.max(lo, r));
      if (step > 0) r = lo + Math.round((r - lo) / step) * step;
      range.value = dec ? r.toFixed(dec) : String(r);
      range.dispatchEvent(new Event('input', { bubbles: true }));
      range.dispatchEvent(new Event('change', { bubbles: true }));
    }, target, panelOf(target));
}

export function installNumberTap() {
  if (window.__numberTapInstalled) return;
  window.__numberTapInstalled = true;
  const st = document.createElement('style');
  st.textContent = 'input[type=range] + span:not([class*=lbl]){cursor:pointer}';
  document.head.appendChild(st);
  document.addEventListener('click', (e) => {
    const hit = sliderFor(e.target);
    if (!hit) return;
    e.preventDefault(); e.stopPropagation();
    openNumberFor(hit.range, e.target, hit.txt);
  }, true);
}
