# SculptXR Project Overview

This document provides a consolidated, high-level overview of the SculptXR project. It synthesizes the information found in the project's documentation, accounting for the recent shift in architectural direction towards Three.js.

## 1. Core Definition
SculptXR is an immersive 3D sculpting application designed for Virtual Reality (VR) on the web. It aims to provide high-performance, organic sculpting tools in a mobile VR environment (specifically targeting platforms like GalaxyXR and Meta Quest).

## 2. Architectural Evolution (The Three.js Pivot)
*   **The Transition**: The project is currently migrating its rendering and scene management from a highly bespoke, raw WebGL engine (inherited from SculptGL) to **Three.js**.
*   **Context**: While the bespoke engine offered extreme control over memory and buffer uploads, a recent high-performance proof-of-concept by the Three.js maintainer proved that a Three.js-based architecture is viable and offers superior forward-looking possibilities.
*   **Status**: The project is in a "fit and finish" phase for the Three.js port, working towards full feature parity with the legacy implementation while maintaining high framerates in standalone VR. Note that older documentation (like `code_analysis.md`) arguing against Three.js has been superseded by this new direction.

## 3. Key Systems & Features

### Core Sculpting Toolset
*   **Legacy Base**: Inherits the core brush engine of SculptGL (including Draw, Inflate, Flatten, Twist, and Pinch) for high-performance vertex displacement.
*   **VR Adaptation**: While these core tools are stable and heavily documented, the primary effort over the months has been adapting their interaction paradigms (from screen-space mouse input to 6DOF controller rays) and optimizing the math to feel natural in physical meter space.

### Voxel Sculpting Engine
*   **Current State**: Uses a Wasm-optimized **SurfaceNets** implementation to extract meshes from signed distance fields (SDF). JS writes directly into the WASM heap (Zero-Copy) to avoid serialization overhead.
*   **Deferred Plans**: Ambitious plans for infinite chunked grids exist in documentation but have not been fully implemented.

### Modeling & Topology Operations
*   **Core Sculpting & 'Feel'**: The project focuses heavily on tactile "feel" and refining core interactions. This includes magnetic snapping for laser pointers, surface-relative culling to prevent brush drift on curves, and handling raw controller poses in meters (Physical World Space). Selection systems and stroke systems have been overhauled to remove jitter and fight temporal variable corruption.
*   **Low-Poly Edit Tools**: Recently added tools for low-poly workflows, including a two-click sequential Weld tool to refine geometry.
*   **Advanced Booleans**: Supports visibility-state-driven Union, Subtract, and Intersect operations when two objects are selected.
*   **Quadrangulation & Symmetry**: Features a robust quad-merging system inspired by Blender's BMesh error metric. Uses `Manifold-3D` to guarantee watertight meshes for booleans and symmetry mirrors.
*   **N-gon Support**: The mesh system strictly supports triangles and quads. It does not support faces with more than 4 vertices (N-gons).
*   **Undo/Redo Stability**: Employs a "Wholistic Object Swapping" pattern for topology-altering tools. Instead of in-place mutation, it swaps entire mesh references to avoid data corruption in the undo stack.

### Interaction & UI
*   **Paradigm**: "Right is Might, Left is Meta." The right hand handles action/sculpting and raycasting, while the left hand holds the UI palette and acts as a modifier. Left-handed mode is fully operational and works fine.
*   **VR HUD**: A heavy custom UI rasterized to a 2D canvas and uploaded to a WebGL texture. Optimized to decouple redraws from heavy GPU uploads to maintain 90fps.

### Animation System (DAW)
*   **Architecture**: A multi-track non-linear mocap sequencer supporting track loops, morph-shape delta overlays, and hierarchical scene modifications.
*   **Features**: Supports keyframe selection, editing, transformation, and AutoKey logic. Mocap recording over short loops is supported for transforms.
*   **Data Storage**: Tracks map to mesh IDs and store both shape keys (vertex snapshots) and transform keys (Position/Rotation/Scale).
*   **Export**: Supports saving animation data in custom `.sxr`/`.sgl` formats and exporting to standard GLB.

## 4. Platform Quirks & Hardware Workarounds
The project contains critical documentation on overcoming mobile WebXR barriers:
*   **GalaxyXR**: Requires aggressive FBO (Framebuffer Object) rebinding per-eye to prevent right-eye dropouts, and strict avoidance of `.innerText` (replaced with `.textContent`) to prevent massive CPU layout thrashing.
*   **Virtual Desktop**: Resolved a critical controller detection failure by removing the `hand-tracking` flag from session requests, preventing confused fallback behavior between physical controllers and optical hand tracking.
*   **Apple Vision Pro**: Notes that enabling full hand tracking requires specific optional flags in WebXR setup to bypass game-like transient pointers, and AVP currently lacks `immersive-ar` support in Safari.

## 5. Animation & Undo System Implementation Notes
*   **VR State Sharing**: VR UI instances may recreate or lose instance properties across frames. To ensure state survives from click to release (e.g., `_animTransformBoxInitialTimes`), store it on `window` rather than `this`.
*   **Sorting Side Effects**: Operations that sort keys by time (like `sortTrack`) will shift array indices. Any Undo/Redo operations must rely on time-based lookups rather than index-based lookups to avoid data corruption.
*   **Undo for Complex Operations**: Operations like "Delete Keys" and "Record Motion" must capture full state (times and values) before execution and restore them in Undo, as simple time-shifting is not sufficient when keys swap order or are removed.

---
*This overview represents the state of understanding after the animation and undo system audit.*
