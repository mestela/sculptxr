use crate::meshio::Vec3;
use crate::topology::{
    build_directed_edges, dedge_next_3, dedge_prev_3, DirectedEdges, TriMesh, INVALID,
};
use glam::IVec2;
use std::cmp::Ordering;
use std::collections::BinaryHeap;

const EPS: f64 = 1e-12;

#[derive(Clone, Debug)]
pub struct MeshStats {
    pub average_edge_length: f64,
    pub maximum_edge_length: f64,
    pub surface_area: f64,
}

#[derive(Clone)]
pub struct Link {
    pub id: usize,
    pub weight: f64,
    pub rot: [i8; 2],
    pub shift: [IVec2; 2],
}

pub fn compute_mesh_stats(mesh: &TriMesh) -> MeshStats {
    let mut average_edge_length = 0.0;
    let mut maximum_edge_length: f64 = 0.0;
    let mut surface_area = 0.0;

    for face in &mesh.faces {
        let tri = [
            mesh.vertices[face[0]],
            mesh.vertices[face[1]],
            mesh.vertices[face[2]],
        ];
        for i in 0..3 {
            let edge_length = (tri[i] - tri[(i + 1) % 3]).length();
            average_edge_length += edge_length;
            maximum_edge_length = maximum_edge_length.max(edge_length);
        }
        let area = 0.5 * (tri[1] - tri[0]).cross(tri[2] - tri[0]).length();
        surface_area += area;
    }
    if !mesh.faces.is_empty() {
        average_edge_length /= (mesh.faces.len() * 3) as f64;
    }
    MeshStats {
        average_edge_length,
        maximum_edge_length,
        surface_area,
    }
}

pub fn compute_dual_vertex_areas(mesh: &TriMesh, dedge: &DirectedEdges) -> Vec<f64> {
    let mut areas = vec![0.0; mesh.vertices.len()];
    for vertex in 0..mesh.vertices.len() {
        let mut edge = dedge.v2e[vertex];
        let stop = edge;
        if dedge.nonmanifold[vertex] || edge == INVALID {
            continue;
        }
        loop {
            let prev = dedge_prev_3(edge);
            let next = dedge_next_3(edge);
            let v = mesh.vertices[mesh.faces[edge / 3][edge % 3]];
            let vn = mesh.vertices[mesh.faces[next / 3][next % 3]];
            let vp = mesh.vertices[mesh.faces[prev / 3][prev % 3]];
            let face_center = (v + vp + vn) / 3.0;
            let prev_mid = (v + vp) * 0.5;
            let next_mid = (v + vn) * 0.5;
            areas[vertex] += 0.5
                * ((v - prev_mid).cross(v - face_center).length()
                    + (v - next_mid).cross(v - face_center).length());
            let opposite = dedge.e2e[edge];
            if opposite == INVALID {
                break;
            }
            edge = dedge_next_3(opposite);
            if edge == stop {
                break;
            }
        }
    }
    areas
}

pub fn generate_uniform_adjacency(mesh: &TriMesh, dedge: &DirectedEdges) -> Vec<Vec<Link>> {
    let mut adjacency = vec![Vec::new(); mesh.vertices.len()];
    for vertex in 0..mesh.vertices.len() {
        let mut edge = dedge.v2e[vertex];
        let stop = edge;
        if dedge.nonmanifold[vertex] || edge == INVALID {
            continue;
        }
        let mut neighbors = Vec::new();
        let mut iteration = 0usize;
        loop {
            let base = edge % 3;
            let face = mesh.faces[edge / 3];
            let opposite = dedge.e2e[edge];
            let next = if opposite == INVALID {
                INVALID
            } else {
                dedge_next_3(opposite)
            };
            if iteration == 0 {
                neighbors.push(face[(base + 2) % 3]);
            }
            if opposite == INVALID || next != stop {
                neighbors.push(face[(base + 1) % 3]);
                if opposite == INVALID {
                    break;
                }
            }
            edge = next;
            iteration += 1;
            if edge == stop {
                break;
            }
        }
        adjacency[vertex] = neighbors
            .into_iter()
            .map(|id| Link {
                id,
                weight: 1.0,
                rot: [0, 0],
                shift: [IVec2::new(0, 0), IVec2::new(0, 0)],
            })
            .collect();
    }
    adjacency
}

pub fn generate_smooth_normals(mesh: &TriMesh) -> Vec<Vec3> {
    let mut normals = vec![Vec3::ZERO; mesh.vertices.len()];
    for face in &mesh.faces {
        let a = mesh.vertices[face[0]];
        let b = mesh.vertices[face[1]];
        let c = mesh.vertices[face[2]];
        let corners = [a, b, c];
        let normal = (b - a).cross(c - a);
        let norm = normal.length();
        if norm <= EPS {
            continue;
        }
        let face_normal = normal / norm;
        for corner in 0..3 {
            let current = corners[corner];
            let next = corners[(corner + 1) % 3];
            let prev = corners[(corner + 2) % 3];
            let d0 = next - current;
            let d1 = prev - current;
            let denom = (d0.length_squared() * d1.length_squared()).sqrt();
            if denom <= EPS {
                continue;
            }
            let angle = (d0.dot(d1) / denom).clamp(-1.0, 1.0).acos();
            if angle.is_finite() {
                normals[face[corner]] += face_normal * angle;
            }
        }
    }
    for normal in &mut normals {
        if normal.length_squared() > EPS {
            *normal = normal.normalize();
        } else {
            *normal = Vec3::new(0.0, 0.0, 1.0);
        }
    }
    normals
}

pub fn subdivide_to_max_edge(mesh: &TriMesh, max_length: f64) -> TriMesh {
    let max_length_sq = max_length * max_length;
    let mut vertices = mesh.vertices.clone();
    let mut faces = mesh.faces.clone();
    let mut groups = mesh.groups.clone();
    let mut dedge = build_directed_edges(&TriMesh::ungrouped(vertices.clone(), faces.clone()));
    let mut queue = BinaryHeap::new();

    schedule_edges(&vertices, &faces, &dedge, max_length_sq, &mut queue);

    while let Some(edge) = queue.pop() {
        let e0 = edge.id;
        if e0 >= dedge.e2e.len() {
            continue;
        }
        let f0 = e0 / 3;
        if f0 >= faces.len() {
            continue;
        }
        let e1 = dedge.e2e[e0];
        let is_boundary = e1 == INVALID;
        let v0 = faces[f0][e0 % 3];
        let v0p = faces[f0][(e0 + 2) % 3];
        let v1 = faces[f0][(e0 + 1) % 3];
        let current_length = (vertices[v0] - vertices[v1]).length_squared();
        if (current_length - edge.length_sq).abs() > 1e-15 {
            continue;
        }

        let f1 = if is_boundary { INVALID } else { e1 / 3 };
        // Capture parent groups before we append children. Splitting edge e0
        // divides original triangle f0 into (f0, f3) and f1 into (f1, f2), so
        // each child inherits its parent's group id.
        let g0 = groups[f0];
        let g1 = if is_boundary { 0 } else { groups[f1] };
        let v1p = if is_boundary {
            INVALID
        } else {
            faces[f1][(e1 + 2) % 3]
        };
        let vn = vertices.len();
        vertices.push((vertices[v0] + vertices[v1]) * 0.5);
        dedge.v2e.push(INVALID);
        dedge.boundary.push(is_boundary);
        dedge.nonmanifold.push(false);

        let f2 = if is_boundary { INVALID } else { faces.len() };
        let f3 = if is_boundary {
            faces.len()
        } else {
            faces.len() + 1
        };
        if !is_boundary {
            faces.push([0, 0, 0]);
            groups.push(g1); // f2 is a half of original f1
        }
        faces.push([0, 0, 0]);
        groups.push(g0); // f3 is a half of original f0
        dedge.e2e.resize(faces.len() * 3, INVALID);

        let e0p = dedge.e2e[dedge_prev_3(e0)];
        let e0n = dedge.e2e[dedge_next_3(e0)];

        faces[f0] = [vn, v0p, v0];
        if !is_boundary {
            faces[f1] = [vn, v0, v1p];
            faces[f2] = [vn, v1p, v1];
        }
        faces[f3] = [vn, v1, v0p];

        set_pair(&mut dedge.e2e, f0 * 3, f3 * 3 + 2);
        set_pair(&mut dedge.e2e, f0 * 3 + 1, e0p);
        set_pair(&mut dedge.e2e, f3 * 3 + 1, e0n);

        if is_boundary {
            set_pair(&mut dedge.e2e, f0 * 3 + 2, INVALID);
            set_pair(&mut dedge.e2e, f3 * 3, INVALID);
        } else {
            let e1p = dedge.e2e[dedge_prev_3(e1)];
            let e1n = dedge.e2e[dedge_next_3(e1)];
            set_pair(&mut dedge.e2e, f0 * 3 + 2, f1 * 3);
            set_pair(&mut dedge.e2e, f1 * 3 + 1, e1n);
            set_pair(&mut dedge.e2e, f1 * 3 + 2, f2 * 3);
            set_pair(&mut dedge.e2e, f2 * 3 + 1, e1p);
            set_pair(&mut dedge.e2e, f2 * 3 + 2, f3 * 3);
        }

        dedge.v2e[v0] = f0 * 3 + 2;
        dedge.v2e[vn] = f0 * 3;
        dedge.v2e[v1] = f3 * 3 + 1;
        dedge.v2e[v0p] = f0 * 3 + 1;
        if !is_boundary {
            dedge.v2e[v1p] = f1 * 3 + 2;
        }

        schedule_face(&vertices, &faces, max_length_sq, f0, &mut queue);
        if !is_boundary {
            schedule_face(&vertices, &faces, max_length_sq, f1, &mut queue);
            schedule_face(&vertices, &faces, max_length_sq, f2, &mut queue);
        }
        schedule_face(&vertices, &faces, max_length_sq, f3, &mut queue);
    }

    TriMesh {
        vertices,
        faces,
        groups,
    }
}

pub fn preprocess_mesh(mesh: &TriMesh, scale: f64) -> TriMesh {
    let mesh = compact_mesh(mesh);
    let stats = compute_mesh_stats(&mesh);
    if stats.maximum_edge_length * 2.0 > scale
        || stats.maximum_edge_length > stats.average_edge_length * 2.0
    {
        subdivide_to_max_edge(&mesh, (scale * 0.5).min(stats.average_edge_length * 2.0))
    } else {
        mesh
    }
}

fn compact_mesh(mesh: &TriMesh) -> TriMesh {
    let mut used = vec![false; mesh.vertices.len()];
    for face in &mesh.faces {
        for &index in face {
            used[index] = true;
        }
    }

    let mut remap = vec![INVALID; mesh.vertices.len()];
    let mut vertices = Vec::with_capacity(mesh.faces.len().saturating_mul(3));
    for (index, &is_used) in used.iter().enumerate() {
        if !is_used {
            continue;
        }
        remap[index] = vertices.len();
        vertices.push(mesh.vertices[index]);
    }

    let faces = mesh
        .faces
        .iter()
        .map(|face| face.map(|index| remap[index]))
        .collect();

    // Face order is preserved, so per-face groups carry over unchanged.
    TriMesh {
        vertices,
        faces,
        groups: mesh.groups.clone(),
    }
}

fn schedule_edges(
    vertices: &[Vec3],
    faces: &[[usize; 3]],
    dedge: &DirectedEdges,
    max_length_sq: f64,
    queue: &mut BinaryHeap<ScheduledEdge>,
) {
    for edge in 0..dedge.e2e.len() {
        let face = faces[edge / 3];
        let v0 = face[edge % 3];
        let v1 = face[(edge + 1) % 3];
        if dedge.nonmanifold[v0] || dedge.nonmanifold[v1] {
            continue;
        }
        let length_sq = (vertices[v0] - vertices[v1]).length_squared();
        if length_sq > max_length_sq && (dedge.e2e[edge] == INVALID || dedge.e2e[edge] > edge) {
            queue.push(ScheduledEdge {
                id: edge,
                length_sq,
            });
        }
    }
}

fn schedule_face(
    vertices: &[Vec3],
    faces: &[[usize; 3]],
    max_length_sq: f64,
    face_index: usize,
    queue: &mut BinaryHeap<ScheduledEdge>,
) {
    for corner in 0..3 {
        let face = faces[face_index];
        let length_sq = (vertices[face[corner]] - vertices[face[(corner + 1) % 3]]).length_squared();
        if length_sq > max_length_sq {
            queue.push(ScheduledEdge {
                id: face_index * 3 + corner,
                length_sq,
            });
        }
    }
}

fn set_pair(e2e: &mut [usize], a: usize, b: usize) {
    e2e[a] = b;
    if b != INVALID {
        e2e[b] = a;
    }
}

#[derive(Clone, Copy)]
struct ScheduledEdge {
    id: usize,
    length_sq: f64,
}

impl PartialEq for ScheduledEdge {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id && self.length_sq == other.length_sq
    }
}

impl Eq for ScheduledEdge {}

impl PartialOrd for ScheduledEdge {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ScheduledEdge {
    fn cmp(&self, other: &Self) -> Ordering {
        self.length_sq
            .total_cmp(&other.length_sq)
            .then_with(|| self.id.cmp(&other.id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square() -> TriMesh {
        TriMesh::ungrouped(
            vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(1.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            vec![[0, 1, 2], [0, 2, 3]],
        )
    }

    #[test]
    fn stats_match_unit_square_area() {
        let stats = compute_mesh_stats(&square());
        assert!((stats.surface_area - 1.0).abs() < 1e-9);
    }

    #[test]
    fn subdivision_splits_large_triangle() {
        let mesh = TriMesh::ungrouped(
            vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(2.0, 0.0, 0.0),
                Vec3::new(0.0, 2.0, 0.0),
            ],
            vec![[0, 1, 2]],
        );
        let subdivided = subdivide_to_max_edge(&mesh, 1.5);
        assert!(subdivided.faces.len() > mesh.faces.len());
    }

    #[test]
    fn preprocessing_drops_isolated_vertices() {
        let mesh = TriMesh::ungrouped(
            vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
                Vec3::new(9.0, 9.0, 9.0),
            ],
            vec![[0, 1, 2]],
        );
        let preprocessed = preprocess_mesh(&mesh, 10.0);
        assert_eq!(preprocessed.vertices.len(), 3);
        assert_eq!(preprocessed.faces, vec![[0, 1, 2]]);
    }
}
