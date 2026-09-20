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

  // FrontSide, NOT DoubleSide -- despite the legacy material using DoubleSide.
  //
  // DoubleSide on this renderer eats large curved patches out of a closed sculpt: matt, "very
  // strange render artifacts; front and sides of the sphere are missing". Reproduced on
  // desktop and isolated by toggling the one flag at runtime -- FrontSide is clean, DoubleSide
  // is not. It is NOT shadow acne, which was the obvious reading of a dark blotchy surface:
  // the artifact is identical with renderer.shadowMap.enabled turned off. Cause unknown; the
  // back faces appear to win the depth test in patches.
  //
  // The cost is real and should not be lost: open surfaces (drawn planes) will show from one
  // side only until this is understood. Tracked rather than papered over.
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
    side: gpu.FrontSide,
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
