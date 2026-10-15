// PIN POSE: a mode of the desktop Transform tool for posing a rig directly.
//
// Checked in the browser on sxr2.sxr with a real mouse: hovering mid-forearm puts the gizmo on the
// ELBOW with rotate-only handles (no translate, no scale) in the hinge frame; the knee pin offers
// translate only, the foot pin translate + rotate; each is picked up straight through the previous
// target's rings; empty space drops the gizmo; a press on the skin or a joint the pins control
// selects and moves nothing; dragging a ring while the cursor stays on it keeps the selection,
// rotates just that joint's children, shows only that one handle and hides the other pins, and is
// one undo step.
//
// What is pinned here is the wiring.
//
// Run: node scratchpad/pinpose_test.mjs
import fs from 'fs';
import path from 'path';
const REPO = new URL('..', import.meta.url).pathname;
let failures = 0;
const check = (n, ok, d) => { if (ok) return console.log('  ok   ' + n);
  failures++; console.log('  FAIL ' + n + (d ? '  ' + d : '')); };
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const XF = strip(read('src/editing/tools/Transform.js'));
check('the handle test comes first, so it can be told to the hover', XF.indexOf('this._gizmo.onMouseOver()') > 0 && XF.indexOf('this._gizmo.onMouseOver()') < XF.indexOf('this._pinPoseHover(overHandle)'));
check('...and the hover never runs mid-drag', /const posing = !this\._gizmo\._isEditing && this\._pinPoseActive\(\);/.test(XF) && /if \(posing\) this\._pinPoseHover\(overHandle\);/.test(XF));
check('over a handle of a live gizmo the target and the highlight never change', /if \(overHandle && main\.getSelectedMeshes\(\)\.length === 1\) \{ this\._ppCand = null; return; \}/.test(XF));
check('inside the gizmo\'s area a new target must be dwelt on before the gizmo moves', /PIN_POSE_DWELL_MS/.test(XF) && /now - this\._ppSince < PIN_POSE_DWELL_MS\) return;/.test(XF));
check('a press re-evaluates the handle under the cursor first (the gizmo may have moved under a resting cursor)',
  /if \(this\._pinPoseActive\(\) && !this\._gizmo\._isEditing\) this\._gizmo\.onMouseOver\(\);/.test(XF)
  && XF.lastIndexOf('this._gizmo.onMouseOver();') < XF.indexOf('this._gizmo.onMouseDown()'));
check('a press in the mode takes a handle or does nothing', /if \(this\._pinPoseActive\(\)\) return false;/.test(XF) && XF.indexOf('if (this._pinPoseActive()) return false;') > XF.indexOf('this._gizmo.onMouseDown()'));
check('only pins and FK-turnable joints are candidates (no skin, no solver-owned joints)', /fkCandidates\(main, owned, true\)/.test(XF) && /fkTarget\(node, bone, owned\)\.joint/.test(XF));
check('a free joint offers rotate only', /Skeleton\.isJoint\(m\) && this\._pinPoseActive\(\)\) return GIZMO_SETS\.TURN;/.test(XF));
check('the old target\'s handle does not survive onto a new target', /sg\._isSelected = false; this\._gizmo\._selected = null;/.test(XF));
check('it only drops a selection it made itself, and only once the cursor leaves the gizmo', /if \(this\._ppAuto && sel\.length === 1 && sel\[0\] === this\._ppAuto && !this\._cursorNearGizmo\(\)\)/.test(XF));
check('selection changes keep the tool (no tool-context switch)', /main\.setMesh\(node, true\)/.test(XF) && /main\.setMesh\(null, true\)/.test(XF));

const PK = strip(read('src/math3d/Picking.js'));
check('Transform in Pin Pose picks bone segments (desktop only)', /if \(sm\.getToolIndex\(\) === TRANSFORM_TOOL\) return !main\._xrSession && pinPoseOn\(\);/.test(PK) && /const TRANSFORM_TOOL = 13;/.test(PK));

const FKP = strip(read('src/editing/fkPick.js'));
check('Grab and Transform share one FK pick rule', /export function fkCandidates/.test(FKP) && /export function fkTarget/.test(FKP) && /export function ownedIds/.test(FKP)
  && /from '\.\.\/fkPick\.js'/.test(strip(read('src/editing/tools/Grab.js'))) && /from '\.\.\/fkPick\.js'/.test(XF));

const PN = read('src/gui/transformPanel.js');
check('the panel has a Pin Pose toggle, wired and kept in sync', /id="xf-pinpose"/.test(PN) && /_xfPinPose = next/.test(PN) && /saveOption\('xfPinPose'/.test(PN) && /Pin Pose \$\{pp \? 'On' : 'Off'\}/.test(PN));
check('the option is declared (off by default)', /options\.xfPinPose = queryBool\(getVal\('xfPinPose'\), false\);/.test(read('src/misc/getOptionsURL.js')));
check('the mode is a leaf module', !/^import .*from '\.\.?\/(Skeleton|IKSolver|Scene)/m.test(read('src/editing/pinPoseMode.js')));

// THE GIZMO'S SCREEN MAPPING GOES THROUGH THE WORLD GROUP. The camera projects WORLD points; the gizmo
// works in MODEL space, and the two differ by _worldGroup's scale and offset. Projecting model points
// directly put the trackball zone (and the arcball, and every drag's screen bookkeeping) on a circle
// that was up to ~85 px from the one drawn: press inside the visible ring, find nothing, orbit the
// view. Checked with a real mouse on sxr2.sxr: zone centre == drawn centre (476.9,331.7) and radius
// == drawn radius (45); a press-drag 28 px from the centre took the interior handle, rotated the pin
// and left the camera alone; dragging the centre handle by (-20,15) / (0,-25) moved the pin on screen
// by exactly that.
const GZ = strip(read('src/editing/GizmoVR.js'));
check('no raw projection of a model-space point is left in the gizmo', !/[^_]camera\.project\(this\._toWorld/.test(GZ) ? !/(?<!_proj\(camera, p\) \{ return )camera\.project\((?!this\._toWorld)/.test(GZ) : true);
check('the gizmo projects and unprojects through the world group', /_proj\(camera, p\) \{ return camera\.project\(this\._toWorld\(p\)\); \}/.test(GZ) && /_unprojModel\(camera, x, y, z\) \{ return this\._toModel\(camera\.unproject\(x, y, z\)\); \}/.test(GZ));
check('...and the screen radius (the trackball zone) uses it', /const cs = this\._proj\(camera, c\);[\s\S]{0,400}const es = this\._proj\(camera, edge\);/.test(GZ));
check('the old divide-by-world-scale hack is gone (the ray is in model space already)', !/S = this\._main\._worldGroup\.scale\.x/.test(GZ));

// THE TRACKBALL ZONE IS THE VISIBLE CIRCLE. Its radius was measured along the ring part's own X axis,
// which is the ring's rotation AXIS: for the hips pin seen from the front that axis points at the camera
// and the "radius" came out 45 px against a ring drawn 130 px across -- a press anywhere in the rest
// of the visible circle (that was not on a ring) orbited the view. The rings are great circles of a
// sphere, whose outline is the same size however it is turned, so the edge is taken ACROSS the view.
// Checked with real mouse drags on sxr2.sxr: zone radius 130 (was 45); a drag from 68 px out, off every
// ring, rotated the pin and left the camera alone.
check('the zone radius is taken across the view, not along a gizmo axis', /const b = this\._cameraBasis\(\);[\s\S]{0,300}vec3\.scaleAndAdd\(\[0, 0, 0\], c, b\.right, R\)/.test(GZ)
  && !/\[ROT_RADIUS \* \(this\._lastScale \|\| 1\), 0\.0, 0\.0\], this\._rotX\._finalMatrix/.test(GZ));

// DESKTOP ROTATION RINGS ARE OPEN-CYLINDER RIBBONS, with a dimmer back half. A cylinder seen from the side
// shows the outside of its near half (front faces) and the inside of its far half (back faces); the
// front is drawn as before and a second mesh on the same geometry draws the back dimmed, so which half
// of a ring is nearer reads at a glance. Checked in the browser: bright near half, dim far half; rings
// still hit (types 8/16/32), still drag, and only the held ring (front AND back) draws during a drag.
check('desktop rings are open cylinders, VR keeps its torus', /const ribbon = this\._desktop;/.test(GZ) && /Primitives\.createCylinder\(this\._gl, radius \* scale, radius \* scale, rh, 64, 1, false, false\)/.test(GZ)
  && /: Primitives\.createTorus\(this\._gl, radius \* scale, THICKNESS \* mthick \* scale, rad, 6, 64\)/.test(GZ));
check('the far half is the same geometry seen from inside, dimmer, behind the front', /new THREE\.Mesh\(threeMesh\.geometry, gizmoMat\(THREE\.BackSide, RIBBON_BACK_OPACITY, RIBBON_BACK_TINT\)\)/.test(GZ) && /back\.renderOrder = 99;/.test(GZ));
check('the ribbons are half as wide and half as opaque as first built', /const RIBBON_FRAC = 0\.11;/.test(GZ) && /const RIBBON_FRONT_OPACITY = 0\.4;/.test(GZ) && /const RIBBON_BACK_OPACITY = 0\.275;/.test(GZ));
check('a dragged handle (front and back) is drawn at a quarter of its opacity, and put back after', /const HELD_OPACITY_MUL = 0\.25;/.test(GZ) && /this\._setHeldLook\(threeMesh, heldNow\);/.test(GZ) && /this\._setHeldLook\(bm, heldNow\);/.test(GZ) && /const want = held \? heldOf\(mesh\.userData\._matN\) : mesh\.userData\._matN;/.test(GZ));
check('the back mesh follows the front: matrix and visibility every frame', /bm\.visible = threeMesh\.visible;/.test(GZ) && /mat4\.copy\(bm\.matrix\.elements, components\[i\]\._finalMatrix\);/.test(GZ));

if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('all checks passed');
