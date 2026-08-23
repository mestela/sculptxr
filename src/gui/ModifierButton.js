import SecondaryAction from '../editing/SecondaryAction.js';
import getOptionsURL from '../misc/getOptionsURL.js';

// THE ON-SCREEN MODIFIER — the flat-screen half of SecondaryAction.
//
// Procreate and Nomad both carry one, and for the same reason: a pointer device has one button
// and a pencil has none, so a modifier has to live on the screen. Read SecondaryAction.js for
// why this is one armed shot with no timed gesture anywhere.
//
// It shows itself only when the active tool HAS a secondary action, and labels itself from that
// action rather than saying "Pin" — the channel is the point, pinning is just its first user.

const ID = 'modifier-btn';
const SIDE_OPT = 'modifierLeft';

// Thumb zone, clear of the palm on an iPad, and swappable so a left-hander is not reaching
// across their own drawing hand.
const CSS = `
#${ID} {
  position: absolute; bottom: 24px; width: 96px; height: 52px;
  display: none; align-items: center; justify-content: center;
  font: 600 15px/1 system-ui, sans-serif; letter-spacing: 0.02em;
  color: #cdd6f4; background: rgba(30, 30, 46, 0.82);
  border: 1px solid rgba(205, 214, 244, 0.28); border-radius: 10px;
  cursor: pointer; user-select: none; -webkit-user-select: none;
  touch-action: manipulation; z-index: 40;
}
#${ID}.armed {
  color: #1e1e2e; background: #f9e2af; border-color: #f9e2af;
  box-shadow: 0 0 0 3px rgba(249, 226, 175, 0.25);
}
`;

export default class ModifierButton {
  constructor(main) {
    this._main = main;
    this._el = null;
    this._build();
    this.refresh();
  }

  _build() {
    const host = document.getElementById('viewport') || document.body;
    if (!document.getElementById(ID + '-css')) {
      const style = document.createElement('style');
      style.id = ID + '-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const el = document.createElement('div');
    el.id = ID;
    // pointerdown, not click: the canvas swallows a great deal, and arming has to happen before
    // the pointer can travel anywhere. stopPropagation keeps the press off the canvas, or the
    // act of arming would also orbit the camera.
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      SecondaryAction.toggle(this._main);
      this.refresh();
    });
    host.appendChild(el);
    this._el = el;
  }

  // Cheap, and called from the places that already mean "the tool or selection changed".
  refresh() {
    const el = this._el;
    if (!el) return;
    const label = SecondaryAction.label(this._main);
    // In VR the A button IS this channel, so a screen control would be a second way to do the
    // same thing that nobody in a headset can reach. Asked here rather than from a session
    // hook: entering VR re-routes Transform to TransformVR, so a tool change always follows.
    const xr = !!this._main?._renderer?.xr?.isPresenting;
    // No secondary action on this tool means no button at all. A dead control that is always
    // present teaches people to stop looking at it.
    if (!label || xr) {
      el.style.display = 'none';
      SecondaryAction.disarm(this._main);
      return;
    }
    el.style.display = 'flex';
    el.textContent = label;
    el.classList.toggle('armed', SecondaryAction.armed(this._main));
    const left = !!getOptionsURL()[SIDE_OPT];
    el.style.left = left ? '24px' : '';
    el.style.right = left ? '' : '24px';
  }
}
