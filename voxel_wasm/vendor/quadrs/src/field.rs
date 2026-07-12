use crate::meshio::Vec3;
use crate::preprocess::Link;
use crate::rng::{tag, Rng};
use crate::rotational_symmetry::{position_round_4, Frame, RoSy4, Sample};

const EPS: f64 = 1e-12;
const ORIENTATION_TAG: u64 = tag("field-orientation");
const ORIGIN_TAG: u64 = tag("field-origin");
const ORIGIN_Y_TAG: u64 = tag("field-origin-y");

#[derive(Clone)]
pub struct BoundaryConstraint {
    pub origin: Vec3,
    pub tangent: Vec3,
    pub weight: f64,
}

pub struct FieldState {
    pub positions: Vec<Vec3>,
    pub normals: Vec<Vec3>,
    pub orientations: Vec<Vec3>,
    pub origins: Vec<Vec3>,
    pub adjacency: Vec<Vec<Link>>,
    pub boundary: Vec<Option<BoundaryConstraint>>,
    pub scale: f64,
}

pub fn initialize_state(
    positions: Vec<Vec3>,
    normals: Vec<Vec3>,
    adjacency: Vec<Vec<Link>>,
    boundary: Vec<Option<BoundaryConstraint>>,
    scale: f64,
    rng: Rng,
) -> FieldState {
    let orientations = normals
        .iter()
        .enumerate()
        .map(|(i, normal)| init_random_tangent(*normal, rng.mix(ORIENTATION_TAG).mix(i as u64)))
        .collect();
    let origins = positions
        .iter()
        .zip(normals.iter())
        .enumerate()
        .map(|(i, (position, normal))| {
            init_random_origin(*position, *normal, scale, rng.mix(ORIGIN_TAG).mix(i as u64))
        })
        .collect();
    FieldState {
        positions,
        normals,
        orientations,
        origins,
        adjacency,
        boundary,
        scale,
    }
}

pub fn greedy_color(adjacency: &[Vec<Link>]) -> Vec<Vec<usize>> {
    let mut order = (0..adjacency.len()).collect::<Vec<_>>();
    order.sort_by_key(|&i| std::cmp::Reverse(adjacency[i].len()));
    let mut colors = vec![usize::MAX; adjacency.len()];
    let mut color_count = 0usize;
    for &vertex in &order {
        let mut forbidden = vec![false; color_count + 1];
        for neighbor in &adjacency[vertex] {
            let color = colors[neighbor.id];
            if color != usize::MAX && color < forbidden.len() {
                forbidden[color] = true;
            }
        }
        let color = forbidden
            .iter()
            .position(|&used| !used)
            .unwrap_or(color_count);
        if color == color_count {
            color_count += 1;
        }
        colors[vertex] = color;
    }
    let mut phases = vec![Vec::new(); color_count];
    for (vertex, color) in colors.into_iter().enumerate() {
        phases[color].push(vertex);
    }
    phases
}

pub fn optimize_orientations<M: RoSy4>(
    state: &mut FieldState,
    phases: &[Vec<usize>],
    iterations: usize,
) {
    for _ in 0..iterations {
        let prev = state.orientations.clone();
        for phase in phases {
            for &i in phase {
                let n_i = state.normals[i];
                let mut sum = prev[i];
                let mut lhs = Frame::new(sum, n_i);
                let mut weight_sum = 0.0;
                for link in &state.adjacency[i] {
                    if link.weight == 0.0 {
                        continue;
                    }
                    let aligned = M::match_orientation(
                        lhs,
                        Frame::new(prev[link.id], state.normals[link.id]),
                    )
                    .rhs
                    .0;
                    sum = sum * weight_sum + aligned * link.weight;
                    sum -= n_i * n_i.dot(sum);
                    weight_sum += link.weight;
                    let norm = sum.length();
                    if norm > EPS {
                        sum /= norm;
                        lhs.q = sum;
                    }
                }
                if let Some(boundary) = &state.boundary[i] {
                    let aligned = M::match_orientation(lhs, Frame::new(boundary.tangent, n_i))
                        .rhs
                        .0;
                    sum = sum * (1.0 - boundary.weight) + aligned * boundary.weight;
                    sum -= n_i * n_i.dot(sum);
                    let norm = sum.length();
                    if norm > EPS {
                        sum /= norm;
                        lhs.q = sum;
                    }
                }
                if weight_sum > 0.0 {
                    state.orientations[i] = normalize_or(sum, prev[i]);
                }
            }
        }
    }
}

pub fn optimize_positions<M: RoSy4>(
    state: &mut FieldState,
    phases: &[Vec<usize>],
    iterations: usize,
) {
    let inv_scale = 1.0 / state.scale;
    for _ in 0..iterations {
        let prev = state.origins.clone();
        for phase in phases {
            for &i in phase {
                let n_i = state.normals[i];
                let v_i = state.positions[i];
                let q_i = normalize_or(state.orientations[i], state.orientations[i]);
                let frame_i = Frame::new(q_i, n_i);
                let mut sum = prev[i];
                let mut lhs = Sample::new(v_i, sum, frame_i);
                let mut weight_sum = 0.0;
                for link in &state.adjacency[i] {
                    if link.weight == 0.0 {
                        continue;
                    }
                    let j = link.id;
                    let q_j = normalize_or(state.orientations[j], state.orientations[j]);
                    let aligned = M::match_position(
                        lhs,
                        Sample::new(
                            state.positions[j],
                            prev[j],
                            Frame::new(q_j, state.normals[j]),
                        ),
                        state.scale,
                        inv_scale,
                    )
                    .rhs
                    .0;
                    sum = (sum * weight_sum + aligned * link.weight) / (weight_sum + link.weight);
                    weight_sum += link.weight;
                    sum -= n_i * n_i.dot(sum - v_i);
                    lhs.o = sum;
                }
                if let Some(boundary) = &state.boundary[i] {
                    let mut delta = boundary.origin - sum;
                    delta -= boundary.tangent * boundary.tangent.dot(delta);
                    sum += delta * boundary.weight;
                    sum -= n_i * n_i.dot(sum - v_i);
                    lhs.o = sum;
                }
                if weight_sum > 0.0 {
                    state.origins[i] = position_round_4(sum, q_i, n_i, v_i, state.scale, inv_scale);
                }
            }
        }
    }
}

pub fn freeze_orientation_ivars<M: RoSy4>(state: &mut FieldState) {
    for i in 0..state.positions.len() {
        let q_i = normalize_or(state.orientations[i], state.orientations[i]);
        let n_i = state.normals[i];
        let lhs = Frame::new(q_i, n_i);
        for link in &mut state.adjacency[i] {
            let j = link.id;
            let q_j = normalize_or(state.orientations[j], state.orientations[j]);
            let n_j = state.normals[j];
            let m = M::match_orientation(lhs, Frame::new(q_j, n_j));
            link.rot = [m.lhs.1 as i8, m.rhs.1 as i8];
        }
    }
}

pub fn optimize_orientations_frozen(
    state: &mut FieldState,
    phases: &[Vec<usize>],
    iterations: usize,
) {
    for _ in 0..iterations {
        let prev = state.orientations.clone();
        for phase in phases {
            for &i in phase {
                let n_i = state.normals[i];
                let mut sum = Vec3::ZERO;
                let mut weight_sum = 0.0;
                for link in &state.adjacency[i] {
                    if link.weight == 0.0 {
                        continue;
                    }
                    let n_j = state.normals[link.id];
                    let temp = rotate90_by(prev[link.id], n_j, link.rot[1] as i32);
                    sum += rotate90_by(temp, -n_i, link.rot[0] as i32) * link.weight;
                    weight_sum += link.weight;
                }
                sum -= n_i * n_i.dot(sum);
                let norm = sum.length();
                if norm > EPS && weight_sum > 0.0 {
                    state.orientations[i] = sum / norm;
                }
            }
        }
    }
}

pub fn freeze_position_ivars<M: RoSy4>(state: &mut FieldState) {
    let inv_scale = 1.0 / state.scale;
    for i in 0..state.positions.len() {
        let n_i = state.normals[i];
        let v_i = state.positions[i];
        let q_i = normalize_or(state.orientations[i], state.orientations[i]);
        let o_i = state.origins[i];
        let lhs = Sample::new(v_i, o_i, Frame::new(q_i, n_i));
        for link in &mut state.adjacency[i] {
            let j = link.id;
            let n_j = state.normals[j];
            let v_j = state.positions[j];
            let q_j = normalize_or(state.orientations[j], state.orientations[j]);
            let o_j = state.origins[j];
            let m = M::match_position(
                lhs,
                Sample::new(v_j, o_j, Frame::new(q_j, n_j)),
                state.scale,
                inv_scale,
            );
            link.shift = [m.lhs.1, m.rhs.1];
        }
    }
}

pub fn optimize_positions_frozen(state: &mut FieldState, phases: &[Vec<usize>], iterations: usize) {
    for _ in 0..iterations {
        let prev = state.origins.clone();
        for phase in phases {
            for &i in phase {
                let n_i = state.normals[i];
                let v_i = state.positions[i];
                let q_i = normalize_or(state.orientations[i], state.orientations[i]);
                let t_i = n_i.cross(q_i);
                let mut sum = Vec3::ZERO;
                let mut weight_sum = 0.0;
                for link in &state.adjacency[i] {
                    if link.weight == 0.0 {
                        continue;
                    }
                    let j = link.id;
                    let n_j = state.normals[j];
                    let q_j = normalize_or(state.orientations[j], state.orientations[j]);
                    let t_j = n_j.cross(q_j);
                    let s0 = link.shift[0];
                    let s1 = link.shift[1];
                    sum += prev[j]
                        + state.scale
                            * (q_j * s1.x as f64 + t_j * s1.y as f64
                                - q_i * s0.x as f64
                                - t_i * s0.y as f64);
                    weight_sum += link.weight;
                }
                if weight_sum > 0.0 {
                    sum /= weight_sum;
                    sum -= n_i * n_i.dot(sum - v_i);
                    state.origins[i] = sum;
                }
            }
        }
    }
}

pub fn coordinate_system(normal: Vec3) -> (Vec3, Vec3) {
    let c = if normal.x.abs() > normal.y.abs() {
        let inv_len = 1.0 / (normal.x * normal.x + normal.z * normal.z).sqrt().max(EPS);
        Vec3::new(normal.z * inv_len, 0.0, -normal.x * inv_len)
    } else {
        let inv_len = 1.0 / (normal.y * normal.y + normal.z * normal.z).sqrt().max(EPS);
        Vec3::new(0.0, normal.z * inv_len, -normal.y * inv_len)
    };
    let b = c.cross(normal);
    (b, c)
}

fn init_random_tangent(normal: Vec3, rng: Rng) -> Vec3 {
    let (s, t) = coordinate_system(normal);
    let angle = rng.next() * std::f64::consts::TAU;
    s * angle.cos() + t * angle.sin()
}

fn init_random_origin(position: Vec3, normal: Vec3, scale: f64, rng: Rng) -> Vec3 {
    let (s, t) = coordinate_system(normal);
    let x = rng.next() * 2.0 - 1.0;
    let y = rng.mix(ORIGIN_Y_TAG).next() * 2.0 - 1.0;
    position + (s * x + t * y) * scale
}

pub fn rotate90_by(q: Vec3, n: Vec3, amount: i32) -> Vec3 {
    let rotated = if amount & 1 == 1 { n.cross(q) } else { q };
    if amount < 2 {
        rotated
    } else {
        -rotated
    }
}

pub fn normalize_or(v: Vec3, fallback: Vec3) -> Vec3 {
    if v.length_squared() <= EPS {
        fallback
    } else {
        v.normalize()
    }
}
