use crate::field::greedy_color;
use crate::meshio::Vec3;
use crate::preprocess::Link;
use glam::IVec2;
use std::collections::HashMap;

pub const INVALID_INDEX: usize = usize::MAX;

#[derive(Clone)]
pub struct HierarchyLevel {
    pub positions: Vec<Vec3>,
    pub normals: Vec<Vec3>,
    pub areas: Vec<f64>,
    pub adjacency: Vec<Vec<Link>>,
    pub phases: Vec<Vec<usize>>,
    pub to_coarser: Option<Vec<usize>>,
}

#[derive(Clone)]
struct Entry {
    i: usize,
    j: usize,
    order: f64,
}

pub fn build_hierarchy(
    positions: &[Vec3],
    normals: &[Vec3],
    areas: &[f64],
    adjacency: &[Vec<Link>],
) -> Vec<HierarchyLevel> {
    let mut levels = vec![HierarchyLevel {
        positions: positions.to_vec(),
        normals: normals.to_vec(),
        areas: areas.to_vec(),
        adjacency: adjacency.to_vec(),
        phases: greedy_color(adjacency),
        to_coarser: None,
    }];

    loop {
        let (coarse, to_coarser) = downsample(levels.last().unwrap());
        let done = coarse.positions.len() <= 1
            || coarse.positions.len() == levels.last().unwrap().positions.len();
        let fine = levels.last_mut().unwrap();
        fine.to_coarser = Some(to_coarser);
        levels.push(coarse);
        if done {
            break;
        }
    }
    levels
}

pub fn prolong_orientations(
    coarse: &HierarchyLevel,
    fine: &HierarchyLevel,
    coarse_q: &[Vec3],
) -> Vec<Vec3> {
    fine.to_coarser
        .as_ref()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(i, &parent)| {
            let q = coarse_q[parent];
            crate::rotational_symmetry::rotate_vector_into_plane(
                q,
                coarse.normals[parent],
                fine.normals[i],
            )
        })
        .collect()
}

pub fn prolong_origins(
    _coarse: &HierarchyLevel,
    fine: &HierarchyLevel,
    coarse_o: &[Vec3],
) -> Vec<Vec3> {
    fine.to_coarser
        .as_ref()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(i, &parent)| {
            let n = fine.normals[i];
            let v = fine.positions[i];
            let mut o = coarse_o[parent];
            o -= n * n.dot(o - v);
            o
        })
        .collect()
}

fn downsample(level: &HierarchyLevel) -> (HierarchyLevel, Vec<usize>) {
    let mut entries = Vec::new();
    for i in 0..level.positions.len() {
        for link in &level.adjacency[i] {
            if link.id <= i {
                continue;
            }
            let ratio = if level.areas[i] > level.areas[link.id] {
                level.areas[i] / level.areas[link.id].max(1e-12)
            } else {
                level.areas[link.id] / level.areas[i].max(1e-12)
            };
            entries.push(Entry {
                i,
                j: link.id,
                order: level.normals[i].dot(level.normals[link.id]) * ratio,
            });
        }
    }
    entries.sort_by(|lhs, rhs| rhs.order.total_cmp(&lhs.order));

    let mut merged = vec![false; level.positions.len()];
    let mut from_coarser = Vec::new();
    for entry in entries {
        if merged[entry.i] || merged[entry.j] {
            continue;
        }
        merged[entry.i] = true;
        merged[entry.j] = true;
        from_coarser.push([entry.i, entry.j]);
    }
    for (i, &flag) in merged.iter().enumerate() {
        if !flag {
            from_coarser.push([i, INVALID_INDEX]);
        }
    }

    let mut to_coarser = vec![0usize; level.positions.len()];
    let mut positions = Vec::with_capacity(from_coarser.len());
    let mut normals = Vec::with_capacity(from_coarser.len());
    let mut areas = Vec::with_capacity(from_coarser.len());
    for (coarse_idx, pair) in from_coarser.iter().copied().enumerate() {
        let i = pair[0];
        let j = pair[1];
        to_coarser[i] = coarse_idx;
        if j == INVALID_INDEX {
            positions.push(level.positions[i]);
            normals.push(level.normals[i]);
            areas.push(level.areas[i]);
            continue;
        }
        to_coarser[j] = coarse_idx;
        let area = level.areas[i] + level.areas[j];
        let position = if area > 1e-12 {
            (level.positions[i] * level.areas[i] + level.positions[j] * level.areas[j]) / area
        } else {
            (level.positions[i] + level.positions[j]) * 0.5
        };
        let normal =
            (level.normals[i] * level.areas[i] + level.normals[j] * level.areas[j]).normalize();
        positions.push(position);
        normals.push(normal);
        areas.push(area);
    }

    let mut adjacency = vec![Vec::new(); positions.len()];
    for coarse_idx in 0..positions.len() {
        let pair = from_coarser[coarse_idx];
        let mut weights = HashMap::<usize, f64>::new();
        for &u in &pair {
            if u == INVALID_INDEX {
                continue;
            }
            for link in &level.adjacency[u] {
                let neighbor = to_coarser[link.id];
                if neighbor == coarse_idx {
                    continue;
                }
                *weights.entry(neighbor).or_insert(0.0) += link.weight;
            }
        }
        adjacency[coarse_idx] = weights
            .into_iter()
            .map(|(id, weight)| Link {
                id,
                weight,
                rot: [0, 0],
                shift: [IVec2::new(0, 0), IVec2::new(0, 0)],
            })
            .collect();
    }

    let phases = greedy_color(&adjacency);
    (
        HierarchyLevel {
            positions,
            normals,
            areas,
            adjacency,
            phases,
            to_coarser: None,
        },
        to_coarser,
    )
}
