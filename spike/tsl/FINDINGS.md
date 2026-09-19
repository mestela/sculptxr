# TSL spike — findings

**Date:** 2026-09-20 · **three:** 0.183.2 · **Device:** GalaxyXR (72 Hz) · **Branch:** `tsl`

Run it: `https://<lan-ip>:8080/spike/tsl/` — Enter VR, trigger cycles six weights, and wrapping
the weights advances the material. `?modes=ourpbr` restricts the set.

---

## The question

Can we move the renderer to `WebGPURenderer` + TSL, and what does it cost?

It is all-or-nothing: **`WebGPURenderer` cannot render a `THREE.ShaderMaterial`.** Its library
registers only the built-in material types, so every one of our seventeen shaders has to be
ported before anything draws. That is why this was worth answering on a throwaway page first.

---

## 1. Viability: YES

`WebGPURenderer({ forceWebGL: true })` enters an immersive session on the GalaxyXR and renders.
`forceWebGL` is not optional — in 0.183.2 the WebGPU backend **throws** on XR:

> THREE.XRManager: XR is currently not supported with a WebGPU backend.

## 2. Performance: NOT A PROBLEM

Median frame time in session, one shared material, 72 Hz panel:

| tris | ours, ported | `MeshPhysicalNodeMaterial` | matcap |
|---|---|---|---|
| 63k – 1.1M | **13.9 (72 fps)** | **13.9 (72)** | **13.9 (72)** |
| 2.1M | 15.0–16.3 (62–66) | 15.9–18.2 (55–63) | **13.9 (72)** |
| 6.5M | 27.8–30.0 (33–36) | 28.1–29.4 (34–36) | 20.2–23.4 (43–49) |

- **Our BRDF costs the same as three's stock physical material.** Keeping our shading model is
  free; adopting theirs buys nothing in speed.
- **Below ~1.1M triangles nothing is distinguishable** — all vsync-locked. That covers the
  working range.
- **Matcap has real headroom**, which matters because that is where the work happens. matt:
  "i'd spend most of my time in matcap mode, and only drop into pbr/shadows occasionally."

Use the MEDIAN. Min catches spurious short frames (it reported 153 and 551 fps); mean is
dragged by compile hitches.

## 3. RESOLVED: undefined behaviour on material switching in XR — avoid by pre-creating

```
GL_INVALID_OPERATION: glDrawElements: It is undefined behaviour
to use a uniform buffer that is too small.
```

Hundreds per frame until WebGL stops reporting. Isolated by running each material alone:

| run | result |
|---|---|
| `?modes=ourpbr`, six weights, twice through | **clean** |
| all three materials | **flood**, beginning exactly at the `physical → matcap` switch |
| desktop, all three, heaviest weight, `setMode` driven | **clean** |

So it is **not our TSL**, and it is **XR-only**. It is `WebGPURenderer`'s WebGL backend
rebuilding pipelines/bind groups when the material type changes mid-session.

### The fix: build every material before the session starts

matt: "surely we define materials once up front, and thats it?" Correct, and measured. With all
three materials constructed and warmed before Enter VR, and switching only ever REASSIGNING
those same objects, a full cycle through three materials x six weights produces **no UBO errors
at all**. So the fault is pipeline CREATION while immersive, not reassignment — which makes it
a constraint rather than a blocker, and a cheap one.

**What the app must do:** `ShaderManager` already caches one material per shader id, but
LAZILY — the first switch to a mode constructs it. Under this renderer that construction would
happen mid-session, which is the failing case. The app therefore needs to build and warm every
shader type at startup. Small, well understood, and now known to be necessary rather than
assumed to be covered.

The cost of the switch is then one frame: measured 30.07, 27.94 and 22.02 ms in the window
immediately after each change, back to 13.9 ms in the next. matt, in a headset: "i barely felt
a hitch... a hitch on scene load, or swapping from matcap to pbr once every 5 mins at most,
that seems perfectly fine."

### Why it looked like a blocker first the app's shader modes ARE that switch. Matcap
to PBR and back is a normal thing to do, and it is the mode matt says he uses most. Undefined
behaviour also means every measurement after the first error is untrustworthy — including the
one place matcap looked less than perfect.

matt's observation, worth keeping: **the in-VR overlay disappears when the errors start**, which
suggests the failing draw may be identifiable rather than universal.

### Also seen

`GL_INVALID_FRAMEBUFFER_OPERATION: Framebuffer is incomplete: Attachments are not all the same
size.` — once per XR entry, in every run including the clean ones. Harmless so far; same
backend, same XR path.

### Material compilation is a real, one-off cost

Rebuild hitches of 50 ms to 8.8 s at the heaviest weights. Per material, first time it is drawn.
With one shared material this is a startup cost; the spike's first version gave every sphere its
own and the result was a hitch every time the head turned and new objects entered the frustum.

---

## Verdict: GO, with one rule

All three questions came back positive.

* It runs in XR on the GalaxyXR.
* Our BRDF costs the same as three's, and everything in the working range is vsync-locked.
* The one fault found is avoidable by building materials up front.

**The rule: no material may be constructed during an immersive session.** Build and warm every
shader type at startup.

### What the spike did NOT cover

Do not read this as "the port is derisked", only that the shading half is:

* **The other sixteen shaders.** Matcap, flat, contour, wireframe, selection, UV, normal, unlit,
  fxaa, blur, merge, background. Volume rather than risk — but it is a lot of volume, and the
  post-process ones (fxaa/blur/merge) are a different shape of problem from a surface shader.
* **The HTML panels.** Untested under this renderer, and their rasterisation cost is a
  PROD-BUILD-ONLY effect, so it cannot be judged from a dev server at all.
* **Per-vertex material channels**, transmission, and the env pipeline (SH9 + panorama vs
  PMREM). The BRDF ported; these are the parts around it.
* **The mock gl comes out with all of this**, which is the prize beyond shadows and
  post-processing.

Next thing worth building, if this proceeds: the panels under `WebGPURenderer`, in a PROD
build, in a headset. That is the remaining unknown with teeth.
