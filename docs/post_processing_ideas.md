# Realtime Post-Processing in SculptXR

## Current Architecture
SculptXR uses a forward rendering pipeline. This means that geometry is drawn directly to the screen (or the current frame buffer), calculating lighting and material properties in a single pass.

Because of this forward renderer architecture, implementing heavy screen-space post-processing effects behaves differently than in a deferred pipeline.

## Screen-Space Ambient Occlusion (SSAO)
* **The Challenge**: To calculate SSAO, the shader needs context about the surrounding geometry, typically requiring a depth texture and ideally a normal texture.
* **Forward Rendering Cost**: In a traditional forward renderer, this would mean rendering the entire mesh once to a depth buffer, then again to get color, and composite them. Given SculptXR's dense geometry (often millions of triangles), rendering the scene twice would drastically reduce framerate, especially in standalone VR.
* **WebGL 2 / WebXR Alternatives**: We could use Multiple Render Targets (MRT) to output color, depth, and normal data simultaneously into separate textures (a G-Buffer) without rendering geometry twice.
* **Performance Consideration**: Even with MRT, SSAO is a very heavy pixel-shader effect (sampling many neighboring pixels for every screen pixel). While it could work on high-end PC desktop GPUs, it would likely be too heavy for standalone headsets like the Quest.

## Curvature / Cavity
* **The Solution**: Adding curvature or cavity effects is much more feasible and performant. We can calculate this directly in the forward rendering pipeline without needing a separate post-processing pass.
* **Screen-Space Derivatives**: WebGL supports functions like `dFdx` and `dFdy` (via `OES_standard_derivatives` or built-in WebGL 2). In our standard material shader (PBR or Matcap), we can analyze how fast the normal is changing compared to neighboring pixels.
* **Implementation**: By adding something like `length(dFdx(normal) + dFdy(normal))` in the fragment shader, we can detect sharp edges and crevices in real-time. This value can be used to add edge highlights or darken cavities practically for free, as it happens during the single color pass.
* **Vertex-based Alternative**: Because SculptXR handles its own meshing, the voxel remesher could potentially calculate a curvature map during mesh generation and bake it into a vertex color/attribute. However, doing it in the fragment shader is generally more "real-time".

## Summary
* **Curvature / Matcap tweaks**: Can be implemented directly inside existing fragment shaders using derivatives. Fast, cheap, and VR-friendly.
* **SSAO / Bloom / Heavy FX**: While there is a rudimentary Render-to-Texture (FBO) system in the codebase (currently used for basic FXAA on desktop), implementing SSAO or heavy effects would likely need to be restricted to a "Desktop Only" or "High-End PCVR" feature due to performance constraints.
