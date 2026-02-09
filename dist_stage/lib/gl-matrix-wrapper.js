import './gl-matrix.js';

const globalScope = (typeof window !== 'undefined') ? window : (typeof self !== 'undefined') ? self : globalThis;
const { vec2, vec3, vec4, mat2, mat2d, mat3, mat4, quat, quat2, glMatrix } = globalScope.glMatrix;

export { vec2, vec3, vec4, mat2, mat2d, mat3, mat4, quat, quat2, glMatrix };
