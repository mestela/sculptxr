import * as THREE from 'three/webgpu';

/**
 * "COMPILING SHADERS" -- a head-facing plate shown while the renderer is building pipelines.
 *
 * WHY IT IS NEEDED AT ALL. On the node renderer a pipeline is compiled the first time a
 * particular material and geometry are drawn together, and on a standalone headset that is tens
 * of milliseconds each. A burst of them reads as the app hanging, with nothing on screen to say
 * otherwise. matt: "at the very least it would be good to display a 'compiling shaders' when
 * thats happening, so folk understand why its lagging."
 *
 * WHAT IT CANNOT DO, said plainly because the limitation is structural: the compile happens
 * INSIDE renderer.render, so a single long frame has already finished by the time anything can
 * be drawn about it. This appears on the frame AFTER the first compile and stays for a moment
 * after the last, which covers a burst -- the shape nearly every real case has -- and cannot
 * cover one isolated 1.5-second frame. It is a label on a queue, not a progress bar.
 *
 * It is created at startup rather than on demand, so its own material is compiled with
 * everything else. A busy indicator that stalls the frame to introduce itself is a joke at the
 * user's expense.
 */
const ShaderBusy = {};

const PAD = 24;
const FONT = '600 40px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const TEXT = 'Compiling shaders...';
// How long the plate stays up after the last pipeline appeared. Long enough that a burst
// arriving a frame or two apart reads as one event rather than a flicker.
const LINGER_MS = 700;
// A FRAME THIS LONG IS A HITCH WORTH EXPLAINING. At 72-90Hz a frame is 11-14ms, so this is
// roughly three dropped frames -- the point where the app visibly catches rather than merely
// does some work. Below it the plate would be explaining something nobody felt.
const HITCH_MS = 40;
// Distance in front of the head, and how far below the centre of vision. Low enough not to sit
// over what the user is doing, close enough to be legible on a low-res panel.
const DIST = 0.9;
const DROP = 0.28;

let sprite = null;
let until = 0;
let lastCount = -1;
let lastTick = 0;

/** Everything three counts as a built pipeline, or -1 when the renderer will not say. */
function pipelineCount(renderer) {
  const pl = renderer && renderer._pipelines;
  return (pl && pl.caches && typeof pl.caches.size === 'number') ? pl.caches.size : -1;
}

function build() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = FONT;
  canvas.width = Math.ceil(ctx.measureText(TEXT).width) + PAD * 2;
  canvas.height = 40 + PAD * 2;
  const c2 = canvas.getContext('2d');       // resizing cleared it and reset every property
  c2.font = FONT;
  c2.fillStyle = 'rgba(0, 0, 0, 0.72)';
  c2.fillRect(0, 0, canvas.width, canvas.height);
  c2.fillStyle = '#ffffff';
  c2.textBaseline = 'middle';
  c2.fillText(TEXT, PAD, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  }));
  // Above everything, including the xray ghosts -- it is a system message, not scene content.
  m.renderOrder = 100000;
  m.isPickable = false;
  m.frustumCulled = false;
  m.visible = false;
  const h = 0.06;
  m.scale.set(h * (canvas.width / canvas.height), h, 1);
  return m;
}

/** Create the plate and put it in the scene. Safe to call more than once. */
ShaderBusy.attach = function (scene) {
  if (sprite || !scene || typeof document === 'undefined') return sprite;
  try {
    sprite = build();
    scene.add(sprite);
  } catch (e) {
    sprite = null;                          // an indicator is never worth failing a frame over
  }
  return sprite;
};

/**
 * Once a frame, BEFORE the render: notice whether the last frame built anything, and place the
 * plate in front of whichever camera is about to draw.
 */
ShaderBusy.tick = function (renderer, camera) {
  if (!sprite || !renderer) return false;
  const n = pipelineCount(renderer);
  if (n < 0) return false;
  // The first tick establishes the baseline. Treating startup's whole cache as growth would show
  // the plate on the first frame of every session, which is exactly the cry-wolf this must not do.
  const now = performance.now();
  const frameMs = lastTick ? now - lastTick : 0;
  lastTick = now;
  if (lastCount < 0) { lastCount = n; return false; }
  // COST, NOT COUNT -- the distinction this got wrong. Raising the plate on any growth in the
  // pipeline cache meant a 2ms build got the same 700ms notice as a 331ms one. Measured on the
  // GalaxyXR once Chrome's own on-disk program cache was warm: 84 builds, 686ms total, MEDIAN
  // 3.3ms. So the plate fired up to eighty-four times to explain work that never stuttered.
  // matt: "no stutters, but frequent 'compiling shaders' warnings."
  //
  // The frame that just elapsed is the measurement, because the compile happens INSIDE
  // renderer.render and is already over by the time anything can be drawn about it -- the same
  // one-frame lag the header note already describes. A cheap compile cannot make a long frame,
  // so this says what the plate always meant: something took long enough for you to notice.
  if (n > lastCount && frameMs >= HITCH_MS) until = now + LINGER_MS;
  lastCount = n;

  const on = now < until;
  sprite.visible = on;
  if (!on || !camera) return on;
  // Placed from the camera's WORLD matrix rather than parented to it. In a session the camera is
  // an ArrayCamera three rebuilds per frame, and anything parented to it inherits a per-eye
  // transform -- the same trap the matcap fell into.
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  sprite.position.set(
    e[12] - e[8] * DIST - e[4] * DROP,
    e[13] - e[9] * DIST - e[5] * DROP,
    e[14] - e[10] * DIST - e[6] * DROP,
  );
  return on;
};

/** Whether the plate is up right now — for tests and for the console. */
ShaderBusy.isBusy = function () { return !!(sprite && sprite.visible); };

export default ShaderBusy;
