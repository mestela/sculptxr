// Node harness for src/files/ImportGLTF.js.
//
// Same stubbed-import trick as the other harnesses: the real source text is read, its imports
// are stripped and replaced with stubs, so what runs here is the shipped code.
//
// WHAT THIS GUARDS is the two things a glTF import can get wrong SILENTLY — wrong in a way the
// model looks fine with and sculpts badly a week later:
//
//   THE SEAM. glTF stores UVs per vertex, so it splits the POSITION array wherever UVs differ.
//   Imported verbatim, a seam is a crack: two vertices where the surface has one, and a brush
//   moves one side and not the other. The fix is not to drop the uvs -- it is to weld the
//   positions and keep the split in the uv CORNER indices, which is what OBJ has always done
//   here. A test that only counts vertices cannot tell the two apart, so the checks below
//   assert the RELATIONSHIP: one welded vertex, two different uv slots.
//
//   THE QUADS. glTF has no quads. FB_ngon_encoding carries them anyway -- the triangles of one
//   polygon are consecutive and share their first index -- and Nomad writes it. Decoding it is
//   a LOSSLESS restore of the authored topology, and getting it wrong yields a mesh that is
//   quietly all triangles in a quad-first application.
//
// Run: node scratchpad/gltfimport_test.mjs
import fs from 'fs';
import path from 'path';

const REPO = new URL('..', import.meta.url).pathname;
const SRC = fs.readFileSync(path.join(REPO, 'src/files/ImportGLTF.js'), 'utf8');
const SCENE = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
const MESH  = fs.readFileSync(path.join(REPO, 'src/mesh/Mesh.js'), 'utf8');
const SHMGR = fs.readFileSync(path.join(REPO, 'src/render/ShaderManager.js'), 'utf8');
const PBR   = fs.readFileSync(path.join(REPO, 'src/render/shaders/ShaderPBR.js'), 'utf8');

const body = SRC.split('\n')
  .filter((l) => !/^import\s/.test(l))
  .filter((l) => !/^export default/.test(l))
  .join('\n');

// MeshStatic records rather than renders: every call the importer makes onto a mesh is part of
// what it produces, so the recording IS the output under test.
const prelude = `
const THREE = { SRGBColorSpace: 'srgb' };
const Utils = { TRI_INDEX: 4294967295 };
const GLTFLoader = class {};
class MeshStatic {
  constructor() { this.calls = {}; }
  setVertices(v) { this.calls.vertices = v; }
  setFaces(f) { this.calls.faces = f; }
  setColors(c) { this.calls.colors = c; }
  setMaterials(m) { this.calls.materials = m; }
  setMatrix(m) { this.calls.matrix = m; }
  initTexCoordsDataFromOBJData(uv, uvf) { this.calls.uv = uv; this.calls.uvf = uvf; }
  setAlbedoMap(t) { this.calls.albedoMap = t; }
}
`;
const tail = '\nexport { decodePolygons, weld, buildUVPool, emitFace, buildMesh };\n';

const tmp = path.join(REPO, 'scratchpad', '.gltfimport_under_test.mjs');
fs.writeFileSync(tmp, prelude + body + tail);
const M = await import(tmp + '?v=' + Date.now());
fs.unlinkSync(tmp);

const TRI = 4294967295;
let fails = 0;
function check(name, cond, why) {
  if (cond) { console.log('  ok   ' + name); return; }
  fails++;
  console.log('  FAIL ' + name + (why ? '  ' + why : ''));
}

// ── FB_ngon decoding ────────────────────────────────────────────────────────────────
//
// Two quads, fan triangulated: (0,1,2)(0,2,3) and (4,5,6)(4,6,7). The runs share first indices
// 0 and 4, so this is two polygons of four -- not four triangles.
{
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const on = M.decodePolygons(idx, true);
  check('FB_ngon: a fan run becomes one polygon',
    on.length === 2 && on[0].length === 4 && on[1].length === 4,
    'got ' + JSON.stringify(on));
  check('...with the corners in order',
    on[0].join(',') === '0,1,2,3' && on[1].join(',') === '4,5,6,7');

  // THE DECLARATION IS NOT THE TEST, because Nomad does not declare it. Measured on a real
  // Nomad 11 export: extensionsUsed carries only the KHR material extensions while the index
  // data is fan-encoded throughout. Gating on the declaration imported the lot as triangles.
  check('...and an undeclared file decodes the same way, because the structure is the test',
    M.decodePolygons(idx, false).length === 2);

  // SHARING A FIRST INDEX IS NOT ENOUGH, and this is the check that keeps the above honest.
  // (0,1,2) and (0,4,5) share vertex 0 and are two unrelated triangles: the second does not
  // start its edge where the first finished, so there is no rim to walk and no polygon here.
  // An ordinary triangle list hits this case by chance; a fan never does.
  const notAFan = [0, 1, 2, 0, 4, 5];
  const nf = M.decodePolygons(notAFan, true);
  check('...but a shared first index alone does NOT merge',
    nf.length === 2 && nf.every((p) => p.length === 3),
    'without the edge chain this would invent a quad across two unrelated triangles');

  // The escape hatch, for a file that fools it anyway.
  globalThis.window = { _glbNoQuads: true };
  check('...and _glbNoQuads forces triangles',
    M.decodePolygons(idx, true).length === 4);
  globalThis.window = undefined;

  // A polygon of 5+ cannot be held by this app (tris and quads only), so it fans into quads
  // plus at most one triangle -- the same walk-in-from-both-ends OBJ import uses.
  const fAr = [];
  M.emitFace([0, 1, 2, 3, 4], fAr, null, null, null);
  let q = 0, t = 0;
  for (let i = 0; i < fAr.length; i += 4) (fAr[i + 3] === TRI ? t++ : q++);
  check('...and a 5-gon becomes quads plus at most one triangle', q >= 1 && t <= 1,
    'got ' + q + ' quads, ' + t + ' tris');
}

// ── welding ─────────────────────────────────────────────────────────────────────────
{
  // Four positions, the last a bit-exact duplicate of the first.
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0]);
  const w = M.weld(pos, 4);
  check('weld: bit-identical positions collapse',
    w.rep.length === 3 && w.merged === 1, JSON.stringify({ n: w.rep.length, merged: w.merged }));
  check('...and both originals map to the same vertex', w.map[0] === w.map[3]);
  // EXACT, not tolerant: these duplicates were made by splitting one vertex, and an epsilon
  // would start merging detail the author put there.
  const near = new Float32Array([0, 0, 0, 0.001, 0, 0]);
  check('...but merely NEARBY positions do not', M.weld(near, 2).rep.length === 2,
    'a tolerance here would eat small detail; that is GeometryWorker\'s job, not this one');
}

// ── the seam, end to end ────────────────────────────────────────────────────────────
//
// The fixture is the shape of the problem: two quads that meet along an edge, where the shared
// edge is SPLIT in the source because the uvs differ across it. Correct import welds the four
// duplicated positions down and keeps two uv slots for them.
{
  const geo = {
    attributes: {
      position: { count: 8, itemSize: 3, array: new Float32Array([
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
        1, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0]) },
      uv: { count: 8, itemSize: 2, array: new Float32Array([
        0, 0, 0.5, 0, 0.5, 1, 0, 1,
        0, 0, 0.5, 0, 0.5, 1, 0, 1]) },
    },
    index: { array: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]) },
  };
  const obj = {
    isMesh: true, name: 'GridA', geometry: geo,
    material: { color: { r: 0.8, g: 0.1, b: 0.1 }, roughness: 0.7, metalness: 0.25 },
    matrixWorld: { elements: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 5,2,0,1]) },
    updateMatrixWorld() {},
  };
  const stats = { meshes: 0, verts: 0, quads: 0, merged: 0, uvs: 0, transmissive: 0, textured: 0, ngon: true };
  const mesh = M.buildMesh([obj], null, 'GridA', stats);
  const c = mesh.calls;

  check('import: the seam welds to one surface',
    c.vertices.length / 3 === 6 && stats.merged === 2,
    '8 source vertices, 2 of them duplicate positions -> 6');
  check('...and the quads survive a format with no quads', stats.quads === 2
    && c.faces.length / 4 === 2 && c.faces[3] !== TRI);

  // THE POINT OF THE WHOLE EXERCISE: the welded vertex is ONE vertex carrying TWO uvs. If the
  // importer dropped the uv split the model would be welded but texture wrong; if it skipped
  // the weld it would be uv-correct and torn. Both must hold at once.
  const vertOfCorner = (i) => c.faces[i];
  const uvOfCorner = (i) => c.uvf[i];
  let sharedVertexWithTwoUVs = false;
  for (let i = 0; i < c.faces.length; i++) {
    for (let j = i + 1; j < c.faces.length; j++) {
      if (c.faces[i] === TRI || c.faces[j] === TRI) continue;
      if (vertOfCorner(i) === vertOfCorner(j) && uvOfCorner(i) !== uvOfCorner(j)) sharedVertexWithTwoUVs = true;
    }
  }
  check('...one vertex, two uv slots -- welded AND unwrapped',
    sharedVertexWithTwoUVs,
    'this is the check that tells a real seam from a dropped one');

  check('...the uv corner list lines up with the faces', c.uvf.length === c.faces.length);
  check('...material factors ride along as per-vertex values',
    Math.abs(c.materials[0] - 0.7) < 1e-6 && Math.abs(c.materials[1] - 0.25) < 1e-6
      && c.materials[2] === 1,
    'the mask slot must start at 1 or the mesh imports fully masked');
  check('...base colour floods the mesh', Math.abs(c.colors[0] - 0.8) < 1e-6);
  // The node's place in the world is the character staying assembled.
  check('...and the node transform is kept',
    c.matrix[12] === 5 && c.matrix[13] === 2);
}

// ── no uvs at all ───────────────────────────────────────────────────────────────────
{
  const geo = {
    attributes: { position: { count: 3, itemSize: 3, array: new Float32Array([0,0,0, 1,0,0, 0,1,0]) } },
    index: { array: new Uint32Array([0, 1, 2]) },
  };
  const obj = { isMesh: true, name: 'Bare', geometry: geo, material: null,
    matrixWorld: { elements: new Float32Array(16) }, updateMatrixWorld() {} };
  const stats = { meshes: 0, verts: 0, quads: 0, merged: 0, uvs: 0, transmissive: 0, textured: 0, ngon: false };
  const mesh = M.buildMesh([obj], null, 'Bare', stats);
  check('a mesh with no uvs imports without inventing any',
    mesh.calls.uv === undefined && mesh.calls.faces.length === 4
      && mesh.calls.faces[3] === TRI);
}

// ── primitives of one mesh are ONE object ───────────────────────────────────────────
//
// glTF allows one material per primitive, so an object painted with three materials is stored
// as three primitives OF THE SAME MESH sharing one vertex buffer and splitting the index list.
// Imported one-for-one that turned a 6-object camel into 13, with `body` arriving three times
// carrying all its vertices and a third of its faces each. They merge back into one object,
// and each primitive's material lands on the vertices that primitive uses.
{
  // Six positions; primitive A uses the first four, primitive B the last four (two shared).
  const pos = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0, 2,0,0, 2,1,0]);
  const shared = { count: 6, itemSize: 3, array: pos };
  const prim = (indices, colour, rough) => ({
    isMesh: true, name: 'part', geometry: { attributes: { position: shared }, index: { array: new Uint32Array(indices) } },
    material: { color: { r: colour, g: colour, b: colour }, roughness: rough, metalness: 0 },
    matrixWorld: { elements: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]) },
    updateMatrixWorld() {},
  });
  const A = prim([0,1,2, 0,2,3], 0.25, 0.1);       // quad 0-1-2-3
  const B = prim([1,4,5, 1,5,2], 0.75, 0.9);       // quad 1-4-5-2
  const stats = { meshes: 0, verts: 0, quads: 0, merged: 0, uvs: 0, transmissive: 0, textured: 0, ngon: true };
  const mesh = M.buildMesh([A, B], null, 'body', stats);
  const c = mesh.calls;

  check('primitives of one mesh become ONE object',
    stats.meshes === 1 && c.faces.length / 4 === 2 && stats.quads === 2,
    'two primitives, one vertex pool, both quads -- got ' + (c.faces.length / 4) + ' faces');
  check('...sharing one vertex pool rather than duplicating it',
    c.vertices.length / 3 === 6, 'got ' + (c.vertices.length / 3));
  // Vertex 0 belongs to A only, vertex 4 to B only. A is roughness 0.1 / colour 0.25;
  // B is roughness 0.9 / colour 0.75.
  check('...with each primitive\'s material on ITS vertices',
    Math.abs(c.materials[0 * 3] - 0.1) < 1e-6 && Math.abs(c.materials[4 * 3] - 0.9) < 1e-6,
    'got ' + c.materials[0] + ' and ' + c.materials[12]);
  check('...and each primitive\'s colour likewise',
    Math.abs(c.colors[0 * 3] - 0.25) < 1e-6 && Math.abs(c.colors[4 * 3] - 0.75) < 1e-6,
    'got ' + c.colors[0] + ' and ' + c.colors[12]);
  check('...and the name comes from the mesh, not the primitive',
    mesh._permanentStaticLabel === 'body');
}

// A primitive's own slice leaves the rest of the shared buffer unreferenced; those must not
// import as stray points.
{
  const pos = new Float32Array([0,0,0, 1,0,0, 0,1,0, 9,9,9]);   // the last is used by nothing
  const obj = {
    isMesh: true, name: 'Slice',
    geometry: { attributes: { position: { count: 4, itemSize: 3, array: pos } },
                index: { array: new Uint32Array([0,1,2]) } },
    material: null, matrixWorld: { elements: new Float32Array(16) }, updateMatrixWorld() {},
  };
  const stats = { meshes: 0, verts: 0, quads: 0, merged: 0, uvs: 0, transmissive: 0, textured: 0, ngon: false };
  const mesh = M.buildMesh([obj], null, 'Slice', stats);
  check('unreferenced vertices in a shared buffer are left behind',
    mesh.calls.vertices.length / 3 === 3,
    'got ' + (mesh.calls.vertices.length / 3) + ' — a primitive must not import its siblings\' vertices');
}

// ── normalized attributes ───────────────────────────────────────────────────────────
//
// glTF stores COLOR_0 as normalized ushort by default, so a white vertex is 65535. Read raw and
// written into a float colour that clamps at 1, the WHOLE MODEL imports white and nothing warns.
// matt: "it loads correctly into other online glb viewers, but in here it loads unlit white."
{
  const geo = {
    attributes: {
      position: { count: 3, itemSize: 3, array: new Float32Array([0,0,0, 1,0,0, 0,1,0]) },
      // 0.5-ish grey as a normalized ushort, and full white
      color: { count: 3, itemSize: 4, normalized: true,
               array: new Uint16Array([32768,32768,32768,65535, 65535,65535,65535,65535, 0,0,0,65535]) },
      // Nomad's material vector: normalized ubyte (roughness, metalness, mask, -)
      color_1: { count: 3, itemSize: 4, normalized: true,
                 array: new Uint8Array([40,0,255,0, 40,0,255,0, 40,0,255,0]) },
    },
    index: { array: new Uint32Array([0,1,2]) },
  };
  const obj = { isMesh: true, name: 'C', geometry: geo, material: null,
    matrixWorld: { elements: new Float32Array(16) }, updateMatrixWorld() {} };
  const stats = { meshes:0, verts:0, quads:0, merged:0, uvs:0, transmissive:0, textured:0,
                  perVertexMaterial:0, vertexColours:0, ngon:false };
  const c = M.buildMesh([obj], null, 'C', stats).calls;
  check('a normalized ushort colour is divided down, not clamped to white',
    Math.abs(c.colors[0] - 0.5) < 0.01 && c.colors[3] === 1 && c.colors[6] === 0,
    'got ' + c.colors[0] + ' — reading the raw 32768 makes every model white');
  // COLOR_1 is not a second colour set: Nomad packs (roughness, metalness, mask) there, which is
  // exactly Mesh.setMaterials' vector, both apps being SculptGL descendants. Verified against
  // the same file's material factors: gums 40/255 = 0.157 against roughness 0.157.
  check('COLOR_1 becomes the per-vertex material, denormalized',
    Math.abs(c.materials[0] - 40/255) < 1e-6 && c.materials[1] === 0 && c.materials[2] === 1,
    'got ' + Array.from(c.materials.slice(0,3)).join(','));
  check('...and the mask slot lands at 1, not 0',
    c.materials[2] === 1 && c.materials[5] === 1,
    'a mask below 1 imports a model that silently refuses to sculpt in places');
  check('...and it is preferred over the material factor, being per vertex',
    /Taken in preference to the material factor because it is PER VERTEX/.test(SRC));
}

// ── units ───────────────────────────────────────────────────────────────────────────
//
// Nomad's units are not scene units: the live link has always scaled by `_nomadScale` on the
// way in, and a glb exported from the same Nomad scene is in the same units. Without the
// conversion the character lands at a fiftieth of its size and everything measured in scene
// units -- brush radius, bone width, the grid -- is wrong against it. matt: "nomad link seems
// to bring things in at an appropriate scale, while the glb import is tiny."
check('the importer reports who wrote the file',
  /generator: \(json\.asset && json\.asset\.generator\) \|\| ''/.test(SRC));
check('...and a Nomad glb takes the same conversion as the Nomad link',
  /const nomad = \/nomad\/i\.test\(stats\.generator \|\| ''\);/.test(SCENE)
    && /const s = nomad \? \(this\._nomadScale \|\| 1\) : 1;/.test(SCENE),
  'two routes from one application must not disagree about its units');
check('...applied as scale BEFORE the node placement, like _applyNomadMatrix',
  /mat4\.multiply\(m, S, m\);/.test(SCENE),
  'post-multiplying would scale the geometry and leave the positions behind');
check('...and only for Nomad, since a Blender glb is in metres',
  /Keyed on the GENERATOR, not applied to everything/.test(SCENE));

// ── the toast is a VR affordance ────────────────────────────────────────────────────
//
// _updateVrFloaters parks the toast above the right controller and hides it when its window
// closes -- and it returns immediately when there is no XR camera. So on desktop _showToolToast
// turned a world-space plane ON and nothing ever turned it off or placed it: it sat at the
// world origin for the rest of the session, invisible only because models are usually big
// enough to hide it.
check('the tool toast does not run on desktop',
  /if \(!this\._renderer\?\.xr\?\.isPresenting\) return;/.test(SCENE),
  'a VR floater with no updater on desktop is a permanent object at the origin');

// ── the albedo map, and the uv pipeline it needs ────────────────────────────────────
//
// The UV machinery was all present and simply never switched on outside the two UV DISPLAY
// modes: in ordinary PBR viewing the geometry carried no `uv` attribute and the index buffer
// used the UNDUPLICATED triangles, so the seam vertices the app had already built never
// reached the GPU. A textured mesh needs the same pipeline for the ordinary shader.
check('a mesh with a texture map runs the uv pipeline',
  /return !!\(this\.hasTextureMap\(\) && this\.hasUV\(\)\);/.test(MESH),
  'without this the geometry has no uv attribute and there is nothing to sample');
check('...and switching it on rebuilds the duplicates and the buffers',
  /if \(this\.hasUV\(\)\) \{ this\.updateDuplicateGeometry\(\); this\.updateDrawArrays\(\); \}/.test(MESH),
  'the uv-indexed triangles address duplicated vertices that must exist first');

// Materials are cached ONE PER SHADER TYPE and updateUniforms runs over every mesh BEFORE
// renderer.render(), so a texture on the shared material would be the last mesh's texture on
// every mesh in the scene.
check('a textured mesh gets its own material',
  /ShaderManager\.getMaterialFor = function\(mesh, shaderId\)/.test(SHMGR)
    && /\(mesh\.hasTextureMap && mesh\.hasTextureMap\(\)\)/.test(SHMGR)
    && /if \(!needsOwn\) return shared;/.test(SHMGR),
  'a shared material cannot carry a per-mesh texture');
check('...and every material assignment goes through it',
  !/= ShaderManager\.getMaterial\(this\.getShaderType\(\)\);/.test(MESH)
    && !/material = ShaderManager\.getMaterial\(shaderName\);/.test(MESH),
  'one site still handing out the shared material undoes the clone');
check('...bound per mesh, since the legacy uniform path knows nothing about it',
  /unifs\.uAlbedoMap\.value = amap \|\| ShaderManager\._dummyTex;/.test(SHMGR));

// uTexture0 is the ENVIRONMENT in this shader and always has been.
check('the PBR shader samples a SECOND texture, not the environment one',
  /'uAlbedoMap', 'uHasAlbedo'/.test(PBR) && /uniform sampler2D uAlbedoMap;/.test(PBR));
check('...multiplying the vertex colour rather than replacing it',
  /if \(uHasAlbedo > 0\.5\) baseColor \*= texture2D\(uAlbedoMap, vAlbedoUv\)\.rgb;/.test(PBR),
  'glTF means baseColorFactor x baseColorTexture, and Nomad puts flat colour in one and detail in the other');
check('...through the same sRGB conversion the vertex colour uses',
  /vec3 linColor = sRGBToLinear\(baseColor\);/.test(PBR),
  'two conversions would let the map and the colour it multiplies drift a gamma apart');
check('...and the texture is marked sRGB with glTF flipY',
  /tex\.colorSpace = THREE_SRGB;/.test(SRC) && /tex\.flipY = false;/.test(SRC));

// ── transmission ────────────────────────────────────────────────────────────────────
//
// KHR_materials_transmission, as much of it as an IBL-only shader can honour. The camel's outer
// eye is transmissionFactor 1 and imported as an opaque white shell over the iris.
check('a transmissive material is read off the glTF material',
  /const trans = prims\.map\(matOf\)\.find\(\(m\) => m && m\.transmission > 0\);/.test(SRC)
    && /mesh\.setTransmission\(trans\.transmission\)/.test(SRC));

// Removing the DIFFUSE and keeping the reflection is the difference between glass and fog:
// fading the whole shaded result with opacity takes the highlights down with it.
check('transmission removes the diffuse, not the highlights',
  /vec3 albedo = linColor \* \(1\.0 - metallic\) \* \(1\.0 - uTransmission\);/.test(PBR),
  'scaling the final colour by opacity instead makes a clear shell read as milky');
check('...with a fresnel-weighted alpha so a curved clear surface still reads as curved',
  /float fres = pow\(1\.0 - clamp\(dot\(normal, V\), 0\.0, 1\.0\), 3\.0\);/.test(PBR));

// AND THE ALPHA MUST NOT UNDO IT. The note above says fading the shaded result takes the
// highlights with it -- and that is precisely what happened one step later, because ordinary
// blending multiplies the WHOLE fragment by alpha. The reflection and the GGX highlights were
// always computed for a transmissive surface (roughness and `specular` are untouched by
// transmission, so the glossy value always fed both), and then at transmission 1 a head-on
// fragment was scaled to 0.12 and 88% of the result was discarded. matt: "transparent surfaces
// (like the outer eye) should read the glossy value, and reflect the environment, do specular
// highlights."
//
// A reflection is light ARRIVING, not a measure of how solid the surface is: glass gets more
// opaque where it catches a highlight. So luminance raises alpha, scaled by uTransmission so an
// opaque surface is untouched.
check('...and a reflection RAISES alpha rather than being faded out by it',
  /float lum = dot\(color, vec3\(0\.2126, 0\.7152, 0\.0722\)\);/.test(PBR)
    && /alpha = clamp\(clearAlpha \+ lum \* uTransmission, 0\.0, 1\.0\);/.test(PBR),
  'multiplying the fragment by a low alpha erases the highlight it just computed');
// Rec.709, not a channel average: a blue-grey environment reflection and a warm highlight should
// raise alpha by what they look like.
check('...weighted by luma, not by a flat channel average',
  !/dot\(color, vec3\(0\.3333/.test(PBR));
// The glossy value was never the missing piece -- worth asserting so it is not "fixed" again.
check('...with roughness and specular untouched by transmission',
  /vec3 specular = mix\( vec3\(0\.04\), linColor, metallic\);/.test(PBR)
    // Line-scoped. `[^;]*` spanned the comment block above and matched the prose describing
    // this very rule, which is a test that passes on its own documentation.
    && !/roughness\s*[*=][^\n]*uTransmission/.test(PBR),
  'transmission removes diffuse only; gloss feeds the IBL and the light loop as it always did');

// Every sculpt material writes depth, which is right for a solid and fatal for a shell with
// something inside it.
check('a transmissive mesh stops writing depth',
  /per\[shaderId\]\.depthWrite = !\(mesh\.getTransmission && mesh\.getTransmission\(\) > 0\);/.test(SHMGR),
  'writing depth hides the iris inside the eye and punches a hole in what is behind');
check('...and gets its own material to do it on',
  /\(mesh\.getTransmission && mesh\.getTransmission\(\) > 0\)/.test(SHMGR)
    && /var needsOwn =/.test(SHMGR));
check('...restored when transmission goes back to zero',
  !/if \(mesh\.getTransmission && mesh\.getTransmission\(\) > 0\) \{\s*\n\s*per\[shaderId\]\.depthWrite = false;/.test(SHMGR),
  'a mesh keeping its own material for another reason would keep depth off for good');
// Refraction is NOT claimed: bending what is behind needs the scene in a buffer first.
check('...and the shader says plainly that ior is read and ignored',
  /What this is NOT: refraction/.test(PBR));

// ── metal/rough map, and the lighting it needed ─────────────────────────────────────
check('the packed metal/rough texture is imported',
  /const withRM = prims\.map\(matOf\)\.find\(\(m\) => m && \(m\.roughnessMap \|\| m\.metalnessMap\)\);/.test(SRC));
check('...left LINEAR, unlike the colour map',
  /NO colorSpace here, unlike the albedo map/.test(SRC),
  'calling data sRGB bends every roughness value on the way in');
check('...roughness from GREEN and metalness from BLUE, times their factors',
  /roughness = max\( 0\.0001, uRoughFactor \* rm\.g \);/.test(PBR)
    && /metallic = uMetalFactor \* rm\.b;/.test(PBR));
// The map REPLACES the per-vertex values, the opposite of what the albedo map does: glTF has
// no per-vertex roughness, so where a file carries the texture the texture is authoritative.
check('...replacing the per-vertex values rather than multiplying them',
  /THE MAP REPLACES the per-vertex values/.test(PBR));
check('...and any map, not just albedo, turns on the uv pipeline',
  /hasTextureMap\(\) \{ return !!\(this\._albedoMap \|\| this\._roughMetalMap/.test(MESH)
    && /return !!\(this\.hasTextureMap\(\) && this\.hasUV\(\)\);/.test(MESH));

// THE ENVIRONMENT HAS BEEN UNBOUND SINCE THE THREE.JS PORT. The mocked gl that intercepts the
// legacy uniform calls had no TEXTURE0 constant, so `gl.TEXTURE0` was undefined, the unit
// resolved to NaN, and the bind looked up `uTextureNaN` and found nothing. uTexture0 stayed
// null, computeIBL_UE4 had no panorama, and the shader ran on SH ambient alone -- which is why
// roughness and metalness had no visible effect at all.
check('the mocked gl carries the texture constants the shaders ask it for',
  /mockGL\.TEXTURE0 = 0x84C0;/.test(SHMGR) && /mockGL\.TEXTURE_2D = 0x0DE1;/.test(SHMGR),
  'without them the environment map silently never binds');
check('...and a missing constant falls back to unit 0 rather than NaN',
  /var u = \(typeof unit === 'number' && isFinite\(unit\)\) \? unit - 0x84C0 : 0;/.test(SHMGR),
  'NaN is what made this silent: a bad unit should cost the wrong texture, not the binding');
// uEnvSize is the panorama's dimensions and the specular lookup needs them for its mip.
check('the environment learns its own size when it loads',
  /if \(tex && tex\.image\) env\.size = \[tex\.image\.width, tex\.image\.height\];/.test(PBR),
  'no environment declares a size, so the guard in updateUniforms never fired and it sat at 0,0');

// ── normal maps, without tangents ───────────────────────────────────────────────────
check('the normal map is imported, linear and with its scale',
  /const withN = prims\.map\(matOf\)\.find\(\(m\) => m && m\.normalMap\);/.test(SRC)
    && /withN\.normalScale && withN\.normalScale\.x !== undefined \? withN\.normalScale\.x : 1/.test(SRC));

// NO TANGENT ATTRIBUTE, and in a sculpting application that is the correct call rather than a
// shortcut: a tangent is derived from positions and uvs, so it is STALE the moment a brush
// moves a vertex. Caching one means recomputing it with the normals on every stroke, on every
// level of the multires stack, or lighting that drifts off the surface it describes.
check('tangents come from derivatives, not from a cached attribute',
  /mat3 cotangentFrame\(vec3 N, vec3 p, vec2 uv\) \{/.test(PBR)
    && /vec3 dp1 = dFdx\(p\);/.test(PBR),
  'a tangent attribute goes stale under every brush stroke');
check('...and nothing added a tangent buffer to the mesh pipeline',
  !/setTangents|aTangent|getTangentBuffer/.test(MESH),
  'the point of the derivative frame is that the buffer pipeline is untouched');
// A degenerate uv triangle gives T = B = 0, and inversesqrt(0) is infinity -> a NaN normal.
check('...guarded against a degenerate uv triangle',
  /inversesqrt\(max\(max\(dot\(T, T\), dot\(B, B\)\), 1e-12\)\)/.test(PBR),
  'without the floor a zero-area uv face paints NaN');
check('...perturbing in VIEW space, where both the normal and vVertex already are',
  /normal = normalize\(cotangentFrame\(normal, vVertex, vAlbedoUv\) \* mapN\);/.test(PBR));
check('...and the scale applies to xy only, as glTF specifies',
  /mapN\.xy \*= uNormalScale;/.test(PBR));
check('a normal map also turns on the uv pipeline',
  /this\._albedoMap \|\| this\._roughMetalMap \|\| this\._normalMap/.test(MESH));

console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nall checks passed');
process.exit(fails ? 1 : 0);
