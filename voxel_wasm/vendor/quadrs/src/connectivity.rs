use std::collections::HashMap;

pub fn face_edges(face: &[usize]) -> Vec<(usize, usize)> {
    let mut edges = Vec::with_capacity(face.len());
    for i in 0..face.len() {
        edges.push(edge_key(face[i], face[(i + 1) % face.len()]));
    }
    edges
}

pub fn boundary_edges(edge_counts: &HashMap<(usize, usize), usize>) -> Vec<(usize, usize)> {
    edge_counts
        .iter()
        .filter_map(|(&edge, &count)| (count == 1).then_some(edge))
        .collect()
}

pub fn edge_key(a: usize, b: usize) -> (usize, usize) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}
