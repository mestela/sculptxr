# Handover Prompt (Protocol Enforced)

**Project Status**: Implemented Split-Only Symmetry Cut Debug view and magenta centerline tagging. Validated that standard CSG (Manifold-3D) breaks down on non-planar self-intersecting sculpting quads across the mirror boundary.
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: Pivoting from C++ CSG Boolean Pipeline to Custom Ray-Plane Edge Slicer.

## Deployed Version
- **Beta**: N/A (Deployment disabled in rules)
- **Prod**: N/A (Deployment disabled in rules)

## Interactive Debugging
- **Preference**: Use browser console for immediate state inspection.
- **Workflow**: Provide copy-pasteable snippets.

## Current Situation / Obstacles
Testing confirmed that `Manifold-3D` coplanarity algorithms inherently splinter into micro-wobbles when fed sculpted, non-manifold or self-intersecting dynamic quads spanning across the zero plane. Therefore, standard boolean CSG is a dead end for this feature. 

## Next Steps / Backlog
1. Abandon C++ CSG booleans for static quad mirror symmetry.
2. Implement a pure custom **Ray-Plane / Sutherland-Hodgman Edge Slicer directly in JavaScript** to calculate perfect segment intersections across the $X = 0$ plane regardless of internal polygon intersections.
