import os
import re

SRC_DIR = './src'
ALIASES = ['misc', 'math3d', 'gui', 'editor', 'editing', 'files', 'mesh', 'render', 'states', 'drawables']

def get_relative_path(from_file, to_import):
    # from_file: e.g. ./src/editing/tools/Move.js
    # to_import: e.g. editing/tools/SculptBase
    
    # 1. Resolve absolute path of the target
    target_path = os.path.join(SRC_DIR, to_import + '.js')
    
    # 2. Calculate relative path from the directory of from_file
    from_dir = os.path.dirname(from_file)
    rel_path = os.path.relpath(target_path, from_dir)
    
    if not rel_path.startswith('.'):
        rel_path = './' + rel_path
        
    return rel_path

for root, _, files in os.walk(SRC_DIR):
    for file in files:
        if file.endswith('.js'):
            filepath = os.path.join(root, file)
            with open(filepath, 'r') as f:
                content = f.read()
            
            modified = False
            lines = content.split('\n')
            for i, line in enumerate(lines):
                # Match import { ... } from 'alias/...' or import X from 'alias/...'
                match = re.search(r'import\s+.*?from\s+[\'"]([^\'"]+)[\'"]', line)
                if match:
                    import_str = match.group(1)
                    # Exclude node_modules like three, gl-matrix, yagui, hammerjs
                    if import_str.split('/')[0] in ALIASES:
                        # Ensure we don't double append .js if it already has it
                        clean_import = import_str[:-3] if import_str.endswith('.js') else import_str
                        new_rel_path = get_relative_path(filepath, clean_import)
                        lines[i] = line.replace(f"'{import_str}'", f"'{new_rel_path}'").replace(f'"{import_str}"', f"'{new_rel_path}'")
                        modified = True
            
            if modified:
                with open(filepath, 'w') as f:
                    f.write('\n'.join(lines))
                print(f"Updated imports in {filepath}")
