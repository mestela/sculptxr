Implementation Plan - Voxel SDF Brushes & Pressure
Goal
Add support for:

Multiple Brush Shapes: Cube, Ellipsoid, Cone (via SDFs).
Analog Trigger Pressure: Control brush radius dynamically.
Visual Feedback: Show Min/Max radius.
User Review Required
IMPORTANT

Performance: Adding complex SDFs (like Cone/Ellipsoid) might be slightly slower than simple Sphere distance checks, but should be negligible for single stamps. Sweeping: Currently, brushes are "stamped". Sweeping non-sphere shapes (like a rotating Cube) is complex. We will assume "Aligned Stamping" (brush orientation matches controller) or "Axis Aligned" for now? Decision: Brushes will be Axis Aligned (to Grid) or Controller Aligned? VoxelState.js usually works in generic grid space. Using Controller Rotation requires passing a rotation matrix to the SDF. Proposal: Initial implementation will be Axis Aligned (Cube stays grid-aligned) or Rotation Locked to simplify math, unless "Follow Rotation" is requested. Actually, user probably wants the brush to rotate with hand? Complexity: Rotating SDF requires transforming query point by inverse rotation: p = inverse(rot) * (p - center). Plan: Pass rotation (quat/mat3) to EDIT_SDF.

Proposed Changes
1. 
src/workers/VoxelWorker.js
Add EDIT_SDF message handler.
Calls voxelState.editSDF(type, params, transform).
2. 
src/workers/VoxelState.js
Implement editSDF(center, rotation, type, params, isNegative).
Implement SDF functions (adapted from Inigo Quilez):
sdBox(p, b)
sdEllipsoid(p, r)
sdCone(p, c)
Update 
computeMesh
 (unchanged, just data modification).
3. 
src/Scene.js
Extract triggerValue (0..1) in 
_drawSceneVR
 / input loop.
Pass triggerValue to sculptManager.updateXR.
Update _vrBrushRadiusSphere to visualize Pressure?
Maybe just scale the sphere by current triggerValue (or mapped radius)?
User asked for Min/Max visualization. We can add a secondary wireframe sphere for Max?
4. 
src/editing/tools/SculptVoxel.js
Update 
updateXR
 to accept triggerValue.
Logic: effectiveRadius = mix(minRadius, maxRadius, pressureCurve(triggerValue))
Send EDIT_SDF with shape params and rotation.
5. 
src/gui/vr/GuiVRTools.js
Add Shape Combobox: Sphere, Cube, Ellipsoid, etc.
Add Min Radius % Slider (0 to 100).
Add Hardness/Falloff? (SDFs usually valid for hard shapes).
Verification Plan
Automated Tests
None (Visual Feature).
Manual Verification
VR Test:
Select "Cube" brush. Sculpt. Verify cubes are stamped.
Rotate hand. Verify Cube rotates (if implemented) or stays aligned.
Light press vs Hard press. Verify radius changes.
Check Undo/Redo (should still work).

Pressure Curve Logic: Slider S in [-100, 100]. Let t be trigger value [0, 1]. Let rMin, rMax be min/max radius. Target radius r.

If S = 0: Linear. r = mix(rMin, rMax, t) If S < 0: Bias to Min. r increases slowly at first, then fast. (Convex/Exponential). This means t acts like t^k where k > 1. If S > 0: Bias to Max. r increases fast at first, then slow. (Concave/Logarithmic). This means t acts like t^k where k < 1.

Let's use a Gamma factor k. S > 0: k = 1.0 - (S / 100.0) * 0.8 -> Range [0.2, 1.0]. (Max bias) S < 0: k = 1.0 + (-S / 100.0) * 3.0 -> Range [1.0, 4.0]. (Min bias)

t_adj = pow(t, k) r = mix(rMin, rMax, t_adj)

Wait, user said: "move slider towards -100, it starts to bias the pressure to favour the min radius value." If k > 1 (e.g. t^2), for t=0.5, t^2=0.25. This favors lower values (closer to Min). Correct. "move slider towards +100, it favours the max radius value." If k < 1 (e.g. t^0.5), for t=0.5, t^0.5=0.707. This favors higher values (closer to Max).

Pressure Logic:

Min Radius: rMin
Max Radius: rMax
Pressure Slider: S (-100 to 100). Default 0.
Trigger Value: t (0 to 1).
Mapping:

S < 0: Bias to Min (Convex). k = 1.0 + (-S / 100.0) * 3.0 (Range 1.0 to 4.0).
S > 0: Bias to Max (Concave). k = 1.0 - (S / 100.0) * 0.8 (Range 1.0 to 0.2).
t_adj = pow(t, k)
r = mix(rMin, rMax, t_adj)