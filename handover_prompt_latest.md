# Handover Prompt (Protocol Enforced)

**Project Status**: v0.7.42 (BETA) - Testing
**Current Working Directory**: `/Users/mattestela/.gemini/jetski/scratch/sculptxr`
**Checkpoint**:
- `sculptxr-beta` (BETA): **v0.7.42** (Includes all new VR features)
- `sculptxr` (PROD): **v0.7.41** (Reverted to stable state)

## MANDATORY: Project Rules & Guidelines
[project_rules.md](file:///Users/mattestela/.gemini/jetski/scratch/sculptxr/project_rules.md)

## Current Focus: Testing VR Features on Beta
The **VR Overlay Menu** updates (Paint PBR, Masking Actions, Scene Logic) are deployed to **BETA**.
- **Paint Tool**: Added Color/Material sliders.
- **Masking Tool**: Added Clear/Invert/Blur/Sharpen buttons.
- **Scene Management**: Wired up Primitives, Reset, Duplicate, Delete, Merge.

## Outstanding Issues (Next Session)
1.  **Verify v0.7.42 on Beta**: Ensure all new VR controls work as expected.
2.  **Performance Tuning**: General optimization for standalone VR.
3.  **Scrolling**: VR Scrollbar drag works, but content clipping/masking could be smoother.

## Recent Changes
*   **v0.7.42 (BETA)**: **VR Feature**: Wired up Paint PBR, Masking Actions, Scene Primitives & Merge.
*   **v0.7.41 (PROD)**: **Tweak**: Changed default **Move Brush** radius from 150 to 80.

## Deployment
*   **BETA**: `./deploy_beta.sh`
*   **PROD**: `./deploy.sh` (LOCKED - Use only when v0.7.42 is verified)