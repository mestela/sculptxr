use glam::DVec3;
use std::error::Error;
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;

pub type Vec3 = DVec3;

#[derive(Clone, Debug, PartialEq)]
/// Polygon mesh with 0-based vertex indices.
pub struct Mesh {
    pub vertices: Vec<Vec3>,
    pub faces: Vec<Vec<usize>>,
}

pub type ObjMesh = Mesh;

/// Loads a mesh from an OBJ file.
pub fn load_obj(path: &Path) -> Result<Mesh, Box<dyn Error>> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut vertices = Vec::new();
    let mut faces = Vec::new();

    for line in reader.lines() {
        let line = line?;
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if let Some(rest) = line.strip_prefix("v ") {
            let mut parts = rest.split_whitespace();
            let x: f64 = parts.next().ok_or("invalid vertex")?.parse()?;
            let y: f64 = parts.next().ok_or("invalid vertex")?.parse()?;
            let z: f64 = parts.next().ok_or("invalid vertex")?.parse()?;
            vertices.push(Vec3::new(x, y, z));
            continue;
        }

        if let Some(rest) = line.strip_prefix("f ") {
            let face: Result<Vec<_>, _> = rest
                .split_whitespace()
                .map(|token| parse_face_index(token, vertices.len()))
                .collect();
            let face = face?;
            if face.len() >= 3 {
                faces.push(face);
            }
        }
    }

    Ok(Mesh { vertices, faces })
}

/// Triangulates polygon faces with a fan from the first vertex.
pub fn triangulate_faces(faces: &[Vec<usize>]) -> Vec<[usize; 3]> {
    let mut triangles = Vec::new();
    for face in faces {
        for i in 1..face.len().saturating_sub(1) {
            triangles.push([face[0], face[i], face[i + 1]]);
        }
    }
    triangles
}

/// Writes a mesh to an OBJ file.
pub fn write_obj(
    path: &Path,
    vertices: &[Vec3],
    faces: &[Vec<usize>],
) -> Result<(), Box<dyn Error>> {
    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    for vertex in vertices {
        writeln!(writer, "v {} {} {}", vertex.x, vertex.y, vertex.z)?;
    }
    for face in faces {
        write!(writer, "f")?;
        for &index in face {
            write!(writer, " {}", index + 1)?;
        }
        writeln!(writer)?;
    }
    Ok(())
}

fn parse_face_index(token: &str, vertex_count: usize) -> Result<usize, Box<dyn Error>> {
    let raw = token
        .split('/')
        .next()
        .ok_or("invalid face index")?
        .parse::<i64>()?;
    let index = if raw > 0 {
        raw - 1
    } else {
        vertex_count as i64 + raw
    };
    if index < 0 || index as usize >= vertex_count {
        return Err(format!("face index out of range: {token}").into());
    }
    Ok(index as usize)
}
