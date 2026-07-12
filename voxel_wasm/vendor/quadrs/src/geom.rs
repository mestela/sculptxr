use crate::meshio::Vec3;
use glam::DVec2;

const EPS: f64 = 1e-12;

pub fn quad_is_valid(vertices: &[Vec3], face: [usize; 4]) -> bool {
    let points = face.map(|index| vertices[index]);
    let normal = (points[1] - points[0]).cross(points[2] - points[0])
        + (points[2] - points[0]).cross(points[3] - points[0]);
    if normal.length_squared() <= EPS {
        return false;
    }

    let axis = dominant_axis(normal);
    let projected = points.map(|point| project_2d(point, axis));
    if segments_intersect(projected[0], projected[1], projected[2], projected[3])
        || segments_intersect(projected[1], projected[2], projected[3], projected[0])
    {
        return false;
    }

    triangle_area(points[0], points[1], points[2]) > EPS
        && triangle_area(points[0], points[2], points[3]) > EPS
}

pub fn triangle_area(a: Vec3, b: Vec3, c: Vec3) -> f64 {
    0.5 * (b - a).cross(c - a).length()
}

fn dominant_axis(normal: Vec3) -> usize {
    let x = normal.x.abs();
    let y = normal.y.abs();
    let z = normal.z.abs();
    if x >= y && x >= z {
        0
    } else if y >= z {
        1
    } else {
        2
    }
}

fn project_2d(point: Vec3, axis: usize) -> DVec2 {
    match axis {
        0 => DVec2::new(point.y, point.z),
        1 => DVec2::new(point.x, point.z),
        _ => DVec2::new(point.x, point.y),
    }
}

fn segments_intersect(
    a0: DVec2,
    a1: DVec2,
    b0: DVec2,
    b1: DVec2,
) -> bool {
    let o1 = orient2d(a0, a1, b0);
    let o2 = orient2d(a0, a1, b1);
    let o3 = orient2d(b0, b1, a0);
    let o4 = orient2d(b0, b1, a1);
    o1 * o2 < -EPS && o3 * o4 < -EPS
}

fn orient2d(a: DVec2, b: DVec2, c: DVec2) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
