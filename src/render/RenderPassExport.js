import * as THREE from 'three';
import { saveAs } from 'file-saver';

/**
 * DEPTH AND NORMAL PASSES, WRITTEN OUT AS PNGs. Backlog #2a.
 *
 * The half of "materials to three.js" that the port was FOR: once every mesh is on a node
 * material, the scene can be re-rendered through a different one and read back. Nothing here
 * would have been possible on the legacy mock-gl path, where a material is a hand-written
 * shader pair and there is no override to swap in.
 *
 * DESKTOP ONLY, DELIBERATELY. Nobody exports a depth buffer while wearing a headset, and XR is
 * switched off for the duration of the render exactly as the thumbnail path does -- the session
 * owns the framebuffer, and a render target in the middle of a frame is how you lose it.
 *
 * MODELLED ON GuiFiles' THUMBNAIL, which already solved the awkward parts: the node renderer has
 * its own RenderTarget class rather than WebGLRenderTarget, and WebGPURenderer has no
 * readRenderTargetPixels at all -- only the async form, which is why this function is async.
 */

const DEFAULT_SIZE = 1024;

/**
 * The scene's near and far depth in VIEW space, from the world bounding box's eight corners.
 * The box alone is not enough -- it is axis-aligned in WORLD space, so its own min/max z says
 * nothing about distance from a camera that is looking at it from an angle.
 */
function viewDepthRange(main) {
  const cam = main._camera && main._camera.getThreeCamera ? main._camera.getThreeCamera() : null;
  const group = main._worldGroup;
  if (!cam || !group) return null;
  // VISIBLE, RENDERABLE GEOMETRY ONLY. Box3.setFromObject traverses every child whether or not
  // it draws, so the hidden rig batches (fourteen of them, instanced at the origin) and the grid
  // inflated the box until the sculpture was a sliver of it again -- measured at 11% of the
  // range used, which is what sent me looking.
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  group.updateWorldMatrix(false, true);
  group.traverseVisible((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    if (o.isPickable === false) return;          // gizmos, overlays, helpers
    const g = o.geometry;
    if (!g) return;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox) return;
    tmp.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
    box.union(tmp);
  });
  if (box.isEmpty()) return null;
  cam.updateMatrixWorld();
  const v = new THREE.Vector3();
  let near = Infinity, far = -Infinity;
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z).applyMatrix4(cam.matrixWorldInverse);
    const d = -v.z;
    if (d < near) near = d;
    if (d > far) far = d;
  }
  near = Math.max(near, 1e-4);
  if (!(far > near)) return null;
  // A little air at both ends, so the nearest surface is not pinned to pure white and clipped.
  const pad = (far - near) * 0.02;
  const out = { near: near - pad, far: far + pad };
  window._depthRange = out;                       // so the fit can be checked, not assumed
  return out;
}

/**
 * The override material for a pass. Null when the node renderer is not in use: the legacy path
 * has no node materials to override with, and silently exporting a lit beauty render labelled
 * "depth" would be worse than refusing.
 */
function passMaterial(main, mode, fitted) {
  const GPU = main._THREE_GPU;
  const TSL = main._TSL_GPU;
  if (!GPU || !TSL) return null;

  if (mode === 'normal') {
    // View-space normals, three's own. Matches every other tool's convention, so the output
    // drops into a compositor without a channel shuffle.
    return new GPU.MeshNormalNodeMaterial();
  }

  // LINEAR VIEW DEPTH, not the depth buffer's non-linear z.
  //
  // `viewportLinearDepth` samples the depth TEXTURE, which during an override pass is the one
  // being written -- reading and writing the same attachment. Deriving it from the fragment's
  // own view position instead has no such loop, and linear depth is what a compositor wants:
  // the buffer's own z crowds everything into the near plane and is useless for defocus.
  // FITTED TO THE GEOMETRY, NOT TO THE CAMERA'S near/far.
  //
  // Measured first: normalising across the camera range gave 28 distinct values out of 256,
  // because a sculpture occupies a sliver of a frustum that runs to the far plane. That is
  // visible banding the moment anyone grades it. Fitting to the scene's own depth extent uses
  // the whole range. Falls back to the camera's planes when there is nothing to measure.
  const { positionView, cameraNear, cameraFar, vec3, uniform } = TSL;
  const range = fitted || viewDepthRange(main);
  const near = range ? uniform(range.near) : cameraNear;
  const far = range ? uniform(range.far) : cameraFar;
  const dist = positionView.z.negate();
  const norm = dist.sub(near).div(far.sub(near)).clamp(0, 1);
  const m = new GPU.MeshBasicNodeMaterial();
  // NEAR IS WHITE. A depth pass is read as "how close", and an image that is black where the
  // subject is reads as a hole. Invert here rather than asking every downstream tool to.
  m.colorNode = vec3(norm.oneMinus());
  return m;
}

/**
 * Render one pass and hand back a canvas. Returns null rather than throwing when the pass cannot
 * be produced, so a caller can offer the option and still refuse gracefully.
 */
export async function renderPassToCanvas(main, mode = 'normal', size = DEFAULT_SIZE, fitted = null) {
  const renderer = main._renderer;
  const scene = main._scene;
  const camera = main._camera && main._camera.getThreeCamera ? main._camera.getThreeCamera() : null;
  if (!renderer || !scene || !camera) return null;

  const override = passMaterial(main, mode, fitted);
  if (!override) return null;

  // EVERYTHING THAT IS NOT THE SCENE COMES OUT: panels, controllers, gizmos, the rig overlay.
  // A depth pass with a menu floating in it is not a depth pass. Same sweep the thumbnail uses.
  const hidden = [];
  scene.children.forEach((child) => {
    if (child.visible && child !== main._worldGroup && !child.isLight) {
      child.visible = false;
      hidden.push(child);
    }
  });

  const wasXR = renderer.xr.enabled;
  const prevOverride = scene.overrideMaterial;
  const GPU = main._THREE_GPU;
  const rt = (main._isNodeRenderer && GPU)
    ? new GPU.RenderTarget(size, size)
    : new THREE.WebGLRenderTarget(size, size);

  let pixels = null;
  try {
    renderer.xr.enabled = false;
    scene.overrideMaterial = override;
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    pixels = (typeof renderer.readRenderTargetPixelsAsync === 'function')
      ? await renderer.readRenderTargetPixelsAsync(rt, 0, 0, size, size)
      : (() => { const p = new Uint8Array(size * size * 4);
                 renderer.readRenderTargetPixels(rt, 0, 0, size, size, p); return p; })();
  } finally {
    // RESTORED IN A finally, because a throw here leaves the app with no menus and every mesh
    // painted as a normal map -- a far worse outcome than a failed export.
    scene.overrideMaterial = prevOverride;
    renderer.setRenderTarget(null);
    renderer.xr.enabled = wasXR;
    for (const c of hidden) c.visible = true;
    rt.dispose();
    override.dispose();
  }
  if (!pixels) return null;

  // GL's origin is bottom-left and a canvas' is top-left.
  const flipped = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row++) {
    const src = (size - 1 - row) * size * 4;
    flipped.set(pixels.subarray(src, src + size * 4), row * size * 4);
  }
  // BACKGROUND IS BLACK AND STILL TRANSPARENT. The alpha channel is the mask a compositor
  // wants, so it is kept -- but leaving the RGB at zero-alpha garbage made the depth pass read
  // as a white field in every viewer that ignores alpha, which is how it first looked wrong.
  for (let i = 3; i < flipped.length; i += 4) {
    if (flipped[i] === 0) { flipped[i - 3] = 0; flipped[i - 2] = 0; flipped[i - 1] = 0; }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').putImageData(new ImageData(flipped, size, size), 0, 0);
  canvas._passPixels = flipped;
  return canvas;
}

/** Render a pass and save it as a PNG. */
/**
 * THE BOX IS AN UPPER BOUND, SO MEASURE THE PIXELS INSTEAD.
 *
 * A bounding box's depth extent is always deeper than the visible surface's -- the back of the
 * box is behind the object, and nothing is ever drawn there. Fitting to it took the range used
 * from 11% to 20%, which still bands. An export is offline, so it can simply render once, look
 * at what came out, and render again with the range the geometry actually occupied.
 */
async function autoRange(main, size) {
  const first = viewDepthRange(main);
  if (!first) return null;
  const canvas = await renderPassToCanvas(main, 'depth', Math.min(size, 256), first);
  const px = canvas && canvas._passPixels;
  if (!px) return null;
  let lo = 255, hi = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;                 // background carries no depth
    const v = px[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi <= lo) return null;
  // Undo the inversion to get back to distances: 255 is nearest.
  const span = first.far - first.near;
  const near = first.near + (1 - hi / 255) * span;
  const far = first.near + (1 - lo / 255) * span;
  const pad = (far - near) * 0.01;
  const out = { near: near - pad, far: far + pad };
  window._depthRange = out;
  return out;
}

export async function exportRenderPass(main, mode = 'normal', size = DEFAULT_SIZE) {
  const fitted = mode === 'depth' ? await autoRange(main, size) : null;
  const canvas = await renderPassToCanvas(main, mode, size, fitted);
  if (!canvas) {
    const why = main._isNodeRenderer ? 'the pass could not be rendered'
      : 'render passes need the node renderer (?renderer=webgpu)';
    if (window.screenLog) window.screenLog('Export failed: ' + why, 'red');
    console.warn('[renderpass] ' + why);
    return false;
  }
  await new Promise((res) => canvas.toBlob((b) => { saveAs(b, 'sculptxr_' + mode + '.png'); res(); }, 'image/png'));
  if (window.screenLog) window.screenLog(mode + ' pass exported', 'cyan');
  return true;
}

export { autoRange };
export default { renderPassToCanvas, exportRenderPass, autoRange };
