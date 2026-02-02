# Handover Prompt (Protocol Enforced)

**Project Status**: v0.6.184 (BETA) - SCULPTING & PAINTING PARITY ACHIEVED
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**: `v0.6.184` deployed to `sculptxrbeta`.
**Last Successful Version**: `v0.6.184` (Symmetry/Continuous logic restored).

## MANDATORY: Project Rules & Guidelines
**CRITICAL**: You MUST read and follow `project_rules.md` at the start of your session. It contains codebase-specific patterns, style guides, and forbidden actions (e.g., no emoji, specific git workflows).
[project_rules.md](file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/project_rules.md)

## Current Issue: VISUAL POLISH ONLY
**User Report**: "That works."
**Status**:
*   **Fixed**: "Common" Section (Symmetry, Continuous) implemented in VR (v0.6.184).
*   **Working**: Combobox Layout (Smart positioning).

## Recent Changes (v0.6.184)
1.  **Common Section (VR)**:
    *   **Feature**: Added 'Common' section to VR Tool Panel.
    *   **Feature**: 'Symmetry' toggle (Hides for Transform tool).
    *   **Feature**: 'Continuous' toggle (Respects `canBeContinuous`).
2.  **Combobox Smart Positioning** (v0.6.183):
    *   Lists push UP if clipping bottom.
    *   Hit testing patched with 1.13x scale factor (Needs proper fix later).

## Debugging Leads for Next Agent
1.  **Combobox Alignment**:
    *   Investigate why `VRMenu` texture/quad mapping results in a 13-15% vertical compression.
    *   Check `GuiXR` canvas height vs `VRMenu` geometry aspect ratio.
2.  **Common Section**:
    *   User wants 'Symmetry' and 'Continuous' in a 'Common' section matching Desktop.
    *   Check `GuiSculpting.js` for exact layout and replicate in `GuiVRTools.js` carefully.

## Deployment
See [Deployment Protocol](#deployment-protocol) in `project_rules.md`.
*   **BETA**: `./deploy_beta.sh` (Current focus)
*   **PROD**: `./deploy.sh` (LOCKED until fix)