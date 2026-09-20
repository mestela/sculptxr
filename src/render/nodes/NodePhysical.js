// THE PBR MATERIAL, ON THREE'S OWN LIT PIPELINE.
//
// This replaces the hand-transcribed BRDF in NodePBR.js. That port was faithful -- same GGX,
// same Schlick-Smith, same SH9, same deliberately non-physical 1/(1 + d²/r²) falloff -- and
// it was the right thing while the app had scenes lit by those exact constants. It does not
// any more: matt, asked whether moving to three's lighting would relight existing work,
// "there's zero existing scenes. do b."
//
// WHAT THAT BUYS, and why it is worth losing a faithful port:
//   - SHADOWS. Our BRDF summed uniform arrays that three knew nothing about, so there was no
//     light object to own a shadow map and nothing to sample. Real lights get them for free.
//   - The uber material. MeshPhysicalNodeMaterial already carries clearcoat, sheen,
//     iridescence, specular colour/intensity, IOR, transmission, thickness, attenuation,
//     dispersion and anisotropy -- most of OpenPBR, which three does NOT ship. Node materials
//     only compile the lobes whose parameters are set, so an unset feature costs nothing.
//   - scene.environment, which is the natural home for the equirect+PMREM swap.
//   - Far less of our code to own.
//
// What it costs: the falloff becomes physical, so intensities mean something different. With
// no scenes to relight that is a re-dial of the defaults, not a migration.
//
// Per-vertex channels stay ours: COLOR_0 is the paint, and aMaterial carries roughness in x
// and metalness in y, which is what a Nomad import writes and what the sculpt tools edit.

export function makePhysical(gpu, tsl) {
  const { attribute, vertexColor, float, max, pow, vec3, select } = tsl;

  // THE SAME FLAGS THE LEGACY MATERIAL USES. DoubleSide in particular is not cosmetic here:
  // sculpts are not all closed solids -- drawn planes and open surfaces are ordinary in this
  // app -- and with FrontSide their back faces vanish, which reads as objects failing to
  // depth-test against each other rather than as backface culling. matt, on a cube used as a
  // ground plane: "it looks like its just doing a dumb transform check rather than a per
  // pixel depth check".
  //
  // OPAQUE, unlike the legacy material, which sets transparent:true unconditionally "for
  // SculptXR opacity handling". Transparent materials DO NOT CAST SHADOWS -- with it set, a
  // light placed inside a closed sphere still lit the floor underneath, because the sphere
  // was casting nothing. Opaque also puts the mesh in the front-to-back opaque pass, which is
  // strictly better depth behaviour than the origin-sorted transparent one.
  //
  // The cost: a mesh with opacity < 1 will not fade until this is made per-mesh (the material
  // is shared across meshes, so the flag cannot simply be toggled here). Worth it for shadows;
  // worth revisiting when per-mesh material variants land with the texture maps.
  const m = new gpu.MeshPhysicalNodeMaterial({
    vertexColors: true,
    side: gpu.DoubleSide,
    transparent: false,
    depthTest: true,
    depthWrite: true,
  });

  // THE PIECEWISE sRGB CURVE, not pow(c, 2.2). They agree in the midtones and diverge in the
  // darks, which is where a sculpt's shadow side lives -- the difference reads as "the port
  // looks muddier" and is very hard to trace back to a colour transform.
  const srgbChannel = (x) => select(
    x.lessThan(0.04045), x.mul(1.0 / 12.92), pow(x.add(0.055).mul(1.0 / 1.055), 2.4));
  const c = vertexColor();
  m.colorNode = vec3(srgbChannel(c.r), srgbChannel(c.g), srgbChannel(c.b));

  // aMaterial is OUR per-vertex material vector: x roughness, y metalness, z masking.
  // ShaderManager renames aVertex/aNormal/aColor/aTexCoord but not this, so it arrives under
  // its own name.
  const mtl = attribute('aMaterial', 'vec3');
  m.roughnessNode = max(mtl.x, float(0.0001));
  m.metalnessNode = mtl.y;

  m.userData.isPhysicalPBR = true;
  return m;
}

export default makePhysical;
