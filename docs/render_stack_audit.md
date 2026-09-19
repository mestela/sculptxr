# Render stack audit

**Date:** 2026-09-19 · **Branch:** `refactor` · **three.js:** 0.183.2 · **Renderer:** `THREE.WebGLRenderer`

Why this file exists: the migration has had several passes, and after each one it looked finished.
A month later the hybrid resurfaces. matt: *"i half understood where we stand, thinking that we've
removed all the old stuff, only to find a month later that we're running a fairly hacky hybrid."*

So this is not a plan, it is a **measurement**, and every claim below says how it was checked.
Re-run the checks before believing any of it — see [Re-running this audit](#re-running-this-audit).

---

## Verdict

three.js does the rendering. The SculptGL WebGL engine is still in the building: partly wired,
partly orphaned, and in exactly one place load-bearing.

| Layer | State | Evidence |
|---|---|---|
| Renderer | **Migrated** — `THREE.WebGLRenderer`, meshes are three Meshes | `Scene.js:2557` |
| Surface shaders | **Hybrid, load-bearing** — see [The mock gl](#the-mock-gl) | `ShaderManager.js:268` |
| Legacy multi-pass pipeline | **Dead code, live allocations** | `Scene.js:1981`, `Scene.js:2456` |
| Drawables | **Split, sometimes inside one file** | 11 files in `src/drawables/` |
| GuiXR | **Retired, not removed** — 7090 lines | `Scene.js:4821` |
| Math | **Two libraries** — 64 files gl-matrix, 53 files three | import counts |
| GLSL dialect | **All 17 shaders are ES 1.0** (`attribute`/`varying`/`gl_FragColor`) | 17/17 |

---

## The mock gl

The single hackiest thing in the renderer, and it is load-bearing.

The 17 custom shaders are compiled into `THREE.ShaderMaterial` by `ShaderManager` — fine. But the
uniform *values* are still produced by the original SculptGL code calling `gl.uniform3fv(...)`.
Those calls are captured by a **hand-written mock WebGL context** (`ShaderManager.js:268`) which
intercepts them by name and writes into the three material's `uniforms`. Every frame, for every
mesh, the old engine runs against a fake `gl`.

```js
mesh.getGL = function() { return mockGL; };       // ShaderManager.js:387
shaderDef.updateUniforms.call(shaderDef, mesh, main);
```

**This has already cost real time.** The mock had no `TEXTURE0`, so the IBL environment binding
produced NaN silently — roughness and metalness did nothing at all, and everything looked unlit,
for months after the port. Suspect the mock first when something visual "never worked".

**Do not tidy this in place.** It is precisely what a TSL / node-material migration deletes.
Cleaning it up before that decision is work thrown away twice.

---

## Dead code with live allocations

Two blocks in `Scene.js` are commented out and labelled `DISABLED FOR THREE.JS MIGRATION`:

- `Scene.js:1981` — legacy post-processing (merge, FXAA)
- `Scene.js:2456` — legacy passes (contour, opaque, transparent)

**But the four render targets they consumed are still constructed and still resized.** Verified
against the shipped bundle, where comments cannot survive:

| Probe | Result |
|---|---|
| `new Rtt(...)` allocation | **LIVE** |
| `_rttOpaque.render(` | gone |
| `_rttOpaque.getFramebuffer(` | gone |
| `_rttOpaque.onResize(` | **LIVE** |

So `_rttContour`, `_rttMerge`, `_rttOpaque` (half-float) and `_rttTransparent` are allocated at
canvas resolution and resized on every window resize, and nothing ever renders to them or reads
them. Constructed at `Scene.js:607-610`, resized at `Scene.js:2930-2933`.

**The raw-GL draw path is already dead.** `Shader.draw()` is reached only via
`mesh.render()` / `renderWireframe()` / `renderFlatColor()`, and the only call site for
`renderFlatColor` is `Scene.js:2466` — inside the commented block. The methods survive into the
bundle only because a minifier cannot prove class methods unused. Do not mistake their presence
in `dist/` for liveness; check the **call sites**, not the definitions. (This audit made exactly
that mistake once: a probe for `renderFlatColor(` matched the method *definition*.)

---

## Drawables: both systems, sometimes in one file

`src/drawables/` — 11 files. Some are migrated to three, some are raw GL, and at least one is
both. `Selection.js` builds `THREE.BufferGeometry` / `LineBasicMaterial` *and* still constructs
the legacy VBO wrappers from `render/Buffer.js` + `render/Attribute.js`:

| File | legacy `new Buffer`/`new Attribute` |
|---|---|
| `Selection.js` | 2 |
| `GazeTooltip.js` | 2 |
| `Background.js` | 2 |
| `VRLaser.js` | 1 |

`Gnomon.js` is present in the bundle but no constructor for it was found in `Scene.js` — likely
orphaned. Needs one check before removal.

---

## GuiXR: 7090 lines, retired but load-bearing

`_legacyVrCanvasEnabled()` is permanently false:

```js
_legacyVrCanvasEnabled() { return window._brushPanelEnabled === false; }   // Scene.js:4821
```

Around eight live call sites still test it. **It cannot simply be deleted:** popups (`_guiPopup`,
`Scene.js:641`) are still built on `GuiXR` and are explicitly "Tier 2 — not migrated". So 7090
lines currently survive to serve one remaining feature.

Order: migrate popups to the HTML panel system, *then* delete GuiXR and every
`_legacyVrCanvasEnabled` branch.

---

## Two math libraries

64 files import `gl-matrix`; 53 import `three`. This is the most visible "curious mishmash of
APIs" to a newcomer, and it is independent of every other item here.

Mechanical but not risk-free: the matrix memory layouts agree (both column-major), the quaternion
and euler conventions do not. See also the two-matrices trap already recorded for the rig, where
writing `_matrix` without `syncThree` leaves a stale three-side matrix.

---

## Tier 0 — done on `refactor`, 2026-09-19

| Removed | Size | Verified by |
|---|---|---|
| Two `DISABLED FOR THREE.JS MIGRATION` comment blocks | 82 lines | build |
| `_rttContour` / `_rttMerge` / `_rttOpaque` / `_rttTransparent` + `Rtt` import | 4 framebuffers | no readers remained after the blocks went |
| `renderSelectOverRtt()` — an empty method — and its 6 callers | 7 sites | build + suite |
| `src/drawables/Gnomon.js` — never imported | whole file | grep: every other `Gnomon` hit is a different implementation |

`Rtt.js` itself **stays**: `GuiFiles.js` still uses it for UV paint baking and blur.

Verified in the browser after the cuts: boots, renders, `render()` and a window resize both run
clean, no console errors.

### Orphan sweep

14 modules, ~120 KB, referenced by nothing and absent from the bundle. Eight deleted as
superseded — the largest being `mesh/MeshSafe.js` at 74 KB, which is a **fork of `Mesh.js`**
declaring its own `class Mesh`. Six console-paste debug instruments moved to `scratchpad/debug/`
rather than deleted: never bundled, so `src/` was the wrong home, but losing them costs a
workflow.

`global_shader_test` had been asserting against `gui/GuiRendering.js` — **green against a file
that never ran.** Worth remembering when reading any harness: a passing check proves the source
text says something, not that the code executes.

#### The sweep's blind spot

"Is it imported anywhere?" does not find a file imported **only by dead code**.
`gui/vr/GuiVRRendering.js` is imported solely by `GuiXR.js`, the retired canvas UI, so it looks
live and is not. The whole `src/gui/vr/` subtree is likely in the same position, which means
**the GuiXR removal cascades well past its own 7090 lines.** To find this class, start from the
known-dead root and walk its imports, rather than sweeping for unreferenced files.

### Correction: Tier 0 was smaller than it looked

The original list also had "the unreachable `render` / `renderWireframe` / `renderFlatColor`
methods" and "the dead VBO wrappers in migrated drawables" as free deletions. **They are not
free, and they are not separate items.** Tracing them showed one entangled system:

```
mesh.render() -> Shader.draw() -> ShaderBase raw GL -> render/Buffer.js + render/Attribute.js
```

with `Multimesh._renderLow` / `_renderWireframeLow` / its `render()` override and
`MeshReference.render()` all chaining through `super.render(main)`, while touching
`getRenderData()`, `_indexBuffer` and the selection level — state that live code also uses.
`Selection.js` runs both systems inside one file.

So the raw-GL draw path is dead *at the top* but has to come out as **one traced piece**, not by
nibbling. It is also adjacent to the mock gl, which means it belongs with the renderer decision
rather than with cleanup. Do not start it as a quick win.

---

## Recommended order

1. **Tier 0 — free deletions.** The two commented blocks, the four unused RTTs, the dead VBO
   wrappers in migrated drawables, the unreachable `render`/`renderWireframe`/`renderFlatColor`
   methods, and `Gnomon.js` if the check confirms it is orphaned. Pure subtraction.
2. **GuiXR.** Migrate popups first, then delete ~7090 lines.
3. **The shader system and the mock gl** — *deferred by design*. This is the renderer decision
   (TSL / node materials), not a cleanup. Doing it as cleanup means doing it twice.
4. **gl-matrix → three math.** Independent; can happen any time; 64 files.

---

## Re-running this audit

Comments do not survive the bundler, so the bundle is the source of truth for liveness. Build
first, then probe:

```bash
npm run build
js=$(ls -t dist/assets/index-*.js | head -1)
node -e "
const s=require('fs').readFileSync('$js','utf8');
for (const t of ['_rttOpaque.render(', '_rttOpaque.onResize(', 'GuiXR'])
  console.log((s.includes(t)?'LIVE  ':'gone  ')+t);
"
```

Counting the split:

```bash
grep -rl "from 'gl-matrix'" src --include=*.js | wc -l   # 64 at time of writing
grep -rl "from 'three'"     src --include=*.js | wc -l   # 53
grep -rln 'attribute \|varying ' src/render/shaders/ | wc -l   # 17 of 17
```

**Check call sites, not definitions.** A class method survives minification whether or not
anything calls it.
