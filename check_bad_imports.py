
import os
import re

SRC_DIR = 'src'
BAD_ROOTS = ['misc/', 'math3d/', 'gui/', 'editing/', 'files/', 'states/', 'render/', 'mesh/', 'drawables/']

def check_file(file_path):
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Check for bare imports
    for root in BAD_ROOTS:
        if f"from '{root}" in content or f'from "{root}' in content:
            print(f"BAD IMPORT: {file_path} contains {root}")
            
    # Check for .js.js
    if '.js.js' in content:
        print(f"DOUBLE EXTENSION: {file_path} contains .js.js")

for root, dirs, files in os.walk(SRC_DIR):
    for file in files:
        if file.endswith('.js'):
            check_file(os.path.join(root, file))
