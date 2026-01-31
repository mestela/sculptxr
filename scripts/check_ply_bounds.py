import os
import struct

def read_ply_bounds(file_path):
    print(f"Checking {file_path}...")
    with open(file_path, 'r') as f:
        lines = f.readlines()

    header_end = 0
    vertex_count = 0
    is_binary = False
    
    properties = []
    
    for i, line in enumerate(lines):
        line = line.strip()
        if line.startswith("element vertex"):
            vertex_count = int(line.split()[-1])
        elif line.startswith("format binary"):
            is_binary = True
        elif line.startswith("property"):
             properties.append(line)
        elif line == "end_header":
            header_end = i + 1
            break

    if is_binary:
        print("Skipping binary PLY (script only supports ASCII for quick check)")
        return

    min_v = [float('inf')] * 3
    max_v = [float('-inf')] * 3

    # Assuming standard x y z order for first 3 props
    # This is a quick & dirty check
    
    count = 0
    for i in range(header_end, header_end + vertex_count):
        parts = lines[i].split()
        if len(parts) < 3: continue
        
        try:
            x, y, z = float(parts[0]), float(parts[1]), float(parts[2])
            
            min_v[0] = min(min_v[0], x)
            min_v[1] = min(min_v[1], y)
            min_v[2] = min(min_v[2], z)
            
            max_v[0] = max(max_v[0], x)
            max_v[1] = max(max_v[1], y)
            max_v[2] = max(max_v[2], z)
            count += 1
        except ValueError:
            continue

    if count == 0:
        print("No vertices found.")
    else:
        print(f"  Count: {count}")
        print(f"  Min: [{min_v[0]:.4f}, {min_v[1]:.4f}, {min_v[2]:.4f}]")
        print(f"  Max: [{max_v[0]:.4f}, {max_v[1]:.4f}, {max_v[2]:.4f}]")
        print(f"  Size: [{max_v[0]-min_v[0]:.4f}, {max_v[1]-min_v[1]:.4f}, {max_v[2]-min_v[2]:.4f}]")
        print(f"  Center: [{(min_v[0]+max_v[0])/2:.4f}, {(min_v[1]+max_v[1])/2:.4f}, {(min_v[2]+max_v[2])/2:.4f}]")

if __name__ == "__main__":
    base = "src/resources/controllers"
    read_ply_bounds(os.path.join(base, "controller_left.ply"))
    read_ply_bounds(os.path.join(base, "controller_right.ply"))
