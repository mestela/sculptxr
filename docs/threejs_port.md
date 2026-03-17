# Three.js Port Status and Priorities

**Context:** The core rendering engine is being migrated from custom raw WebGL (SculptGL) to **Three.js**. The project is currently on a branch and functioning in the GalaxyXR headset. 

**Goal:** Complete the "fit and finish" phase, ensure parity with the WebGL version, and eventually merge back to `master` as a single unified codebase.

---

## 1. Fit & Finish Priorities (Current Focus)
* **Symmetry**: 
  * Currently very broken, specifically for the Move Tool. Needs debugging.
* **Rendering Modes**:
  * Missing wireframe overlays.
  * Missing other rendering modes like matcaps, normals, etc.
* **VR Menu Completion**:
  * "Tools" section is working, but "Wireframe/Materials" are currently broken.
  * Need to audit and test the rest of the full VR menu to ensure all sections function correctly.
* **Sculpting "Feel"**:
  * The current Three.js sculpting feel isn't bad, but requires tuning to match the exact tactile feel of the original WebGL version.

## 2. Legacy / Missing Features
* **Voxel Mode**: Needs a complete review and testing to see what broke during the port. Has not been tested yet.
* **Other Features**: TBD (Will emerge as the menu and tools are fully audited).

## 3. Device Testing Strategy
* **Phase 1: Fast Iteration (Current)**
  * **Device**: GalaxyXR headset.
  * **Workflow**: Connected via ADB to the Macbook. Using Remote Chrome Console for debugging. 
  * **Hot Reloading**: Utilizing Vite's HMR for rapid iteration, cutting development cycle time to 1/3 of the previous process.
* **Phase 2: Broad Platform Validation**
  * **Devices:** Quest 3 (Standalone & PCVR), Quest 2.
  * **External Beta Testers:** Valve Index, Pico VR, Apple Vision Pro.

## 4. Port History and Reference Projects
**Origin Story:** The Three.js port was initially inspired by a conversation with Mr.doob (creator of Three.js) at Google. He demonstrated a "vibecoding" approach where Claude ported the original SculptGL to Three.js and WebXR in about 30 minutes.

**Attempt 1 (Abandoned):** The initial effort involved taking Mr.doob's generated (Claude) codebase—which only had a simple sphere and controllers—and attempting to port our existing complex VR UI and menus into it. After 2 days, this approach was abandoned. While the generated code was impressive, it took too many architectural shortcuts and proved too different from our established codebase to build out cleanly.

**Attempt 2 (Success):** The successful approach was the reverse: taking our mature, existing codebase and replacing the core custom WebGL engine underneath it with Three.js. This took only a few hours of pair programming and retained all of our existing structure.

**Reference Directories:** 
If reference code from the initial experiments is ever needed, the previous prototypes are stored locally:
* `~/.gemini/jetski/scratch/sculptxr-threejs` - A full clone of the Three.js repository, which contains the original WebXR example in a subfolder.
* `~/.gemini/jetski/scratch/sculptxr-vr` - The standalone XR example that includes the partial (abandoned) attempt to port our menu systems into the generated codebase.
  * *Note: Relying on Three.js' built-in WebXR support to provide per-platform controller meshes and API compatibilities "for free."*
