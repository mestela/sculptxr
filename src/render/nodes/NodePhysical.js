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
  // PHYSICAL OR STANDARD, because Physical is a suspect.
  //
  // matt: in an AR session, with even ONE light in the graph, this material does not draw at
  // all -- passthrough where the sculpt should be -- while matcap is fine and pool=0,0,0
  // brings it straight back. So it is not a light COUNT limit; it is that the lit path is
  // taken at all. MeshPhysicalNodeMaterial's lit path is much larger than Standard's: it
  // carries clearcoat, sheen, iridescence and transmission, and transmission in particular
  // wants a backbuffer render, which is exactly the sort of thing a session breaks on.
  //
  // We use none of them yet -- only colour, roughness and metalness, all of which Standard
  // has. ?pbrmat=standard swaps the base class so that can be tested in one reload.
  // ?pbrmat=lambert is the CLEANEST A/B IN THE WHOLE PORT: the app's unlit base is already a
  // MeshLambertNodeMaterial with lights = false, and that DOES draw in a session. So this is
  // the identical class with lights = true and one light — the single variable, nothing else
  // moved. If it draws, three's lighting works in XR and the fault is in Standard/Physical's
  // graph. If it does not, the fault is three's lighting node under the XR camera layout,
  // and that is an upstream bug with a repro small enough to file.
  const _mat = /[?&]pbrmat=(\w+)/.exec(window.location.search);
  const Base = !_mat ? gpu.MeshPhysicalNodeMaterial
    : _mat[1] === 'standard' ? gpu.MeshStandardNodeMaterial
    : _mat[1] === 'lambert' ? gpu.MeshLambertNodeMaterial
    : gpu.MeshPhysicalNodeMaterial;
  const m = new Base({
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
  // ?geomrough=N -- CAP three's SCREEN-SPACE ROUGHNESS TERM.
  //
  // MeshStandardNodeMaterial.setupVariants does roughness = getRoughness({roughness}), and
  // getRoughness is max(r, 0.0525) + getGeometryRoughness(), where the geometry term is
  //     max(|dFdx(normalView)|, |dFdy(normalView)|)
  // -- a per-PIXEL derivative. It is three's specular antialiasing: the smaller an object
  // appears on screen, the faster its normal turns per pixel, the rougher it is made, and the
  // more the specular lobe spreads. It feeds ROUGHNESS only, so it moves specular and never
  // touches diffuse.
  //
  // That is exactly what matt reports in VR: grip-scale the world down and the highlights
  // change, while the diffuse shading stays put. Grip scaling changes apparent screen size, so
  // it drives this term directly -- and at a 0.6% world scale it stops being a subtle
  // antialiasing nudge and starts setting the roughness.
  //
  // Since the material ADDS the term to whatever we hand it, handing it a value reduced by the
  // excess cancels the excess exactly. ?geomrough=0 removes the term (crisper highlights, and
  // specular shimmer returns on a minified sculpt); ?geomrough=0.05 keeps a little. No flag
  // leaves three's behaviour untouched.
  // DEFAULT IS CAP 0 -- the term is removed. matt judged it in a headset: "yeah it looks good",
  // grip-scaling no longer moves the highlights. The cost is three's specular antialiasing, so
  // shimmer can come back on a heavily minified sculpt; ?geomrough=N reinstates that much of it
  // and ?geomrough=off restores three's own behaviour untouched.
  const _gr = /[?&]geomrough=([\w.]+)/.exec(window.location.search);
  const _grCap = !_gr ? 0 : (_gr[1] === 'off' ? null : parseFloat(_gr[1]));
  let _rough = max(mtl.x, float(0.0001));
  if (_grCap !== null && Number.isFinite(_grCap)) {
    _rough = max(_rough.sub(max(tsl.getGeometryRoughness().sub(float(_grCap)), float(0))), float(0.0001));
  }
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

    // Transmission is a MATERIAL property rather than a node: MeshPhysicalNodeMaterial only
    // compiles the transmission lobe when it is non-zero, so setting it is what turns it on.
    // It also needs transparency, which the shared material deliberately refuses -- an opaque
    // material casts shadows and sorts front-to-back. A transmissive mesh gives that up, which
    // is the correct trade for glass and the wrong one for everything else: another reason
    // these are per-mesh.
    const tr = mesh.getTransmission ? mesh.getTransmission() : 0;
    if (tr > 0) {
      m.transmission = tr;
      m.transparent = true;
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
