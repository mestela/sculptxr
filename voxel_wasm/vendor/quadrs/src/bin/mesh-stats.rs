use quadrs::{analyze_mesh, load_obj};
use std::env;
use std::error::Error;
use std::path::PathBuf;

fn main() {
    if matches!(env::args().nth(1).as_deref(), Some("-h" | "--help")) {
        println!("{}", usage());
        return;
    }
    if let Err(err) = run() {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let input = env::args().nth(1).ok_or_else(|| usage().to_string())?;
    let input = PathBuf::from(input);
    let mesh = load_obj(&input)?;
    let report = analyze_mesh(&mesh);

    println!("file: {}", input.display());
    println!("vertices: {}", report.vertex_count);
    println!("faces: {}", report.face_count);
    println!("quads: {}", report.quad_face_count);
    println!("non_quads: {}", report.non_quad_face_count);
    println!("area: {:.9}", report.area);
    println!("abs_volume: {:.9}", report.abs_volume);
    println!("boundary_edges: {}", report.boundary_edge_count);
    println!("nonmanifold_edges: {}", report.nonmanifold_edge_count);
    println!("invalid_lt3: {}", report.fewer_than_three_face_count);
    println!("invalid_repeat: {}", report.repeated_vertex_face_count);
    println!("invalid_index: {}", report.invalid_vertex_index_face_count);
    println!("invalid_quad: {}", report.invalid_quad_face_count);
    println!("isolated_vertices: {}", report.isolated_vertex_count);
    Ok(())
}

fn usage() -> &'static str {
    "usage: mesh-stats <input.obj>"
}
