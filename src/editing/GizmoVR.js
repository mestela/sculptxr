import { vec2, vec3, mat4, quat } from 'gl-matrix';
import Primitives from '../drawables/Primitives.js';
import Enums from '../misc/Enums.js';
import * as THREE from 'three';
import getOptionsURL from '../misc/getOptionsURL.js';
import { gizmoBasis, basisAxis, ringTangent, rotationEdit, scaleEdit, axisParamFromRay } from './gizmoMath.js';


// Configuration constants
const COLOR_X = vec3.fromValues(1.0, 0.2, 0.2);
const COLOR_Y = vec3.fromValues(0.2, 1.0, 0.2);
const COLOR_Z = vec3.fromValues(0.2, 0.2, 1.0);
const COLOR_GREY = vec3.fromValues(0.5, 0.5, 0.5);
const COLOR_SW = vec3.fromValues(1.0, 0.5, 0.2);
const COLOR_SELECT = vec3.fromValues(1.0, 1.0, 0.0);

// Geometry constants
const ARROW_LENGTH = 2.5;
const ARROW_CONE_THICK = 6.0;
const ARROW_CONE_LENGTH = 0.25;
const THICKNESS = 0.02;
const THICKNESS_PICK = THICKNESS * 5.0;
const ROT_RADIUS = 1.5;
const SCALE_RADIUS = ROT_RADIUS * 1.3;
const CUBE_SIDE = 0.35;
const CUBE_SIDE_PICK = CUBE_SIDE * 1.2;

// SCREEN-CONSTANT SIZE, the desktop rule. In VR the gizmo holds a constant PHYSICAL size
// because you reach for it with your hand; on a monitor you reach for it with a cursor, so
// what has to stay constant is how big it is on screen as you dolly. Same number Gizmo.js
// used, so the desktop gizmo comes out the size it always was.
const GIZMO_SIZE_SCREEN = 160.0;

// CONSTANT PHYSICAL SIZE, the VR rule, in metres. 0.125 is what the old latched rule produced at
// the default world scale (the 15.625 sculpt-space bake x _vrScale 0.008), so the gizmo comes out
// the size it always was at the zoom it was calibrated at -- but now from a number rather than
// from whatever zoom it first woke up at. See update().
const GIZMO_SIZE_M = 0.125;

// THE USER'S SIZE MULTIPLIER, AND ITS ENDS, DEFINED WHERE THE GIZMO IS SIZED.
//
// Three things write this number -- the thumbstick while Transform is active (Scene), the
// Settings slider and the Transform section's slider (gui/transformPanel) -- and all three used
// to carry their own copy of the 0.25/2.0 clamp. They are exported from here instead, so the
// range a control offers cannot drift from the range the gizmo will honour.
//
// Live value first, saved value second: every writer sets the live one and persists the same
// number, so a change takes effect this frame and survives the session. Read through one helper
// because BOTH sizing branches need it now.
export const GIZMO_MUL_MIN = 0.25;
export const GIZMO_MUL_MAX = 2.0;

export function gizmoSizeMul() {
  const v = window._gizmoSizeMul != null ? window._gizmoSizeMul : getOptionsURL().gizmoSizeMul;
  return Number.isFinite(v) && v > 0 ? v : 1.0;
}

// Bitmasks for Gizmo parts
export const GIZMO_TYPE = {
  TRANS_X: 1 << 0,
  TRANS_Y: 1 << 1,
  TRANS_Z: 1 << 2,
  ROT_X: 1 << 3,
  ROT_Y: 1 << 4,
  ROT_Z: 1 << 5,
  ROT_W: 1 << 6,
  PLANE_X: 1 << 7,
  PLANE_Y: 1 << 8,
  PLANE_Z: 1 << 9,
  SCALE_X: 1 << 10,
  SCALE_Y: 1 << 11,
  SCALE_Z: 1 << 12,
  SCALE_W: 1 << 13,
  TRANS_W: 1 << 14   // center handle → free translate (all axes, follows the controller)
};

const TRANS_XYZ = GIZMO_TYPE.TRANS_X | GIZMO_TYPE.TRANS_Y | GIZMO_TYPE.TRANS_Z;
const ROT_XYZ = GIZMO_TYPE.ROT_X | GIZMO_TYPE.ROT_Y | GIZMO_TYPE.ROT_Z;
const PLANE_XYZ = GIZMO_TYPE.PLANE_X | GIZMO_TYPE.PLANE_Y | GIZMO_TYPE.PLANE_Z;
const SCALE_XYZW = GIZMO_TYPE.SCALE_X | GIZMO_TYPE.SCALE_Y | GIZMO_TYPE.SCALE_Z | GIZMO_TYPE.SCALE_W;

// WHICH HANDLES A THING OFFERS. A handle for something the node cannot do is a handle that lies:
// a rotate-only pin has no use for an arrow, and no pin has any use for a scale cube. Named sets
// rather than raw masks so the tool that picks one says what it means.
export const GIZMO_SETS = {
  ALL: TRANS_XYZ | ROT_XYZ | PLANE_XYZ | SCALE_XYZW | GIZMO_TYPE.ROT_W | GIZMO_TYPE.TRANS_W,
  MOVE: TRANS_XYZ | PLANE_XYZ | GIZMO_TYPE.TRANS_W,
  TURN: ROT_XYZ | GIZMO_TYPE.ROT_W,
  MOVE_TURN: TRANS_XYZ | PLANE_XYZ | ROT_XYZ | GIZMO_TYPE.TRANS_W | GIZMO_TYPE.ROT_W,
};

// ONE MATERIAL FOR THE WHOLE GIZMO, with the colour in the GEOMETRY.
//
// Every handle used to carry its own MeshBasicMaterial because each is a different colour. On
// the legacy renderer that was free: WebGLRenderer keys its program cache on the shader's
// STRUCTURE, so fifteen materials differing only in a colour uniform share one compiled program.
// The node renderer has no equivalent -- each material builds its own node graph and its own
// pipeline -- so the gizmo alone accounted for 28 of the 45 converted materials in a scene, and
// all of them compile on the frame it first appears.
//
// The geometry already carries a `color` attribute (Primitives writes one), so the fix is to use
// it: one shared material with vertexColors, and the per-handle colour written into the buffer.
// Two variants, because the plane quads need DoubleSide and a material cannot be both.
let _gizmoMatS = null, _gizmoMatD = null;
function gizmoMaterial(doubleSided) {
  const mk = (side) => new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    // The centre sphere used to be 0.85 and everything else 0.8; one number now, because a
    // second material for five hundredths of alpha is the trade this whole change is undoing.
    opacity: 0.8,
    depthTest: false,
    depthWrite: false,
    side,
  });
  if (doubleSided) return (_gizmoMatD = _gizmoMatD || mk(THREE.DoubleSide));
  return (_gizmoMatS = _gizmoMatS || mk(THREE.FrontSide));
}

// GIZMO MATERIALS FOR THE RIBBONS AND FOR A HELD HANDLE, built on demand and cached by what makes them
// differ. The colour is in the GEOMETRY (see gizmoMaterial); `tint` multiplies it down.
const _gizmoMats = new Map();
function gizmoMat(side, opacity, tint = 0xffffff) {
  const key = side + '|' + opacity.toFixed(4) + '|' + tint;
  let m = _gizmoMats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ vertexColors: true, color: tint, transparent: true, opacity,
      depthTest: false, depthWrite: false, side });
    _gizmoMats.set(key, m);
  }
  return m;
}

// THE DESKTOP ROTATION RINGS ARE OPEN-CYLINDER RIBBONS, and a cylinder seen from the side shows two
// surfaces: the OUTSIDE of the near half (front faces) and the INSIDE of the far half (back faces). The
// front is drawn as a ribbon; the back is drawn with the same geometry and vertex colours, dimmed and
// more transparent, so which half of a ring is nearer is plain at a glance, and a highlighted ring
// still lights on both halves.
const RIBBON_FRONT_OPACITY = 0.4;
const RIBBON_BACK_OPACITY = 0.275;
const RIBBON_BACK_TINT = 0x6a6a6a;       // multiplies the vertex colours down to ~40%

// A HANDLE THAT IS BEING DRAGGED goes to this fraction of its own opacity: still there to read, but not
// in front of the pose it is being used to change.
const HELD_OPACITY_MUL = 0.25;
function heldOf(m) { return gizmoMat(m.side, m.opacity * HELD_OPACITY_MUL, m.color.getHex()); }

// How wide the ribbon is along the ring's own axis, as a fraction of ROT_RADIUS. A band rather than a
// wire, but a slim one: it should not fill the gizmo or obscure what is behind it.
const RIBBON_FRAC = 0.11;

// Fill a handle's colour buffer. Cached against the last value: this is called for every part
// every frame, and re-uploading fifteen buffers a frame to write the same numbers is exactly the
// sort of cost this change exists to remove.
function setGizmoColor(mesh, r, g, b) {
  if (!mesh) return;
  const last = mesh.userData._tint;
  if (last && last[0] === r && last[1] === g && last[2] === b) return;
  const attr = mesh.geometry && mesh.geometry.getAttribute('color');
  if (!attr) return;
  for (let i = 0; i < attr.count; i++) attr.setXYZ(i, r, g, b);
  attr.needsUpdate = true;
  mesh.userData._tint = [r, g, b];
}

const createGizmoPart = function (type, nbAxis = -1) {
  return {
    _finalMatrix: mat4.create(),
    _baseMatrix: mat4.create(),
    _color: vec3.create(),
    _drawGeo: null,
    _pickGeo: null,
    _isSelected: false,
    _type: type,
    _nbAxis: nbAxis,
    _lastInter: [0.0, 0.0, 0.0],
    updateMatrix() {
      if (this._drawGeo) {
        mat4.copy(this._drawGeo.getMatrix(), this._finalMatrix);
        const tm = this._drawGeo.getThreeMesh();
        if (tm) {
          tm.matrix.fromArray(this._finalMatrix);
          tm.matrixWorldNeedsUpdate = true;
        }
      }
      if (this._pickGeo) {
        mat4.copy(this._pickGeo.getMatrix(), this._finalMatrix);
        const tm = this._pickGeo.getThreeMesh();
        if (tm) {
          tm.matrix.fromArray(this._finalMatrix);
          tm.matrixWorldNeedsUpdate = true;
        }
      }
    },
    updateFinalMatrix(mat) {
      mat4.mul(this._finalMatrix, mat, this._baseMatrix);
    }
  };
};

class GizmoVR {

  constructor(main) {
    this._main = main;
    this._gl = main._gl;

    this._group = new THREE.Group();
    this._group.name = "Transform Gizmo Group";
    this._group.visible = false; // Hide by default

    let worldGroup = null;
    if (this._main._worldGroup) {
      worldGroup = this._main._worldGroup;
    } else if (this._main._scene && this._main._scene._worldGroup) {
      worldGroup = this._main._scene._worldGroup;
    } else if (this._main.getScene && this._main.getScene()._worldGroup) {
      worldGroup = this._main.getScene()._worldGroup;
    }

    if (worldGroup) {
      worldGroup.add(this._group);
    } else if (this._main._scene && this._main._scene._scene) {
      this._main._scene._scene.add(this._group);
    } else {
      console.error("GizmoVR: Could not find scene to add to!");
      if (this._main._scene && this._main._scene.add) {
         this._main._scene.add(this._group);
      }
    }

    // Attach debug tools to window
    window.debugGizmo = {
      show: () => { if (this._group) this._group.visible = true; },
      hide: () => { if (this._group) this._group.visible = false; },
      log: () => {
        const grp = this._group;
        const sc = this._main._scene || this._main.getScene?.();
        console.group('[GizmoVR debug]');
        console.log('group.visible:', grp?.visible);
        console.log('group.parent type:', grp?.parent?.type ?? 'NULL — not in scene!');
        console.log('group.parent name:', grp?.parent?.name ?? 'n/a');
        const inWorldGroup = grp?.parent === sc?._worldGroup;
        console.log('in worldGroup:', inWorldGroup, '← should be true in VR');
        console.log('worldGroup.scale:', sc?._worldGroup?.scale);
        console.log('vrScale (_vrScale):', sc?._vrScale ?? this._main._vrScale ?? 'unknown');
        console.log('_lastScale (geometry baked at):', this._lastScale);
        console.log('geometry physical size estimate:',
          this._lastScale * (sc?._worldGroup?.scale?.x ?? 1), 'THREE.js metres');
        console.log('group.children count:', grp?.children?.length);
        if (grp?.children?.length) {
          const vis = grp.children.filter(c => c.visible).length;
          console.log('visible children:', vis, '/', grp.children.length);
        }
        const mesh = this._main.getMesh();
        console.log('current mesh:', mesh ? 'yes' : 'null');
        if (mesh) {
          const c = mesh.getCenter();
          console.log('mesh center:', c);
        }
        console.groupEnd();
      },
      // Resize gizmo geometry to `scale` sculpt units — multiply by worldGroup.scale
      // to estimate physical size, e.g. testScale(50) → 50 * 0.008 = 0.4m = 40cm
      testScale: (scale) => { this._resize(scale); this._lastScale = scale; },
      // Override the whole group's matrix scale for quick visual testing
      // (bypasses geometry, works instantly without recreating meshes)
      testGroupScale: (s) => { if (this._group) this._group.scale.set(s, s, s); },
    };

    // Default active types
    this._activatedType = TRANS_XYZ | ROT_XYZ | PLANE_XYZ | SCALE_XYZW | GIZMO_TYPE.ROT_W | GIZMO_TYPE.TRANS_W;

    // Components
    this._transX = createGizmoPart(GIZMO_TYPE.TRANS_X, 0);
    this._transY = createGizmoPart(GIZMO_TYPE.TRANS_Y, 1);
    this._transZ = createGizmoPart(GIZMO_TYPE.TRANS_Z, 2);

    this._planeX = createGizmoPart(GIZMO_TYPE.PLANE_X, 0);
    this._planeY = createGizmoPart(GIZMO_TYPE.PLANE_Y, 1);
    this._planeZ = createGizmoPart(GIZMO_TYPE.PLANE_Z, 2);

    this._scaleX = createGizmoPart(GIZMO_TYPE.SCALE_X, 0);
    this._scaleY = createGizmoPart(GIZMO_TYPE.SCALE_Y, 1);
    this._scaleZ = createGizmoPart(GIZMO_TYPE.SCALE_Z, 2);
    this._scaleW = createGizmoPart(GIZMO_TYPE.SCALE_W);

    this._rotX = createGizmoPart(GIZMO_TYPE.ROT_X, 0);
    this._rotY = createGizmoPart(GIZMO_TYPE.ROT_Y, 1);
    this._rotZ = createGizmoPart(GIZMO_TYPE.ROT_Z, 2);
    this._rotW = createGizmoPart(GIZMO_TYPE.ROT_W);

    // Center free-translate sphere (visible) + an invisible interior sphere that arms the
    // free (all-axis) rotate — its radius is inside the rings, so nearest-hit picking lets
    // the rings/arrows still grab when aimed at, and only the empty interior trackballs.
    this._transW = createGizmoPart(GIZMO_TYPE.TRANS_W);
    this._rotBall = createGizmoPart(GIZMO_TYPE.ROT_W);

    this._pickables = [];
    this._selected = null;

    // ── DESKTOP DRAG STATE ────────────────────────────────────────────────────────────
    // Set by the desktop Transform tool. Everything guarded by `_desktop` below is the
    // mouse half of this gizmo; VR never touches it.
    this._desktop = false;
    this._isEditing = false;
    this._lastDistToEye = 0.0;
    this._editLineOrigin = [0.0, 0.0, 0.0];
    this._editLineDirection = [0.0, 0.0, 0.0];
    this._editOffset = [0.0, 0.0, 0.0];
    this._editTrans = mat4.create();
    this._editTransInv = mat4.create();
    this._editLocal = [];
    this._editLocalInv = [];
    this._editScaleRot = [];
    this._editScaleRotInv = [];
    this._startLocal = [];
    this._camPlaneNormal = [0.0, 0.0, 1.0];

    window.gizmoShowPick = (on = true) => this.showPickGeometry(on);
    if (/[?&]gizmopick=1/.test(window.location.search)) this._showPickOnInit = true;

    // Initialize geometry
    this._lastScale = 1.0;
    this._resize(1.0);

    // Debug Hook
    window.debugGizmoVR = () => {
      console.log("=== GizmoVR Debug ===");
      console.log("Gizmo Instance:", this);
      console.log("Enabled Config:", this._activatedType);

      const components = [
        this._transX, this._transY, this._transZ,
        this._planeX, this._planeY, this._planeZ,
        this._rotX, this._rotY, this._rotZ, 
        this._scaleX, this._scaleY, this._scaleZ, this._scaleW
      ];
      console.log("Components:", components);

      const sample = this._transX;
      console.log("TransX Matrix:", sample._finalMatrix);
      console.log("TransX DrawGeo:", sample._drawGeo);
      if (sample._drawGeo) {
        console.log("TransX ShaderType:", sample._drawGeo._shaderType);
      }
      console.log("vrScale:", this._main._vrScale);

      // Query Scale
      window.debugGizmoIntersection = true;
      console.log("Debug Gizmo Intersection ENABLED (window.debugGizmoIntersection = true)");
      // window.debugGizmoScale = scaleFactor; // ReferenceError: scaleFactor is not defined in this scope
      return "Check Console";
    };

    window.debugQueryGizmoScale = () => {
      return "Gizmo Scale: " + (this._transX._finalMatrix[0] / (this._main._vrScale || 50.0));
    };
  }

  // Swap a handle's material between its normal one and its held one, remembering the normal.
  _setHeldLook(mesh, held) {
    if (!mesh.userData._matN) mesh.userData._matN = mesh.material;
    const want = held ? heldOf(mesh.userData._matN) : mesh.userData._matN;
    if (mesh.material !== want) mesh.material = want;
  }

  _resize(scale) {
    if (this._group) this._group.clear();
    // Re-create geometry with new scale
    // In VR we might want to just scale the matrix, but baking scale into geometry 
    // helps keep line thickness constant or controllable.
    this._initTranslate(scale);
    this._initRotate(scale);
    this._initScale(scale);
    this._initPickables();
  }

  _initPickables() {
    this._pickables.length = 0;
    const type = this._activatedType;

    const parts = [
      { mask: GIZMO_TYPE.TRANS_X, obj: this._transX },
      { mask: GIZMO_TYPE.TRANS_Y, obj: this._transY },
      { mask: GIZMO_TYPE.TRANS_Z, obj: this._transZ },
      { mask: GIZMO_TYPE.PLANE_X, obj: this._planeX },
      { mask: GIZMO_TYPE.PLANE_Y, obj: this._planeY },
      { mask: GIZMO_TYPE.PLANE_Z, obj: this._planeZ },
      { mask: GIZMO_TYPE.ROT_X, obj: this._rotX },
      { mask: GIZMO_TYPE.ROT_Y, obj: this._rotY },
      { mask: GIZMO_TYPE.ROT_Z, obj: this._rotZ },
      { mask: GIZMO_TYPE.SCALE_X, obj: this._scaleX },
      { mask: GIZMO_TYPE.SCALE_Y, obj: this._scaleY },
      { mask: GIZMO_TYPE.SCALE_Z, obj: this._scaleZ },
      { mask: GIZMO_TYPE.SCALE_W, obj: this._scaleW },
      // Center translate handle + interior trackball ball (both map to all-axis modes in
      // TransformVR). Small center sphere wins at dead-centre; interior ball (inside the
      // rings) catches the rest of the interior; rings/arrows still win when aimed at.
      { mask: GIZMO_TYPE.TRANS_W, obj: this._transW },
      { mask: GIZMO_TYPE.ROT_W, obj: this._rotBall }
    ];

    for (let i = 0; i < parts.length; ++i) {
      if (type & parts[i].mask) this._pickables.push(parts[i].obj._pickGeo);
    }
  }

  update(camera) {
    if (this._handleSetFn) this.setActivatedType(this._handleSetFn());
    // 1. Calculate Center
    let meshes = this._main.getTransformableMeshes();
    // The fallback honours the lock too -- otherwise it hands the gizmo straight back the mesh
    // the filter above just removed.
    if (meshes.length === 0 && this._main.getMesh() && !this._main.getMesh()._selectLocked) {
      meshes = [this._main.getMesh()];
    }
    const center = [0.0, 0.0, 0.0];

    if (meshes.length > 0) {
      const acc = [0.0, 0.0, 0.0];
      const icenter = [0.0, 0.0, 0.0];
      for (let i = 0; i < meshes.length; ++i) {
        const mesh = meshes[i];
        vec3.transformMat4(icenter, mesh.getCenter(), mesh.getEditMatrix());
        // Anchor in MODEL space (== getMatrix() for a top-level mesh) so the gizmo
        // sits on a parented child instead of landing tiny near the world origin.
        const _mm = mesh.getModelSpaceMatrix ? mesh.getModelSpaceMatrix() : mesh.getMatrix();
        vec3.transformMat4(icenter, icenter, _mm);
        vec3.add(acc, acc, icenter);
      }
      vec3.scale(center, acc, 1.0 / meshes.length);
    } else if (window.debugGizmoAttach === 'controller') {
      // Controller Attach Mode
      const main = this._main;
      if (main._vrControllerPos && main._vrControllerQuat) {
        vec3.copy(center, main._vrControllerPos);
        const fwd = vec3.fromValues(0, 0, -1);
        vec3.transformQuat(fwd, fwd, main._vrControllerQuat);
        vec3.scaleAndAdd(center, center, fwd, 0.2); // 20cm forward
      }
    }

    // 2. Calculate Scale
    // We want the Gizmo to be a consistent physical size in VR
    // typically around 25cm (0.25m) feels good for hand interaction.
    // However, the internal coordinate system might be scaled (vrScale).

    const baseSize = 0.25; // 25cm target size
    
    let worldScale = 1.0;
    const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
    if (sceneApp && sceneApp._worldGroup) {
      worldScale = sceneApp._worldGroup.scale.x;
    } else if (this._main._worldGroup) {
      worldScale = this._main._worldGroup.scale.x; // fallback for Scene
    }

    let scaleFactor = getOptionsURL().gizmoScale || 15.625; // Constant base size in sculpt space
    if (window.debugGizmoScale) {
      scaleFactor = window.debugGizmoScale;
    }

    // Resize geometry if scale changed significantly
    // (Optimization: only resize if diff > 10%)
    // But for now, let's just do it if we are still validating.
    // Actually, generating geometry every frame is bad.
    // Let's cache it.

    // We used to call _resize(scaleFactor * VERTEX_SCALE)
    // Let's assume VERTEX_SCALE = 1.0

    // Let's check if we really need to re-generate geometry. 
    // We can just scale the matrix!
    // The only reason to bake scale is if thickness needs to be non-uniform?
    // Start with identifying if we need to resize.

    // NOTE: In the previous code, _resize RECREATED all geometry. That is heavy.
    // We should try to avoid it.
    // Let's just create geometry ONCE at unit size, and scale via Matrix.
    // BUT: Arrow thickness etc might get weird if we scale non-uniformly.
    // For uniform scale, Matrix is fine.

    // Let's initialize once with scale 1.0 * vrScale?
    // Or just 1.0 and scale the matrix by vrScale?
    // The primitives usage in `Gizmo.js` baked scale into vertices.
    // Let's stick to baking for now to ensure visual consistency with what we had.
    // Let's stick to baking for now to ensure visual consistency with what we had.
    if (Math.abs(scaleFactor - this._lastScale) > 0.0001) {
      this._resize(scaleFactor);
      this._lastScale = scaleFactor;
    }

    // 3. Build Final Components Matrix
    const baseMat = mat4.create();
    mat4.translate(baseMat, baseMat, center);

    // A single object's gizmo follows its local axes. A multi-selection has no meaningful
    // shared local frame, so its centroid gizmo is world-aligned. TransformVR uses the same
    // rule when interpreting rotation and scale gestures; keeping the display/picker local to
    // meshes[0] here made the visible X ring disagree with the world-X rotation it produced.
    if (this._desktop) {
      // DESKTOP: the displayed frame IS the dragged frame, and it is the MODEL-space one. The
      // branch below reads the mesh's LOCAL matrix, which for a parented mesh (every joint and
      // pin) is relative to a parent the gizmo is not drawn in. LIVE during a drag, like every
      // other gizmo: it turns with the object. The drag itself is measured against the frame
      // frozen at press (`_editBasis`), so the handle turning under the cursor changes nothing
      // about what the drag does.
      const B = this._basisFor(meshes);
      if (B) mat4.multiply(baseMat, baseMat, B);
    } else if (meshes.length === 1) {
      const m = meshes[0].getMatrix();
      const sx = Math.hypot(m[0], m[1], m[2]);
      const sy = Math.hypot(m[4], m[5], m[6]);
      const sz = Math.hypot(m[8], m[9], m[10]);

      const unscaledMat = mat4.clone(m);
      if (sx > 0.0001) { unscaledMat[0] /= sx; unscaledMat[1] /= sx; unscaledMat[2] /= sx; }
      if (sy > 0.0001) { unscaledMat[4] /= sy; unscaledMat[5] /= sy; unscaledMat[6] /= sy; }
      if (sz > 0.0001) { unscaledMat[8] /= sz; unscaledMat[9] /= sz; unscaledMat[10] /= sz; }

      const qRot = quat.create();
      mat4.getRotation(qRot, unscaledMat);
      
      const mRot = mat4.create();
      mat4.fromQuat(mRot, qRot);
      mat4.multiply(baseMat, baseMat, mRot);
    }

    // A CONSTANT PHYSICAL SIZE, AND THE CONSTANT IS A CONSTANT.
    //
    // The gizmo group rides _worldGroup, which scales with double-grip zoom, so without this it
    // balloons and shrinks with the world instead of staying fixed like the menus and panels.
    // That part was always right. What was wrong is where the reference came from: it LATCHED
    // `_refWorldScale` to whatever the world scale happened to be the first time the gizmo ever
    // sized itself, and then held k = refScale/worldScale forever. Physical size works out to
    // `scaleFactor * refScale`, so the gizmo's real size was decided by the zoom you were at on
    // its first frame -- 12.5cm if that was the default 0.008, but ten times that if you had
    // zoomed in first, and eighty times that if the VR gizmo's first update had run on the
    // desktop (worldScale 0.701 there). Nothing ever released the latch, so for the rest of the
    // session it could not be argued with. matt: "the transform gizmo gets larger and larger...
    // something is resetting the scale of these elements somewhere and i can't control it."
    //
    // So the reference is now a NUMBER OF METRES, and the whole sizing is solved back from it.
    // GIZMO_SIZE_M is exactly what the old rule produced at the default world scale (15.625
    // baked x 0.008 = 0.125m), so at the zoom the default was calibrated for nothing moves --
    // it is the same gizmo, just one that cannot inherit somebody else's reference any more.
    //
    // DESKTOP: screen-constant instead, and measured from the camera rather than from the
    // world scale. `_lastDistToEye` is frozen while a drag is running so the gizmo does not
    // resize under the cursor mid-edit -- the handle you grabbed has to stay where you
    // grabbed it. (Gizmo.js's rule, carried over with it.)
    if (this._desktop && camera && camera.computePosition) {
      const eye = camera.computePosition();
      const d = vec3.dist(eye, center);
      this._lastDistToEye = this._isEditing ? (this._lastDistToEye || d) : d;
      // DIVIDED BY THE BAKE. VR sizes the gizmo by BAKING `scaleFactor` into the geometry and
      // then uses the matrix only to hold that physical size against world zoom. The screen
      // rule wants the matrix to carry the whole size, so the bake has to come back out --
      // left in, the two multiply and the gizmo fills the viewport.
      const k = ((this._lastDistToEye * GIZMO_SIZE_SCREEN) / camera.getConstantScreen())
        / (this._lastScale || 1);
      // THE SIZE MULTIPLIER APPLIES HERE TOO. It was on the VR branch only, so the "Gizmo size"
      // slider and the thumbstick did nothing whatsoever on the desktop -- a control that exists
      // and is inert reads as no control at all.
      const km = k * gizmoSizeMul();
      mat4.scale(baseMat, baseMat, [km, km, km]);
    } else if (worldScale > 0.0001) {
      // Solved from the target size in metres: physical = lastScale (the bake) * k * worldScale,
      // so k = metres / (bake * worldScale). No latch, no history, same answer every session.
      const k = (GIZMO_SIZE_M * gizmoSizeMul()) / ((this._lastScale || 1) * worldScale);
      mat4.scale(baseMat, baseMat, [k, k, k]);
    }

    // Update all components
    const components = [
      this._transX, this._transY, this._transZ,
      this._planeX, this._planeY, this._planeZ,
      this._rotX, this._rotY, this._rotZ, 
      this._scaleX, this._scaleY, this._scaleZ, this._scaleW,
      this._transW, this._rotBall
    ];

    for (let i = 0; i < components.length; ++i) {
      components[i].updateFinalMatrix(baseMat);
      
      const threeMesh = components[i]._drawGeo.getThreeMesh();
      if (threeMesh) {
        // A handle the current set does not offer is not drawn either (it is not picked: the
        // tiered pick already tests the type).
        // (The interior trackball ball is never drawn; leave its own flag alone.)
        // WHILE A HANDLE IS HELD, ONLY THAT HANDLE IS DRAWN. The rest of the gizmo is in the way of
        // watching what the one you are dragging does, and comes back the moment you let go.
        // (Dragging the interior trackball, which has no drawn handle, leaves nothing showing.)
        const _held = this._desktop && this._isEditing && this._selected;
        if (components[i] !== this._rotBall) {
          threeMesh.visible = !!(this._activatedType & components[i]._type) && (!_held || components[i] === this._selected);
        }
        mat4.copy(threeMesh.matrix.elements, components[i]._finalMatrix);
        threeMesh.matrixWorldNeedsUpdate = true;
        // The handle being dragged is shown at a quarter of its opacity (and put back afterwards).
        const heldNow = !!(_held && components[i] === this._selected);
        this._setHeldLook(threeMesh, heldNow);
        const bm = components[i]._backMesh;
        if (bm) {
          mat4.copy(bm.matrix.elements, components[i]._finalMatrix);
          bm.matrixWorldNeedsUpdate = true;
          bm.visible = threeMesh.visible;
          this._setHeldLook(bm, heldNow);
        }
      }
      
      if (components[i]._pickGeo) {
        mat4.copy(components[i]._pickGeo.getMatrix(), components[i]._finalMatrix);
      }
      
      const elt = components[i];
      if (elt._drawGeo) {
        const tm = elt._drawGeo.getThreeMesh();
        if (tm) {
          // Into the GEOMETRY, not the material -- the material is shared by every handle now.
          // setGizmoColor caches, so a handle whose colour has not changed costs a comparison.
          const color = elt._isSelected ? COLOR_SELECT : elt._color;
          setGizmoColor(tm, color[0], color[1], color[2]);
        }
      }
    }

    // ── THE DESKTOP PICK HAS TO LIVE IN THE SAME WORLD THE HANDLES ARE DRAWN IN ────────
    //
    // Two matrices, and only one of them was being written. `_finalMatrix` goes to the pick
    // geometry's gl-matrix side, which is what the VR ray test reads (intersectionRayMeshesVR
    // -> getModelSpaceMatrix), and that is why VR was never wrong. The DESKTOP picker takes a
    // world-space ray and transforms it by inverse(threeMesh.matrixWorld) -- the three side --
    // and these pick meshes have no parent, so their matrixWorld carried no _worldGroup at all.
    //
    // The handles are drawn under _worldGroup (0.701), so every pick zone sat 1/0.701 = 1.43x
    // further from the centre than the handle you could see. Measured: the X arrow drawn at
    // 8.27 and picked at 11.8. The error is proportional to distance from the centre, which is
    // why the centre sphere and the plane quads felt right and the arrow tips and rings did
    // not. matt: "the highlight selection is misaligned."
    //
    // THE PICK MESHES ARE PARENTED INTO THE GROUP, invisible, and three keeps their
    // matrixWorld for them. This started as a hand-composed `group.matrixWorld * matrix` on the
    // reasoning that fifteen invisible CPU-only meshes were fifteen more objects for every
    // per-frame traversal to walk -- and that hand-composed version was WRONG in a way no
    // measurement of mine could see, because every measurement I took happened to be with the
    // debug overlay switched on, and switching it on is exactly what parents them. matt found
    // it in one line: "it ONLY works if i add ?gizmopick=1".
    //
    // The lesson is worth more than the fix: an instrument that changes the thing it measures
    // confirms itself. The overlay now changes only `visible` and the material, so what you see
    // is what picks either way.
    //
    // matrixWorldNeedsUpdate every frame because matrixAutoUpdate is off and `matrix` is
    // written here -- the same contract the drawn handles use a few lines above.
    if (this._showPickOnInit) { this._showPickOnInit = false; this.showPickGeometry(true); }
    if (this._desktop) {
      // A GIZMO OVER NOTHING IS AN OFFER TO DRAG SOMETHING THAT IS NOT THERE, and a locked
      // mesh is exactly that: getTransformableMeshes filters it out, so `getMesh()` is the
      // wrong question. Decided here rather than in the caller because this is the one place
      // that runs every frame -- SculptManager.syncTransformGizmoVisibility still answers it on
      // a selection or tool change, which this cannot see.
      const _movable = this._main.getTransformableMeshes().length > 0
        || !!(this._main.getMesh() && !this._main.getMesh()._selectLocked);
      if (this._group) this._group.visible = _movable;
      if (!_movable) return;
      for (let i = 0; i < components.length; ++i) {
        const pg = components[i]._pickGeo;
        const pm = pg && pg.getThreeMesh && pg.getThreeMesh();
        if (!pm) continue;
        if (pm.parent !== this._group) {
          pm.visible = !!this._showPick;
          this._group.add(pm);
        }
        pm.matrixAutoUpdate = false;
        pm.matrix.fromArray(components[i]._finalMatrix);
        pm.matrixWorldNeedsUpdate = true;
      }
      this._group.updateMatrixWorld(true);
    }
  }

  intersect(origin, direction) {
    let worldScale = 1.0;
    const sceneApp = this._main.getScene ? this._main.getScene() : this._main._scene;
    if (sceneApp && sceneApp._worldGroup) {
      worldScale = sceneApp._worldGroup.scale.x;
    } else if (this._main._worldGroup) {
      worldScale = this._main._worldGroup.scale.x;
    }
    return this.intersectPhysical(origin, direction, (0.05 / worldScale), false);
  }

  intersectPhysical(origin, direction, radius, isPhysical = true) {
    const main = this._main;
    const pick = main.getPicking();

    // 1. Transform Gizmo Components to Intersection Space
    const components = [
      this._transX, this._transY, this._transZ,
      this._planeX, this._planeY, this._planeZ,
      this._rotX, this._rotY, this._rotZ, 
      this._scaleX, this._scaleY, this._scaleZ, this._scaleW,
      this._transW, this._rotBall
    ];

    const backups = new Array(components.length);
    if (isPhysical) {
      const engToPhys = mat4.create();
      main.computeEngineToPhysicalMatrix(engToPhys);

      for (let i = 0; i < components.length; ++i) {
        const elt = components[i];
        if (!elt._pickGeo) continue;
        const mesh = elt._pickGeo;
        backups[i] = mat4.clone(mesh.getMatrix());
        const physMat = mat4.create();
        mat4.mul(physMat, engToPhys, backups[i]);
        mat4.copy(mesh.getMatrix(), physMat);
      }
    }

    // 2. Perform Intersection
    // Backup state to prevent destructive clearing if we miss the gizmo
    const oldMesh = pick.getMesh();
    const oldFace = pick.getPickedFace();
    const oldPoint = vec3.clone(pick.getIntersectionPoint());
    const oldR2 = pick._rWorld2;
    const oldRL2 = pick._rLocal2;

    // Priority-tiered pick (same idea as the desktop gizmo): test tier by tier and take the
    // first tier that hits anything. Crucially the interior trackball ball is LAST, so its
    // big sphere no longer occludes the small center handle / thin arrows on nearest-hit.
    const _pt = this._activatedType;
    const _tiers = [
      [this._transW],
      [this._planeX, this._planeY, this._planeZ],
      [this._transX, this._transY, this._transZ,
       this._scaleX, this._scaleY, this._scaleZ, this._scaleW],
      [this._rotX, this._rotY, this._rotZ],
      [this._rotBall],
    ];
    for (let ti = 0; ti < _tiers.length; ++ti) {
      const geos = [];
      for (let j = 0; j < _tiers[ti].length; ++j) {
        const p = _tiers[ti][j];
        if ((_pt & p._type) && p._pickGeo) geos.push(p._pickGeo);
      }
      if (geos.length === 0) continue;
      pick.intersectionRayMeshesVR(geos, origin, direction, radius);
      if (pick.getMesh()) break;
    }

    const hitMesh = pick.getMesh();
    if (!hitMesh && oldMesh) {
      // Restore if we missed the gizmo but had a world hit
      pick._mesh = oldMesh;
      pick._pickedFace = oldFace;
      vec3.copy(pick._interPoint, oldPoint);
      pick._rWorld2 = oldR2;
      pick._rLocal2 = oldRL2;
    }

    // 3. Restore Matrices
    if (isPhysical) {
      for (let i = 0; i < components.length; ++i) {
        if (backups[i]) mat4.copy(components[i]._pickGeo.getMatrix(), backups[i]);
      }
    }

    if (this._selected) this._selected._isSelected = false;

    const mesh = pick.getMesh();

    // Visual Debugging
    if (window.debugGizmoIntersection) {
      if (!this._logThrottle) this._logThrottle = 0;
      const shouldLog = (this._logThrottle++ % 60 === 0);

      const pt = pick.getIntersectionPoint(); // Local Space of pickable
      const worldPt = vec3.create();

      if (mesh) {
        if (mesh._gizmo) {
          vec3.copy(mesh._gizmo._lastInter, pt);
        }
        vec3.transformMat4(worldPt, pt, mesh.getMatrix());
        if (shouldLog) console.log("Hit:", mesh._gizmo._type, "at", worldPt);
        main.updateDebugPivot(worldPt, true);
      } else {
        if (shouldLog) console.log("No Hit");
      }
    }

    if (!mesh || !mesh._gizmo) {
      this._selected = null;
      return -1;
    }

    this._selected = mesh._gizmo;
    this._selected._isSelected = true;
    vec3.copy(this._selected._lastInter, pick.getIntersectionPoint());

    return this._selected._type;
  }

  render(camera) {
    // Three.js handles rendering via the scene graph.
  }

  // ══ THE DESKTOP HALF ══════════════════════════════════════════════════════════════════
  //
  // Lifted from Gizmo.js, which was a fork of this file: same GIZMO_TYPE bits, same part
  // objects (`_finalMatrix`, `_nbAxis`, `_lastInter`, `_pickGeo`), so the maths carries over
  // unchanged. What differs between the two is only where the ray comes from and how the
  // gizmo is sized -- a controller pose and a constant physical size in VR, a mouse ray and a
  // constant SCREEN size here. Those are genuinely different inputs, not duplicated logic,
  // which is why one gizmo can serve both and two of them never needed to exist.
  //
  // #84. The desktop gizmo also happened to be broken on the node renderer -- it draws
  // through the legacy raw-GL tail, which does not run there, and came out as a speck at the
  // centre of the mesh. So this is a repair as much as a merge.

  setActivatedType(type) {
    if (type === this._activatedType) return;
    this._activatedType = type;
    this._initPickables();
  }

  _computeCenterGizmo(center = [0.0, 0.0, 0.0]) {
    let meshes = this._main.getTransformableMeshes();
    if (meshes.length === 0 && this._main.getMesh() && !this._main.getMesh()._selectLocked) {
      meshes = [this._main.getMesh()];
    }
    const acc = [0.0, 0.0, 0.0];
    const icenter = [0.0, 0.0, 0.0];
    for (let i = 0; i < meshes.length; ++i) {
      const mesh = meshes[i];
      vec3.transformMat4(icenter, mesh.getCenter(), mesh.getEditMatrix());
      const mm = mesh.getModelSpaceMatrix ? mesh.getModelSpaceMatrix() : mesh.getMatrix();
      vec3.transformMat4(icenter, icenter, mm);
      vec3.add(acc, acc, icenter);
    }
    if (meshes.length > 0) vec3.scale(center, acc, 1.0 / meshes.length);
    return center;
  }

  // The 2D rubber-band line Gizmo.js drew during a drag is NOT carried over. It is a legacy
  // raw-GL Primitives.createLine2D on the tail pass that does not run on the node renderer,
  // and THREE.Line is unsupported on this backend, so there is nothing to draw it with. It
  // was a drag affordance, not information -- the object moves under the cursor either way.
  _updateLineHelper() {}

  // The frame the desktop handles are drawn in AND dragged about. A single node follows its own
  // model-space orientation; a multi-selection has no shared frame, so it is world-aligned.
  // Null means world.
  _basisFor(meshes) {
    if (meshes.length !== 1) return null;
    const m = meshes[0];
    // A tool that knows better than the node's own matrix (a joint, whose axes mean nothing
    // about the limb) supplies the frame; anything it declines gets the model-space orientation.
    const f = this._frameFn ? this._frameFn(m) : null;
    if (f) return f;
    return gizmoBasis(m.getModelSpaceMatrix ? m.getModelSpaceMatrix() : m.getMatrix());
  }

  // Axis n of the frozen edit frame, in model space.
  _editAxis(n, out) {
    return this._editBasis ? basisAxis(this._editBasis, n, out)
      : vec3.set(out || vec3.create(), n === 0 ? 1 : 0, n === 1 ? 1 : 0, n === 2 ? 1 : 0);
  }

  _saveEditMatrices() {
    const meshes = this._main.getTransformableMeshes();
    this._editBasis = this._desktop ? this._basisFor(meshes) : null;
    const center = this._computeCenterGizmo();
    mat4.translate(this._editTrans, mat4.identity(this._editTrans), center);
    mat4.invert(this._editTransInv, this._editTrans);

    for (let i = 0; i < meshes.length; ++i) {
      this._editLocal[i] = mat4.create();
      this._editScaleRot[i] = mat4.create();
      this._editLocalInv[i] = mat4.create();
      this._editScaleRotInv[i] = mat4.create();
      // Snapshot the LOCAL matrix at drag start; live writes are startLocal * editMatrix.
      this._startLocal[i] = mat4.clone(meshes[i].getMatrix());
      // The MODEL matrix is the edit frame, so the conjugation below yields a mesh-LOCAL
      // delta and a parented child commits correctly. Reduces to getMatrix() when unparented.
      meshes[i].getModelSpaceMatrix(this._editLocal[i]);
      mat4.copy(this._editScaleRot[i], this._editLocal[i]);
      this._editScaleRot[i][12] = this._editScaleRot[i][13] = this._editScaleRot[i][14] = 0.0;
      mat4.invert(this._editLocalInv[i], this._editLocal[i]);
      mat4.invert(this._editScaleRotInv[i], this._editScaleRot[i]);
    }
    this._startLocal.length = meshes.length;
  }

  _scaleRotateEditMatrix(edit, i) {
    mat4.mul(edit, this._editTrans, edit);
    mat4.mul(edit, edit, this._editTransInv);
    mat4.mul(edit, this._editLocalInv[i], edit);
    mat4.mul(edit, edit, this._editLocal[i]);
  }

  _applyEditLive() {
    const meshes = this._main.getTransformableMeshes();
    const tmp = mat4.create();
    for (let i = 0; i < meshes.length; ++i) {
      if (!this._startLocal[i]) continue;
      const em = meshes[i].getEditMatrix();
      mat4.mul(tmp, this._startLocal[i], em);
      meshes[i].setMatrix(tmp);
      mat4.identity(em);
    }
  }

  // ── drag starts ──────────────────────────────────────────────────────────────────────

  // MODEL SPACE <-> THE SCREEN. The gizmo, like everything in the scene, is drawn under _worldGroup,
  // which scales (and may move) the model; the camera projects WORLD points. Projecting a model-space
  // point directly puts it somewhere else -- on a rig low in the scene, tens of pixels from where the
  // gizmo is drawn -- so the trackball zone, the arcball and every drag's screen-space bookkeeping
  // were measured on a circle that was not the one on screen: press inside the visible ring and the
  // tool saw nothing there and orbited the view. Every projection and unprojection goes through the
  // world group here.
  _wgMat() {
    const wg = this._main._worldGroup;
    if (!wg || !wg.matrixWorld || !wg.updateMatrixWorld) return null;
    wg.updateMatrixWorld(true);
    return wg.matrixWorld.elements;
  }

  _toWorld(p) {
    const W = this._wgMat();
    if (!W) return [p[0], p[1], p[2]];
    return [W[0] * p[0] + W[4] * p[1] + W[8] * p[2] + W[12],
      W[1] * p[0] + W[5] * p[1] + W[9] * p[2] + W[13],
      W[2] * p[0] + W[6] * p[1] + W[10] * p[2] + W[14]];
  }

  _toModel(p) {
    const W = this._wgMat();
    if (!W) return [p[0], p[1], p[2]];
    const inv = mat4.invert(mat4.create(), W);
    return vec3.transformMat4([0, 0, 0], p, inv);
  }

  _proj(camera, p) { return camera.project(this._toWorld(p)); }

  _unprojModel(camera, x, y, z) { return this._toModel(camera.unproject(x, y, z)); }

  _startRotateEdit() {
    // WHICH WAY THE CURSOR HAS TO TRAVEL, from the point actually grabbed. The tangent of the
    // ring at that point (axis x radius) is the direction a positive rotation carries it; its
    // screen projection is the drag line. No per-axis sign: the old table assumed the ring was
    // seen from the front and the displayed axis was the dragged one, and was wrong in both.
    const main = this._main;
    const camera = main.getCamera();
    const c = this._computeCenterGizmo([0.0, 0.0, 0.0]);
    const axisW = this._editAxis(this._selected._nbAxis, [0, 0, 0]);
    const P = vec3.transformMat4([0, 0, 0], this._selected._lastInter, this._selected._finalMatrix);
    this._rotAxis = axisW;
    const t = ringTangent(axisW, P, c, [0, 0, 0]);
    const a = this._proj(camera, P);
    const b = this._proj(camera, vec3.scaleAndAdd([0, 0, 0], P, t, vec3.dist(P, c) * 0.25 || 1.0));
    const dir = this._editLineDirection;
    vec2.normalize(dir, vec2.sub(dir, b, a));
    vec2.set(this._editLineOrigin, main._mouseX, main._mouseY);
  }

  _startTranslateEdit() {
    const main = this._main;
    const camera = main.getCamera();
    const origin = this._editLineOrigin;
    const dir = this._editLineDirection;

    this._computeCenterGizmo(origin);
    const nbAxis = this._selected._nbAxis;
    if (nbAxis !== -1) this._editAxis(nbAxis, dir);
    vec3.add(dir, origin, dir);

    vec3.copy(origin, this._proj(camera, origin));
    vec3.copy(dir, this._proj(camera, dir));
    vec2.normalize(dir, vec2.sub(dir, dir, origin));

    this._editOffset[0] = main._mouseX - origin[0];
    this._editOffset[1] = main._mouseY - origin[1];
  }

  _startPlaneEdit() {
    const main = this._main;
    const camera = main.getCamera();
    const origin = this._editLineOrigin;
    this._computeCenterGizmo(origin);
    vec3.copy(origin, this._proj(camera, origin));
    this._editOffset[0] = main._mouseX - origin[0];
    this._editOffset[1] = main._mouseY - origin[1];
    vec2.set(this._editLineOrigin, main._mouseX, main._mouseY);
  }

  _startScaleEdit() {
    this._startTranslateEdit();
  }

  // Centre handle: free translate in the camera plane. The plane normal is captured ONCE at
  // drag start -- recomputing it per frame would let the object chase an orbiting camera.
  _startCameraPlaneEdit() {
    const main = this._main;
    const camera = main.getCamera();
    const origin = this._editLineOrigin;
    this._computeCenterGizmo(origin);
    vec3.copy(origin, this._proj(camera, origin));
    this._editOffset[0] = main._mouseX - origin[0];
    this._editOffset[1] = main._mouseY - origin[1];
    vec2.set(this._editLineOrigin, main._mouseX, main._mouseY);

    const c = this._computeCenterGizmo([0, 0, 0]);
    const cs = this._proj(camera, c);
    const n0 = this._unprojModel(camera, cs[0], cs[1], 0.0);
    const n1 = this._unprojModel(camera, cs[0], cs[1], 0.5);
    this._camPlaneNormal = vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], n1, n0));
  }

  _startTrackballEdit() {
    this._trackStartVec = this._arcballVec(this._main._mouseX, this._main._mouseY);
    this._trackBasis = this._cameraBasis();
  }

  // ── drag updates ─────────────────────────────────────────────────────────────────────

  _updateRotateEdit() {
    const main = this._main;
    const origin = this._editLineOrigin;
    const dir = this._editLineDirection;

    const vec = [main._mouseX, main._mouseY, 0.0];
    vec2.sub(vec, vec, origin);
    const dist = vec2.dot(vec, dir);

    let angle = (7 * dist) / Math.min(main.getCanvasWidth(), main.getCanvasHeight());
    angle %= Math.PI * 2;

    const meshes = main.getTransformableMeshes();
    for (let i = 0; i < meshes.length; ++i) {
      const mrot = meshes[i].getEditMatrix();
      rotationEdit(this._rotAxis, angle, mrot);
      this._scaleRotateEditMatrix(mrot, i);
    }
  }

  _updateTranslateEdit() {
    const main = this._main;
    const camera = main.getCamera();
    const origin = this._editLineOrigin;
    const dir = this._editLineDirection;

    const vec = [main._mouseX, main._mouseY, 0.0];
    vec2.sub(vec, vec, origin);
    vec2.sub(vec, vec, this._editOffset);
    vec2.scaleAndAdd(vec, origin, dir, vec2.dot(vec, dir));

    const near = this._unprojModel(camera, vec[0], vec[1], 0.0);
    const far = this._unprojModel(camera, vec[0], vec[1], 0.1);
    vec3.transformMat4(near, near, this._editTransInv);
    vec3.transformMat4(far, far, this._editTransInv);

    vec3.normalize(vec, vec3.sub(vec, far, near));

    const axisW = this._editAxis(this._selected._nbAxis, [0, 0, 0]);
    const t = axisParamFromRay(near, vec, axisW);
    this._updateMatrixTranslate(vec3.scale(axisW, axisW, t));
  }

  _updatePlaneEdit() {
    const main = this._main;
    const camera = main.getCamera();
    const vec = [main._mouseX, main._mouseY, 0.0];
    vec2.sub(vec, vec, this._editOffset);

    const near = this._unprojModel(camera, vec[0], vec[1], 0.0);
    const far = this._unprojModel(camera, vec[0], vec[1], 0.1);
    vec3.transformMat4(near, near, this._editTransInv);
    vec3.transformMat4(far, far, this._editTransInv);

    const inter = this._editAxis(this._selected._nbAxis, [0, 0, 0]);
    const dist1 = vec3.dot(near, inter);
    const dist2 = vec3.dot(far, inter);
    if (dist1 === dist2) return false;

    const val = -dist1 / (dist2 - dist1);
    inter[0] = near[0] + (far[0] - near[0]) * val;
    inter[1] = near[1] + (far[1] - near[1]) * val;
    inter[2] = near[2] + (far[2] - near[2]) * val;
    this._updateMatrixTranslate(inter);
  }

  _updateCameraPlaneEdit() {
    const main = this._main;
    const camera = main.getCamera();
    const vec = [main._mouseX, main._mouseY, 0.0];
    vec2.sub(vec, vec, this._editOffset);

    const near = this._unprojModel(camera, vec[0], vec[1], 0.0);
    const far = this._unprojModel(camera, vec[0], vec[1], 0.1);
    vec3.transformMat4(near, near, this._editTransInv);
    vec3.transformMat4(far, far, this._editTransInv);

    const N = this._camPlaneNormal;
    const dist1 = vec3.dot(near, N);
    const dist2 = vec3.dot(far, N);
    if (dist1 === dist2) return false;
    const val = -dist1 / (dist2 - dist1);
    this._updateMatrixTranslate([
      near[0] + (far[0] - near[0]) * val,
      near[1] + (far[1] - near[1]) * val,
      near[2] + (far[2] - near[2]) * val,
    ]);
  }

  _updateScaleEdit() {
    const main = this._main;
    const origin = this._editLineOrigin;
    const dir = this._editLineDirection;
    const nbAxis = this._selected._nbAxis;

    const vec = [main._mouseX, main._mouseY, 0.0];
    if (nbAxis !== -1) {
      vec2.sub(vec, vec, origin);
      vec2.scaleAndAdd(vec, origin, dir, vec2.dot(vec, dir));
    }

    const distOffset = vec3.len(this._editOffset);
    const inter = [1.0, 1.0, 1.0];
    const scaleMult = Math.max(-0.99, (vec2.dist(origin, vec) - distOffset) / distOffset);
    if (nbAxis === -1) { inter[0] += scaleMult; inter[1] += scaleMult; inter[2] += scaleMult; }
    else inter[nbAxis] += scaleMult;

    const meshes = main.getTransformableMeshes();
    for (let i = 0; i < meshes.length; ++i) {
      const edim = meshes[i].getEditMatrix();
      if (this._editBasis) scaleEdit(this._editBasis, inter, edim);
      else { mat4.identity(edim); mat4.scale(edim, edim, inter); }
      this._scaleRotateEditMatrix(edim, i);
    }
  }

  _updateMatrixTranslate(inter) {
    const tmp = [0, 0, 0];
    const meshes = this._main.getTransformableMeshes();
    for (let i = 0; i < meshes.length; ++i) {
      vec3.transformMat4(tmp, inter, this._editScaleRotInv[i]);
      // (`inter` is in MODEL space now -- the ray is unprojected through the world group -- so there is
      // no scale left to divide out here.)
      const edim = meshes[i].getEditMatrix();
      mat4.identity(edim);
      mat4.translate(edim, edim, tmp);
    }
  }

  // ── trackball ────────────────────────────────────────────────────────────────────────
  //
  // The sphere's on-screen radius comes from the X ring rather than Gizmo.js's `_rotW`: this
  // gizmo builds no `_rotW` geometry (its free-rotate handle is the interior `_rotBall`), so
  // reading `_rotW._finalMatrix` here would measure an identity matrix and give every click
  // a radius of nothing.
  _gizmoScreenRadius() {
    const camera = this._main.getCamera();
    const c = this._computeCenterGizmo([0, 0, 0]);
    const cs = this._proj(camera, c);
    // ROT_RADIUS IS A PRE-BAKE NUMBER. This gizmo bakes `_lastScale` into the ring geometry
    // and leaves the matrix carrying only the sizing factor, so the ring's real radius in the
    // part's own frame is ROT_RADIUS * _lastScale. Using the bare constant (what Gizmo.js did,
    // correctly, because its geometry was unit-sized) measured the sphere at 8 screen pixels:
    // the trackball zone then never armed and the arcball mapped every drag to a wild angle.
    //
    // ...AND THE EDGE IS TAKEN ACROSS THE VIEW, NOT ALONG A GIZMO AXIS. The rings are great circles of
    // a sphere, and the sphere's outline on screen is the same size however the gizmo is turned. This
    // used to step along the ring part's own X axis -- which is the ring's rotation AXIS, and points
    // at the camera for a gizmo whose X is the view direction (the hips pin, looked at from the
    // front): the "radius" came out a third of the circle you can see, and a press inside the visible
    // ring but outside that sliver found no handle and orbited the view.
    const b = this._cameraBasis();
    const F = this._rotX._finalMatrix;
    const R = ROT_RADIUS * (this._lastScale || 1) * Math.hypot(F[0], F[1], F[2]);
    const edge = vec3.scaleAndAdd([0, 0, 0], c, b.right, R);
    const es = this._proj(camera, edge);
    const dx = es[0] - cs[0], dy = es[1] - cs[1];
    return { cx: cs[0], cy: cs[1], r: Math.max(1e-3, Math.sqrt(dx * dx + dy * dy)) };
  }

  // THE TRACKBALL IS THE WHOLE INTERIOR. This is only ever consulted after the tiered pick
  // has returned nothing, and that pick gives the centre sphere and the planes their own
  // priority tiers -- so if it missed them there is nothing left in the middle to protect.
  // What a centre exclusion costs is the gesture every other app has: press inside the gizmo
  // on empty space and swing. matt: "usually click and drag within the transform gizmo in
  // empty space is treated as a trackball rotation".
  _inTrackballZone(mx, my) {
    const s = this._gizmoScreenRadius();
    const dx = mx - s.cx, dy = my - s.cy;
    return (dx * dx + dy * dy) <= s.r * s.r;
  }

  // Camera right / up / toward-viewer in world space, via unproject. Screen y grows down,
  // so screen-up is cy - 10.
  _cameraBasis() {
    const camera = this._main.getCamera();
    const c = this._computeCenterGizmo([0, 0, 0]);
    const cs = this._proj(camera, c);
    const o = this._unprojModel(camera, cs[0], cs[1], 0.0);
    const oR = this._unprojModel(camera, cs[0] + 10, cs[1], 0.0);
    const oU = this._unprojModel(camera, cs[0], cs[1] - 10, 0.0);
    const oF = this._unprojModel(camera, cs[0], cs[1], 0.5);
    return {
      right: vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], oR, o)),
      up: vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], oU, o)),
      viewer: vec3.normalize([0, 0, 0], vec3.sub([0, 0, 0], o, oF)),
    };
  }

  _arcballVec(mx, my) {
    const s = this._gizmoScreenRadius();
    let x = (mx - s.cx) / s.r;
    let y = (my - s.cy) / s.r;
    const d2 = x * x + y * y;
    let z;
    if (d2 <= 1.0) {
      z = Math.sqrt(1.0 - d2);
    } else {
      const inv = 1.0 / Math.sqrt(d2);
      x *= inv; y *= inv; z = 0.0;
    }
    return [x, -y, z];
  }

  _updateTrackballEdit() {
    const meshes = this._main.getTransformableMeshes();
    const v0 = this._trackStartVec;
    const v1 = this._arcballVec(this._main._mouseX, this._main._mouseY);

    const axisCam = vec3.cross([0, 0, 0], v0, v1);
    const lenAxis = vec3.length(axisCam);
    const dot = Math.max(-1.0, Math.min(1.0, vec3.dot(v0, v1)));
    const angle = Math.atan2(lenAxis, dot);

    if (lenAxis < 1e-6 || angle < 1e-6) {
      for (let k = 0; k < meshes.length; ++k) mat4.identity(meshes[k].getEditMatrix());
      return;
    }
    vec3.scale(axisCam, axisCam, 1.0 / lenAxis);

    const b = this._trackBasis;
    const axisW = [
      b.right[0] * axisCam[0] + b.up[0] * axisCam[1] + b.viewer[0] * axisCam[2],
      b.right[1] * axisCam[0] + b.up[1] * axisCam[1] + b.viewer[1] * axisCam[2],
      b.right[2] * axisCam[0] + b.up[2] * axisCam[1] + b.viewer[2] * axisCam[2],
    ];
    vec3.normalize(axisW, axisW);

    for (let i = 0; i < meshes.length; ++i) {
      const mrot = meshes[i].getEditMatrix();
      mat4.identity(mrot);
      mat4.rotate(mrot, mrot, angle, axisW);
      this._scaleRotateEditMatrix(mrot, i);
    }
  }

  // ── mouse entry points, called by the desktop Transform tool ─────────────────────────

  onMouseOver() {
    if (this._isEditing) {
      const type = this._selected._type;
      if (type & ROT_XYZ) this._updateRotateEdit();
      else if (type & TRANS_XYZ) this._updateTranslateEdit();
      else if (type & PLANE_XYZ) this._updatePlaneEdit();
      else if (type & SCALE_XYZW) this._updateScaleEdit();
      else if (type & GIZMO_TYPE.TRANS_W) this._updateCameraPlaneEdit();
      else if (type & GIZMO_TYPE.ROT_W) this._updateTrackballEdit();

      this._applyEditLive();
      this._main.render();
      return true;
    }

    const main = this._main;
    const picking = main.getPicking();
    const mx = main._mouseX;
    const my = main._mouseY;

    if (this._selected) this._selected._isSelected = false;
    const sel = this._pickGizmoTiered(mx, my);
    if (!sel) {
      if ((this._activatedType & GIZMO_TYPE.ROT_W) && this._inTrackballZone(mx, my)) {
        this._selected = this._rotBall;
        this._rotBall._isSelected = true;
        return true;
      }
      this._selected = null;
      return false;
    }

    this._selected = sel;
    this._selected._isSelected = true;
    vec3.copy(this._selected._lastInter, picking.getIntersectionPoint());
    return true;
  }

  // Priority-tiered pick. The handles draw as a depth-off overlay, so a raw nearest-hit ray
  // test lets the fat arrow bases (which meet at the centre) and the rotation tori win over
  // the small centre sphere and the thin plane quads you are visually on. Test tier by tier
  // and take the nearest hit in the FIRST tier that hits anything -- that matches what you
  // see, which is the only thing a depth-off overlay can be judged against.
  _pickGizmoTiered(mx, my) {
    const picking = this._main.getPicking();
    const t = this._activatedType;
    const tiers = [
      [this._transW],
      [this._planeX, this._planeY, this._planeZ],
      [this._transX, this._transY, this._transZ,
       this._scaleX, this._scaleY, this._scaleZ, this._scaleW],
      [this._rotX, this._rotY, this._rotZ],
    ];
    for (let ti = 0; ti < tiers.length; ++ti) {
      const geos = [];
      for (let j = 0; j < tiers[ti].length; ++j) {
        const part = tiers[ti][j];
        if (part && (t & part._type) && part._pickGeo) geos.push(part._pickGeo);
      }
      if (geos.length === 0) continue;
      // twoSided ONLY for the plane tier: a thin quad goes edge-on at some views and a
      // one-sided test culls it. The rings must stay one-sided, or a click well outside the
      // gizmo grazing a ring's hidden back arc grabs that axis with no visible highlight.
      picking.intersectionMouseMeshes(geos, mx, my, ti === 1);
      const geo = picking.getMesh();
      if (geo) return geo._gizmo;
    }
    return null;
  }

  onMouseDown() {
    const sel = this._selected;
    if (!sel) return false;

    this._isEditing = true;
    const type = sel._type;
    this._saveEditMatrices();

    if (type & ROT_XYZ) this._startRotateEdit();
    else if (type & TRANS_XYZ) this._startTranslateEdit();
    else if (type & PLANE_XYZ) this._startPlaneEdit();
    else if (type & SCALE_XYZW) this._startScaleEdit();
    else if (type & GIZMO_TYPE.TRANS_W) this._startCameraPlaneEdit();
    else if (type & GIZMO_TYPE.ROT_W) this._startTrackballEdit();

    return true;
  }

  onMouseUp() {
    this._isEditing = false;
  }

  // ── SEE THE HITZONES ──────────────────────────────────────────────────────────────────
  //
  // `?gizmopick=1`, or window.gizmoShowPick(true) at any time. The pick geometry is invisible
  // CPU-only geometry that nobody can look at, so a pick that disagrees with the drawing can
  // only be argued about from numbers -- and a number taken at one camera angle proves nothing
  // about the others. This parents each pick mesh into the gizmo group in translucent
  // wireframe, so the zone and the handle it belongs to are on screen together at every angle
  // and zoom.
  //
  // IT CHANGES NOTHING BUT `visible` AND THE MATERIAL. It used to parent the meshes into the
  // group as well, which made the overlay lie: parenting is what fixes their matrixWorld, so
  // turning the instrument on repaired the very fault it was meant to reveal, and every
  // measurement taken through it agreed with the drawing. They are parented always now.
  showPickGeometry(on) {
    const THREE_ANY = THREE;
    const comps = [
      this._transX, this._transY, this._transZ,
      this._planeX, this._planeY, this._planeZ,
      this._rotX, this._rotY, this._rotZ,
      this._scaleX, this._scaleY, this._scaleZ, this._scaleW,
      this._transW, this._rotBall,
    ];
    this._showPick = !!on;
    for (let i = 0; i < comps.length; ++i) {
      const pg = comps[i] && comps[i]._pickGeo;
      const pm = pg && pg.getThreeMesh && pg.getThreeMesh();
      if (!pm) continue;
      if (on) {
        if (!pm.userData._pickDebugMat) {
          pm.userData._pickDebugMat = new THREE_ANY.MeshBasicMaterial({
            color: new THREE_ANY.Color(1, 1, 1), wireframe: true,
            transparent: true, opacity: 0.35, depthTest: false, depthWrite: false,
          });
        }
        if (!pm.userData._pickRealMat) pm.userData._pickRealMat = pm.material;
        pm.material = pm.userData._pickDebugMat;
        pm.renderOrder = 102;
        pm.visible = true;
      } else {
        if (pm.userData._pickRealMat) pm.material = pm.userData._pickRealMat;
        pm.visible = false;
      }
    }
    return this._showPick;
  }


  // --- Geometry Creation Helpers ---

  _createArrow(tra, axis, color, scale) {
    tra._baseMatrix = mat4.create();
    const mat = tra._baseMatrix;
    const up = vec3.fromValues(0.0, 1.0, 0.0);
    const q = quat.create();
    quat.rotationTo(q, up, axis);
    mat4.fromQuat(mat, q);
    mat4.translate(mat, mat, [0.0, ARROW_LENGTH * 0.5 * scale, 0.0]);
    vec3.copy(tra._color, color);

    tra._pickGeo = Primitives.createArrow(
      this._gl,
      THICKNESS_PICK * scale,
      ARROW_LENGTH * scale,
      ARROW_CONE_THICK * 0.4
    );
    tra._pickGeo._gizmo = tra;
    { const _pm = tra._pickGeo.getThreeMesh?.(); if (_pm) _pm.visible = false; } // CPU pick-only; don't render the stray copy at origin

    tra._drawGeo = Primitives.createArrow(
      this._gl,
      THICKNESS * scale,
      ARROW_LENGTH * scale,
      ARROW_CONE_THICK,
      ARROW_CONE_LENGTH
    );
    tra._drawGeo.setShaderType(Enums.Shader.FLAT);

    const threeMesh = tra._drawGeo.getThreeMesh();
    if (threeMesh) {
      threeMesh.material = gizmoMaterial(false);
      setGizmoColor(threeMesh, color[0], color[1], color[2]);
      threeMesh.matrixAutoUpdate = false;
      mat4.copy(threeMesh.matrix.elements, tra._baseMatrix);
      threeMesh.renderOrder = 100;
      if (this._group) this._group.add(threeMesh);
    }
  }

  _createPlane(pla, color, wx, wy, wz, hx, hy, hz, scale) {
    vec3.copy(pla._color, color);

    // Planes need to be scaled
    pla._pickGeo = Primitives.createPlane(this._gl, 0, 0, 0, wx * scale, wy * scale, wz * scale, hx * scale, hy * scale, hz * scale);
    pla._pickGeo._gizmo = pla;
    { const _pm = pla._pickGeo.getThreeMesh?.(); if (_pm) _pm.visible = false; }

    pla._drawGeo = Primitives.createPlane(this._gl, 0, 0, 0, wx * scale, wy * scale, wz * scale, hx * scale, hy * scale, hz * scale);
    pla._drawGeo.setShaderType(Enums.Shader.FLAT);

    const threeMesh = pla._drawGeo.getThreeMesh();
    if (threeMesh) {
      threeMesh.material = gizmoMaterial(true);
      setGizmoColor(threeMesh, color[0], color[1], color[2]);
      threeMesh.matrixAutoUpdate = false;
      threeMesh.renderOrder = 100;
      if (this._group) this._group.add(threeMesh);
    }
  }

  _createCircle(rot, rad, axis, color, radius, mthick, scale) {
    if (!rot._baseMatrix) rot._baseMatrix = mat4.create();
    const mat = rot._baseMatrix;
    mat4.identity(mat);

    // Primitives.createTorus makes a torus lying on XZ plane (Normal = Y)
    // We need to rotate it to align with the desired 'axis'
    // axis is the Normal of the ring

    // Default Y-axis (0,1,0) -> No rotation
    if (axis[0] !== 0.0 || axis[1] !== 1.0 || axis[2] !== 0.0) {
      // Rotate from Y to target axis
      const up = vec3.fromValues(0.0, 1.0, 0.0);
      const q = quat.create();
      quat.rotationTo(q, up, axis);
      mat4.fromQuat(mat, q);
    }

    // Debug Log
    // if (window.debugGizmoVR) {
    //   console.log(`CreateCircle Axis: [${axis}], Matrix: [${mat}]`);
    // }

    vec3.copy(rot._color, color);

    // THE RING IS THE ONE HANDLE WITH NO PICK TOLERANCE, and it was the odd one out: the
    // arrows are picked with THICKNESS_PICK (5x) and the scale cubes with CUBE_SIDE_PICK, while
    // this built its pick torus at the DRAWN thickness because VR's tube cast supplies the
    // tolerance itself (intersectPhysical takes a ray radius). The desktop picker has no such
    // parameter -- it is an exact triangle test -- so on a monitor the ring's hitzone was
    // literally the 2%-thick torus you can see, a couple of pixels wide, and a cursor one pixel
    // off it fell straight through to the trackball that backs the whole interior.
    //
    // So the tolerance goes in the geometry for the desktop and VR keeps the thin torus it was
    // tuned against.
    // ON THE DESKTOP A RING IS AN OPEN CYLINDER -- a ribbon, not a wire -- so its near and far halves can
    // be shaded differently (see gizmoMat and RIBBON_BACK_*), and the band you see is the band you can pick.
    // VR keeps its thin half-arc torus, which is what it was tuned against.
    const ribbon = this._desktop;
    const rh = ROT_RADIUS * RIBBON_FRAC * scale;
    rot._pickGeo = ribbon
      ? Primitives.createCylinder(this._gl, radius * scale, radius * scale, rh, 64, 1, false, false)
      : Primitives.createTorus(
        this._gl,
        radius * scale,
        (this._desktop ? THICKNESS_PICK : THICKNESS * mthick) * scale,
        rad,
        6,
        64
      );
    rot._pickGeo._gizmo = rot;
    { const _pm = rot._pickGeo.getThreeMesh?.(); if (_pm) _pm.visible = false; }

    rot._drawGeo = ribbon
      ? Primitives.createCylinder(this._gl, radius * scale, radius * scale, rh, 64, 1, false, false)
      : Primitives.createTorus(this._gl, radius * scale, THICKNESS * mthick * scale, rad, 6, 64);
    rot._drawGeo.setShaderType(Enums.Shader.FLAT);

    const threeMesh = rot._drawGeo.getThreeMesh();
    if (threeMesh) {
      threeMesh.material = ribbon ? gizmoMat(THREE.FrontSide, RIBBON_FRONT_OPACITY) : gizmoMaterial(false);
      setGizmoColor(threeMesh, color[0], color[1], color[2]);
      threeMesh.matrixAutoUpdate = false;
      mat4.copy(threeMesh.matrix.elements, rot._baseMatrix);
      threeMesh.renderOrder = 100;
      if (this._group) this._group.add(threeMesh);
      if (ribbon) {
        // The far half: the same geometry seen from inside, behind the front and dimmer.
        const back = new THREE.Mesh(threeMesh.geometry, gizmoMat(THREE.BackSide, RIBBON_BACK_OPACITY, RIBBON_BACK_TINT));
        back.matrixAutoUpdate = false;
        mat4.copy(back.matrix.elements, rot._baseMatrix);
        back.renderOrder = 99;
        back.frustumCulled = false;
        rot._backMesh = back;
        if (this._group) this._group.add(back);
      }
    }
  }

  _createCube(sca, axis, color, scale) {
    sca._baseMatrix = mat4.create();
    const mat = sca._baseMatrix;
    const up = vec3.fromValues(0.0, 1.0, 0.0);
    const q = quat.create();
    quat.rotationTo(q, up, axis);
    mat4.fromQuat(mat, q);
    mat4.translate(mat, mat, [0.0, ROT_RADIUS * scale, 0.0]);
    vec3.copy(sca._color, color);

    sca._pickGeo = Primitives.createCube(this._gl, CUBE_SIDE_PICK * scale);
    sca._pickGeo._gizmo = sca;
    { const _pm = sca._pickGeo.getThreeMesh?.(); if (_pm) _pm.visible = false; }

    sca._drawGeo = Primitives.createCube(this._gl, CUBE_SIDE * scale);
    sca._drawGeo.setShaderType(Enums.Shader.FLAT);

    const threeMesh = sca._drawGeo.getThreeMesh();
    if (threeMesh) {
      threeMesh.material = gizmoMaterial(false);
      setGizmoColor(threeMesh, color[0], color[1], color[2]);
      threeMesh.matrixAutoUpdate = false;
      mat4.copy(threeMesh.matrix.elements, sca._baseMatrix);
      threeMesh.renderOrder = 100;
      if (this._group) this._group.add(threeMesh);
    }
  }

  // Center sphere. `visible` false → pick-only (the interior trackball region); the draw
  // mesh is created but kept out of the scene so the components loop can still touch it.
  _createSphere(part, color, scale, radius, visible) {
    part._baseMatrix = mat4.create();
    vec3.copy(part._color, color);
    part._pickGeo = Primitives.createSphere(this._gl, radius * scale, 16, 16);
    part._pickGeo._gizmo = part;
    { const _pm = part._pickGeo.getThreeMesh?.(); if (_pm) _pm.visible = false; }

    part._drawGeo = Primitives.createSphere(this._gl, radius * scale, 16, 16);
    part._drawGeo.setShaderType(Enums.Shader.FLAT);
    const threeMesh = part._drawGeo.getThreeMesh();
    if (threeMesh) {
      threeMesh.material = gizmoMaterial(false);
      setGizmoColor(threeMesh, color[0], color[1], color[2]);
      threeMesh.matrixAutoUpdate = false;
      threeMesh.renderOrder = 101;
      threeMesh.visible = visible;
      if (visible && this._group) this._group.add(threeMesh);
    }
  }

  _initTranslate(scale) {
    const axis = [0.0, 0.0, 0.0];
    this._createArrow(this._transX, vec3.set(axis, 1.0, 0.0, 0.0), COLOR_X, scale);
    this._createArrow(this._transY, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_Y, scale);
    this._createArrow(this._transZ, vec3.set(axis, 0.0, 0.0, 1.0), COLOR_Z, scale);

    const s = ARROW_LENGTH * 0.2;
    this._createPlane(this._planeX, COLOR_X, 0.0, s, 0.0, 0.0, 0.0, s, scale);
    this._createPlane(this._planeY, COLOR_Y, s, 0.0, 0.0, 0.0, 0.0, s, scale);
    this._createPlane(this._planeZ, COLOR_Z, s, 0.0, 0.0, 0.0, s, 0.0, scale);

    // visible center translate handle + invisible interior trackball ball (inside the rings)
    this._createSphere(this._transW, COLOR_SW, scale, CUBE_SIDE * 0.5, true);
    this._createSphere(this._rotBall, COLOR_SW, scale, ROT_RADIUS * 0.9, false);
  }

  _initRotate(scale) {
    const axis = vec3.create();
    // FULL CIRCLES ON THE DESKTOP, HALF ARCS IN VR.
    //
    // Each ring is a torus with an ARC angle, and at PI it is half a ring. In VR that is fine:
    // you walk round it, and a fixed arc is a fixed target you can point at twice the same way.
    // On a monitor the missing half sits wherever the base matrix happens to put it, so from
    // most angles the part of the ring you are aiming at is not there -- measured, only 14 of
    // 40 points sampled from the ring's OWN vertices could be hit, and in a screen-space pick
    // map the rings almost never won. What answered instead was the trackball, since that is
    // what the tiered pick falls through to: aim at the X ring, get a free rotation. matt:
    // "the hitzones are still really misaligned".
    //
    // Gizmo.js kept half arcs and spun them to face the camera every frame
    // (_updateArcRotation). That does not port: it builds its tori on a different convention,
    // and driving these with its quaternions mis-orients them (the Y ring disappears). A whole
    // ring needs no camera-facing rule at all -- every point you can see is real geometry --
    // and it is less code, not more.
    const arc = this._desktop ? Math.PI * 2 : Math.PI;
    this._createCircle(this._rotX, arc, vec3.set(axis, 1.0, 0.0, 0.0), COLOR_X, ROT_RADIUS, 1.0, scale);
    this._createCircle(this._rotY, arc, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_Y, ROT_RADIUS, 1.0, scale);
    this._createCircle(this._rotZ, arc, vec3.set(axis, 0.0, 0.0, 1.0), COLOR_Z, ROT_RADIUS, 1.0, scale);
    // this._createCircle( Math.PI * 2, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_GREY, ROT_RADIUS, 1.0, scale);
  }

  _initScale(scale) {
    const axis = vec3.create();
    this._createCube(this._scaleX, vec3.set(axis, 1.0, 0.0, 0.0), COLOR_X, scale);
    this._createCube(this._scaleY, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_Y, scale);
    this._createCube(this._scaleZ, vec3.set(axis, 0.0, 0.0, 1.0), COLOR_Z, scale);
    this._createCircle(this._scaleW, Math.PI * 2, vec3.set(axis, 0.0, 1.0, 0.0), COLOR_SW, SCALE_RADIUS, 2.0, scale);
  }
}

export default GizmoVR;
