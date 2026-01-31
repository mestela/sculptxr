import bpy
import os
import sys

def convert_glb_to_ply(glb_path, output_path):
    # Clear existing objects
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import GLB
    print(f"Importing {glb_path}...")
    bpy.ops.import_scene.gltf(filepath=glb_path)
    
    # Select all objects
    bpy.ops.object.select_all(action='SELECT')
    
    # Export PLY (Binary by default)
    print(f"Exporting to {output_path}...")
    bpy.ops.wm.ply_export(
        filepath=output_path,
        export_selected_objects=True,
        export_triangulated_mesh=True,
        forward_axis='NEGATIVE_Z',
        up_axis='Y',
        export_normals=True,
        export_uv=False,
        export_colors='NONE',
        ascii_format=True
    )

def main():
    # Hardcoded paths relative to script execution
    # Assuming script run from project root
    raw_dir = os.path.abspath("src/resources/controllers_raw")
    out_dir = os.path.abspath("src/resources/controllers")

    if not os.path.exists(out_dir):
        os.makedirs(out_dir)

    for side in ["left", "right"]:
        glb_path = os.path.join(raw_dir, f"{side}.glb")
        ply_path = os.path.join(out_dir, f"controller_{side}.ply")

        if os.path.exists(glb_path):
            convert_glb_to_ply(glb_path, ply_path)
        else:
            print(f"Warning: {glb_path} not found.")

if __name__ == "__main__":
    main()
