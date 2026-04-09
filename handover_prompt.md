# Handover Prompt (Protocol Enforced)

**Project Status**: Rebuilt Inset tool from scratch with robust un-welded Keep Together topology, per-face target midpoint averaging for smooth coplanar scaling without sinking, and a precision start-click aim sphere helper.
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: v1.0.143

## Deployed Version
- **Beta**: N/A (Deployment disabled in rules)
- **Prod**: N/A (Deployment disabled in rules)

## Interactive Debugging
- **Preference**: Use browser console for immediate state inspection.
- **Workflow**: Provide copy-pasteable snippets.

## Accomplishments & Current Situation
1. **Complete Rewrite of Inset Tool**: Implemented independent vertex duplication when Keep Together is disabled, and combined midpoint face averaging when Keep Together is enabled to maintain coplanarity over spherical/curved surfaces.
2. **Precision Targeting Indicator**: Added a yellow 0.2m glowing sphere positioned perfectly on the mesh intersection point using `activeMesh.getMatrix()` to guide users on their initial click location.

## Next Steps / Backlog
1. **Symmetry Validation**: Validate any specific behavior for inset tools across complex models or mirroring seams if desired.
