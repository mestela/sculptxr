import getOptionsURL from '../../misc/getOptionsURL.js';
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

  /* ── CONTROL RHYTHM (ui reorg mockup) ──────────────────────────────────────
     Measured across the Files, View, Settings, Scene, Tools and Properties pages before
     writing these: ELEVEN distinct control heights (16, 22, 24, 25, 26, 27, 28, 30, 35), two
     radius families, five type sizes, three weights, and four different greys for "a control
     you press". mm-action-btn and mm-choice are the same thing at the same height on different
     backgrounds; mm-select-trigger is a third; mm-text-input is 35px where everything else is
     30. matt: "its a mishmash of lineweights, some things have borders, some don't."

     Two heights, one radius, two type sizes, two surfaces, one border rule. */
  --ui-ctl-h:          30px;   /* anything pressable or editable */
  --ui-ctl-h-sm:       24px;   /* a compact row: label plus slider plus readout */
  --ui-ctl-r:          5px;
  --ui-ctl-px:         10px;   /* THE SHARED LEFT EDGE, see the note in the sweep below */
  --ui-ctl-bg:         #181825;
  --ui-ctl-bg-hover:   #24243e;
  --ui-ctl-bg-active:  rgba(137, 180, 250, 0.18);
  --ui-ctl-border:     #45475a;
  --ui-ctl-fs:         11px;
  --ui-ctl-fw:         500;
  --ui-head-fs:        10px;
  --ui-head-fw:        700;
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

// ── Collapsible groups (ui reorg mockup) ─────────────────────────────────────
//
// COLLAPSE RATHER THAN SUBTAB, and the reason is the heading: a collapsed group still shows
// its own name, in place, one click from its contents. An unselected subtab shows a word
// somewhere else and hides what kind of thing is behind it. It also lets both be open at once,
// which subtabs make impossible.
//
// Hand-rolled rather than <details>: the disclosure triangle is a UA-drawn glyph and this
// markup is serialised into an SVG to be rasterised, where UA glyphs are exactly what does not
// survive. The chevron is a text character we draw ourselves.
//
// State is global and keyed by name so it survives the panel rebuilds that replace this markup
// wholesale, and so the main panel and a torn-off copy agree.

export function groupOpen(key, dflt = true) {
  const g = (window._uiGroups = window._uiGroups || {});
  if (g[key] == null) g[key] = dflt;
  return !!g[key];
}

export function toggleGroup(key) {
  const g = (window._uiGroups = window._uiGroups || {});
  g[key] = !groupOpen(key);
  return g[key];
}

// `key` is the state key AND the data attribute the wiring looks for, so a group cannot be
// rendered under one name and toggled under another.
export function collapsibleHTML(key, label, bodyHTML, dflt = true) {
  const open = groupOpen(key, dflt);
  return `
    <button class="mm-group-head" data-group="${key}">
      <span class="mm-group-chev">${open ? '&#9662;' : '&#9656;'}</span>${label}
    </button>
    <div class="mm-group-body${open ? '' : ' collapsed'}" data-group-body="${key}">${bodyHTML}</div>`;
}

// ── UI REORG MOCKUP FLAG (branch ui-reorg-mockup) ────────────────────────────
//
// LIVES HERE, not in MainMenuPanel, because bonePanel needs it too and MainMenuPanel already
// imports bonePanel -- asking for it the other way round is a cycle, and in a cycle the
// function is in its temporal dead zone for whichever module happens to evaluate first. This
// module imports nothing from gui/, so nothing can loop back through it.
export function uiReorg() {
  // The window flag is the LIVE override (a toggle mid-session, or the console); the saved
  // option is what a fresh load starts from.
  if (window._uiReorg != null) return !!window._uiReorg;
  return getOptionsURL().uiReorg !== false;
}

// ONE WIRING PASS, USED BY ALL THREE PANELS.
//
// The groups are emitted by shared builders, so they turn up in the VR main menu, the wrist
// panel AND the desktop sidebar -- three roots, three stylesheets, and originally two copies
// of this loop and one place that simply forgot. The sidebar's headings were dead and it did
// not look dead, because the VR panel keeps its own copy of the same markup attached off-screen
// for the rasteriser: clicking "the" heading in a console found that one and worked.
//
// Toggling flips a class and repaints. Never a rebuild -- a rebuild would re-run the wiring
// that is currently mid-click, and would throw away the scroll position with it.
export function wireGroups(root, repaint) {
  if (!root) return;
  root.querySelectorAll('.mm-group-head').forEach((head) => {
    if (head._groupWired) return;   // builders re-render, and a second listener would toggle twice
    head._groupWired = true;
    head.addEventListener('click', () => {
      const key = head.dataset.group;
      const open = toggleGroup(key);
      // Scoped to THIS root: the same key is rendered in every panel, and a document-wide
      // query would flip the off-screen VR copy's class and leave this one alone.
      root.querySelector(`[data-group-body="${key}"]`)?.classList.toggle('collapsed', !open);
      const chev = head.querySelector('.mm-group-chev');
      if (chev) chev.innerHTML = open ? '&#9662;' : '&#9656;';
      repaint?.();
    });
  });
}

// ── THE STYLE SWEEP (ui reorg mockup) ────────────────────────────────────────
//
// ONE NORMALISATION LAYER, INJECTED ONCE, APPLIED EVERYWHERE.
//
// This file has always described itself as the single source of truth for the panel visual
// language. It was not: before this sweep the three big panels referenced ZERO of its
// variables (MainMenuPanel 0, MiniPanel 0, AnimationControlPanel 0) and hardcoded every colour
// and size themselves. Only VrConfirm ever adopted it. That is the whole explanation for the
// eleven heights and the four greys -- there was a system and nobody used it.
//
// So this does not invent a vocabulary, it applies the one already declared above.
//
// WRITTEN AS AN OVERRIDE LAYER RATHER THAN A REWRITE. Editing the base rules in three
// stylesheets would be the same change with no way back, and the point of this branch is to be
// able to look at it next to what it replaces. Fold it into the base rules and delete the
// originals once the look is agreed.
//
// HOOKED ON THE ROOT ELEMENT, not on a panel. The desktop sidebar, the wrist panel and the VR
// main menu are three different roots in three different places, and the sidebar is not inside
// any of them -- a per-panel class would sweep two of the three and silently skip the one matt
// looks at most.
const SWEEP_CSS = `
/* Everything a person presses, types into, or drags: one height, one radius, one border,
   one type size, one resting surface. */
html.ui-reorg .mm-action-btn,
html.ui-reorg .mm-toggle,
html.ui-reorg .mm-choice,
html.ui-reorg .mm-select-trigger,
html.ui-reorg .mm-tool-btn,
html.ui-reorg .mm-xf,
html.ui-reorg .mm-xf-bake,
html.ui-reorg .mm-text-input,
html.ui-reorg .mp-action-btn,
html.ui-reorg .mp-toggle-btn,
html.ui-reorg .mp-voxel-btn,
html.ui-reorg .mp-keep-btn,
html.ui-reorg .acp-btn-full,
html.ui-reorg .acp-btn-clear,
html.ui-reorg .acp-btn-autokey,
html.ui-reorg .acp-mode-btn,
html.ui-reorg .acp-btn-grid button,
html.ui-reorg .acp-addkey-row button,
html.ui-reorg .acp-select-trigger {
  min-height: var(--ui-ctl-h);
  height: auto;
  box-sizing: border-box;
  padding: 0 var(--ui-ctl-px);
  border: 1px solid var(--ui-ctl-border);
  border-radius: var(--ui-ctl-r);
  background: var(--ui-ctl-bg);
  color: var(--ui-text);
  font-size: var(--ui-ctl-fs);
  font-weight: var(--ui-ctl-fw);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

/* ONE ACTIVE LOOK. The panels had at least three: a filled grey, a tinted wash, and a border
   colour change, for the same meaning. */
html.ui-reorg .mm-action-btn.active,
html.ui-reorg .mm-toggle.active,
html.ui-reorg .mm-choice.active,
html.ui-reorg .mp-toggle-btn.active,
html.ui-reorg .mp-voxel-btn.active,
html.ui-reorg .mp-keep-btn.active,
html.ui-reorg .acp-mode-btn.active,
html.ui-reorg .acp-btn-autokey.active {
  background: var(--ui-ctl-bg-active);
  border-color: var(--ui-accent);
  color: var(--ui-text);
}

/* Text and number fields read left, not centred: you are reading a value, not a label. */
html.ui-reorg .mm-xf,
html.ui-reorg .mm-text-input { justify-content: flex-start; text-align: left; }

/* THE SHARED LEFT EDGE. A button's label starts at its own horizontal padding; a row's label
   started at zero, because rows have no border and never had any. So every label in the column
   sat at one of two different x positions and nothing lined up -- matt: "nothing is vertically
   aligned". Same padding on the row puts its text on the same edge as the button text above it. */
html.ui-reorg .mm-row,
html.ui-reorg .acp-row {
  min-height: var(--ui-ctl-h-sm);
  padding-left: var(--ui-ctl-px);
  padding-right: var(--ui-ctl-px);
  box-sizing: border-box;
}
html.ui-reorg .mm-check-row,
html.ui-reorg .acp-check-row { padding-left: var(--ui-ctl-px); box-sizing: border-box; }

/* One heading size and weight, and the same left edge again. */
html.ui-reorg .mm-section-title,
html.ui-reorg .acp-section-title,
html.ui-reorg .mm-group-head {
  font-size: var(--ui-head-fs);
  font-weight: var(--ui-head-fw);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding-left: var(--ui-ctl-px);
  box-sizing: border-box;
}
/* The chevron sits in the gutter the padding just created, so the heading TEXT still lines up
   with everything below it rather than being pushed right by its own marker.

   JUSTIFY-CONTENT IS THE ONE THAT MATTERS. A heading is a <button>, and a button given
   display:flex is centred by the user agent -- so every collapsible heading in this branch was
   sitting in the middle of its own row, at a different x per heading depending on how long the
   word was, while everything underneath was left aligned. It read as decoration rather than as
   the start of a section. text-align does not fix it because the flex box has already placed
   the line. */
html.ui-reorg .mm-group-head {
  padding-left: 0;
  justify-content: flex-start;
  text-align: left;
}
html.ui-reorg .mm-group-chev {
  width: var(--ui-ctl-px);
  margin-left: 0;
  text-align: left;
  flex-shrink: 0;
}

/* The outliner rows were 8px, the only type in the app that small. They keep their own tinted
   surface, which carries selection state, but take the shared radius and border. */
html.ui-reorg .mm-mesh-btn {
  font-size: var(--ui-ctl-fs);
  min-height: var(--ui-ctl-h-sm);
  border-radius: var(--ui-ctl-r);
}

/* Compact rows and headings settle on the small height rather than near it: 25, 26 and 27 were
   each one control finding its own answer to the same question. */
html.ui-reorg .mm-check-row,
html.ui-reorg .acp-check-row,
html.ui-reorg .mm-group-head { min-height: var(--ui-ctl-h-sm); }

/* A heading is not a control: no radius, no border, no surface. It reads as a label because it
   looks nothing like the things under it. */
html.ui-reorg .mm-group-head { border-radius: 0; border: 0; background: none; }

/* The section pin was 26px and 13px type, the only two of either in the panel. */
html.ui-reorg .mm-section-pin-btn {
  min-height: var(--ui-ctl-h-sm);
  font-size: var(--ui-ctl-fs);
  border-radius: var(--ui-ctl-r);
  border: 1px solid var(--ui-ctl-border);
  background: var(--ui-ctl-bg);
}

/* A SWATCH IS ITS OWN VALUE. The wireframe colour chip is the one button whose background is
   the thing it means, so it keeps it and takes only the frame and the radius. Normalising it
   to the control grey would have hidden the colour it exists to show. */
html.ui-reorg #mm-wf-swatch {
  min-height: var(--ui-ctl-h-sm);
  border-radius: var(--ui-ctl-r);
  border: 1px solid var(--ui-ctl-border);
}

/* ── CONFORMING THE ANIMATION PANEL ──────────────────────────────────────────
   matt: "the animation mainpanel looks nothing like the others, conform it."

   It is a parallel vocabulary: acp-* declared its own buttons, its own fields, its own
   segmented control and its own frame sizes, none of which share a line with the mm-* panels
   it sits beside. The sweep above already caught its main buttons; these are what was left.

   The transport row is deliberately NOT repacked -- matt called it out as a good use of space
   ("8 buttons across feels like a good use of space"). Only its chrome conforms: same radius,
   same border, same resting surface, same height as every other control. Its glyphs keep their
   own size, because an icon and a word do not read at the same point size. */
html.ui-reorg .acp-transport button {
  /* HEIGHT, not just min-height. The row is a grid track sized to its content, and an icon
     button's line box carries descender space the glyph never uses -- so a 13px icon in a
     zero-padding button still measured 35px and set the track. Every other control in the app
     is 30. */
  height: var(--ui-ctl-h);
  min-height: var(--ui-ctl-h);
  padding: 0;
  border: 1px solid var(--ui-ctl-border);
  border-radius: var(--ui-ctl-r);
  background: var(--ui-ctl-bg);
}

/* THE SEGMENTED CONTROL LOSES ITS FRAME. acp-mode-row drew a rounded border around three
   buttons that had none of their own; the sweep gives those three the standard button chrome,
   so the container frame became a second box drawn around three boxes. */
html.ui-reorg .acp-mode-row {
  border: 0;
  border-radius: 0;
  overflow: visible;
  gap: 4px;
}

/* Number fields: the same control as everything else you type into. They were radius 6 and
   13px type against the panel's 5 and 11. */
html.ui-reorg .acp-frame-cell input[type=number] {
  min-height: var(--ui-ctl-h);
  border: 1px solid var(--ui-ctl-border);
  border-radius: var(--ui-ctl-r);
  background: var(--ui-display-bg);
  font-size: var(--ui-ctl-fs);
  box-sizing: border-box;
}
/* The key inspector packs many small fields into one row on purpose, so it takes the COMPACT
   height rather than the full one -- conforming to the scale, not flattening the distinction. */
html.ui-reorg .acp-key-inspector .acp-frame-cell input {
  min-height: var(--ui-ctl-h-sm);
  height: auto;
  /* Border and background as well as size. Setting only the metrics left these falling back to
     the user agent's own field chrome -- a #bbb border on a #101219 ground, neither of which
     appears in any palette in this codebase. A control that is half conformed reads worse than
     one that was never touched, because the mismatch now looks deliberate. */
  border: 1px solid var(--ui-ctl-border);
  background: var(--ui-display-bg);
  color: var(--ui-text);
  border-radius: var(--ui-ctl-r);
  font-size: var(--ui-ctl-fs);
  padding: 0 6px;
  box-sizing: border-box;
}

/* THE CHECKBOXES WERE TWO DIFFERENT CONTROLS. The mm panels draw a custom 13px box (a
   .mm-checkmark span: 1px #585b70, 3px radius, #313244, accent when checked). The animation
   panel used a NATIVE input with accent-color, so the user agent drew it -- which is where the
   stray #bbb and #a6adc8 borders and the #101219 background came from, none of them in any
   palette in this codebase.

   appearance:none and the same metrics, so the two panels draw the same box. It very probably
   also fixes them in the headset: a UA-drawn control is exactly the kind of thing that does not
   survive the panel rasteriser, which is why the mm side hand-draws one in the first place.

   3px radius, not the control radius: a 13px box at 5px reads as a blob, and matching the
   panel beside it is the entire point of this pass. */
html.ui-reorg .acp-check-row input[type=checkbox] {
  appearance: none;
  -webkit-appearance: none;
  width: 13px;
  height: 13px;
  margin: 0;
  flex-shrink: 0;
  border: 1px solid #585b70;
  border-radius: 3px;
  background: #313244;
  position: relative;
  cursor: pointer;
}
html.ui-reorg .acp-check-row input[type=checkbox]:checked {
  background: var(--ui-accent);
  border-color: var(--ui-accent);
}
/* The tick, drawn the same way the mm checkmark draws it. */
html.ui-reorg .acp-check-row input[type=checkbox]:checked::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 0px;
  width: 4px;
  height: 8px;
  border: 2px solid var(--ui-panel-bg);
  border-top: 0;
  border-left: 0;
  transform: rotate(45deg);
  box-sizing: border-box;
}

/* 12px was the only body size in the app that was neither 11 nor 13. */
html.ui-reorg .acp-root,
html.ui-reorg .acp-check-row { font-size: var(--ui-ctl-fs); }

/* Native range inputs keep their own metrics: accent-color already themes them, and forcing a
   height onto the track fights the browser's thumb sizing for no gain. Deliberately out of
   scope rather than overlooked. */
`;

let _sweepEl = null;
// Called on every reorg toggle as well as at startup, so the A/B switch reaches the styling and
// not only the layout.
export function applyUISweep() {
  injectUITokens();
  const on = uiReorg();
  document.documentElement.classList.toggle('ui-reorg', on);
  if (!_sweepEl) {
    _sweepEl = document.createElement('style');
    _sweepEl.setAttribute('data-ui-sweep', '');
    document.head.appendChild(_sweepEl);
    _sweepEl.textContent = SWEEP_CSS;
  }
}

// ── EVERY SECTION TITLE BECOMES A COLLAPSIBLE, AT RUNTIME ────────────────────
//
// matt: "all those titles should be collapsable sections, and collapsed by default."
//
// DONE IN THE DOM, NOT IN THE BUILDERS. A section title is emitted as a loose
// <div class="mm-section-title">Name</div> with its content following as plain siblings --
// there is no wrapper to collapse, and there are dozens of them across a dozen builders. So
// this walks the built content afterwards and wraps each title plus everything up to the next
// title. One function, every page, no builder touched, and a section added tomorrow is
// collapsible the day it appears without anyone remembering to make it so.
//
// THE KEY IS THE TITLE TEXT, not a position, so the open/closed state survives the rebuilds
// that replace this markup wholesale (a rebuild happens on nearly every click). Duplicate
// titles inside one page get an index suffix, because "Type" appears more than once in View
// and two sections sharing one key would open and close together.
//
// Idempotent by construction: it only ever looks at titles that are not already inside a body
// it created, so running it again after a rebuild re-wraps the fresh markup and never nests.
const _slug = (t) => t.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';

export function groupSectionTitles(root, opts) {
  if (!root) return;
  const o = opts || {};
  const sel = o.selector || '.mm-section-title, .acp-section-title';
  const prefix = o.prefix || 'sec';
  // Collapsed by default. A page then opens as a list of its own sections, which is the right
  // shape for a 456px panel holding 600 to 1400px of content -- and the state is sticky, so a
  // section you work in stays open for the rest of the session.
  const dflt = o.defaultOpen === true;
  const used = new Map();

  for (const title of [...root.querySelectorAll(sel)]) {
    if (title.dataset.sectionWrapped) continue;
    const text = (title.textContent || '').trim();
    if (!text) continue;
    const base = prefix + ':' + _slug(text);
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    const key = n > 1 ? base + ':' + n : base;

    // Everything up to the next title at this level is this section's body.
    const body = document.createElement('div');
    body.className = 'mm-group-body';
    body.dataset.groupBody = key;
    let sib = title.nextElementSibling;
    while (sib && !sib.matches(sel)) {
      const next = sib.nextElementSibling;
      body.appendChild(sib);
      sib = next;
    }
    // A HEADING WITH NOTHING UNDER IT IS NOT A SECTION. View has a run of titles with their
    // content elsewhere; turning those into empty collapsibles would add a chevron that opens
    // onto nothing. Left exactly as they were.
    if (!body.children.length) { title.dataset.sectionWrapped = '1'; continue; }

    const open = groupOpen(key, dflt);
    if (!open) body.classList.add('collapsed');

    const head = document.createElement('button');
    head.className = 'mm-group-head';
    head.dataset.group = key;
    head.dataset.sectionWrapped = '1';
    const chev = document.createElement('span');
    chev.className = 'mm-group-chev';
    chev.innerHTML = open ? '&#9662;' : '&#9656;';
    head.appendChild(chev);
    head.appendChild(document.createTextNode(text));

    title.replaceWith(head);
    head.after(body);
  }
}
