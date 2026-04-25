# Three.js Port Status and Priorities

**Context:** The core rendering engine is being migrated from custom raw WebGL (SculptGL) to **Three.js**. The project is currently on a branch and functioning in the GalaxyXR headset. 

**Goal:** Complete the "fit and finish" phase, ensure parity with the WebGL version, and eventually merge back to `master` as a single unified codebase.

## 0. Graph editor issues/features

* [ ] Check baking to glb works, i assume we'll need to pre-frame bake or something
* [ ] Allow playhead to move outside of range, so users can place spare shapes at frames -1, -2 etc


## 1. Todo

* [ ] **Scene**: simple mirror for now? in lieu of proper scene hierarchy/instancing
* [-] **Animation**: per key interp type; hold, bezier, linear [partially there, can do broken tangents]
* [ ] **Animation**: per frame sculpting, shape replacement based
* [ ] **Animation**: blendshapes
* [ ] **Low Poly**: Snapping for retopo. Snap from one object to another? More work on the slide tool maybe?
* [ ] **Desktop**: hmd+desktop hybrid
* [ ] **Hair/Fur**: Examples: https://github.com/FeliDipi/Grass or https://piellardj.github.io/fur-threejs/ 
* [ ] **AVP support**: fingers and stylus
* [ ] **Preview menus in desktop again** ctrl-shift-v works but doesn't actually show the menu contents.
* [ ] **Floating VR Keyboard**: there is a builtin one (use three-mesh-ui?)
* [ ] **Other Features**: TBD  What else is unlocked by using threejs?
* [ ] **Materials**: move to native threejs materials, allowing for better integration with post process etc
* [ ] **Layers**
* [ ] **Desktop electron build**: increase memory limits, modify load/save

* [x] tangents; Option to lock angle, only adjust length of tangent
* [x] Quick option to flatten off tangents for shape keys
* [x] Tangents too easy to grab and misplace in vr, esp when panning/zooming
* [x] Hover highlight missing on tangents
* [x] Fit view button for both desktop and vr
* [x] Tangent disply should be removed from timeline, they don't work
* [x] Unify desktop and vr graph editor/timeline, too much code to maintain now.
* [x] **Tablet**: UI doesn't work on ios, why?
* [x] **Animation**: graph editor in vr
* [x] **Animation**: for shape anim, handle with a graph editor and treat as time? so diagonal graph, beziers control retime essentially?
* [x] **Animation**: graph editor in desktop
* [x] **Animation**: calculator for duration is seconds, it should be frames
* [x] **Animation**: recording sculpting, move, like we record transforms
* [x] **Animation**: on desktop, undo isn't working properly
* [x] **Animation**: on desktop, can't paste multiple keys
* [x] **Animation**: transform box should allow scaling into negative to reverse key order.
* [x] **Animation**: on desktop, the key mode should have a default selection. probably transform.
* [x] **Animation**: on desktop, autokey doesn't work
* [x] **Animation**: autokey should work for shape on both desktop and vr
* [x] **Animation**: on desktop
* [x] **Extrude**: secondary trigger to multiselect/paint select faces, then extrude with primary trigger?
* [x] **Desktop**: low poly tools
* [x] **Desktop**: Getting base desktop sculpting working again
* [x] **Animation**: not all keyframe edit events can be undone atm. 
* [x] **Bug**:  when I click the big resize circle in transform tool it sometimes switches to grab tool
* [x] **Animation**: good basics for keyframe select, edit, transform, autokey
* [x] **Anim Bug**: setting transform keys by hand doesn't work
* [x] **Bug**: Grid only updates from saved state when the scene tab is active
* [?] **Three-mesh-ui**: move menu system to this -- advised not to.. but gemini has lied before...
* [x] **Bug**: reported by user, after "remesh (voxel)", can't sculpt on mesh
* [x] **Animation**: per frame sculpting mods, shapekey based
* [x] **Animation**: graph editor/frame editor
* [x] **Animation**: glb export
* [x] **Animation**: record mocap over short loop for transforms. 
* [*] **Outliner**: Persistent names, better use of space, selection modes
* [*] **About**: Include recent release info, and be scrollable
* [x] **Inset**: Nearly there, i think replace controller length along normal with just total distance from click
* [x] **Extrude** 
* [x] **Fix level 0 wireframe after reverse**
* [x] **Flow/relax**: Use hidden copy of mesh, conform relax over it. Or select another mesh?
* [x] **Symmetry line cleanup tools**: Configured mirror macro-diamond culler. Full Manifold-3D CSG ghost-edge tagging & quad preservation pipeline scheduled for next execution step.
* [x] **Symmetry**: "I found symmetry stopped working when I turned mesh to voxel and back again after adding some stuff in voxels"
* [x] **Topology menu tidy up**: Too much vertical scrolling, too many similarly named items.
* [x] **Fix normals breaks things**: Especially after quad remesh/quadrangulate
* [x] **Processing states on slow processes** Like how instant meshes goes gray, do the same for decimate/isotropic remesh. Progress?
* [x] **Triangulate**: Either internal or another library -- using baby shark
* [x] **wasm speed**: how to profile, fix? -- as fast as we can go for the moment. single threaded etc
* [x] **Quadrangulate** should leave existing quads alone. option maybe? 
* [x] **Stylus tilt**: Added slider, saved to local storage, and updated tip physics.
* [?] **Symmetry cut**: Fails on latest test head after simple edits --- partial progress, needs work
* [x] **Undo for cut tool**: should be able to undo a marker, not just undo the entire operation
* [x] **Jumping between tabs that have scroll looks blank at first**: Needs a repaint call or something.. fixed now?
* [x] **overal exposure/brightness**: virtual desktop too bright and overexposed
* [x] **boolean modes**: union, subtract, intersect
* [x] **menu styling**: seems unbalanced, come up with a better design. same for overall vr menu
* [x] **new scene tab issues**: missing clear scene and similar tools, hover flash highlights gaps between menu entrues
* [x] **Local Storage**: Saving user options is long overdue, possibly store local projects, recently used etc
* [x] **thumbstick should scroll menu**
* [x] **Audit menus** and test the rest of the full VR menu to ensure all sections function correctly.
* [x] **Symmetry**: get working in all modes
* [x] **wireframe overlays**
* [x] **other rendering modes** like matcaps, normals, etc.
* [x] **Wireframe/Materials**
* [x] **Sculpting "Feel"**: match to webgl build
* [x] transform still behaves a bit wacky when used on cylinder / other objects besides the sphere, especially during rotation
* [x] when exporting obj files it actually saves them as obj.txt for some reason
* [?] **voxel undo** sometimes seems to undo the data structure, but doesn't push those changes do the view - cant repro
* [x] **fix paint issues in default matcap image**
* [x] **instant meshes rust** very basic quadremesher
* [x] **control mesh to voxel res**: should happen from the resolution slider nearby
* [x] **GUI Swap accordian layout to tabs**
* [x] **Voxel refine**: bake, move, smooth normals, support different materials, paint, wasm
* [x] **Mesh to Voxel**
* [x] **Resample changes colour**
* [x] **Voxel Mode**: get core working, make it fast
* [x] **Paint Mode**
* [x] **Transform gizmo**
* [x] **Outliner**:
* [x] **Proper controllers per headset** - selectable for pcvr
* [x] undo in voxel doesn't undo paint
* [x] color picker doesn't latch properly; drag too far in the square, it affects the hue circle, vice versa

 

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
