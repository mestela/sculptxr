# Research: Smooth vs. Relax Sculpting Algorithms

## 1. The Smooth Brush (Vertex Position Averaging)
**Goal:** Eliminate surface noise and irregularities.
**Standard Algorithm (Laplacian Smoothing):**
The simplest implementation of a Smooth brush moves each vertex towards the geometric average (centroid) of its immediately connected neighbors. 
- **The Math:** $V_{new} = V_{old} + \alpha \cdot (\frac{1}{N}\sum_{i=1}^{N} N_i - V_{old})$ where $N_i$ are the neighboring vertices and $\alpha$ is the smoothing strength.
- **The Problem:** Because vertices are pulled directly towards their neighbors' centroid, convex areas (like sharp corners, ridges, or noses) get pulled inward, causing the mesh to inherently **shrink and lose overall volume**. 
- **Advanced Variants (Surface Smooth):** Some applications, like Blender, attempt to mitigate volume loss by computing the difference between the original and smoothed mesh, and pushing vertices back along their normal to preserve the original silhouette.

## 2. The Relax Brush (Topology Redistribution)
**Goal:** Even out the spacing of polygons across the surface *without* altering the underlying form or volume.
**Standard Algorithm:**
Instead of blurring the mesh inward, a Relax operation tries to make all edges roughly the same length while constraining the vertices to slide *strictly along the existing surface*.
- **The Math (Cotangent/Spring-based Relaxation):** Vertices act as if they are connected by springs of equal length. However, when the springs push a vertex, its movement is projected onto the tangent plane of the original surface (using the vertex normal).
- **The Process:**
  1. Calculate the desired "relaxed" position (often using Laplacian smoothing).
  2. Determine the movement vector from the current position to the relaxed position.
  3. **Crucial Step:** Project this movement vector onto the vertex's tangent plane (so it only slides tangentially to the surface, neither pushing in nor pulling out).
  4. Move the vertex.
- **Why use it?:** If you use tools like the Pinch brush or Drag brush, polygons get stretched or compressed. The Relax tool untangles and evenly spaces these squashed polygons without destroying the sculpture's volume, making it essential for retopology-like cleanup and preventing `GL_INVALID_OPERATION` crashes from mangled faces before Dynamic Topology is applied.

## Summary
- **Smooth:** Flattens the surface. Affects the silhouette. Shrinks volume. (Changes **Shape**)
- **Relax:** Spreads out the vertices. Preserves the silhouette. Maintains volume. (Changes **Topology**)

## [PARANOID] Reconstruction Guide: Slide Brush Sub Mode (Relaxation)
### Goal
Enable the Slide brush, when triggered with the Sub/Negative modifier (`A` button), to act as a continuous, stationary, non-deforming relaxation tool that perfectly unravels and untangles vertex distribution without dragging or shearing.

### Plain English Logic
1. **Continuous Evaluation**: Inside `Slide.updateXR`, if `picking._negative` is active, construct an explicit zero-distance continuous stroke loop by picking vertices around the cursor each frame and recalculating their normals.
2. **Mirrored Offhand**: Explicitly mirror `_eyeDir` and `_origin` when using symmetry to copy the falloff cone precisely across the symmetry plane, preventing left side vertices from shearing toward the right side controller.
3. **Un-biased Falloff**: Pass `null` instead of `picking` to `Smooth.prototype.smoothTangent` within the negative sub mode loop to remove directional alpha projection drag, allowing pure unconstrained spherical convergence.
4. **Boundary Preservation**: Pre-check vertex starting hemispheres (`X > 0` or `X < 0`), and safely clamp any lateral vertices trying to cross the absolute mirroring boundary to `0.0`. True centerline vertices (whose topological symmetric mapped index matches their own index) remain permanently assigned to the seam plane.
