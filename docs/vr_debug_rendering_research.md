# SculptGL Rendering & Scale Research

**Date:** 2026-02-28
**Focus:** Understanding the bespoke rendering pipeline, rendering helper/debug objects, and VR scale logic.

## 1. The SculptGL Shader Pipeline

SculptGL does not use a standard scene graph (like Three.js). Instead, it relies on a highly bespoke rendering loop managed by `ShaderBase.js` and custom `Shader` extensions (e.g., `ShaderUnlit.js`, `ShaderFlat.js`).

### The Rigid Interface
Every object that wants to be rendered by `ShaderLib` MUST masquerade as a full `Mesh` object. The shader strictly expects a series of getter methods:
*   `getGL()`: WebGL context
*   `getID()`: Unique identifier (sometimes used to bypass UI/selection logic, e.g., `< 0`)
*   `getMV()` and `getMVP()`: ModelView and ModelViewProjection matrices
*   `getN()` and `getEN()`: Normal matrices
*   `getEditMatrix()`: Usually identity, but required by the shader.

### Vertex and Buffer Requirements
If creating a helper object from scratch (e.g., a line or wireframe bounds), you cannot just pass raw arrays. You must construct `Buffer` objects and provide them via:
*   `getVertexBuffer()`
*   `getMaterialBuffer()` (Can just return vertex buffer to prevent null crashes)
*   `getColorBuffer()` (Same as above)
*   `getNormalBuffer()` (Same as above)

**Crucial Fallback Check:** If the helper does not use indexed drawing (like a simple debug line), it MUST define:
```javascript
isUsingDrawArrays() { return true; }
getMode() { return this._gl.LINES; } // or POINTS, TRIANGLES
getCount() { return vertexCount; }
```
Failure to provide these exact duck-typed methods will cause `ShaderBase.js` to crash internally when attempting to bind attributes that don't exist.

## 2. Helper Object Construction Patterns

To draw something simple, there are two viable paths:

### Path A: The `Primitives` Module (Recommended for Shapes)
`Primitives.js` contains generators that wrap raw Float32Arrays and Uint32Arrays into a fully compliant `MeshStatic` component. 
*   `Primitives.createLine2D(gl, lx, ly, ux, uy)` exists but generates `z=0`.
*   It is safer to use `Primitives.createCube` or `createCylinder` and wrap it in a `Multimesh`.

### Path B: The `VoxelBounds` Interface Fake (Recommended for Raw WebGL)
`VoxelBounds.js` is an excellent example of a raw helper class mapping. It constructs a `Float32Array`, wraps it in a `Buffer`, and then implements the 15+ getter functions required by `ShaderBase` manually. It then uses `ShaderLib[Enums.Shader.UNLIT]` to draw it simply.

## 3. The Twisty Scale Logic (VR)

The most notorious trap in this codebase is the interaction between `_vrScale` and `_xrWorldOffset`.

### Space Definitions
*   **Room Space (Meters):** The physical tracking space of the WebXR headset. The controllers report their positions here. (1 unit = 1 meter).
*   **Engine Space (Model Space):** The internal SculptGL canvas. A typical sculpt is sized `[-1, 1]` or roughly a 2-unit sphere around the origin.

### The Conversion
`Scene.js` bridges these spaces. When a user creates a 2-grip scaling gesture (moving hands apart):
1.  **Stationary Mode:** The mathematical representation of the *world* shrinks (zooms in on the object), so `_vrScale` decreases.
2.  **Tracked Mode:** The mathematical representation of the *object* grows, so `_vrScale` increases.

**The Golden Equation:**
`ModelPos = Inv(WorldScale) * Inv(WorldOffset) * RoomPos`

### Why Visual Debugging Usually Fails
A common mistake is attaching a debug mesh (scaled to `[1,1,1]`) to a controller's *Room* position but rendering it in *Engine* space. 
*   If `_vrScale` is extremely small (e.g., heavily zoomed object), `invScale` is huge. 
*   The raw positional offsets are multiplied by this huge inverse scale, shooting the debug object off into the void.

**The Fix for Debug Objects:**
If mapping an object to a physical tracking coordinate `[x,y,z]`:
1. Render it in **Pass 1 (Controllers/Debug)** *before* the matrices are multiplied by `_vrScale` and `_xrWorldOffset`. Pass 1 rendering operates in pure 1:1 Room Space.
2. **OR**, if rendering in **Pass 2 (World Space)**, the debug geometry MUST be transformed by `Inv(WorldOffset)` and multiplied by `Inv(WorldScale)` to survive the engine's projection back onto the screen.

## 4. Why The `Pink Laser` Failed / Was Risky
Injecting a `VRLaser` object dynamically into Pass 2 (`_drawSceneVR` / World Scaled) means its `updateMatrices` method must perfectly un-do the `vrScale` and `WorldOffset` transformations that `_renderSceneVR` applies immediately after it returns to the WebXR pipeline. 

Because `VRLaser` draws entirely via an internal shader configuration originally built for Pass 1 (unscaled Room Space Menu Pointing), moving it into Pass 2 (Scaled World Space) causes the length projection and width thickness to mathematically distort based on `vrScale`, often making the geometry invisible or infinitely stretched.

## 5. Next Steps for Safe Debugging
To safely build the visual debugger the user needs:
1.  We must use `Primitives.createCylinder` or a `MeshStatic` component to ensure it integrates safely into Pass 2.
2.  We must explicitly calculate the `Target Point` (Intersection Point) and draw a cylinder exactly spanning `EngineOrigin -> EngineTarget`.
3.  We must scale the `width` of this cylinder by `_vrScale` so it remains a constant 5mm thickness inside the headset, regardless of world zoom.
