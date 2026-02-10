import { VERSION } from './Version.js';
import { vec3 } from 'gl-matrix';
import GuiXR from './gui/GuiXR.js';

console.log("Scene Debug Module Loaded");

export default class Scene {
  constructor() {
    console.log("Scene Debug Constructor");
  }
  start() {
    console.log("Scene Debug Start");
  }
}
