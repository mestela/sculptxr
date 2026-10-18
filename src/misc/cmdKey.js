// THE COMMAND MODIFIER FOR THIS PLATFORM: Cmd on a Mac and on an iPad or iPhone keyboard, Ctrl
// everywhere else. Every command shortcut (undo, redo, duplicate, copy, paste, cut, open, export)
// asks this, so none of them can drift back to Ctrl alone -- matt, 2026-10-19: "undo, redo, copy,
// paste all use the control key, regardless of platform. on ipad and osx it should be cmd."
//
// Decided once. iPadOS in desktop mode reports itself as a Mac ("MacIntel"), which is what we want.
//
// NOT for Ctrl as a held SCULPTING modifier (negative brush, masking, Ctrl+right-drag): that is a
// tool modifier, not a command, and stays Ctrl. Nor for the trackpad pinch, which the browser
// itself delivers as ctrlKey on every platform.
export const IS_APPLE = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '');

export function cmdKey(e) { return !!e && (IS_APPLE ? !!e.metaKey : !!e.ctrlKey); }

// Undo is Cmd/Ctrl+Z; redo is Cmd/Ctrl+Y or Cmd/Ctrl+Shift+Z (the Mac convention).
export function isUndo(e) { return cmdKey(e) && e.which === 90 && !e.shiftKey; }
export function isRedo(e) { return cmdKey(e) && (e.which === 89 || (e.which === 90 && e.shiftKey)); }
