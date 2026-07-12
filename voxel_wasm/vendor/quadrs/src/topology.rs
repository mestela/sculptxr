use crate::meshio::Vec3;

pub const INVALID: usize = usize::MAX;

#[derive(Clone)]
pub struct TriMesh {
    pub vertices: Vec<Vec3>,
    pub faces: Vec<[usize; 3]>,
    /// One group id per face, parallel to `faces`. Used to steer quad flow:
    /// edges straddling two different group ids become seam constraints.
    pub groups: Vec<u32>,
}

impl TriMesh {
    /// Constructs a mesh with every face in group 0 (i.e. no seams).
    pub fn ungrouped(vertices: Vec<Vec3>, faces: Vec<[usize; 3]>) -> Self {
        let groups = vec![0; faces.len()];
        Self {
            vertices,
            faces,
            groups,
        }
    }
}

#[derive(Clone)]
pub struct DirectedEdges {
    pub v2e: Vec<usize>,
    pub e2e: Vec<usize>,
    pub boundary: Vec<bool>,
    pub nonmanifold: Vec<bool>,
}

pub fn dedge_prev_3(edge: usize) -> usize {
    if edge % 3 == 0 {
        edge + 2
    } else {
        edge - 1
    }
}

pub fn dedge_next_3(edge: usize) -> usize {
    if edge % 3 == 2 {
        edge - 2
    } else {
        edge + 1
    }
}

pub fn build_directed_edges(mesh: &TriMesh) -> DirectedEdges {
    let mut v2e = vec![INVALID; mesh.vertices.len()];
    let mut next_from_vertex = vec![INVALID; mesh.faces.len() * 3];

    for (face_index, face) in mesh.faces.iter().enumerate() {
        for corner in 0..3 {
            let current = face[corner];
            let next = face[(corner + 1) % 3];
            if current == next {
                continue;
            }
            let edge_id = face_index * 3 + corner;
            next_from_vertex[edge_id] = v2e[current];
            v2e[current] = edge_id;
        }
    }

    let mut e2e = vec![INVALID; mesh.faces.len() * 3];
    let mut nonmanifold = vec![false; mesh.vertices.len()];
    for (face_index, face) in mesh.faces.iter().enumerate() {
        for corner in 0..3 {
            let current = face[corner];
            let next = face[(corner + 1) % 3];
            if current == next {
                continue;
            }
            let edge_id = face_index * 3 + corner;
            let mut candidate = v2e[next];
            let mut opposite = INVALID;
            while candidate != INVALID {
                let candidate_face = mesh.faces[candidate / 3];
                let candidate_next = candidate_face[candidate % 3];
                let candidate_to = candidate_face[(candidate % 3 + 1) % 3];
                if candidate_next == next && candidate_to == current {
                    if opposite == INVALID {
                        opposite = candidate;
                    } else {
                        nonmanifold[current] = true;
                        nonmanifold[next] = true;
                        opposite = INVALID;
                        break;
                    }
                }
                candidate = next_from_vertex[candidate];
            }
            if opposite != INVALID && edge_id < opposite {
                e2e[edge_id] = opposite;
                e2e[opposite] = edge_id;
            }
        }
    }

    let mut boundary = vec![false; mesh.vertices.len()];
    for vertex in 0..mesh.vertices.len() {
        let edge = v2e[vertex];
        if edge == INVALID || nonmanifold[vertex] {
            v2e[vertex] = INVALID;
            continue;
        }
        let mut cursor = edge;
        let start = edge;
        let mut best = edge;
        loop {
            best = best.min(cursor);
            let previous = e2e[dedge_prev_3(cursor)];
            if previous == INVALID {
                best = cursor;
                boundary[vertex] = true;
                break;
            }
            cursor = previous;
            if cursor == start {
                break;
            }
        }
        v2e[vertex] = best;
    }

    DirectedEdges {
        v2e,
        e2e,
        boundary,
        nonmanifold,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_opposites_for_two_triangles() {
        let mesh = TriMesh::ungrouped(
            vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(1.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            vec![[0, 1, 2], [0, 2, 3]],
        );
        let dedge = build_directed_edges(&mesh);
        assert_ne!(dedge.e2e[2], INVALID);
        assert_eq!(dedge.e2e[dedge.e2e[2]], 2);
    }
}
