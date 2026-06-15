import '@fortawesome/fontawesome-free/css/all.min.css';
import SculptGL from './SculptGL.js';
import { installFontReadyRepaint } from './gui/htmlvr/fontReady.js';

window.SculptGL = SculptGL;

// Re-rasterise panels once the FontAwesome web-font is loaded so icons don't
// intermittently bake blank on a cold load.
installFontReadyRepaint();
