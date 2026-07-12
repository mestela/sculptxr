use crate::field::BoundaryConstraint;
use crate::hierarchy::HierarchyLevel;
use crate::meshio::Vec3;
use crate::rotational_symmetry::rotate_vector_into_plane;
use crate::topology::{DirectedEdges, TriMesh, INVALID};
use std::collections::VecDeque;

/// How many vertex rings outward from a group seam also get aligned. Instant Meshes'
/// guidance is a *soft* field constraint, so constraining only the seam-edge vertices
/// barely survives the field smoothing. Constraining a band around the seam (with the
/// seam's own tangent, at a decaying weight) makes the alignment coherent enough to be
/// visible. 0 = old behaviour (seam edge only).
const SEAM_BAND_RINGS: usize = 2;

pub fn build_boundary_constraints(
    mesh: &TriMesh,
    dedges: &DirectedEdges,
    normals: &[Vec3],
) -> Vec<Option<BoundaryConstraint>> {
    let mut constraints = vec![None; mesh.vertices.len()];
    for edge in 0..dedges.e2e.len() {
        if dedges.e2e[edge] != INVALID {
            continue;
        }
        let face = mesh.faces[edge / 3];
        let i0 = face[edge % 3];
        let i1 = face[(edge + 1) % 3];
        let direction = mesh.vertices[i1] - mesh.vertices[i0];
        if direction.length_squared() <= 1e-12 {
            continue;
        }
        let tangent0 = (direction - normals[i0] * normals[i0].dot(direction)).normalize();
        let tangent1 = (direction - normals[i1] * normals[i1].dot(direction)).normalize();
        constraints[i0] = Some(BoundaryConstraint {
            origin: mesh.vertices[i0],
            tangent: tangent0,
            weight: 1.0,
        });
        constraints[i1] = Some(BoundaryConstraint {
            origin: mesh.vertices[i1],
            tangent: tangent1,
            weight: 1.0,
        });
    }
    constraints
}

/// Overlays group-seam constraints onto an existing constraint buffer.
///
/// Fires on interior edges whose two adjacent faces belong to different groups
/// and aligns the field *along* the seam, so the extracted quad loops follow the
/// group border. This is the ZRemesher/Exoside "keep polygroups" behaviour, using
/// the same per-vertex constraint machinery the open-boundary path already uses.
///
/// Existing (open-boundary) constraints are left untouched — seams only fill
/// vertices that are otherwise unconstrained.
pub fn build_group_seam_constraints(
    mesh: &TriMesh,
    dedges: &DirectedEdges,
    normals: &[Vec3],
    groups: &[u32],
    weight: f64,
    out: &mut [Option<BoundaryConstraint>],
) {
    for edge in 0..dedges.e2e.len() {
        let opposite = dedges.e2e[edge];
        // Skip open/non-manifold edges (handled by build_boundary_constraints),
        // and visit each interior edge only once.
        if opposite == INVALID || edge > opposite {
            continue;
        }
        if groups[edge / 3] == groups[opposite / 3] {
            continue; // same group on both sides -> not a seam
        }
        let face = mesh.faces[edge / 3];
        let i0 = face[edge % 3];
        let i1 = face[(edge + 1) % 3];
        let direction = mesh.vertices[i1] - mesh.vertices[i0];
        if direction.length_squared() <= 1e-12 {
            continue;
        }
        let tangent0 = (direction - normals[i0] * normals[i0].dot(direction)).normalize();
        let tangent1 = (direction - normals[i1] * normals[i1].dot(direction)).normalize();
        if out[i0].is_none() {
            out[i0] = Some(BoundaryConstraint {
                origin: mesh.vertices[i0],
                tangent: tangent0,
                weight,
            });
        }
        if out[i1].is_none() {
            out[i1] = Some(BoundaryConstraint {
                origin: mesh.vertices[i1],
                tangent: tangent1,
                weight,
            });
        }
    }

    if SEAM_BAND_RINGS > 0 {
        widen_seam_band(mesh, normals, weight, out);
    }
}

/// Propagate the seam alignment outward `SEAM_BAND_RINGS` vertex rings. Each ring
/// inherits the seam tangent of the vertex it was reached from (re-projected onto its
/// own normal) at a linearly-decaying weight, and never overwrites an existing (seam or
/// open-boundary) constraint. This widens the aligned zone so the soft field constraint
/// produces a visible flow along the group border instead of washing out.
fn widen_seam_band(
    mesh: &TriMesh,
    normals: &[Vec3],
    weight: f64,
    out: &mut [Option<BoundaryConstraint>],
) {
    // Vertex 1-ring adjacency from the triangle list.
    let mut adjacency: Vec<Vec<usize>> = vec![Vec::new(); mesh.vertices.len()];
    for face in &mesh.faces {
        for k in 0..3 {
            let a = face[k];
            let b = face[(k + 1) % 3];
            adjacency[a].push(b);
            adjacency[b].push(a);
        }
    }

    // BFS seeds = the seam-edge vertices constrained above. Carry the seam tangent so
    // band vertices align to the border direction (not toward it).
    let mut queue: VecDeque<(usize, usize, Vec3)> = VecDeque::new();
    for (v, c) in out.iter().enumerate() {
        if let Some(c) = c {
            queue.push_back((v, 0, c.tangent));
        }
    }

    while let Some((v, ring, tangent)) = queue.pop_front() {
        if ring >= SEAM_BAND_RINGS {
            continue;
        }
        for &n in &adjacency[v] {
            if out[n].is_some() {
                continue; // don't clobber seam / open-boundary constraints
            }
            let t = tangent - normals[n] * normals[n].dot(tangent);
            if t.length_squared() <= 1e-12 {
                continue;
            }
            let t = t.normalize();
            // Linear falloff: ring 1 gets ~2/3 weight (RINGS=2), ring 2 ~1/3.
            let ring_weight = weight * (1.0 - (ring + 1) as f64 / (SEAM_BAND_RINGS + 1) as f64);
            out[n] = Some(BoundaryConstraint {
                origin: mesh.vertices[n],
                tangent: t,
                weight: ring_weight,
            });
            queue.push_back((n, ring + 1, t));
        }
    }
}

pub fn build_boundary_hierarchy(
    levels: &[HierarchyLevel],
    fine_boundary: Vec<Option<BoundaryConstraint>>,
) -> Vec<Vec<Option<BoundaryConstraint>>> {
    let mut hierarchy = Vec::with_capacity(levels.len());
    hierarchy.push(fine_boundary);
    for level_idx in 0..levels.len().saturating_sub(1) {
        let fine = &levels[level_idx];
        let coarse = &levels[level_idx + 1];
        let to_coarser = fine.to_coarser.as_ref().unwrap();
        let mut origins = vec![Vec3::ZERO; coarse.positions.len()];
        let mut tangents = vec![Vec3::ZERO; coarse.positions.len()];
        let mut weights = vec![0.0; coarse.positions.len()];
        for (i, constraint) in hierarchy[level_idx].iter().enumerate() {
            let Some(constraint) = constraint else {
                continue;
            };
            let parent = to_coarser[i];
            let weight = fine.areas[i].max(1e-12) * constraint.weight.max(1e-12);
            origins[parent] += constraint.origin * weight;
            tangents[parent] += rotate_vector_into_plane(
                constraint.tangent,
                fine.normals[i],
                coarse.normals[parent],
            ) * weight;
            weights[parent] += weight;
        }

        let mut coarse_boundary = vec![None; coarse.positions.len()];
        for i in 0..coarse.positions.len() {
            if weights[i] == 0.0 {
                continue;
            }
            let normal = coarse.normals[i];
            let position = coarse.positions[i];
            let mut origin = origins[i] / weights[i];
            origin -= normal * normal.dot(origin - position);
            let mut tangent = tangents[i];
            tangent -= normal * normal.dot(tangent);
            if tangent.length_squared() <= 1e-12 {
                continue;
            }
            coarse_boundary[i] = Some(BoundaryConstraint {
                origin,
                tangent: tangent.normalize(),
                weight: 1.0,
            });
        }
        hierarchy.push(coarse_boundary);
    }
    hierarchy
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::topology::build_directed_edges;

    fn two_triangles(groups: Vec<u32>) -> TriMesh {
        // Two triangles sharing the interior edge {0, 2}.
        TriMesh {
            vertices: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(1.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            faces: vec![[0, 1, 2], [0, 2, 3]],
            groups,
        }
    }

    #[test]
    fn seam_constrains_shared_edge_between_groups() {
        let mesh = two_triangles(vec![0, 1]);
        let dedges = build_directed_edges(&mesh);
        let normals = vec![Vec3::new(0.0, 0.0, 1.0); mesh.vertices.len()];
        let mut out = vec![None; mesh.vertices.len()];
        build_group_seam_constraints(&mesh, &dedges, &normals, &mesh.groups, 1.0, &mut out);

        // The shared-edge endpoints (0 and 2) are constrained at full weight.
        assert!(out[0].is_some());
        assert!(out[2].is_some());
        assert_eq!(out[0].as_ref().unwrap().weight, 1.0);
        assert_eq!(out[2].as_ref().unwrap().weight, 1.0);

        // The constraint tangent runs along the seam edge (0 <-> 2).
        let along = (mesh.vertices[2] - mesh.vertices[0]).normalize();
        assert!(out[0].as_ref().unwrap().tangent.dot(along).abs() > 0.99);

        // With SEAM_BAND_RINGS > 0 the off-seam ring vertices (1, 3) also get a
        // constraint, but at a lower (decayed) weight than the seam itself.
        if SEAM_BAND_RINGS > 0 {
            assert!(out[1].is_some());
            assert!(out[3].is_some());
            assert!(out[1].as_ref().unwrap().weight < 1.0);
        } else {
            assert!(out[1].is_none());
            assert!(out[3].is_none());
        }
    }

    #[test]
    fn no_seam_when_faces_share_a_group() {
        let mesh = two_triangles(vec![0, 0]);
        let dedges = build_directed_edges(&mesh);
        let normals = vec![Vec3::new(0.0, 0.0, 1.0); mesh.vertices.len()];
        let mut out = vec![None; mesh.vertices.len()];
        build_group_seam_constraints(&mesh, &dedges, &normals, &mesh.groups, 1.0, &mut out);
        assert!(out.iter().all(Option::is_none));
    }

    #[test]
    fn seam_does_not_clobber_existing_boundary_constraint() {
        let mesh = two_triangles(vec![0, 1]);
        let dedges = build_directed_edges(&mesh);
        let normals = vec![Vec3::new(0.0, 0.0, 1.0); mesh.vertices.len()];
        let mut out = vec![None; mesh.vertices.len()];
        // Pretend vertex 0 already has a hard open-boundary constraint.
        let sentinel = BoundaryConstraint {
            origin: mesh.vertices[0],
            tangent: Vec3::new(0.0, 1.0, 0.0),
            weight: 1.0,
        };
        out[0] = Some(sentinel.clone());
        build_group_seam_constraints(&mesh, &dedges, &normals, &mesh.groups, 0.5, &mut out);
        // The pre-existing boundary constraint is preserved untouched.
        assert_eq!(out[0].as_ref().unwrap().tangent, sentinel.tangent);
        assert_eq!(out[0].as_ref().unwrap().weight, 1.0);
    }
}
