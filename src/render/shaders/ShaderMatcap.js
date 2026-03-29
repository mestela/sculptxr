import TR from '../../gui/GuiTR.js';
import ShaderBase from './ShaderBase.js';
import { mat3, mat4 } from 'gl-matrix';
import * as THREE from 'three';

var ShaderMatcap = ShaderBase.getCopy();
ShaderMatcap.vertexName = ShaderMatcap.fragmentName = 'Matcap';

ShaderMatcap.textures = [];

var texPath = 'app/resources/matcaps/';
ShaderMatcap.matcaps = [{
  path: texPath + 'matcapFV.jpg',
  name: 'matcap FV' // too lazy to tr
}, {
  path: texPath + 'redClay.jpg',
  name: 'Red clay' // too lazy to tr
}, {
  path: texPath + 'skinHazardousarts.jpg',
  name: 'Skin hazardousarts' // too lazy to tr
}, {
  path: texPath + 'skinHazardousarts2.jpg',
  name: 'Skin Hazardousarts2' // too lazy to tr
}, {
  path: texPath + 'pearl.jpg',
  name: TR('matcapPearl')
}, {
  path: texPath + 'clay.jpg',
  name: TR('matcapClay')
}, {
  path: texPath + 'skin.jpg',
  name: TR('matcapSkin')
}, {
  path: texPath + 'green.jpg',
  name: TR('matcapGreen')
}, {
  path: texPath + 'white.jpg',
  name: TR('matcapWhite')
}];

ShaderMatcap.uniforms = {};
ShaderMatcap.attributes = {};

ShaderMatcap.uniformNames = ['uTexture0', 'uAlbedo', 'uRotCorrection', 'uFlat'];
Array.prototype.push.apply(ShaderMatcap.uniformNames, ShaderBase.uniformNames.commonUniforms);

ShaderMatcap.vertex = [
  'attribute vec3 aVertex;',
  'attribute vec3 aNormal;',
  'attribute vec3 aColor;',
  'attribute vec3 aMaterial;',
  ShaderBase.strings.vertUniforms,
  'varying highp vec3 vVertex;',
  'varying vec3 vNormal;',
  'varying vec3 vColor;',
  'varying float vMasking;',
  'varying highp vec3 vVertexPres;',
  'uniform vec3 uAlbedo;',
  'void main() {',
  '  vColor = uAlbedo.x >= 0.0 ? uAlbedo : aColor;',
  '  vMasking = aMaterial.z;',
  '  vNormal = mix(aNormal, uEN * aNormal, vMasking);',
  '  vNormal = normalize(mat3(uMV) * vNormal);',
  '  vec4 vertex4 = vec4(aVertex, 1.0);',
  '  vertex4 = mix(vertex4, uEM * vertex4, vMasking);',
  '  vVertex = vec3(uMV * vertex4);',
  '  vVertexPres = vVertex;', // Optimized: VR uses Perspective, skip Ortho hacks
  '  gl_Position = uMVP * vertex4;',
  '}'
].join('\n');

ShaderMatcap.fragment = [
  'precision highp float;', // Fix for solarization/overflow artifacts
  'uniform sampler2D uTexture0;',
  'varying highp vec3 vVertex;',
  'varying highp vec3 vVertexPres;',
  'varying vec3 vNormal;',
  'varying vec3 vColor;',
  'uniform float uAlpha;',
  // 'uniform int uFlat;', // Defined in ShaderBase.strings.fragColorUniforms
  'uniform mat3 uRotCorrection;', // Stabilizes normals to Horizon
  ShaderBase.strings.fragColorUniforms,
  ShaderBase.strings.fragColorFunction,
  'void main() {',
  '  vec3 normal = vNormal;',
  '  if (uFlat > 0) {',
  '    normal = normalize(cross(dFdx(vVertex), dFdy(vVertex)));',
  '  }',
  '  // Stabilize Normal: Transform View Space Normal -> Billboard Space Normal',
  '  normal = normalize(uRotCorrection * normal);',
  '  ',
  '  // Reverted to standard XY after fixing world offset',
  '  vec2 texCoord = normal.xy * 0.5 + 0.5;',
  '  // texCoord.y = 1.0 - texCoord.y; // Keep Y upright',
  '  vec3 color = texture2D(uTexture0, texCoord).rgb * vColor; // Double gamma removed',
  '  // Bypass encodeFragColor (which does sRGB conversion) to prevent double-sRGB washing out',
  '  gl_FragColor = vec4(color, uAlpha);',
  '}'
].join('\n');

ShaderMatcap.updateUniforms = function (mesh, main) {
  var gl = mesh.getGL();
  var uniforms = this.uniforms;

  var matIndex = mesh.getMatcap();
  var tex = ShaderMatcap.textures[matIndex];

  if (!window.loggedTextureState) {
    // console.log("MatCap Debug - Index: " + matIndex + " Texture:", tex);
    // if (window.screenLog) window.screenLog("MatCap Debug: idx=" + matIndex, "cyan");

    window.loggedTextureState = true;
  }

  gl.uniform1i(uniforms.uFlat, mesh.getFlatShading()); // Pass Flat Flag

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex || this.getOrCreateTexture0(gl, 'app/resources/matcaps/matcapFV.jpg', main));
  gl.uniform1i(uniforms.uTexture0, 0);

  // --- Compute Billboard Stabilization Matrix ---
  // Goal: Aim Matcap at the viewer's POSITION, ignoring Head Rotation.
  // This ensures the lighting "Look" vector follows the viewer (yaw) but doesn't roll/pitch with the head.

  if (!this._cacheMats) {
    this._cacheMats = {
      viewInv: mat4.create(),
      camBasis: mat3.create(),
      stabBasis: mat3.create(),
      corrMat: mat3.create()
    };
  }
  const mats = this._cacheMats;
  const view = main.getCamera().getView();

  // 1. Get Camera World Matrix (Inverse View)
  mat4.invert(mats.viewInv, view);

  // 2. Extract Camera Position (World Space) and use it as Forward Vector
  // We assume the object is at (0,0,0) (common in SculptGL/VR focus).
  // Ideally we'd use (CameraPos - ModelPos), but ModelPos varies.
  // Using CameraPos as the "Look Vector" is a robust approximation for "Billboard aiming".
  const cx = mats.viewInv[12];
  const cy = mats.viewInv[13];
  const cz = mats.viewInv[14];

  // Back Vector = Normalize(CameraPos - Origin)
  // This aims the Matcap at the viewer's *Position*.
  let len = Math.sqrt(cx * cx + cy * cy + cz * cz);
  let bx, by, bz;
  if (len < 0.001) {
    // User inside object? Use Camera Back as fallback.
    bx = mats.viewInv[8]; by = mats.viewInv[9]; bz = mats.viewInv[10];
  } else {
    bx = cx / len; by = cy / len; bz = cz / len;
  }

  // 3. Construct Stabilized Basis (Billboard)
  // We keep 'Back' (Aim at Viewer), and force 'Right' to be horizontal.
  // Right = Cross(WorldUp, Back) = Cross((0,1,0), B) = (bz, 0, -bx)
  let srx = bz;
  let sry = 0.0;
  let srz = -bx;

  // Normalize Right
  len = Math.sqrt(srx * srx + srz * srz);
  if (len < 0.001) {
    // Looking from top/bottom. Fallback to Camera Right.
    srx = mats.viewInv[0]; sry = mats.viewInv[1]; srz = mats.viewInv[2];
  } else {
    srx /= len; srz /= len;
  }

  // Up = Cross(Back, Right)
  // B x SR
  const sux = by * srz - bz * sry;
  const suy = bz * srx - bx * srz;
  const suz = bx * sry - by * srx;

  // 4. Compute Correction Rotation
  // We want to transform Normal_View -> Normal_Stab
  // Normal_World = CamBasis * Normal_View
  // Normal_World = StabBasis * Normal_Stab  =>  Normal_Stab = StabBasis^T * Normal_World
  // Normal_Stab = StabBasis^T * (CamBasis * Normal_View)
  // Correction = StabBasis^T * CamBasis

  // Extract View Rotation Submatrix (CamBasis)
  // This represents the Actual Camera Rotation
  const rx = mats.viewInv[0], ry = mats.viewInv[1], rz = mats.viewInv[2];
  const ux = mats.viewInv[4], uy = mats.viewInv[5], uz = mats.viewInv[6];
  const cbx = mats.viewInv[8], cby = mats.viewInv[9], cbz = mats.viewInv[10];

  const C = mats.camBasis;
  C[0] = rx; C[1] = ry; C[2] = rz;
  C[3] = ux; C[4] = uy; C[5] = uz;
  C[6] = cbx; C[7] = cby; C[8] = cbz;

  // Fill StabBasis (Col-Major)
  // This represents our Ideal Billboard Rotation
  const S = mats.stabBasis;
  S[0] = srx; S[1] = sry; S[2] = srz;
  S[3] = sux; S[4] = suy; S[5] = suz;
  S[6] = bx; S[7] = by; S[8] = bz;

  // Correction = Transpose(S) * C
  mat3.transpose(S, S); // Invert S
  mat3.mul(mats.corrMat, S, C);

  gl.uniformMatrix3fv(uniforms.uRotCorrection, false, mats.corrMat);

  gl.uniform3fv(uniforms.uAlbedo, mesh.getAlbedo());
  ShaderBase.updateUniforms.call(this, mesh, main);
};

window.ShaderMatcap = ShaderMatcap;

export default ShaderMatcap;
