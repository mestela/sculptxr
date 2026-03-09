# Voxel Move Tool: ODE SDF Advection

This document explains the technical architecture behind SculptXR's Voxel Move tool, which combines a real-time polygonal proxy with a deferred Ordinary Differential Equation (ODE) solver for Signed Distance Field (SDF) advection.

## 1. The Core Architecture: Split Threading
The central problem with deforming volumetric data (Voxels/SDFs) in real-time within a WebGL/JavaScript environment is the massive computational cost. Desktop software utilizes highly parallel GPU Compute Shaders to run advection continuously. Since WebGL1 lacks Compute Shaders, evaluating grid matrices 90 times a second on the CPU would instantly crash the browser.

To solve this, the Voxel Move tool utilizes a "sleight of hand" architecture that splits the workload:
1.  **Main Thread (Visual Proxy)**: Tracks the controller and provides instant 90fps visual feedback.
2.  **Web Worker (Deferred Advection)**: Performs the heavy Level Set math asynchronously only *after* the user finishes the stroke.

## 2. The Main Thread (The Drag)
When the user pulls the trigger to start a voxel move:
1.  The Main Thread takes a snapshot of the VR controller's World Position and Rotation Matrices (`this._moveStartXRPos`, `this._moveStartXRQuat`).
2.  It identifies all voxel grid points within the brush radius and temporarily "steals" their polygons, detaching them into a lightweight **Proxy Mesh**.
3.  As the user drags their hand, the Main Thread calculates the "Delta" (the translation and rotation difference from the start position).
4.  This Delta is piped directly to the GPU to instantly move the Proxy Mesh, giving the user perfect 1:1 tactile feedback without touching the underlying voxel data structure.

## 3. The Release (The Payload)
When the trigger is released, the visual proxy is hidden, and the Main Thread packages the total hand movement into a payload and sends it to the Web Worker (`VoxelState.js`) via a `WARP_SPHERE` command.

This payload is essentially a pure **Transformation Matrix** derived directly from the controller's path, rather than thousands of moving vertices.

## 4. The Web Worker (ODE Level Set Advection)
Once the Worker receives the transformation payload, it must update the actual Signed Distance Field to match the proxy's new position. This uses principles from **Level Set Methods**.

### The Problem: Forward Advection Tearing
If you take an SDF and "push" all the cells forward along the movement vector, they spread out. Because the grid is discrete, gaps appear between voxels, literally tearing the surface apart.

### The Solution: Reverse Advection & ODE Integration
To fix this, we use **Reverse Advection**. Instead of pushing geometry forward, the algorithm iterates over every destination cell in the grid and asks: "Where did you come from?"

1.  **Iterative ODE Solver (Reverse Euler)**: If a user translates and twists their hand drastically in one stroke, a single reverse vector creates "spatial folding" (the math intersects itself, causing spikes).
2.  To solve this, the Worker implements an **Iterative ODE Solver**. It mathematically slices the user's total transformation into fractional "time-steps".
3.  For each voxel cell within the bounding box, it traces the vector gradient backward incrementally, step-by-step, along the curve of the rotation.
4.  Once it finds the exact origin coordinate, it uses trilinear interpolation to sample the old distance value, and pulls that value into the new cell.

This reverse-tracing guarantees a perfectly solid mesh with zero gaps, tearing, or folding artifacts, perfectly reconstructing the organic volume exactly where the visual proxy was dropped.
