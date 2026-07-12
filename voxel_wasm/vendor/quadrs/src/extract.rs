use crate::meshio::Vec3;
use std::collections::{HashMap, HashSet};

const EPS: f64 = 1e-12;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TaggedLink {
    pub id: usize,
    pub flag: u8,
}

impl TaggedLink {
    pub fn new(id: usize) -> Self {
        Self { id, flag: 0 }
    }

    fn used(self) -> bool {
        self.flag & 1 != 0
    }

    fn mark_used(&mut self) {
        self.flag |= 1;
    }
}

#[derive(Clone)]
pub struct EmbeddedGraph {
    pub positions: Vec<Vec3>,
    pub normals: Vec<Vec3>,
    pub adjacency: Vec<Vec<TaggedLink>>,
    pub crease: HashSet<usize>,
}

#[derive(Default)]
pub struct CleanupStats {
    pub removed_vertices: usize,
    pub snapped_vertices: usize,
    pub removed_edges: usize,
}

#[derive(Default)]
#[cfg_attr(not(test), allow(dead_code))]
pub struct ExtractionStats {
    pub extracted_faces: usize,
    pub filled_holes: usize,
    pub degree_histogram: HashMap<usize, usize>,
}

#[cfg_attr(not(test), allow(dead_code))]
pub struct ExtractedMesh {
    pub positions: Vec<Vec3>,
    pub quads: Vec<[usize; 4]>,
    pub stats: ExtractionStats,
}

impl EmbeddedGraph {
    pub fn cleanup(
        &mut self,
        collapse_counts: Option<&[usize]>,
        scale: f64,
        posy: usize,
    ) -> CleanupStats {
        let mut stats = CleanupStats::default();
        if let Some(counts) = collapse_counts {
            stats.removed_vertices = self.remove_spurious_vertices(counts);
        }
        let (snapped_vertices, removed_edges) = self.snap_and_remove_unnecessary_edges(scale, posy);
        stats.snapped_vertices = snapped_vertices;
        stats.removed_edges = removed_edges;
        self.compact();
        stats
    }

    pub fn orient_edges(&mut self) {
        for i in 0..self.positions.len() {
            let normal = self.normals[i];
            let (s, t) = coordinate_system(normal);
            let origin = self.positions[i];
            self.adjacency[i].sort_by(|lhs, rhs| {
                let vl = self.positions[lhs.id] - origin;
                let vr = self.positions[rhs.id] - origin;
                let al = t.dot(vl).atan2(s.dot(vl));
                let ar = t.dot(vr).atan2(s.dot(vr));
                ar.total_cmp(&al)
            });
        }
    }

    pub fn extract_pure_quad_mesh(&self, posy: usize, fill_holes: bool) -> ExtractedMesh {
        let mut adjacency = self.adjacency.clone();
        let mut stats = ExtractionStats::default();
        let mut regular_faces = Vec::<[usize; 4]>::new();
        let mut irregular_cycles = Vec::<Vec<usize>>::new();
        let n_old = adjacency.len();

        for degree in 3..=8 {
            for i in 0..n_old {
                for j in 0..adjacency[i].len() {
                    let Some(cycle) = extract_cycle(&mut adjacency, i, j, Some(degree)) else {
                        continue;
                    };
                    *stats.degree_histogram.entry(cycle.len()).or_insert(0) += 1;
                    fill_cycle(
                        cycle,
                        &self.positions,
                        posy,
                        &mut regular_faces,
                        &mut irregular_cycles,
                    );
                    stats.extracted_faces += 1;
                }
            }
        }

        if fill_holes {
            tag_boundary_hole_edges(&mut adjacency);
            for i in 0..n_old {
                adjacency[i].retain(|link| link.flag & 2 != 0);
            }
            for i in 0..n_old {
                for j in 0..adjacency[i].len() {
                    let Some(cycle) = extract_cycle(&mut adjacency, i, j, None) else {
                        continue;
                    };
                    if cycle.len() > 7 {
                        continue;
                    }
                    *stats.degree_histogram.entry(cycle.len()).or_insert(0) += 1;
                    fill_cycle(
                        cycle,
                        &self.positions,
                        posy,
                        &mut regular_faces,
                        &mut irregular_cycles,
                    );
                    stats.filled_holes += 1;
                }
            }
        }

        let mut positions = self.positions.clone();
        let mut normals = self.normals.clone();
        let mut crease = self.crease.clone();
        let quads = regular_subdivide_to_quads(
            &mut positions,
            &mut normals,
            &mut crease,
            &regular_faces,
            &irregular_cycles,
        );

        ExtractedMesh {
            positions,
            quads,
            stats,
        }
    }

    fn remove_spurious_vertices(&mut self, collapse_counts: &[usize]) -> usize {
        let mut active = 0usize;
        let mut total = 0usize;
        for (i, neighbors) in self.adjacency.iter().enumerate() {
            if neighbors.is_empty() {
                continue;
            }
            total += collapse_counts.get(i).copied().unwrap_or(0);
            active += 1;
        }
        let threshold = if active == 0 {
            0.0
        } else {
            total as f64 / active as f64 / 10.0
        };
        let mut removed = 0;
        for i in 0..self.adjacency.len() {
            if self.adjacency[i].is_empty() {
                continue;
            }
            if collapse_counts.get(i).copied().unwrap_or(0) as f64 > threshold {
                continue;
            }
            let neighbors: Vec<_> = self.adjacency[i].iter().map(|link| link.id).collect();
            for neighbor in neighbors {
                remove_edge(&mut self.adjacency, neighbor, i);
            }
            self.adjacency[i].clear();
            self.crease.remove(&i);
            removed += 1;
        }
        removed
    }

    fn snap_and_remove_unnecessary_edges(&mut self, scale: f64, posy: usize) -> (usize, usize) {
        let mut snapped_vertices = 0;
        let mut removed_edges = 0;
        let mut changed = true;

        while changed {
            changed = false;
            let mut changed_inner = true;
            while changed_inner {
                changed_inner = false;
                let threshold = 0.3 * scale;
                let mut candidates = Vec::new();

                for i in 0..self.adjacency.len() {
                    for link in &self.adjacency[i] {
                        let j = link.id;
                        let p_i = self.positions[i];
                        let p_j = self.positions[j];
                        for next in &self.adjacency[j] {
                            let k = next.id;
                            if k == i {
                                continue;
                            }
                            let p_k = self.positions[k];
                            let a = (p_j - p_k).length();
                            let b = (p_i - p_j).length();
                            let c = (p_i - p_k).length();
                            if a <= b.max(c) {
                                continue;
                            }
                            let Some(height) = triangle_height(a, b, c) else {
                                continue;
                            };
                            if height < threshold {
                                candidates.push((height, i, j, k));
                            }
                        }
                    }
                }

                candidates.sort_by(|lhs, rhs| lhs.0.total_cmp(&rhs.0));

                for (expected_height, i, j, k) in candidates {
                    if !has_edge(&self.adjacency, i, j) || !has_edge(&self.adjacency, j, k) {
                        continue;
                    }
                    let p_i = self.positions[i];
                    let p_j = self.positions[j];
                    let p_k = self.positions[k];
                    let a = (p_j - p_k).length();
                    let b = (p_i - p_j).length();
                    let c = (p_i - p_k).length();
                    let Some(height) = triangle_height(a, b, c) else {
                        continue;
                    };
                    if (height - expected_height).abs() > EPS {
                        continue;
                    }

                    if b < threshold || c < threshold {
                        let merge = if b < threshold { j } else { k };
                        self.merge_vertex_into(i, merge);
                    } else {
                        self.positions[i] = (p_j + p_k) * 0.5;
                        self.normals[i] =
                            normalize_or(self.normals[j] + self.normals[k], self.normals[i]);
                        if self.crease.contains(&j) && self.crease.contains(&k) {
                            self.crease.insert(i);
                        }
                        remove_edge(&mut self.adjacency, j, k);
                        if !has_edge(&self.adjacency, i, k) {
                            add_edge(&mut self.adjacency, i, k);
                        }
                    }

                    changed = true;
                    changed_inner = true;
                    snapped_vertices += 1;
                }
            }

            if posy != 4 {
                continue;
            }

            let mut candidates = Vec::new();
            for i in 0..self.adjacency.len() {
                for link in &self.adjacency[i] {
                    let j = link.id;
                    if i >= j {
                        continue;
                    }
                    let shared = shared_neighbors(&self.adjacency, i, j);
                    if shared.len() != 2 {
                        continue;
                    }
                    let length = shared
                        .iter()
                        .map(|&k| {
                            (self.positions[k] - self.positions[i]).length()
                                + (self.positions[k] - self.positions[j]).length()
                        })
                        .sum::<f64>();
                    let expected = length * std::f64::consts::SQRT_2 / 4.0;
                    let diag = (self.positions[i] - self.positions[j]).length();
                    let score = ((diag - expected) / diag.min(expected)).abs();
                    candidates.push((score, i, j));
                }
            }
            candidates.sort_by(|lhs, rhs| lhs.0.total_cmp(&rhs.0));
            for (_, i, j) in candidates {
                if shared_neighbors(&self.adjacency, i, j).len() != 2 {
                    continue;
                }
                if remove_edge(&mut self.adjacency, i, j) {
                    changed = true;
                    removed_edges += 1;
                }
            }
        }

        (snapped_vertices, removed_edges)
    }

    fn merge_vertex_into(&mut self, target: usize, merge: usize) {
        self.positions[target] = (self.positions[target] + self.positions[merge]) * 0.5;
        self.normals[target] = normalize_or(
            self.normals[target] + self.normals[merge],
            self.normals[target],
        );
        let mut neighbors = HashSet::new();
        for link in &self.adjacency[target] {
            neighbors.insert(link.id);
        }
        let merge_neighbors: Vec<_> = self.adjacency[merge].iter().map(|link| link.id).collect();
        for neighbor in merge_neighbors {
            if neighbor == target {
                continue;
            }
            neighbors.insert(neighbor);
            replace_neighbor(&mut self.adjacency[neighbor], merge, target);
        }
        neighbors.remove(&target);
        neighbors.remove(&merge);
        self.adjacency[target] = neighbors.into_iter().map(TaggedLink::new).collect();
        self.adjacency[merge].clear();
        if self.crease.remove(&merge) {
            self.crease.insert(target);
        }
    }

    fn compact(&mut self) {
        let mut remap = vec![usize::MAX; self.positions.len()];
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        for i in 0..self.adjacency.len() {
            if self.adjacency[i].is_empty() {
                continue;
            }
            remap[i] = positions.len();
            positions.push(self.positions[i]);
            normals.push(self.normals[i]);
        }

        let mut adjacency = vec![Vec::new(); positions.len()];
        for i in 0..self.adjacency.len() {
            let mapped = remap[i];
            if mapped == usize::MAX {
                continue;
            }
            let mut unique = HashSet::new();
            for link in &self.adjacency[i] {
                let neighbor = remap[link.id];
                if neighbor == usize::MAX || neighbor == mapped || !unique.insert(neighbor) {
                    continue;
                }
                adjacency[mapped].push(TaggedLink::new(neighbor));
            }
        }

        let crease = self
            .crease
            .iter()
            .filter_map(|&index| (remap[index] != usize::MAX).then_some(remap[index]))
            .collect();
        self.positions = positions;
        self.normals = normals;
        self.adjacency = adjacency;
        self.crease = crease;
    }
}

fn extract_cycle(
    adjacency: &mut [Vec<TaggedLink>],
    start: usize,
    start_idx: usize,
    target_size: Option<usize>,
) -> Option<Vec<usize>> {
    let mut current = start;
    let mut current_idx = start_idx;
    let mut cycle = Vec::new();

    loop {
        if current_idx >= adjacency[current].len() || adjacency[current][current_idx].used() {
            return None;
        }
        if let Some(limit) = target_size {
            if cycle.len() + 1 > limit {
                return None;
            }
        }

        cycle.push(current);
        let next = adjacency[current][current_idx].id;
        let next_idx = adjacency[next].iter().position(|link| link.id == current)?;
        if adjacency[next].len() == 1 {
            return None;
        }
        current = next;
        current_idx = (next_idx + 1) % adjacency[next].len();
        if current == start {
            break;
        }
    }

    if let Some(limit) = target_size {
        if cycle.len() != limit {
            return None;
        }
    }

    current = start;
    current_idx = start_idx;
    loop {
        adjacency[current][current_idx].mark_used();
        let next = adjacency[current][current_idx].id;
        let next_idx = adjacency[next]
            .iter()
            .position(|link| link.id == current)
            .expect("cycle edge missing");
        current = next;
        current_idx = (next_idx + 1) % adjacency[next].len();
        if current == start {
            break;
        }
    }

    Some(cycle)
}

fn fill_cycle(
    mut cycle: Vec<usize>,
    positions: &[Vec3],
    posy: usize,
    regular_faces: &mut Vec<[usize; 4]>,
    irregular_cycles: &mut Vec<Vec<usize>>,
) {
    while cycle.len() > 2 {
        if cycle.len() == posy {
            regular_faces.push([cycle[0], cycle[1], cycle[2], cycle[3]]);
            break;
        }
        if cycle.len() > posy + 1 {
            let mut best_idx = 0usize;
            let mut best_score = f64::INFINITY;
            for i in 0..cycle.len() {
                let mut score = 0.0;
                for k in 0..posy {
                    let i0 = cycle[(i + k) % cycle.len()];
                    let i1 = cycle[(i + k + 1) % cycle.len()];
                    let i2 = cycle[(i + k + 2) % cycle.len()];
                    score += angle_error(positions[i0], positions[i1], positions[i2], 90.0);
                }
                if score < best_score {
                    best_score = score;
                    best_idx = i;
                }
            }
            regular_faces.push([
                cycle[best_idx % cycle.len()],
                cycle[(best_idx + 1) % cycle.len()],
                cycle[(best_idx + 2) % cycle.len()],
                cycle[(best_idx + 3) % cycle.len()],
            ]);
            let len = cycle.len();
            cycle = cycle
                .into_iter()
                .enumerate()
                .filter_map(|(index, vertex)| {
                    let offset = (index + len - best_idx) % len;
                    (!(offset == 1 || offset == 2)).then_some(vertex)
                })
                .collect();
            continue;
        }
        irregular_cycles.push(cycle);
        break;
    }
}

fn angle_error(v0: Vec3, v1: Vec3, v2: Vec3, target_deg: f64) -> f64 {
    let d0 = normalize_or(v0 - v1, Vec3::new(1.0, 0.0, 0.0));
    let d1 = normalize_or(v2 - v1, Vec3::new(0.0, 1.0, 0.0));
    let cosine = d0.dot(d1).clamp(-1.0, 1.0);
    (cosine.acos().to_degrees() - target_deg).abs()
}

fn tag_boundary_hole_edges(adjacency: &mut [Vec<TaggedLink>]) {
    for i in 0..adjacency.len() {
        for j in 0..adjacency[i].len() {
            if adjacency[i][j].used() {
                continue;
            }
            let neighbor = adjacency[i][j].id;
            if let Some(k) = adjacency[neighbor].iter().position(|link| link.id == i) {
                if adjacency[neighbor][k].used() {
                    adjacency[i][j].flag |= 2;
                    adjacency[neighbor][k].flag |= 2;
                }
            }
        }
    }
}

fn regular_subdivide_to_quads(
    positions: &mut Vec<Vec3>,
    normals: &mut Vec<Vec3>,
    crease: &mut HashSet<usize>,
    regular_faces: &[[usize; 4]],
    irregular_cycles: &[Vec<usize>],
) -> Vec<[usize; 4]> {
    let mut quads = Vec::new();
    let mut edge_centers = HashMap::<(usize, usize), usize>::new();

    for &face in regular_faces {
        let face_center = append_vertex(
            positions,
            normals,
            average_position(positions, &face),
            average_normal(normals, &face),
        );
        if face.iter().all(|index| crease.contains(index)) {
            crease.insert(face_center);
        }
        let mids = [
            edge_center(
                edge_centers
                    .entry(edge_key(face[0], face[1]))
                    .or_insert_with(|| {
                        let index = append_vertex(
                            positions,
                            normals,
                            (positions[face[0]] + positions[face[1]]) * 0.5,
                            normalize_or(normals[face[0]] + normals[face[1]], normals[face[0]]),
                        );
                        if crease.contains(&face[0]) && crease.contains(&face[1]) {
                            crease.insert(index);
                        }
                        index
                    }),
            ),
            edge_center(
                edge_centers
                    .entry(edge_key(face[1], face[2]))
                    .or_insert_with(|| {
                        let index = append_vertex(
                            positions,
                            normals,
                            (positions[face[1]] + positions[face[2]]) * 0.5,
                            normalize_or(normals[face[1]] + normals[face[2]], normals[face[1]]),
                        );
                        if crease.contains(&face[1]) && crease.contains(&face[2]) {
                            crease.insert(index);
                        }
                        index
                    }),
            ),
            edge_center(
                edge_centers
                    .entry(edge_key(face[2], face[3]))
                    .or_insert_with(|| {
                        let index = append_vertex(
                            positions,
                            normals,
                            (positions[face[2]] + positions[face[3]]) * 0.5,
                            normalize_or(normals[face[2]] + normals[face[3]], normals[face[2]]),
                        );
                        if crease.contains(&face[2]) && crease.contains(&face[3]) {
                            crease.insert(index);
                        }
                        index
                    }),
            ),
            edge_center(
                edge_centers
                    .entry(edge_key(face[3], face[0]))
                    .or_insert_with(|| {
                        let index = append_vertex(
                            positions,
                            normals,
                            (positions[face[3]] + positions[face[0]]) * 0.5,
                            normalize_or(normals[face[3]] + normals[face[0]], normals[face[3]]),
                        );
                        if crease.contains(&face[3]) && crease.contains(&face[0]) {
                            crease.insert(index);
                        }
                        index
                    }),
            ),
        ];
        quads.push([mids[0], face[1], mids[1], face_center]);
        quads.push([mids[1], face[2], mids[2], face_center]);
        quads.push([mids[2], face[3], mids[3], face_center]);
        quads.push([mids[3], face[0], mids[0], face_center]);
    }

    for cycle in irregular_cycles {
        let face_center = append_vertex(
            positions,
            normals,
            average_position_slice(positions, cycle),
            average_normal_slice(normals, cycle),
        );
        let mut mids = Vec::with_capacity(cycle.len());
        for i in 0..cycle.len() {
            let a = cycle[i];
            let b = cycle[(i + 1) % cycle.len()];
            let mid = *edge_centers.entry(edge_key(a, b)).or_insert_with(|| {
                let index = append_vertex(
                    positions,
                    normals,
                    (positions[a] + positions[b]) * 0.5,
                    normalize_or(normals[a] + normals[b], normals[a]),
                );
                if crease.contains(&a) && crease.contains(&b) {
                    crease.insert(index);
                }
                index
            });
            mids.push(mid);
        }
        for i in 0..cycle.len() {
            quads.push([
                mids[i],
                cycle[(i + 1) % cycle.len()],
                mids[(i + 1) % cycle.len()],
                face_center,
            ]);
        }
    }

    quads
}

fn append_vertex(
    positions: &mut Vec<Vec3>,
    normals: &mut Vec<Vec3>,
    position: Vec3,
    normal: Vec3,
) -> usize {
    let index = positions.len();
    positions.push(position);
    normals.push(normalize_or(normal, Vec3::new(0.0, 0.0, 1.0)));
    index
}

fn average_position(positions: &[Vec3], face: &[usize; 4]) -> Vec3 {
    average_position_slice(positions, face)
}

fn average_position_slice(positions: &[Vec3], face: &[usize]) -> Vec3 {
    face.iter()
        .fold(Vec3::ZERO, |sum, &index| sum + positions[index])
        / face.len() as f64
}

fn average_normal(normals: &[Vec3], face: &[usize; 4]) -> Vec3 {
    average_normal_slice(normals, face)
}

fn average_normal_slice(normals: &[Vec3], face: &[usize]) -> Vec3 {
    normalize_or(
        face.iter()
            .fold(Vec3::ZERO, |sum, &index| sum + normals[index]),
        Vec3::new(0.0, 0.0, 1.0),
    )
}

fn edge_center(index: &mut usize) -> usize {
    *index
}

fn triangle_height(a: f64, b: f64, c: f64) -> Option<f64> {
    let s = 0.5 * (a + b + c);
    let area_sq = s * (s - a) * (s - b) * (s - c);
    (area_sq > EPS).then_some(2.0 * area_sq.sqrt() / a)
}

fn coordinate_system(normal: Vec3) -> (Vec3, Vec3) {
    let tangent = if normal.x.abs() > normal.z.abs() {
        Vec3::new(-normal.y, normal.x, 0.0)
    } else {
        Vec3::new(0.0, -normal.z, normal.y)
    };
    let s = normalize_or(tangent, Vec3::new(1.0, 0.0, 0.0));
    let t = normalize_or(normal.cross(s), Vec3::new(0.0, 1.0, 0.0));
    (s, t)
}

fn normalize_or(vector: Vec3, fallback: Vec3) -> Vec3 {
    if vector.length_squared() <= EPS {
        fallback
    } else {
        vector.normalize()
    }
}

fn edge_key(a: usize, b: usize) -> (usize, usize) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

fn has_edge(adjacency: &[Vec<TaggedLink>], a: usize, b: usize) -> bool {
    adjacency[a].iter().any(|link| link.id == b)
}

fn add_edge(adjacency: &mut [Vec<TaggedLink>], a: usize, b: usize) {
    if !has_edge(adjacency, a, b) {
        adjacency[a].push(TaggedLink::new(b));
    }
    if !has_edge(adjacency, b, a) {
        adjacency[b].push(TaggedLink::new(a));
    }
}

fn remove_edge(adjacency: &mut [Vec<TaggedLink>], a: usize, b: usize) -> bool {
    let before_a = adjacency[a].len();
    let before_b = adjacency[b].len();
    adjacency[a].retain(|link| link.id != b);
    adjacency[b].retain(|link| link.id != a);
    adjacency[a].len() != before_a || adjacency[b].len() != before_b
}

fn replace_neighbor(neighbors: &mut [TaggedLink], from: usize, to: usize) {
    for neighbor in neighbors {
        if neighbor.id == from {
            neighbor.id = to;
        }
    }
}

fn shared_neighbors(adjacency: &[Vec<TaggedLink>], a: usize, b: usize) -> Vec<usize> {
    let set_b: HashSet<_> = adjacency[b].iter().map(|link| link.id).collect();
    adjacency[a]
        .iter()
        .filter_map(|link| set_b.contains(&link.id).then_some(link.id))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit_square_graph() -> EmbeddedGraph {
        EmbeddedGraph {
            positions: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(1.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            normals: vec![Vec3::new(0.0, 0.0, 1.0); 4],
            adjacency: vec![
                vec![TaggedLink::new(1), TaggedLink::new(3)],
                vec![TaggedLink::new(2), TaggedLink::new(0)],
                vec![TaggedLink::new(3), TaggedLink::new(1)],
                vec![TaggedLink::new(0), TaggedLink::new(2)],
            ],
            crease: HashSet::new(),
        }
    }

    #[test]
    fn extracts_square_into_four_quads() {
        let mut graph = unit_square_graph();
        graph.orient_edges();
        let mesh = graph.extract_pure_quad_mesh(4, false);
        assert_eq!(mesh.quads.len(), 8);
        assert_eq!(mesh.stats.extracted_faces, 2);
    }

    #[test]
    fn triangle_cycle_becomes_three_quads() {
        let mut graph = EmbeddedGraph {
            positions: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.5, 1.0, 0.0),
            ],
            normals: vec![Vec3::new(0.0, 0.0, 1.0); 3],
            adjacency: vec![
                vec![TaggedLink::new(1), TaggedLink::new(2)],
                vec![TaggedLink::new(2), TaggedLink::new(0)],
                vec![TaggedLink::new(0), TaggedLink::new(1)],
            ],
            crease: HashSet::new(),
        };
        graph.orient_edges();
        let mesh = graph.extract_pure_quad_mesh(4, false);
        assert_eq!(mesh.quads.len(), 6);
    }
}
