import fs from 'fs';

// 1. Read GuiXR
let code = fs.readFileSync('src/gui/GuiXR.js', 'utf8');

// Replace imports with dummy or direct paths for Node
code = code.replace(/import { vec3 } from 'gl-matrix';/g, 'const vec3 = { create:()=>[], copy:()=>[], add:()=>[], sub:()=>[], transformMat4:()=>[] };');
code = code.replace(/import { mat4 } from 'gl-matrix';/g, 'const mat4 = { create:()=>[], copy:()=>[], identity:()=>[], invert:()=>[], multiply:()=>[] };');
code = code.replace(/import { quat } from 'gl-matrix';/g, 'const quat = { create:()=>[], copy:()=>[], identity:()=>[], invert:()=>[], multiply:()=>[] };');
code = code.replace(/import {?.*}? from '.*';/g, ''); // Strip ALL other imports!

// We just want to check for SYNTAX or REFERENCE errors structurally in draw!
// Wait, we need the functions it calls to be defined.
// Actually, let's just use the real files but with a custom module loader.
