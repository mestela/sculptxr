
import os
import re

SRC_DIR = 'src'
VERSION = 'fix_5'

def bust_cache_in_file(file_path):
    with open(file_path, 'r') as f:
        content = f.read()
        
    def replace_import(match):
        full_match = match.group(0)
        import_path = match.group(1)
        
        # Only target .js files
        if not import_path.endswith('.js'):
            return full_match
            
        # If already has version, replace it
        if '?v=' in import_path:
            base_path = import_path.split('?v=')[0]
            new_import = f"from '{base_path}?v={VERSION}'"
            if new_import != full_match:
                # print(f"  Replacing {full_match} -> {new_import}") # Verbose
                pass
            return new_import
            
        return f"from '{import_path}?v={VERSION}'"

    # Regex for "from '...'"
    # Handles "import ... from '...'" and "export ... from '...'"
    new_content = re.sub(r"from '([^']*)'", replace_import, content)
    
    # Also handle dynamic imports import('...')
    new_content = re.sub(r"import\('([^']*)'\)", lambda m: f"import('{m.group(1).split('?v=')[0]}?v={VERSION}')", new_content)
    
    if new_content != content:
        print(f"Busting cache in {file_path}")
        with open(file_path, 'w') as f:
            f.write(new_content)
    else:
        # print(f"No changes in {file_path}")
        pass

print(f"Starting Cache Bust to {VERSION}...")
for root, dirs, files in os.walk(SRC_DIR):
    for file in files:
        if file.endswith('.js'):
            bust_cache_in_file(os.path.join(root, file))
print("Done.")
