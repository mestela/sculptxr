// Voxel WASM Bridge for SculptXR
use std::mem;

#[unsafe(no_mangle)]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let mut buf = Vec::with_capacity(size);
    let ptr = buf.as_mut_ptr();
    mem::forget(buf);
    ptr
}

#[unsafe(no_mangle)]
pub extern "C" fn dealloc(ptr: *mut u8, size: usize) {
    unsafe {
        let _v = Vec::from_raw_parts(ptr, 0, size);
    }
}

#[repr(C)]
pub struct MeshResult {
    pub vertices_ptr: *mut f32,
    pub vertices_len: usize,
    pub faces_ptr: *mut u32,
    pub faces_len: usize,
    pub colors_ptr: *mut f32,
    pub colors_len: usize,
    pub materials_ptr: *mut f32,
    pub materials_len: usize,
    pub normals_ptr: *mut f32,
    pub normals_len: usize,
}

struct VoxelGrid<'a> {
    dims: [usize; 3],
    distance_field: &'a [f32],
    color_field: &'a [f32],
    material_field: &'a [f32],
}

struct Bounds {
    min: [usize; 3],
    max: [usize; 3],
}

#[unsafe(no_mangle)]
pub extern "C" fn compute_surface_wasm(
    dims_ptr: *const u32,
    bounds_ptr: *const u32,
    distance_ptr: *const f32,
    color_ptr: *const f32,
    material_ptr: *const f32,
) -> *mut MeshResult {
    if dims_ptr.is_null() || bounds_ptr.is_null() || distance_ptr.is_null() {
        return std::ptr::null_mut();
    }

    let dims_slice = unsafe { std::slice::from_raw_parts(dims_ptr, 3) };
    let bounds_slice = unsafe { std::slice::from_raw_parts(bounds_ptr, 6) };

    let dims = [dims_slice[0] as usize, dims_slice[1] as usize, dims_slice[2] as usize];
    let bounds = Bounds {
        min: [bounds_slice[0] as usize, bounds_slice[1] as usize, bounds_slice[2] as usize],
        max: [bounds_slice[3] as usize, bounds_slice[4] as usize, bounds_slice[5] as usize],
    };

    let total_cells = dims[0] * dims[1] * dims[2];
    let distance_field = unsafe { std::slice::from_raw_parts(distance_ptr, total_cells) };
    let color_field = unsafe { std::slice::from_raw_parts(color_ptr, total_cells * 3) };
    let material_field = unsafe { std::slice::from_raw_parts(material_ptr, total_cells * 3) };

    let voxels = VoxelGrid {
        dims,
        distance_field,
        color_field,
        material_field,
    };

    let (mut vertices, mut faces, mut cols, mut mats, _normals) = compute_surface(&voxels, &bounds);

    vertices.shrink_to_fit();
    faces.shrink_to_fit();
    cols.shrink_to_fit();
    mats.shrink_to_fit();

    let result = Box::new(MeshResult {
        vertices_ptr: vertices.as_mut_ptr(),
        vertices_len: vertices.len(),
        faces_ptr: faces.as_mut_ptr(),
        faces_len: faces.len(),
        colors_ptr: cols.as_mut_ptr(),
        colors_len: cols.len(),
        materials_ptr: mats.as_mut_ptr(),
        materials_len: mats.len(),
        normals_ptr: std::ptr::null_mut(),
        normals_len: 0,
    });

    mem::forget(vertices);
    mem::forget(faces);
    mem::forget(cols);
    mem::forget(mats);

    Box::into_raw(result)
}

fn compute_cube_edges() -> [u32; 24] {
    let mut edges = [0; 24];
    let mut k = 0;
    for i in 0..8 {
        let mut j = 1;
        while j <= 4 {
            let p = i ^ j;
            if i <= p {
                edges[k] = i as u32;
                edges[k + 1] = p as u32;
                k += 2;
            }
            j <<= 1;
        }
    }
    edges
}

fn compute_edge_table(cube_edges: &[u32; 24]) -> [u32; 256] {
    let mut table = [0; 256];
    for i in 0..256 {
        let mut em = 0;
        let mut j = 0;
        while j < 24 {
            let a = (i & (1 << cube_edges[j])) != 0;
            let b = (i & (1 << cube_edges[j + 1])) != 0;
            if a != b {
                em |= 1 << (j >> 1);
            }
            j += 2;
        }
        table[i] = em;
    }
    table
}

fn compute_surface(
    voxels: &VoxelGrid,
    bounds: &Bounds,
) -> (Vec<f32>, Vec<u32>, Vec<f32>, Vec<f32>, Vec<f32>) {
    let mut vertices = Vec::new();
    let mut faces = Vec::new();
    let mut cols = Vec::new();
    let mut mats = Vec::new();
    let normals = Vec::new();

    let cube_edges = compute_cube_edges();
    let edge_table = compute_edge_table(&cube_edges);

    let rx = voxels.dims[0];
    let ry = voxels.dims[1];
    let stride_y = rx;
    let stride_z = rx * ry;

    let buf_stride_y = rx + 1;
    let buf_stride_z = (rx + 1) * (ry + 1);

    let mut buffer = vec![-1_i32; buf_stride_z * 2];
    let mut r = [1_i32, buf_stride_y as i32, buf_stride_z as i32];
    let mut nb_buf = 1;

    let min_x = bounds.min[0];
    let min_y = bounds.min[1];
    let min_z = bounds.min[2];
    let max_x = bounds.max[0];
    let max_y = bounds.max[1];
    let max_z = bounds.max[2];

    let mut grid = [0.0; 8];

    for z in min_z..max_z {
        nb_buf ^= 1;
        r[2] = -r[2];

        let nz = z * stride_z;
        let buffer_offset = nb_buf * buf_stride_z;

        buffer[buffer_offset..(buffer_offset + buf_stride_z)].fill(-1);

        for y in min_y..max_y {
            let mut n = nz + y * stride_y + min_x;
            let mut m = buffer_offset + (y + 1) * buf_stride_y + (min_x + 1);

            for x in min_x..max_x {
                let mask = read_scalar_values(voxels, n, &mut grid, &mut cols, &mut mats);
                if mask == 0 || mask == 0xff {
                    n += 1;
                    m += 1;
                    continue;
                }

                let edge_mask = edge_table[mask as usize];
                buffer[m] = (vertices.len() / 3) as i32;

                interpolate_vertices(edge_mask, &cube_edges, &grid, x, y, z, &mut vertices);
                create_face(edge_mask, mask, &buffer, &r, m, x, y, z, &mut faces);

                n += 1;
                m += 1;
            }
        }
    }

    (vertices, faces, cols, mats, normals)
}

fn read_scalar_values(
    voxels: &VoxelGrid,
    n: usize,
    grid: &mut [f32; 8],
    cols: &mut Vec<f32>,
    mats: &mut Vec<f32>,
) -> u8 {
    let rx = voxels.dims[0];
    let ry = voxels.dims[1];
    let rxy = rx * ry;

    let mut mask = 0;
    let mut g = 0;

    for k in 0..2 {
        for j in 0..2 {
            for i in 0..2 {
                let id = n + i + j * rx + k * rxy;
                let p = voxels.distance_field[id];
                grid[g] = p;
                if p < 0.0 {
                    mask |= 1 << g;
                }
                g += 1;
            }
        }
    }

    if mask == 0 || mask == 0xff {
        return mask;
    }

    let mut c1 = 0.0;
    let mut c2 = 0.0;
    let mut c3 = 0.0;
    let mut m1 = 0.0;
    let mut m2 = 0.0;
    let mut m3 = 0.0;
    let mut inv_sum = 0.0;

    g = 0;
    for k in 0..2 {
        for j in 0..2 {
            for i in 0..2 {
                let id = n + i + j * rx + k * rxy;
                let p = grid[g];
                g += 1;

                if p != f32::INFINITY {
                    let mut weight = 1.0 / p.abs();
                    if weight > 1e15 {
                        weight = 1e15;
                    }
                    inv_sum += weight;

                    let id3 = id * 3;
                    c1 += voxels.color_field[id3] * weight;
                    c2 += voxels.color_field[id3 + 1] * weight;
                    c3 += voxels.color_field[id3 + 2] * weight;
                    m1 += voxels.material_field[id3] * weight;
                    m2 += voxels.material_field[id3 + 1] * weight;
                    m3 += voxels.material_field[id3 + 2] * weight;
                }
            }
        }
    }

    if inv_sum > 0.0 {
        inv_sum = 1.0 / inv_sum;
    }

    cols.push(c1 * inv_sum);
    cols.push(c2 * inv_sum);
    cols.push(c3 * inv_sum);

    mats.push(m1 * inv_sum);
    mats.push(m2 * inv_sum);
    mats.push(m3 * inv_sum);

    mask
}

fn interpolate_vertices(
    edge_mask: u32,
    cube_edges: &[u32; 24],
    grid: &[f32; 8],
    x_pos: usize,
    y_pos: usize,
    z_pos: usize,
    vertices: &mut Vec<f32>,
) {
    let mut v_temp = [0.0; 3];
    let mut edge_count = 0;

    for i in 0..12 {
        if (edge_mask & (1 << i)) == 0 {
            continue;
        }
        edge_count += 1;

        let e0 = cube_edges[i << 1] as usize;
        let e1 = cube_edges[(i << 1) + 1] as usize;
        let g0 = grid[e0];
        let t = g0 - grid[e1];

        let mut weight = 0.5;
        if t.abs() > 1e-7 && !t.is_nan() {
            weight = g0 / t;
        }

        for j in 0..3 {
            let k = 1 << j;
            let a = (e0 & k) != 0;
            let b = (e1 & k) != 0;

            if a != b {
                v_temp[j] += if a { 1.0 - weight } else { weight };
            } else {
                v_temp[j] += if a { 1.0 } else { 0.0 };
            }
        }
    }

    let s = 1.0 / edge_count as f32;
    vertices.push(x_pos as f32 + s * v_temp[0]);
    vertices.push(y_pos as f32 + s * v_temp[1]);
    vertices.push(z_pos as f32 + s * v_temp[2]);
}

fn create_face(
    edge_mask: u32,
    mask: u8,
    buffer: &[i32],
    r_strides: &[i32; 3],
    m: usize,
    x: usize,
    y: usize,
    z: usize,
    faces: &mut Vec<u32>,
) {
    for i in 0..3 {
        if (edge_mask & (1 << i)) == 0 {
            continue;
        }

        let iu = (i + 1) % 3;
        let iv = (i + 2) % 3;

        let x_uv = [x, y, z];
        if x_uv[iu] == 0 || x_uv[iv] == 0 {
            continue;
        }

        let du = r_strides[iu] as isize;
        let dv = r_strides[iv] as isize;

        let i1;
        let i2;
        let i3;
        let i4;

        if (mask & 1) != 0 {
            i1 = buffer[m];
            i2 = buffer[(m as isize - du) as usize];
            i3 = buffer[(m as isize - du - dv) as usize];
            i4 = buffer[(m as isize - dv) as usize];
        } else {
            i1 = buffer[m];
            i2 = buffer[(m as isize - dv) as usize];
            i3 = buffer[(m as isize - du - dv) as usize];
            i4 = buffer[(m as isize - du) as usize];
        }

        if i1 >= 0 && i2 >= 0 && i3 >= 0 && i4 >= 0 {
            faces.push(i1 as u32);
            faces.push(i2 as u32);
            faces.push(i3 as u32);
            faces.push(i4 as u32);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn free_mesh_result(ptr: *mut MeshResult) {
    if ptr.is_null() { return; }
    unsafe {
        let mesh = Box::from_raw(ptr);
        if !mesh.vertices_ptr.is_null() {
            let _v = Vec::from_raw_parts(mesh.vertices_ptr, mesh.vertices_len, mesh.vertices_len);
        }
        if !mesh.faces_ptr.is_null() {
            let _v = Vec::from_raw_parts(mesh.faces_ptr, mesh.faces_len, mesh.faces_len);
        }
        if !mesh.colors_ptr.is_null() {
            let _v = Vec::from_raw_parts(mesh.colors_ptr, mesh.colors_len, mesh.colors_len);
        }
        if !mesh.materials_ptr.is_null() {
            let _v = Vec::from_raw_parts(mesh.materials_ptr, mesh.materials_len, mesh.materials_len);
        }
        if !mesh.normals_ptr.is_null() {
            let _v = Vec::from_raw_parts(mesh.normals_ptr, mesh.normals_len, mesh.normals_len);
        }
    }
}
