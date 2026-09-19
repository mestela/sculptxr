# Device test plan

Four targets: **desktop**, **iPad**, **GalaxyXR** (standalone Android), **Vision Pro**.

The useful question is not "how often" but **"what did I change, and which device is the only one
that can see it?"** Several bug classes in this codebase are *structurally invisible* everywhere
except one target — they are not rare, they are guaranteed. Those are listed first.

---

## Bug classes and the only device that shows them

| Class | Visible only on | Why the others cannot see it |
|---|---|---|
| A VR panel control whose **markup** changes but does not repaint | headset | Desktop rebuilds panel sections unconditionally; VR rasterises a cached SVG and needs `_rebuildContent` + a revision in the cache key |
| CSS bundle size tanking panel raster performance | headset, **prod build only** | The VR rasteriser inlines the full page CSS per SVG paint. Dev serves unbundled CSS, so dev is always fast and prod is not |
| Hand-tracking pinch thresholds | each runtime separately | Quest wants ~0.022, everything else ~0.005; a number tuned on the worse tracker ruins the better one |
| Frame cost of a shader change | headset | A desktop GPU absorbs what a standalone will not. Per pixel, per eye |
| iOS Safari ignores CSS `resize` | iPad | Not implemented; the handle simply does nothing |
| iPadOS Scribble hijacking the pencil | iPad | A system input method — `touch-action` cannot reach it; `readonly` is the opt-out |
| Synthetic touch events carrying no `pointerType` | iPad | A mouse-only guard never fires |
| Safari suppressing `pointerdown`/`pointerup` on hover→touch | iPad | Pencil-specific |
| AR alpha / passthrough compositing | headset | No passthrough on desktop |

**Consequence worth stating plainly:** a VR smoke test on the dev server cannot prove panel
performance. Test VR against a **deployed build** (beta is fine) or you are testing the wrong
thing.

---

## What desktop automation does and does not prove

Run on every change, cheap, no device needed:

```bash
npm run build
node scratchpad/run_all.mjs      # baseline 87/93 — six standing failures
```

Then boot it and read the console. `vite preview` serves `dist/` and is safe to run alongside
matt's dev server; **never start a second `npm run dev`** — two vite instances share
`node_modules/.vite/deps` and invalidate each other's chunk hashes, which reads as random 404s
and "network connection lost" on a headset.

```bash
HTTP=1 npx vite preview --port 8099 --strictPort
```

**What this proves:** nothing crashes on boot, contracts the harnesses encode still hold, no
regressions in the 87.

**What it does not prove:** anything visual, anything about feel, anything about frame time, and
anything on the list above. Most harnesses are structural assertions over source text — they
catch a refactor breaking a contract, not a picture looking wrong.

---

## Smoke sequences

Each is two or three minutes. They are not coverage; each item is here because it has broken
before.

### iPad

1. Draw a stroke with the Pencil — press, drag, lift. (Safari pointer-event suppression)
2. Two-finger drag to zoom. **No context menu may appear.**
3. Long-press with a finger — the context menu *should* appear.
4. Drag the outliner's resize grip. (CSS `resize` is dead here; this is the pointer-event grip)
5. Tap a numeric field, then draw near it. (Scribble)

### GalaxyXR — on a deployed build, not dev

1. Open the main menu; open and close a collapsible section. (Raster perf, and rebuild-vs-repaint)
2. Toggle a control that **changes markup**, not just a value — a section that grows or shrinks a row.
3. Grab a pin and move it; grab a bone. (Pick rules, `_rigBoneSelect`)
4. Pinch-select a menu item a few times. (Threshold)
5. `xrPerf()` in the console over Chrome remote debugging. Compare, do not eyeball.

### Vision Pro

1. Point at a menu, click a button, point away, point back. (The failure mode was every event
   feeling delayed — it was the pinch threshold treating "about to pinch" as a pinch)
2. The same markup-changing panel toggle as above.
3. One sculpt stroke, one camera tumble.

### Desktop

Automated above, plus: one sculpt stroke, one undo, one file save/load round trip if IO changed.

---

## Cadence

- **Desktop:** every change. Automated, so there is no reason not to.
- **iPad + one headset:** before any deploy to prod. These two cover the widest span of the
  invisible classes.
- **All four:** when the change touches **input, panels, or the render path** — and after any
  refactor that moved shared code, because those are exactly the changes whose blast radius you
  cannot see from one device.
- Otherwise a full round trip per release train is enough. A calendar rule will either be too
  often to keep or too rare to help; the trigger table above is the real answer.

**Record the frame time, do not remember it.** "It felt fine" from two weeks ago will not tell
you whether today is a regression.
