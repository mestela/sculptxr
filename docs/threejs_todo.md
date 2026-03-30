# Three.js Port Status and Priorities

**Context:** The core rendering engine is being migrated from custom raw WebGL (SculptGL) to **Three.js**. The project is currently on a branch and functioning in the GalaxyXR headset. 

**Goal:** Complete the "fit and finish" phase, ensure parity with the WebGL version, and eventually merge back to `master` as a single unified codebase.

---

## 1. Todo
### Fit & Finish Priorities (Current Focus)
* [x] **Audit menus** and test the rest of the full VR menu to ensure all sections function correctly.
* [x] **Symmetry**: get working in all modes
* [x] **wireframe overlays**
* [x] **other rendering modes** like matcaps, normals, etc.
* [x] **Wireframe/Materials**
* [x] **Sculpting "Feel"**: match to webgl build
* [ ] transform still behaves a bit wacky when used on cylinder / other objects besides the sphere, especially during rotation
* [ ] when exporting obj files it actually saves them as obj.txt for some reason

### Todo misc
* [ ] **voxel undo** sometimes seems to undo the data structure, but doesn't push those changes do the view
* [ ] **control mesh to voxel res**: should happen from the resolution slider nearby
* [ ] **fix paint issues in default matcap image**
* [ ] **thumbstick should scroll menu**
* [ ] **Local Storage**: Saving user options is long overdue, possibly store local projects, recently used etc
* [ ] **Desktop modes**: Niche, but should make a stab at reimplementing. Use quest 2 for this
* [ ] **Three-mesh-ui**: move menu system to this
* [ ] **Floating VR Keyboard**: there is a builtin one (part of three-mesh-ui?)
* [ ] **Other Features**: TBD (Will emerge as the menu and tools are fully audited). What else is unlocked by using threejs?
* [ ] **Box modelling**: Integrate functions from https://github.com/sengchor/kokraf?tab=readme-ov-file and put VR front end on it
* [ ] **Materials**: move to native threejs materials, allowing for better integration with post process effects and whatnot.
* [ ] **Layers**
* [ ] **Animation**
* [x] **GUI Swap accordian layout to tabs**
* [x] **Voxel refine**: bake, move, smooth normals, support different materials, paint, wasm
* [x] **Mesh to Voxel**
* [x] **Resample changes colour**
* [x] **Voxel Mode**: get core working, make it fast
* [x] **Paint Mode**
* [x] **Transform gizmo**
* [x] **Outliner**:
* [x] **Proper controllers per headset** - selectable for pcvr

### Bugs during testing
* [ ] undo in voxel doesn't undo paint
* [ ] color picker doesn't latch properly; drag too far in the square, it affects the hue circle, vice versa
 

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
