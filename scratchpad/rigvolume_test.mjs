// Node harness for JOINT VOLUMES (roadmap #60) — the pelvis case.
//
// matt: "the hips is ultimately a t-junction; hips to the top of the leg joints, and hips to the
// base of the spine. I want to put a dome to represent the pelvis that should be centered at the
// hips, and is as wide as the top of the legs. right now i can only place a dome in one line
// segment of the T, not replace the entire T."
//
// That sentence is the whole spec, and it rules out the obvious implementation: a shape hung on
// a BONE can only ever cover one arm of the T. The volume belongs to the JOINT.
//
// Run: node scratchpad/rigvolume_test.mjs
//   RV_INJECT=boneowned   the volume goes back to being asked of the bone, not the junction
//   RV_INJECT=nofit       a new volume is unit-sized instead of fitted to the joint's children
//   RV_INJECT=drawboth    a swallowed bone keeps drawing its own body over the volume
//   RV_INJECT=swallowall a volume swallows every bone out of its joint, contained or not, so a
//                         hip dome eats both whole thigh bones
//   RV_INJECT=leafswallowall the leaf case swallows its incoming bone unconditionally
//   RV_INJECT=keepcaps    a swallowed bone keeps its capsule, so two envelopes claim the junction
//   RV_INJECT=identcolour the volume reads the bone section's `ident`, declared 270 lines later
//   RV_INJECT=domeup      the dome goes back to sitting on the joint like a bowl
//   RV_INJECT=fullextent  the cube is sided by the whole bone length, so it comes out twice size
//   RV_INJECT=nocube      a non-branching joint is fitted like a pelvis again
//   RV_INJECT=nooffset    the volume ignores its offset and stays pinned to the joint
//   RV_INJECT=alwaysvol   the gizmo edits volumes in EVERY mode, so posing a rig resizes it
//   RV_INJECT=livedims    the drag measures from the live dimensions, so the scale compounds
//   RV_INJECT=worldoffset the offset is stored in world space rather than the joint's frame
//   RV_INJECT=frozenfit   creating a volume seeds its dimensions, freezing it at the rig's shape
//                         when the button was pressed
//   RV_INJECT=nomanual    a hand-sized volume goes back to auto-fitting, undoing the adjustment
//   RV_INJECT=symgrow     a face handle grows the volume symmetrically, so the opposite face
//                         walks away instead of staying put
//   RV_INJECT=norot       the volume's own rotation is dropped from the draw
//   RV_INJECT=handlesalways the handles are drawn for every volume, not just the selected one
//   RV_INJECT=rotbutton   rotation needs the secondary button again
//   RV_INJECT=asymcentre  a centreline volume scales from one face, walking off the plane
//   RV_INJECT=freerot     a centreline volume may rotate on any axis, breaking its symmetry
//   RV_INJECT=slidex      a centreline volume may slide in X, off the plane it is defined by
//   RV_INJECT=tintwhileedit the volume lights up in selection colour while being edited
//   RV_INJECT=fixedplane  the mirror plane goes back to a fixed square centred on the origin
//   RV_INJECT=nostand     the plane straddles the ground grid instead of standing on it
//   RV_INJECT=edgescan    the round shapes go back to an edge-angle scan, which finds nothing on
//                         an ellipsoid
//   RV_INJECT=fullrings   the dome draws full circles, half of each in the air above it
//   RV_INJECT=novolarm    a volume drag starts armed, so selecting one knocks it off axis
//   RV_INJECT=notwinedit  a side volume no longer takes its twin with it
//   RV_INJECT=twinnoundo  the twin is edited but left out of the undo step
//   RV_INJECT=onesideshape choosing a shape applies to the selected joint only, not its twin
//   RV_INJECT=copyoff     the twin's offset is copied rather than reflected, so dragging the
//                         left face of one hand moves the left face of the other
//   RV_INJECT=copyrot     the twin's rotation is copied rather than reflected, so both sides
//                         tip the same way
//   RV_INJECT=wirealpha   the wireframe blends alpha normally again, cutting a hole in AR
import fs from 'fs';
import path from 'path';

const REPO = '/Users/mattestela/sculptxr';
let SRC = fs.readFileSync(path.join(REPO, 'src/editing/Skeleton.js'), 'utf8');
let GIZ = fs.readFileSync(path.join(REPO, 'src/editing/Gizmo.js'), 'utf8');
let TOOLSRC = fs.readFileSync(path.join(REPO, 'src/editing/tools/BoneDrawTool.js'), 'utf8');
let PANELSRC = fs.readFileSync(path.join(REPO, 'src/gui/bonePanel.js'), 'utf8');
let WIRE_INJ = false;
const TOOL = fs.readFileSync(path.join(REPO, 'src/editing/tools/BoneDrawTool.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(REPO, 'src/gui/bonePanel.js'), 'utf8');

const inject = process.env.RV_INJECT || '';
const cut = (a, b, n) => {
  if (!SRC.includes(a)) throw new Error('inject ' + n + ': anchor moved');
  SRC = SRC.replace(a, b);
};
if (inject === 'boneowned') {
  cut('  if (Skeleton.hasVolume(parent)) return true;', '  if (false) return true;', inject);
} else if (inject === 'nofit') {
  cut('  return Skeleton.fitJointVolume(main, j, out);', '  return out;', inject);
} else if (inject === 'drawboth') {
  cut('      o.visible = swallowed ? false : (isBody ? showSolid : showWire);',
    '      o.visible = isBody ? showSolid : showWire;', inject);
} else if (inject === 'alwaysvol') {
  const a = "  if (!tool || tool.modeKey?.() !== 'volume') return null;";
  if (!SRC.includes(a)) throw new Error('inject alwaysvol: anchor moved');
  SRC = SRC.replace(a, '');
} else if (inject === 'livedims') {
  const a = "      var d0 = this._volStartDims || Skeleton.jointVolDims(this._main, volJoint);";
  if (!GIZ.includes(a)) throw new Error('inject livedims: anchor moved');
  GIZ = GIZ.replace(a, "      var d0 = Skeleton.jointVolDims(this._main, volJoint);");
} else if (inject === 'worldoffset') {
  const a = "      var local = vec3.transformMat4([0, 0, 0], inter, this._volJointInv || mat4.create());";
  if (!GIZ.includes(a)) throw new Error('inject worldoffset: anchor moved');
  GIZ = GIZ.replace(a, "      var local = inter;");
} else if (inject === 'copyoff') {
  TOOLSRC = TOOLSRC.replace('            const o2 = Skeleton.mirrorVolumeOffset(Skeleton.jointVolOffset(main, vd.joint), _offMirrorV);',
    '            const o2 = Skeleton.jointVolOffset(main, vd.joint);');
} else if (inject === 'copyrot') {
  TOOLSRC = TOOLSRC.replace('              Skeleton.mirrorVolumeRot(Skeleton.jointVolRot(vd.joint), _qMirrorV));',
    '              Skeleton.jointVolRot(vd.joint));');
} else if (inject === 'wirealpha') {
  WIRE_INJ = true;
} else if (inject === 'onesideshape') {
  PANELSRC = PANELSRC.replace('        if (twin && main.getMeshes?.().includes(twin) && !joints.includes(twin)) joints.push(twin);', '');
} else if (inject === 'novolarm') {
  TOOLSRC = TOOLSRC.replace('            armed: false,', '            armed: true,');
} else if (inject === 'notwinedit') {
  TOOLSRC = TOOLSRC.replace('          if (vd.twin) {', '          if (false) {');
} else if (inject === 'twinnoundo') {
  TOOLSRC = TOOLSRC.replace('      for (const t of twin ? [j, twin] : [j]) {', '      for (const t of [j]) {');
} else if (inject === 'edgescan') {
  cut("  if (shape === 'egg') return (_eggEdgeGeo = _eggEdgeGeo || equatorGeometry(32, false));",
    "  if (shape === 'egg') return (_eggEdgeGeo = _eggEdgeGeo || new THREE.EdgesGeometry(eggVolGeometry(), 28));", inject);
} else if (inject === 'fullrings') {
  cut('    arc(0, 1, Math.PI, TAU);      // XY, lower half only', '    arc(0, 1, 0, TAU);', inject);
} else if (inject === 'fixedplane') {
  cut('    w = Math.max(floor, Math.abs(_vRel.dot(_vRight)) * 2.2);', '    w = floor;', inject);
} else if (inject === 'nostand') {
  cut('    lift = sign * ((base + h * 0.5) - plane.origin.y);', '', inject);
} else if (inject === 'rotbutton') {
  TOOLSRC = TOOLSRC.replace('            if (vd.qStart && options && options.quat) {',
    '            if (options && options.isNegative && vd.qStart && options.quat) {');
} else if (inject === 'asymcentre') {
  TOOLSRC = TOOLSRC.replace('            if (vd.centreline && ax === 0) {', '            if (false) {');
} else if (inject === 'freerot') {
  TOOLSRC = TOOLSRC.replace('                Skeleton.twistAboutAxis(_qDeltaV, _axisX, _qDeltaV);', '');
} else if (inject === 'slidex') {
  TOOLSRC = TOOLSRC.replace('              vd.centreline ? vd.off[0] : vd.off[0] + _vDelta.x,',
    '              vd.off[0] + _vDelta.x,');
} else if (inject === 'tintwhileedit') {
  cut('      const volTint = volEditing ? (volIdent ? volIdent.getHex() : BONE_COLOR)',
    '      const volTint = false ? (volIdent ? volIdent.getHex() : BONE_COLOR)', inject);
} else if (inject === 'symgrow') {
  TOOLSRC = TOOLSRC.replace('            off[ax] = vd.off[ax] + d * 0.5;', '');
  if (!/off\[ax\] = vd\.off\[ax\]/.test(fs.readFileSync(path.join(REPO, 'src/editing/tools/BoneDrawTool.js'), 'utf8')))
    throw new Error('inject symgrow: anchor moved');
} else if (inject === 'norot') {
  cut('  out.quat.multiply(Skeleton.jointVolRot(j, _qFrame));', '', inject);
} else if (inject === 'handlesalways') {
  cut("    if (e.vol && isSel && main.getSculptManager?.()?.getCurrentTool?.()?.modeKey?.() === 'volume') {",
    '    if (e.vol) {', inject);
} else if (inject === 'frozenfit') {
  cut('  // from a volume the user had sized by hand.\n  j._jointVolDims = null;\n  j._jointVolOffset = null;',
    '  Skeleton.setJointVolDims(j, ...Skeleton.fitJointVolume(main, j));', inject);
} else if (inject === 'nomanual') {
  cut('  const d = j && j._jointVolDims;\n  if (d && d.length === 3', '  const d = null;\n  if (d && d.length === 3', inject);
} else if (inject === 'domeup') {
  cut('new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)',
    'new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)', inject);
} else if (inject === 'fullextent') {
  cut('    out[0] = out[1] = out[2] = len * 0.5;', '    out[0] = out[1] = out[2] = len;', inject);
} else if (inject === 'nocube') {
  cut('  if (kids.length < 2) {', '  if (false) {', inject);
} else if (inject === 'nooffset') {
  cut('  out.pos.add(_vFrame);', '', inject);
} else if (inject === 'identcolour') {
  cut('      const volIdent = Skeleton.boneColor(main, j);', '      const volIdent = ident;', inject);
} else if (inject === 'swallowall') {
  cut('    if (Skeleton.volumeContains(main, parent, Skeleton.jointPos(child, _pSwallow), 1.05)) return true;',
    '    return true;', inject);
} else if (inject === 'leafswallowall') {
  cut('  return Skeleton.volumeContains(main, child, Skeleton.jointPos(parent, _pSwallow), 1.05);',
    '  return true;', inject);
} else if (inject === 'keepcaps') {
  cut('    if (swallowed || !showCaps || !(cr > 1e-9)) { hideCaps(e); continue; }',
    '    if (!showCaps || !(cr > 1e-9)) { hideCaps(e); continue; }', inject);
}

let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };

// ── THE VOLUME BELONGS TO THE JOINT ───────────────────────────────────────────────────
check('a volume is a property of the JOINT, not of a bone',
  /Skeleton\.jointVolume = function \(j\)/.test(SRC) && !/_boneShape/.test(SRC),
  'hung on a bone it can only ever cover one arm of the T');
check('...and it swallows the bones out of that joint THAT IT CONTAINS',
  /if \(Skeleton\.hasVolume\(parent\)\) \{[\s\S]{0,200}?Skeleton\.volumeContains\(main, parent, Skeleton\.jointPos\(child, _pSwallow\), 1\.05\)\) return true;/.test(SRC),
  'asked of the PARENT — but a hip dome that swallows unconditionally eats both entire thigh '
  + 'bones, and those limbs get no tube and no capsule at all');
// A leaf has no bone leading out of it, so its volume stands in for the one leading IN — without
// this a skull volume leaves the neck bone drawn straight through it.
check('...and a LEAF joint\'s volume swallows the bone leading into it',
  /if \(!childIsLeaf \|\| !Skeleton\.hasVolume\(child\)\) return false;/.test(SRC)
  && /return Skeleton\.volumeContains\(main, child, Skeleton\.jointPos\(parent, _pSwallow\), 1\.05\);/.test(SRC),
  'and it too is a containment test, run from the other end of the bone');
// matt: "cube is centered on the joint vs replacing the bone drawn from itself to the child".
check('a non-branching volume starts centred on its BONE, not on its joint',
  /Skeleton\.volSpan = function \(main, j\)/.test(SRC)
  && /if \(span\) \{ out\[0\] = span\.mid\[0\];/.test(SRC),
  'a branching joint has no single bone to stand on and stays on the junction — the pelvis case');
check('...spanning the bone OUT of it, or the bone IN when it is a leaf',
  /const other = kids\.length === 1 \? kids\[0\]\s*\n\s*: \(Skeleton\.isJoint\(j\._parentMesh\) \? j\._parentMesh : null\);/.test(SRC));
check('...and sized by that same bone',
  /const span = Skeleton\.volSpan\(main, j\);\s*\n\s*const len = \(span && span\.len\)/.test(SRC),
  'the cube\'s side and its placement must come from the same bone or it lands off the end');
check('a swallowed bone stops drawing',
  /o\.visible = swallowed \? false : \(isBody \? showSolid : showWire\);/.test(SRC),
  'drawing both says there are two answers to where the bone is');
check('...and stops carrying an envelope',
  /if \(swallowed \|\| !showCaps/.test(SRC),
  'the volume IS the envelope at that junction');

// ── FITTED TO THE JOINT AND ITS CHILDREN ──────────────────────────────────────────────
//
// "as wide as the top of the legs" is a measurement off the rig, and it is what makes a new
// dome land pelvis-shaped instead of unit-sized in the middle of the character.
// Superseded: the fit no longer happens once at creation, it happens on every READ — which is
// what makes it live as the rig moves. Same claim, moved to where the work now is.
check('a volume with nothing set is fitted to the joint and its children',
  /const d = j && j\._jointVolDims;[\s\S]{0,300}?return Skeleton\.fitJointVolume\(main, j, out\);/.test(SRC),
  'fitted on every read rather than once at creation');
check('...measured in the frame the volume is DRAWN in',
  /const invQ = Skeleton\.volumeBasis\(main, j, _qBasisFit\)\.clone\(\)\.invert\(\);/.test(SRC),
  'the joint\'s own matrix carries no rotation, so measuring through it put the width on '
  + 'whichever world axis the limb happened to lie along');
check('...and that frame aims along the bone',
  /return out\.setFromUnitVectors\(_yAxisV, _vAim\.normalize\(\)\);/.test(SRC)
  && /Skeleton\.volumeBasis = function \(main, j, out\)/.test(SRC),
  'matt: "boxes don\'t aim at their child bone, they stay aligned in worldspace"');
check('...except at a junction, which has no single bone to aim at',
  /return out;                       \/\/ branching: keep the joint's own orientation/.test(SRC),
  'a pelvis points three ways at once, and that case already read correctly');
check('...over the joints that are its children',
  /const kids = Skeleton\.joints\(main\)\.filter\(\(k\) => k\._parentMesh === j\);/.test(SRC));
check('...falling back to the capsule radius when there is nothing to measure',
  /const r = \(j\._boneRadius \|\| 0\) \|\| Skeleton\.sceneUnit\(main\) \* 0\.05;/.test(SRC),
  'a leaf joint, or children stacked on one axis, still has to produce three usable numbers');

// ── SHAPE ─────────────────────────────────────────────────────────────────────────────
{
  check('a box is CENTRED on the joint',
    /new THREE\.BoxGeometry\(2, 2, 2\)/.test(SRC),
    'a pelvis or ribcage box straddles the junction rather than growing out of one side');
  check('...and the dome is closed by a disc',
    /new THREE\.CircleGeometry\(1, 16\)\.rotateX\(-Math\.PI \/ 2\)/.test(SRC),
    'this geometry is also baked into a weight cage, and an open surface has no inside for a '
    + 'signed distance to be negative in');
  check('the volume is drawn in the joint\'s frame',
    /const vf = Skeleton\.volumeFrame\(main, j, _frameDraw\);/.test(SRC)
    && /o\.quaternion\.copy\(_qJ\);/.test(SRC),
    'so a pelvis stays a pelvis when the character is posed');
}

// ── NOTHING IN THE VOLUME BLOCK MAY REACH FORWARD ─────────────────────────────────────
//
// The volume is drawn early in the joint loop; the bone section's `ident` is a `const` declared
// ~270 lines further down in the same scope. Reading it from up here is a TEMPORAL DEAD ZONE
// error that throws on the first frame a volume exists — which is exactly how the first dome
// matt made crashed: "Uncaught ReferenceError: Cannot access 'ident' before initialization".
// Nothing about the code looks wrong at the point of use, so it is worth a check of its own.
{
  const fn = SRC.slice(SRC.indexOf("Skeleton.updateVisuals = function"));
  const blockAt = fn.indexOf("// THE JOINT'S VOLUME. Drawn in the joint's own frame");
  const blockEnd = fn.indexOf('const isolated = !hasChildBone', blockAt);
  const block = fn.slice(blockAt, blockEnd);
  check('the volume block is liftable', blockAt > 0 && blockEnd > blockAt, 'the draw code moved');
  for (const name of ['ident', 'wireTint', 'boneTint', 'swallowed']) {
    const declAt = fn.indexOf('const ' + name + ' ');
    check("...and does not reach forward to `" + name + "`",
      !new RegExp('\\b' + name + '\\b').test(block) || (declAt >= 0 && declAt < blockAt),
      'declared at ' + declAt + ', used at ' + blockAt + ' — a const read before its declaration '
      + 'throws on the first frame, not at build time');
  }
  check('the volume takes the JOINT\'s own colour',
    /const volIdent = Skeleton\.boneColor\(main, j\);/.test(block),
    'the volume speaks for the junction, and its weights are painted in the colour of the joint '
    + 'that moves them');
  check('...and reads the frame from one place rather than rebuilding it',
    /Skeleton\.volumeFrame\(main, j, _frameDraw\)/.test(block),
    'the draw, the handles, the cage and Make Skin all need the same answer, and three of them '
    + 'had their own');
}

// ── WHICH WAY UP, AND HOW BIG ─────────────────────────────────────────────────────────
//
// Both of these are assumptions about how a rig is built, stated by matt and worth writing down
// where they can be found later: legs run left/right, the spine runs up the joint's +Y.
{
  check('the dome hangs BELOW its joint, flat side toward the spine',
    /new THREE\.SphereGeometry\(1, 16, 8, 0, Math\.PI \* 2, Math\.PI \/ 2, Math\.PI \/ 2\)/.test(SRC),
    'thetaStart = PI/2 is the LOWER hemisphere — the other way up it reads as a bowl on the hips');
  check('...with its cap facing the spine',
    /new THREE\.CircleGeometry\(1, 16\)\.rotateX\(-Math\.PI \/ 2\)/.test(SRC));

  check('a joint with no branching is a CUBE off the bone length',
    /if \(kids\.length < 2\) \{/.test(SRC) && /out\[0\] = out\[1\] = out\[2\] = len \* 0\.5;/.test(SRC),
    'a skull fitted like a pelvis comes out thin: a leaf joint has no children to span');
  check('...in HALF-extents, since the geometry is unit-sized about its centre',
    /len \* 0\.5/.test(SRC),
    'treating them as full extents is what made the head twice the size asked for');
  check('...and a branching joint still spans its children',
    /out\[0\] = \(mx > 1e-6 \? mx : r\) \* 1\.15;/.test(SRC),
    'the pelvis case must survive the cube rule being added in front of it');
}

// ── AN OFFSET, SO THE SHAPE IS NOT STUCK ON THE PIVOT ─────────────────────────────────
//
// matt: "i'd want to tweak a skull representation to have its pivot be towards the back of the
// cube, and raised a little." Moving the JOINT would move the rig; the offset moves only the
// shape, so the joint stays where the animation needs it.
{
  check('a volume can be offset from its joint',
    /Skeleton\.setJointVolOffset = function/.test(SRC) && /Skeleton\.jointVolOffset = function/.test(SRC));
  check('...applied in the joint\'s own frame, scaled into model space',
    /_vFrame\.set\(off\[0\] \* _sFrame\.x, off\[1\] \* _sFrame\.y, off\[2\] \* _sFrame\.z\)\.applyQuaternion\(out\.quat\);/.test(SRC),
    'so it turns with the joint and is the right LENGTH — the offset is stored joint-local');
  check('...and it actually moves the drawn volume',
    /out\.pos\.add\(_vFrame\);/.test(SRC) && /o\.position\.copy\(vf\.pos\);/.test(SRC));
  check('...falling back to the joint itself when there is no bone to stand on',
    /out\[0\] = out\[1\] = out\[2\] = 0;\s*\n\s*return out;/.test(SRC),
    'a branching joint is centred on its junction');
  check('...and a stored offset wins over both',
    /if \(o\) \{ out\[0\] = o\[0\]; out\[1\] = o\[1\]; out\[2\] = o\[2\]; return out; \}/.test(SRC),
    'once you have moved a skull back and up, nothing may re-derive it');
}

// ── THE GIZMO SIZES AND PLACES A VOLUME ───────────────────────────────────────────────
//
// matt chose the existing non-uniform scale gizmo over handles or numbers. The whole risk is
// that the gizmo already means something for a selected joint — it POSES it — so the redirect
// has to be gated on a mode, and the drag has to be measured from a captured start.
{
  check('the redirect is gated on Volume mode',
    /if \(!tool \|\| tool\.modeKey\?\.\(\) !== 'volume'\) return null;/.test(SRC),
    'ungated, dragging a joint to pose it would resize the pelvis instead');
  check('...on a single selected joint that HAS a volume',
    /const j = sel\.length === 1 \? sel\[0\] : null;\s*\n\s*return j && Skeleton\.hasVolume\(j\) \? j : null;/.test(SRC));
  check('...and the mode exists in the tool and the panel',
    /if \(this\._mode === 'volume'\) return 'volume';/.test(TOOL)
    && /named = \{ draw: 'draw', pose: 'pose', radius: 'radius', ik: 'ik', volume: 'volume' \}/.test(TOOL)
    && /\['volume', 'Volume'\]/.test(PANEL));

  check('scale writes the volume\'s dimensions, not the rig',
    /Skeleton\.setJointVolDims\(volJoint,\s*\n\s*d0\[0\] \* inter\[0\], d0\[1\] \* inter\[1\], d0\[2\] \* inter\[2\]\);/.test(GIZ));
  check('...measured from the dimensions captured when the handle was grabbed',
    /var d0 = this\._volStartDims \|\| Skeleton\.jointVolDims/.test(GIZ),
    'reading the live dimensions each frame compounds the scale and the shape runs away');
  check('translate writes the volume\'s offset',
    /Skeleton\.setJointVolOffset\(volJoint, o0\[0\] \+ local\[0\]/.test(GIZ));
  check('...in the JOINT\'s frame, not the world\'s',
    /var local = vec3\.transformMat4\(\[0, 0, 0\], inter, this\._volJointInv/.test(GIZ),
    'stored in world space it would slide the shape sideways the moment the joint turned');
  check('...intercepted where every translate handle lands',
    (() => {
      const at = GIZ.indexOf('_updateMatrixTranslate(inter) {');
      const body = GIZ.slice(at, GIZ.indexOf('\n  }', at));
      return at > 0 && /Skeleton\.volumeEditTarget/.test(body);
    })(),
    'axis, plane and camera-plane translate all write through this one function');
  check('the start state is captured after the handle branch, for every handle',
    /this\._startVolumeEdit\(\);\s*\n\s*\n\s*return true;/.test(GIZ));
}

// ── THE FIT IS LIVE UNTIL YOU TOUCH IT ────────────────────────────────────────────────
//
// matt: "if i then adjust the placement of the first leg joint, the shape should adapt to fit in
// realtime... similarly with the head, if i adjust the tip of the head, i would expect the cube
// to scale to match." The first version wrote the fitted numbers when the volume was created,
// which froze it at whatever the rig looked like in that instant.
{
  {
    const at = SRC.indexOf('Skeleton.setJointVolume = function');
    const body = SRC.slice(at, SRC.indexOf('\n};', at));
    check('creating a volume seeds nothing',
      /j\._jointVolDims = null;\s*\n\s*j\._jointVolOffset = null;/.test(body)
      && !/setJointVolDims/.test(body),
      'unset is what makes jointVolDims fall through to the fit every frame — and refit clears '
      + 'the same two fields, so this has to be read inside setJointVolume, not file-wide');
  }
  check('...so an untouched volume is re-fitted on every read',
    /return Skeleton\.fitJointVolume\(main, j, out\);/.test(SRC));
  check('a hand-sized volume stops following the rig',
    /if \(d && d\.length === 3 && d\[0\] > 0 && d\[1\] > 0 && d\[2\] > 0\) \{/.test(SRC),
    'or the adjustment you just made is undone by the next joint you nudge');
  check('...and can be told apart from an automatic one',
    /Skeleton\.volumeIsManual = function/.test(SRC));
  check('...with a way back to the live fit',
    /Skeleton\.refitJointVolume = function/.test(SRC)
    && /if \(Skeleton\.jointVolume\(j\) === shape\) \{ if \(Skeleton\.refitJointVolume\(j\)\) refitted\+\+; \}/.test(
      fs.readFileSync(path.join(REPO, 'src/gui/bonePanel.js'), 'utf8')),
    'pressing the shape it already has — the button that is already lit is where you would look');
}

// ── HANDLES, AN EGG, AND A ROTATION ───────────────────────────────────────────────────
//
// matt: "can the volume tweak allow for rotation too? and can we add an egg shape/ellipsoid?
// ...can we get transform handles, like small dots on the bounding box that i could use to
// scale/slide the shapes?"
{
  check('there is an egg', /VOLUME_SHAPES = \['none', 'box', 'half', 'egg'\]/.test(SRC)
    && /_eggGeo = new THREE\.SphereGeometry\(1, 20, 14\)/.test(SRC));
  check('...offered in the panel',
    /shapeBtn\('egg', 'Egg'/.test(fs.readFileSync(path.join(REPO, 'src/gui/bonePanel.js'), 'utf8')));

  check('a volume carries its own rotation',
    /Skeleton\.setJointVolRot = function/.test(SRC) && /Skeleton\.jointVolRot = function/.test(SRC));
  check('...composed onto the joint\'s, so it survives a pose',
    /out\.quat\.multiply\(Skeleton\.jointVolRot\(j, _qFrame\)\);/.test(SRC),
    'stored in world terms it would slide off the bone the moment the character moved');
  check('...and counts as a hand edit, stopping the live fit',
    /j\._jointVolDims \|\| j\._jointVolOffset \|\| j\._jointVolRot/.test(SRC));

  check('seven handles: a face each and a centre',
    /const HANDLE_AXES = \[\[0, 1\], \[0, -1\], \[1, 1\], \[1, -1\], \[2, 1\], \[2, -1\]\]/.test(SRC)
    && /centre: mk\(0xffffff\)/.test(SRC));
  check('...drawn only for the SELECTED volume, in Volume mode',
    /if \(e\.vol && isSel && main\.getSculptManager\?\.\(\)\?\.getCurrentTool\?\.\(\)\?\.modeKey\?\.\(\) === 'volume'\)/.test(SRC),
    'handles on every volume at once would bury the rig and make it unpickable');
  check('...and hidden again when nothing qualifies',
    /if \(!_volHandlesShown && main\._volHandles\) main\._volHandles\.group\.visible = false;/.test(SRC));
  check('...placed and picked from one set of numbers',
    /Skeleton\.updateVolumeHandles = function/.test(SRC) && /Skeleton\.pickVolumeHandle = function/.test(SRC),
    'two would drift and you would grab something other than what you see');
  check('...and drawn above the rig, since a handle you cannot see is one you cannot grab',
    /m\.renderOrder = 10002;/.test(SRC));

  check('a handle beats a joint for the grab',
    /const grip = hj \? Skeleton\.pickVolumeHandle\(main, _tip, this\._snapDist\(\) \* 1\.2\) : null;/.test(TOOLSRC),
    'falling through to the joint pick would re-select instead of resizing');
  check('a face drag grows from that face, leaving the opposite one put',
    /dims\[ax\] = Math\.max\(1e-4, vd\.dims\[ax\] \+ sgn \* d \* 0\.5\);/.test(TOOLSRC)
    && /off\[ax\] = vd\.off\[ax\] \+ d \* 0\.5;/.test(TOOLSRC),
    'the extent takes half the pull and the centre takes the other half');
  check('the centre dot slides, and turns with the secondary button',
    /Skeleton\.setJointVolRot\(vd\.joint, _qDeltaV\.multiply\(vd\.rot\)\);/.test(TOOLSRC));
  check('...measured in the volume\'s frame, rotation included',
    /_mVolInv\.multiply\(new THREE\.Matrix4\(\)\.makeRotationFromQuaternion\(_qVolT\)\);/.test(TOOLSRC),
    'or dragging the X dot on a tilted ribcage scales it along the bone');
  check('one undo step carries all three numbers',
    /rot: rotArr\(Skeleton\.jointVolRot\(j\)\),/.test(TOOLSRC));
}

// ── HOLDING A VOLUME, AND WHAT THE CENTRELINE ALLOWS ──────────────────────────────────
{
  check('the centre dot is a 6DOF hold, with no modifier',
    /if \(vd\.qStart && options && options\.quat\) \{/.test(TOOLSRC)
    && !/options\.isNegative && vd\.qStart/.test(TOOLSRC),
    'asking for a button to turn it made rotation a mode; holding something turns it');

  // matt: "bones/volumes on the center axis should have their moves be left/right symmetrical...
  // rotation for volumes on the center should really only allow me to rotate around the x axis,
  // and i shouldn't be able to translate the volume in X, only on YZ."
  check('a centreline volume is recognised',
    /Skeleton\.volumeIsCentreline = function/.test(SRC)
    && /if \(!j \|\| j\._boneMirror\) return false;/.test(SRC),
    'a volume WITH a twin is a side volume and none of these rules apply to it');
  check('...decided once at the grab',
    /centreline: Skeleton\.volumeIsCentreline\(main, hj\),/.test(TOOLSRC),
    'a drag that crossed the plane would otherwise change the rules mid-gesture');
  check('...scales both sides from one handle',
    /if \(vd\.centreline && ax === 0\) \{[\s\S]{0,420}?dims\[ax\] = Math\.max\(1e-4, vd\.dims\[ax\] \+ sgn \* d\);/.test(TOOLSRC),
    'the extent changes and the centre does not move at all');
  check('...rotates only about the mirror normal',
    /Skeleton\.twistAboutAxis\(_qDeltaV, _axisX, _qDeltaV\);/.test(TOOLSRC)
    && /Skeleton\.twistAboutAxis = function/.test(SRC),
    'the twist of a swing-twist split — the rest is dropped, not approximated');
  check('...and cannot slide off the plane',
    /vd\.centreline \? vd\.off\[0\] : vd\.off\[0\] \+ _vDelta\.x,/.test(TOOLSRC));

  check('the volume does not light up while it is being edited',
    /const volTint = volEditing \? \(volIdent \? volIdent\.getHex\(\) : BONE_COLOR\)/.test(SRC),
    'selection colour on the thing you are working on hides the handles and the x-ray ghost');
  check('the handle under the hand lights up instead',
    /Skeleton\.highlightVolumeHandle = function/.test(SRC)
    && /Skeleton\.highlightVolumeHandle\(main,\s*\n\s*vd \? vd\.grip : Skeleton\.pickVolumeHandle/.test(TOOLSRC),
    'they sit close together on a small volume; without a hover state you find out which one '
    + 'you took by taking it');
}

// ── THE MIRROR PLANE FITS WHAT YOU ARE DRAWING ────────────────────────────────────────
//
// matt: "the mirror plane when drawing bones is centered on the origin, and if i'm drawing from
// there up to the head, its always too small... it should default to always grow and be 10%
// larger than where the draw cursor is, and if the groundplane is visible, start with the base
// of it on the groundplane, rather than the center be on the groundplane."
{
  check('the plane sizes itself to the cursor',
    /w = Math\.max\(floor, Math\.abs\(_vRel\.dot\(_vRight\)\) \* 2\.2\);/.test(SRC)
    && /h = Math\.max\(floor, Math\.abs\(_vRel\.dot\(_vUp\)\) \* 2\.2\);/.test(SRC),
    '2.2 = twice the distance (a half-extent becomes a full one) plus the 10% clearance');
  check('...along the plane\'s own axes',
    /_vRight\.set\(1, 0, 0\)\.applyQuaternion\(_q\);/.test(SRC),
    'so it holds however the plane is oriented');
  check('...never smaller than it used to be',
    /const floor = unit \* 2\.6;/.test(SRC) && /let w = floor, h = floor, lift = 0;/.test(SRC),
    'or it shrinks to a sliver when the cursor is near the origin');
  check('...and the cursor is actually passed in',
    /Skeleton\.updatePlane\(main, plane, [^;]*, _tip\);/.test(TOOLSRC),
    'a size that fits the cursor is only as good as the call site that supplies one');

  check('the plane stands ON the ground grid',
    /lift = sign \* \(\(base \+ h \* 0\.5\) - plane\.origin\.y\);/.test(SRC),
    'centred on it, half the plane is always buried under the floor');
  check('...only when the grid is actually shown',
    /const grid = main\._showGrid && main\._groundGrid \? main\._groundGrid : null;/.test(SRC));
  check('...and only when its own up really is up',
    /Math\.abs\(_vUp\.y\) > 0\.7/.test(SRC),
    'a plane lying flat has no base to stand on');
}

// ── A WIREFRAME THE ROUND SHAPES CAN ACTUALLY HAVE ────────────────────────────────────
//
// EdgesGeometry keeps an edge only where two faces meet past a threshold angle. That is the
// right rule for a box and no rule at all for an ellipsoid, whose facets are all nearly flat —
// so the egg came out with no wireframe whatsoever. matt: "nothing at all for the ellipsoid
// shapes. can they get one. 3 circles that fit to the shape around X, Y, Z equators." And,
// a moment later: "and around the dome too."
{
  check('the round shapes are wireframed with equators, not an edge scan',
    /if \(shape === 'egg'\) return \(_eggEdgeGeo = _eggEdgeGeo \|\| equatorGeometry\(32, false\)\);/.test(SRC)
    && /return \(_halfEdgeGeo = _halfEdgeGeo \|\| equatorGeometry\(32, true\)\);/.test(SRC));
  check('...the box keeps its edges, which it genuinely has',
    /if \(shape === 'box'\) return \(_boxEdgeGeo = _boxEdgeGeo \|\| new THREE\.EdgesGeometry\(boxVolGeometry\(\), 1\)\);/.test(SRC));
  check('an egg gets three full circles',
    /arc\(0, 1, 0, TAU\);            \/\/ XY/.test(SRC)
    && /arc\(1, 2, 0, TAU\);            \/\/ YZ/.test(SRC)
    && /arc\(2, 0, 0, TAU\);            \/\/ ZX/.test(SRC));
  check('a dome gets its rim and two HALF circles',
    /arc\(0, 2, 0, TAU\);            \/\/ the rim, in XZ/.test(SRC)
    && /arc\(0, 1, Math\.PI, TAU\);      \/\/ XY, lower half only/.test(SRC)
    && /arc\(2, 1, Math\.PI, TAU\);      \/\/ ZY, lower half only/.test(SRC),
    'full circles would put half of each one in the empty air above the shape');
  check('...unit sized, so they scale with the volume like it does',
    /p0\[ax\] = Math\.cos\(t0\); p0\[ay\] = Math\.sin\(t0\);/.test(SRC));
}

// ── SELECTING A VOLUME MUST NOT MOVE IT, AND EDITING ONE EDITS ITS TWIN ───────────────
{
  check('a volume drag starts unarmed',
    /armed: false,/.test(TOOLSRC)
    && /if \(isPressed && !vd\.armed\s*\n\s*&& _tip\.distanceTo\(vd\.start\) > this\._snapDist\(\) \* 0\.35\)/.test(TOOLSRC),
    'the centre handle is a 6DOF hold, so the smallest wrist rotation tipped the shape off axis '
    + 'before you had done anything — matt: "i frequently knock it off axis and out of symmetry"');
  check('...and re-takes its reference when it arms',
    /vd\.start\.copy\(_tip\);/.test(TOOLSRC) && /vd\.dims = Skeleton\.jointVolDims\(main, vd\.joint\)\.slice\(\);/.test(TOOLSRC),
    'or the shape jumps by the threshold the instant the drag begins');

  check('a side volume knows its twin',
    /twin: hj\._boneMirror && Skeleton\.hasVolume\(hj\._boneMirror\) \? hj\._boneMirror : null,/.test(TOOLSRC));
  check('...which receives the same edit, whichever handle did it', (() => {
    const at = TOOLSRC.indexOf('if (vd.twin) {');
    if (at < 0) return false;
    const block = TOOLSRC.slice(at, TOOLSRC.indexOf('\n          }', at));
    return /setJointVolDims\(vd\.twin/.test(block) && /setJointVolOffset\(vd\.twin/.test(block)
      && /setJointVolRot\(vd\.twin/.test(block);
  })());
  check('...placed after the branches, not inside one',
    TOOLSRC.indexOf('whichever handle did it') > TOOLSRC.indexOf("vd.grip.kind === 'centre'"),
    'inside the centre branch a FACE drag would not mirror — and the face is the one matt named');
  check('...and goes in the same undo step',
    /for \(const t of twin \? \[j, twin\] : \[j\]\) \{/.test(TOOLSRC),
    'restoring one side and not the other leaves exactly the asymmetry this prevents');
}

// ── THE MENU GETS OUT OF THE WAY (roadmap #72) ────────────────────────────────────────
//
// The wrist panels hang off the non-dominant grip, so reaching with that hand puts the menu
// through whatever you are grabbing. matt, twice: "if the secondary controller is used to grab a
// control, hide the menu for as long as the trigger is held."
{
  const SCENE = fs.readFileSync(path.join(REPO, 'src/Scene.js'), 'utf8');
  check('the secondary hand\'s trigger is read',
    /if \(!src\.gamepad \|\| src\.handedness === this\._dominantHand\) continue;/.test(SCENE),
    'that hand\'s own trigger is unambiguous — the menu is operated by pointing at it with the '
    + 'other hand');
  check('...and the wrist panels hide while it is held',
    /if \(secondaryHeld\) \{[\s\S]{0,220}?_p\.mesh\.visible = false;/.test(SCENE));
  check('...restoring what was OPEN, not everything',
    /_p\._preHideVisible = _p\.mesh\.visible;/.test(SCENE)
    && /_p\.mesh\.visible = _p\._preHideVisible;/.test(SCENE),
    'forcing them all visible on release would open panels the user had closed');
  check('...and a pinned panel is exempt',
    /if \(!_p\?\.mesh \|\| _p\.pinned \|\| _p\.mesh\.parent !== uiGrip\) continue;/.test(SCENE),
    'it is world-anchored and no longer on the hand');
}

// ── CHOOSING A SHAPE IS MIRRORED TOO ──────────────────────────────────────────────────
//
// One step earlier than the drag mirroring, and the same asymmetry if it is missing. matt: "if
// i select a left wrist and make it a box volume, the right wrist should do the same."
{
  check('the shape buttons act on the twin as well',
    /const twin = j\._boneMirror;\s*\n\s*if \(twin && main\.getMeshes\?\.\(\)\.includes\(twin\) && !joints\.includes\(twin\)\) joints\.push\(twin\);/.test(PANELSRC));
  check('...deduped, so selecting both sides does not act on either twice',
    /if \(!joints\.includes\(j\)\) joints\.push\(j\);/.test(PANELSRC));
  check('...only for a twin that is actually in the scene',
    /main\.getMeshes\?\.\(\)\.includes\(twin\)/.test(PANELSRC),
    '_boneMirror survives a save and can outlive the joint it names');
  check('...and the undo step covers everything it touched',
    /const before = snap\(\);/.test(PANELSRC),
    'snap() runs over the expanded list, so both sides come back together');
}

// ── A MIRRORED ROTATION IS REFLECTED, NOT COPIED ──────────────────────────────────────
//
// matt: "rotating a mirrored volume shape should properly mirror, atm the mirror twins the
// rotation rather than inverting it across the mirror plane."
{
  check('there is a reflection for a volume rotation',
    /Skeleton\.mirrorVolumeRot = function \(q, out\)/.test(SRC));
  check('...keeping the twist about the mirror normal and negating the other two',
    /return out\.set\(q\.x, -q\.y, -q\.z, q\.w\);/.test(SRC),
    'M.R.M is proper — two sign flips — and a twist about the normal genuinely is unchanged '
    + 'by mirroring, while a nod or a yaw reverses');
  check('...used when the drag writes the twin',
    /Skeleton\.setJointVolRot\(vd\.twin,\s*\n\s*Skeleton\.mirrorVolumeRot\(Skeleton\.jointVolRot\(vd\.joint\), _qMirrorV\)\);/.test(TOOLSRC));
  check('...and when undo puts it back',
    /Skeleton\.setJointVolRot\(t, t === j/.test(TOOLSRC),
    'restoring the twin from the recorded rotation verbatim would re-introduce the bug on undo');
  // WHAT THE HANDS TAUGHT US: the two joints' frames are NOT mirror images, they carry the same
  // orientation. So an offset copied across moves the twin the same way in the world — matt:
  // "i tweak the left side on the left hand, but it tweaks the left side of the right hand,
  // rather than the right side of the right hand."
  check('the offset is reflected too',
    /Skeleton\.mirrorVolumeOffset = function \(off, out\)/.test(SRC)
    && /out\[0\] = -off\[0\]; out\[1\] = off\[1\]; out\[2\] = off\[2\];/.test(SRC),
    'only the component along the mirror normal flips — the twin grows on the matching side '
    + 'while keeping the same height and depth');
  check('...on the drag',
    /const o2 = Skeleton\.mirrorVolumeOffset\(Skeleton\.jointVolOffset\(main, vd\.joint\), _offMirrorV\);/.test(TOOLSRC));
  check('...and on undo',
    /const off = t === j \? st\.off : Skeleton\.mirrorVolumeOffset\(st\.off, _offMirrorV\);/.test(TOOLSRC));
  check('dimensions still go across verbatim',
    /Skeleton\.setJointVolDims\(vd\.twin, d2\[0\], d2\[1\], d2\[2\]\);/.test(TOOLSRC),
    'extents survive a reflection unchanged; a position does not');
}

// ── THE WIREFRAME MUST NOT CUT A HOLE IN AR ───────────────────────────────────────────
//
// In passthrough the compositor reads framebuffer alpha as "how much room shows through", and
// ordinary blending LOWERS destination alpha. matt hit this on the ground grid first and has now
// hit it on the wireframe over a bound mesh.
{
  let MM = fs.readFileSync(path.join(REPO, 'src/mesh/multiresolution/Multimesh.js'), 'utf8');
  if (WIRE_INJ) MM = MM.replace('            lineMaterial.blendSrcAlpha = THREE.OneFactor;', '');
  check('the wireframe blends its alpha additively',
    /lineMaterial\.blendSrcAlpha = THREE\.OneFactor;/.test(MM)
    && /lineMaterial\.blendDstAlpha = THREE\.OneFactor;/.test(MM),
    'the same rule the ground grid needed, for the same reason');
  check('...with the COLOUR blend left exactly as it was',
    /lineMaterial\.blendSrc = THREE\.SrcAlphaFactor;/.test(MM)
    && /lineMaterial\.blendDst = THREE\.OneMinusSrcAlphaFactor;/.test(MM),
    'only the alpha channel was ever the problem');
}

// ── THE WIREFRAME CARRIES THE SURFACE'S COLOUR ────────────────────────────────────────
//
// A black wire over a see-through skin reads as jet black — there is nothing behind it to mix
// with, so alpha does not help. And during weight painting the one thing the wire should agree
// with is the colour under it. matt: "wires when xray is enabled render jet black. they should
// mix properly. when weight painting, the wire should take on the weight paint colour."
{
  const MM = fs.readFileSync(path.join(REPO, 'src/mesh/multiresolution/Multimesh.js'), 'utf8');
  check('the wireframe uses per-vertex colour',
    /vertexColors: true,/.test(MM) && /color: 0xffffff,/.test(MM),
    'white base, or the vertex colour is multiplied down to nothing');
  check('...fed from the mesh\'s own colours',
    /var srcColors = activeMesh\.getColors && activeMesh\.getColors\(\);/.test(MM)
    && /setAttribute\('color', new THREE\.BufferAttribute\(wireCols, 3\)\)/.test(MM),
    'which is where the weight preview writes');
  check('...darkened, so an edge still reads as an edge',
    /wireCols\[ci\] = srcColors\[ci\] \* 0\.45;/.test(MM),
    'matched exactly it would disappear into the face it sits on');
  check('...and the buffer is reused between frames',
    /if \(!wireCols \|\| wireCols\.length !== activeVerts\.length\)/.test(MM),
    'this runs on every wireframe update, and a fresh Float32Array per frame on a dense sculpt '
    + 'is a garbage collection every few seconds');
}

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
