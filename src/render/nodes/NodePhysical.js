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

// `mesh` is optional. Without it this builds the SHARED sculpt material, which is what almost
// every mesh uses. With it, it builds a variant carrying that mesh's own texture maps -- see
// the note above the map block below for why those cannot be shared.
export function makePhysical(gpu, tsl, mesh) {
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
  // PHYSICAL, settled. `?pbrmat=standard|lambert` used to swap the base class to find out
  // whether the lit path itself was what an AR session could not draw. It was not -- the fault
  // was three's, in the XR camera layout, and it is patched in ThreeXRPatches. The switch is
  // gone with the question.
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
  // THREE'S SCREEN-SPACE ROUGHNESS TERM IS REMOVED, not capped.
  //
  // MeshStandardNodeMaterial adds max(|dFdx(normalView)|, |dFdy(normalView)|) to roughness as
  // specular antialiasing -- a per-PIXEL derivative, so the smaller an object appears the
  // rougher it is made. In VR the grip scale changes apparent size directly, so grip-scaling the
  // world moved the highlights while the diffuse stayed put. Subtracting the term cancels it
  // exactly. matt judged it in a headset: "yeah it looks good."
  //
  // The cost is three's specular antialiasing, so shimmer can return on a heavily minified
  // sculpt. `?geomrough=` used to dial it back; the default was chosen and approved, so the dial
  // is gone.
  const _rough = max(
    max(mtl.x, float(0.0001)).sub(max(tsl.getGeometryRoughness(), float(0))), float(0.0001));
  m.roughnessNode = _rough;
  m.metalnessNode = mtl.y;

  // ── PER-MESH TEXTURE MAPS ──────────────────────────────────────────────────────────────
  //
  // A MAP CANNOT BE SHARED, which is the whole reason this function takes a mesh at all. The
  // node materials are one per shader id and handed to every mesh; a texture is per mesh, so
  // the last import would wear its image on everything. ShaderManager.getMaterialFor already
  // solved this for the legacy path by cloning per mesh, and the node branch short-circuited
  // past it -- which is why an imported glb arrived untextured. matt: "textures aren't
  // imported, transparency isn't working. they should be translated into our new tsl
  // materials on import."
  //
  // Semantics follow the legacy ShaderPBR exactly, because they follow glTF:
  //   albedo      multiplied onto the vertex colour
  //   roughMetal  roughness from G, metalness from B, each scaled by its factor
  //   normal      tangent space, xy scaled by normalScale
  // TextureIO already sets the colour spaces (albedo sRGB, data maps linear), so sampling
  // returns linear values that sit directly alongside the linearised vertex colour.
  if (mesh) {
    const { texture, uv, normalMap } = tsl;
    const uvNode = uv();

    const albedo = mesh.getAlbedoMap && mesh.getAlbedoMap();
    if (albedo) m.colorNode = m.colorNode.mul(texture(albedo, uvNode).rgb);

    const rm = mesh.getRoughMetalMap && mesh.getRoughMetalMap();
    if (rm) {
      const rmTex = texture(rm, uvNode);
      const rFac = mesh.getRoughFactor ? mesh.getRoughFactor() : 1;
      const mFac = mesh.getMetalFactor ? mesh.getMetalFactor() : 1;
      m.roughnessNode = max(rmTex.g.mul(float(rFac)), float(0.0001));
      m.metalnessNode = rmTex.b.mul(float(mFac));
    }

    const nrm = mesh.getNormalMap && mesh.getNormalMap();
    if (nrm) {
      const sc = mesh.getNormalScale ? mesh.getNormalScale() : 1;
      m.normalNode = normalMap(texture(nrm, uvNode), tsl.vec2(sc, sc));
    }

    // ── GLASS: A SPECULAR COAT, NOT THREE'S TRANSMISSION LOBE ────────────────────────────
    //
    // matt, on the camel's outer eye: "it should just be essentially transparent, no attempts
    // at refraction, and reflect sharp specular with fresnel falloff."
    //
    // Setting material.transmission gives the opposite. three's lobe is a REFRACTION model: it
    // copies the opaque pass into a backbuffer and looks the background up through the surface
    // with an IOR bend, which costs a full-screen copy per eye in a session and spends all of
    // it on an effect we are explicitly not asking for. It also only sees what was in the
    // opaque pass, so the iris -- itself drawn later -- is simply missing from what shows
    // through.
    //
    // The legacy ShaderPBR reached the right answer already and the reasoning is worth
    // repeating: a reflection is LIGHT ARRIVING, not a measure of how solid the surface is, so
    // glass gets brighter where it catches a highlight rather than more opaque. Ordinary alpha
    // blending fights that -- it multiplies the WHOLE fragment by alpha, so a clear surface
    // throws away the highlight it just computed, and the legacy shader had to add the
    // reflection's luminance back into alpha to undo its own blend.
    //
    // ADDITIVE BLENDING says the same thing in the blend instead of in the alpha, and then
    // none of that arithmetic is needed. With the diffuse taken to black the material emits
    // only its specular -- direct highlights and the IBL reflection -- and adds that to
    // whatever is behind it. The fresnel falloff is the BRDF's own F term, so it is physical
    // rather than a hand-fitted pow(); roughness is pinned low because glass is sharp and the
    // vertex roughness channel has no meaning on an imported coat.
    //
    // `?glass=transmission` restored three's lobe for comparison; matt judged the coat and it
    // stays, so the comparison is gone.
    const tr = mesh.getTransmission ? mesh.getTransmission() : 0;
    if (tr > 0) {
      {
        m.userData.isGlassCoat = true;
        m.colorNode = vec3(0, 0, 0);
        m.roughnessNode = float(0.02);
        m.metalnessNode = float(0);
        m.transparent = true;
        m.blending = gpu.AdditiveBlending;
      }
      // A TRANSMISSIVE SURFACE MUST NOT WRITE DEPTH -- the nested-eye rule ShaderManager has
      // carried for the legacy path. The node branch returns before that line ever runs, so
      // the glass eye was writing depth and hiding the iris inside it. (ShaderManager still
      // owns the matching renderOrder = 0.9; that part does reach both renderers.)
      m.depthWrite = false;
    }

    // OPACITY, for the same reason and with the same trade. The shared material is opaque
    // deliberately -- opaque casts shadows and sorts front-to-back -- so a mesh that wants to
    // fade has to leave it. matt: "transparency isn't working" on an imported glb; the glTF
    // alpha was never read on import, and even once read there was no material that could show
    // it. Mesh.setOpacity moves the number on an existing variant and only re-queries when the
    // mesh crosses 1.0, so a slider drag does not build a material per frame.
    const op = mesh.getOpacity ? mesh.getOpacity() : 1;
    if (op < 1) {
      m.opacity = op;
      m.transparent = true;
    }

    m.userData.sculptMeshId = mesh.getID ? mesh.getID() : null;
  }

  m.userData.isPhysicalPBR = true;
  return m;
}

export default makePhysical;
