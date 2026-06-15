/**
 * uiTokens — single source of truth for the panel visual language.
 *
 * Injects CSS custom properties (Catppuccin-Mocha-derived, but named
 * SEMANTICALLY rather than by palette colour) so every HTML panel pulls its
 * colours / radii / transitions from one place. Change a value here and it
 * propagates to all panels.
 *
 * Canvas-drawn surfaces (e.g. GuiTimeline) can't read CSS vars — see
 * UI_PALETTE below for the matching JS constants to keep them in sync.
 *
 * Usage (panels): import { injectUITokens } from './uiTokens.js'; call it once
 * (e.g. at the top of the panel's own injectCss()), then reference var(--ui-*).
 *
 * VR hover note: there is no CSS :hover in a headset (the panel is a rasterised
 * texture). The ray dispatch adds a `.hover` class to the hovered <button>
 * instead, so style interactive elements with BOTH:
 *     selector:hover, selector.hover { ... }
 */

export const UI_PALETTE = {
  panelBg:       '#1e1e2e',
  panelBorder:   '#45475a',
  displayBg:     '#11111b',
  btnBg:         '#313244',
  btnBgHover:    '#45475a',
  btnBgActive:   '#585b70',
  text:          '#cdd6f4',
  textDim:       '#a6adc8',
  accent:        '#89b4fa',
  okBg:          '#40a02b',
  okBgHover:     '#4ec33a',
  dangerBg:      '#e64553',
  dangerBgHover: '#f17585',
};

const TOKENS_CSS = `
:root {
  --ui-panel-bg:       ${UI_PALETTE.panelBg};
  --ui-panel-border:   ${UI_PALETTE.panelBorder};
  --ui-display-bg:     ${UI_PALETTE.displayBg};
  --ui-btn-bg:         ${UI_PALETTE.btnBg};
  --ui-btn-bg-hover:   ${UI_PALETTE.btnBgHover};
  --ui-btn-bg-active:  ${UI_PALETTE.btnBgActive};
  --ui-text:           ${UI_PALETTE.text};
  --ui-text-dim:       ${UI_PALETTE.textDim};
  --ui-accent:         ${UI_PALETTE.accent};
  --ui-ok-bg:          ${UI_PALETTE.okBg};
  --ui-ok-bg-hover:    ${UI_PALETTE.okBgHover};
  --ui-danger-bg:      ${UI_PALETTE.dangerBg};
  --ui-danger-bg-hover:${UI_PALETTE.dangerBgHover};
  --ui-radius:         8px;
  --ui-radius-lg:      12px;
  --ui-transition:     background 0.07s;
}
`;

let _injected = false;
export function injectUITokens() {
  if (_injected) return;
  _injected = true;
  const s = document.createElement('style');
  s.setAttribute('data-ui-tokens', '');
  s.textContent = TOKENS_CSS;
  // Prepend so panel stylesheets (appended later) can override if needed.
  document.head.insertBefore(s, document.head.firstChild);
}
