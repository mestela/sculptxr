use crate::connectivity::{boundary_edges, face_edges};
use crate::geom::quad_is_valid;
use crate::meshio::{triangulate_faces, ObjMesh, Vec3};
use std::collections::{HashMap, HashSet};

const EPS: f64 = 1e-12;

pub fn vertex_count(mesh: &ObjMesh) -> usize {
    mesh.vertices.len()
}

pub fn face_count(mesh: &ObjMesh) -> usize {
    mesh.faces.len()
}

pub fn quad_face_count(mesh: &ObjMesh) -> usize {
    mesh.faces.iter().filter(|face| face.len() == 4).count()
}

pub fn non_quad_face_count(mesh: &ObjMesh) -> usize {
    mesh.faces.len().saturating_sub(quad_face_count(mesh))
}

pub fn area(mesh: &ObjMesh) -> f64 {
    triangulate_faces(&mesh.faces)
        .into_iter()
        .map(|[a, b, c]| {
            0.5 * (mesh.vertices[b] - mesh.vertices[a])
                .cross(mesh.vertices[c] - mesh.vertices[a])
                .length()
        })
        .sum()
}

pub fn abs_volume(mesh: &ObjMesh) -> f64 {
    triangulate_faces(&mesh.faces)
        .into_iter()
        .map(|[a, b, c]| mesh.vertices[a].dot(mesh.vertices[b].cross(mesh.vertices[c])) / 6.0)
        .sum::<f64>()
        .abs()
}

pub fn boundary_edge_count(mesh: &ObjMesh) -> usize {
    boundary_edges(&edge_counts(mesh)).len()
}

pub fn nonmanifold_edge_count(mesh: &ObjMesh) -> usize {
    edge_counts(mesh)
        .values()
        .filter(|&&count| count > 2)
        .count()
}

pub fn fewer_than_three_face_count(mesh: &ObjMesh) -> usize {
    mesh.faces
        .iter()
        .filter(|face| has_too_few_vertices(face))
        .count()
}

pub fn repeated_vertex_face_count(mesh: &ObjMesh) -> usize {
    mesh.faces
        .iter()
        .filter(|face| has_repeated_vertex(face))
        .count()
}

pub fn invalid_vertex_index_face_count(mesh: &ObjMesh) -> usize {
    mesh.faces
        .iter()
        .filter(|face| has_invalid_vertex_index(face, mesh.vertices.len()))
        .count()
}

pub fn invalid_quad_face_count(mesh: &ObjMesh) -> usize {
    mesh.faces
        .iter()
        .filter(|face| is_invalid_quad(face, &mesh.vertices))
        .count()
}

pub fn isolated_vertex_count(mesh: &ObjMesh) -> usize {
    vertex_neighbors(mesh)
        .iter()
        .filter(|neighbors| neighbors.is_empty())
        .count()
}

pub fn ratio(output: f64, input: f64) -> Option<f64> {
    (input.abs() > EPS).then_some(output / input)
}

fn edge_counts(mesh: &ObjMesh) -> HashMap<(usize, usize), usize> {
    let mut counts = HashMap::new();
    for face in &mesh.faces {
        for edge in face_edges(face) {
            *counts.entry(edge).or_insert(0) += 1;
        }
    }
    counts
}

fn vertex_neighbors(mesh: &ObjMesh) -> Vec<Vec<usize>> {
    let mut neighbors = vec![Vec::new(); mesh.vertices.len()];
    for face in &mesh.faces {
        for edge in face_edges(face) {
            if !neighbors[edge.0].contains(&edge.1) {
                neighbors[edge.0].push(edge.1);
            }
            if !neighbors[edge.1].contains(&edge.0) {
                neighbors[edge.1].push(edge.0);
            }
        }
    }
    neighbors
}

fn has_too_few_vertices(face: &[usize]) -> bool {
    face.len() < 3
}

fn has_repeated_vertex(face: &[usize]) -> bool {
    let distinct: HashSet<_> = face.iter().copied().collect();
    distinct.len() != face.len()
}

fn has_invalid_vertex_index(face: &[usize], vertex_count: usize) -> bool {
    face.iter().any(|&index| index >= vertex_count)
}

fn is_invalid_quad(face: &[usize], vertices: &[Vec3]) -> bool {
    face.len() == 4
        && !has_repeated_vertex(face)
        && !has_invalid_vertex_index(face, vertices.len())
        && !quad_is_valid(vertices, [face[0], face[1], face[2], face[3]])
}
