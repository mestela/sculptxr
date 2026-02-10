
import os
import re

ROOTS = ['misc', 'math3d', 'gui', 'editing', 'files', 'states', 'render', 'mesh', 'drawables', 'Scene', 'SculptGL']
SRC_DIR = 'src'

def get_relative_path(current_file_path, target_import):
    # target_import: e.g. 'misc/Enums' or 'Scene'
    # current_file_path: e.g. 'src/gui/vr/GuiVRTools.js'
    
    current_dir = os.path.dirname(current_file_path) # src/gui/vr
    
    # Check if target starts with a known root
    target_root = target_import.split('/')[0]
    if target_root not in ROOTS:
        return None # External or unknown
    
    # Construct target absolute path (relative to src/)
    if target_root == 'Scene' or target_root == 'SculptGL':
        target_abs = os.path.join(SRC_DIR, target_import + '.js')
    else:
        # e.g. misc/Enums -> src/misc/Enums.js
        target_abs = os.path.join(SRC_DIR, target_import + '.js')
        
    # Calculate relative path
    rel_path = os.path.relpath(target_abs, current_dir)
    if not rel_path.startswith('.'):
        rel_path = './' + rel_path
        
    return rel_path

def fix_imports_in_file(file_path):
    with open(file_path, 'r') as f:
        content = f.read()
        
    def replace_import(match):
        full_match = match.group(0)
        import_path = match.group(1)
        
        # If already relative (starts with .), check extension
        if import_path.startswith('.'):
            if not import_path.endswith('.js'):
                return f"from '{import_path}.js'"
            return full_match
            
        # If bare import
        rel_path = get_relative_path(file_path, import_path)
        if rel_path:
            return f"from '{rel_path}'"
        
        return full_match

    # Regex for "from '...'"
    new_content = re.sub(r"from '([^']*)'", replace_import, content)
    
    if new_content != content:
        print(f"Fixing {file_path}")
        with open(file_path, 'w') as f:
            f.write(new_content)

for root, dirs, files in os.walk(SRC_DIR):
    for file in files:
        if file.endswith('.js'):
            fix_imports_in_file(os.path.join(root, file))
