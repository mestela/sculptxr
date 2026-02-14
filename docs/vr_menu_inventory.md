# VR Menu Inventory & Status

## Overview
Status of the VR Menu system implementation as of **v0.7.49**.

### ✅ Fully Implemented Categories
| Category | Settings / Features | Notes |
| :--- | :--- | :--- |
| **Files** | Import/Export (OBJ, SGL, PLY, STL), Sketchfab, Texture Export | Project loading via "Import" |
| **Scene** | ADD (Sphere, Cube, Cylinder, Torus), Selection (Dup, Del, Merge), Grid, Symmetry Line, Sym Offset | Isolate check exists (default false) |
| **History** | Undo, Redo, Stack Size | |
| **Background**| Type (Image/Env), Blur, Import, Fill | |
| **Camera** | Reset/Front/Left/Top, Proj (Persp/Ortho), Mode (Orbit/Sphere/Plane), FOV, Speed | |
| **Tablet** | Pressure Intensity/Radius | |
| **Language** | Language Selector | |
| **Rendering** | Shaders (PBR, Matcap, Normal, UV), Environment, Exposure, Wireframe, Flat, Transparency, Curvature, Filmic | |

### 🛠 Implemented but Needs Verification (User Flagged)
| Category | Feature | Status in VR |
| :--- | :--- | :--- |
| **Topology** | **Dynamic Topology** | UI implemented (Activate, Subd, Decimation, Linear). **Needs Verification.** |
| **Topology** | **Multiresolution** | UI implemented (Level +/-, Subd, Reverse, Del Lower/Higher). **Needs Verification.** |
| **Topology** | **Remesh** | UI implemented (Resolution, Remesh). |

### ⚠️ Partial / TODO / Missing
| Category | Feature | Status |
| :--- | :--- | :--- |
| **Extra UI** | **Contour Color** | Marked as **TODO** in `GuiVRExtraUI.js`. |
| **Extra UI** | **Voxel Settings** | Duplicate of Tool settings? Has Res/Rad sliders. |
| **Tools** | **Alphas** | Import & Select implemented. |
| **Tools** | **Masking** | Clear, Invert, Blur, Sharpen implemented. |

## Detailed Breakdown by File

### `GuiVRTools.js` (Sculpting & Painting)
*   **Tool Select**: Combobox working.
*   **Settings**: Radius, Intensity.
*   **Paint**: Color Picker (Embedded), Roughness, Metallic, Paint All.
*   **Masking**: Clear, Invert, Blur, Sharpen.
*   **Move**: Topological Check.
*   **Voxel**: Resolution, Wireframe, Bake to Mesh.
*   **Modifiers**: Negative, Clay, Accumulate, Thin Surface (Culling), Lock Position.
*   **Alpha**: Texture Select, Import.
*   **Common**: Symmetry, Continuous.

### `GuiVRTopology.js` (Topology)
*   **Multiresolution**: Full UI suite present.
*   **Remesh**: Resolution slider + Button.
*   **Dynamic Topology**: Activation toggle, Subdivision, Decimation, Linear toggle.

### `GuiVRRendering.js` (View / Rendering)
*   **Shaders**: Matcap (Select/Import), PBR (Env/Exposure), Normal, UV (Import).
*   **Effects**: Curvature, Filmic.
*   **Mesh**: Transparency, Flat Shading, Wireframe.

### `GuiVRExtraUI.js` (Extra)
*   **Contour**: Header exists, Color is TODO.
*   **Resolution**: Pixel Ratio slider.
*   **Voxel**: Redundant? "Res" and "Rad Mult" sliders.

## Next Steps
1.  **Verify Dynamic Topology**: Test if the "Activated" checkbox effectively enables dynamic topology in VR sculpting.
2.  **Verify Multiresolution**: Test "Subdivide" and Level switching in VR.
3.  **Contour Color**: Implement if needed or remove TODO.
4.  **Voxel Redundancy**: Check if `GuiVRExtraUI` Voxel settings are effectively controlling the same thing as the Voxel Tool settings or if they are "Global" overrides.
