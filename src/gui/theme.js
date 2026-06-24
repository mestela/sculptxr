// Shared UI palette (Catppuccin Mocha) — single source of truth for the HTML menu CSS and the
// canvas panels (timeline / blendshapes), so the VR menu reads as one consistent theme. The
// HTML panels (MainMenuPanel.js CSS) use these same hex values; canvas panels reference Theme so
// chrome (backgrounds, headers, gridlines, text) stays in sync. Semantic colours (keyframe types,
// channel colours, status) are intentionally NOT in here — they carry meaning and stay as-is.
export const Theme = {
  crust:    '#11111b', // darkest — inputs
  mantle:   '#181825', // darker surface — toolbars/headers
  base:     '#1e1e2e', // panel background
  surface0: '#313244', // buttons / hover
  surface1: '#45475a', // borders / gridlines
  surface2: '#585b70',
  overlay0: '#6c7086', // muted lines / dim text
  overlay1: '#7f849c',
  subtext:  '#a6adc8', // labels
  text:     '#cdd6f4', // primary text
  blue:     '#89b4fa', // accent / active
  mauve:    '#cba6f7',
  sky:      '#89dceb',
  yellow:   '#f9e2af',
  red:      '#f38ba8',
  green:    '#a6e3a1',
};

export default Theme;
