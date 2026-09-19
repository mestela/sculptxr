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

## 3. THE BLOCKER: undefined behaviour on material switching in XR

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

**Why this is the blocker and not a curiosity:** the app's shader modes ARE that switch. Matcap
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

## Verdict

Performance and fidelity are answered: the port is affordable and our BRDF survives it.
**The renderer is not yet trustworthy for us** — not because it is slow, but because the exact
interaction the app relies on (switching shader modes in an immersive session) produces
undefined behaviour in the only backend XR can use.

Before committing to a seventeen-shader port, one of:

1. Find the smallest reproduction of the UBO error and check it against three's issue tracker /
   a newer release. The overlay-disappearing clue is the place to start.
2. Confirm it is avoidable — e.g. if every material type is created up front and never switched,
   or if shader modes become one uber-material with a branch, the bug may be unreachable.
3. Wait for XR on the WebGPU backend proper, which removes this backend from the path entirely.

Until one of those lands, the renderer half of `docs/render_stack_audit.md` (the mock gl,
gl-matrix, hand-rolled shadows) stays deferred — but now for a measured reason rather than an
unknown one.
