use quadrs::{load_obj, remesh, write_obj, MeshReport, RemeshMode, RemeshOptions, RemeshTarget};
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
    let args = parse_args(env::args().skip(1))?;
    let input = load_obj(&args.input)?;
    let mut options = RemeshOptions::new(args.target);
    options.hierarchy_orientation_iterations = args.hierarchy_orientation_iterations;
    options.hierarchy_position_iterations = args.hierarchy_position_iterations;
    options.orientation_iterations = args.orientation_iterations;
    options.position_iterations = args.position_iterations;
    options.frozen_orientation_iterations = args.frozen_orientation_iterations;
    options.frozen_position_iterations = args.frozen_position_iterations;
    options.seed = args.seed;
    options.mode = args.mode;

    let result = remesh(&input, &options)?;
    print_report("input", &result.input, None);
    eprintln!("seed {}", result.seed);
    write_obj(&args.output, &result.mesh.vertices, &result.mesh.faces)?;
    print_report(
        "output",
        &result.output,
        Some((result.area_ratio, result.volume_ratio)),
    );
    Ok(())
}

#[derive(Clone)]
struct Args {
    input: PathBuf,
    output: PathBuf,
    target: RemeshTarget,
    hierarchy_orientation_iterations: usize,
    hierarchy_position_iterations: usize,
    orientation_iterations: usize,
    position_iterations: usize,
    frozen_orientation_iterations: usize,
    frozen_position_iterations: usize,
    seed: Option<u64>,
    mode: RemeshMode,
}

fn parse_args<I>(args: I) -> Result<Args, Box<dyn Error>>
where
    I: IntoIterator<Item = String>,
{
    let mut input = None;
    let mut output = None;
    let mut edge_length = None;
    let mut target_vertices = None;
    let mut target_faces = None;
    let mut hierarchy_orientation_iterations = 6;
    let mut hierarchy_position_iterations = 6;
    let mut orientation_iterations = 40;
    let mut position_iterations = 80;
    let mut frozen_orientation_iterations = 20;
    let mut frozen_position_iterations = 20;
    let mut seed = None;
    let mut mode = RemeshMode::Intrinsic;
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-o" | "--output" => output = Some(PathBuf::from(next_value(&mut args, &arg)?)),
            "--edge-length" => edge_length = Some(next_value(&mut args, &arg)?.parse()?),
            "--target-vertices" => target_vertices = Some(next_value(&mut args, &arg)?.parse()?),
            "--target-faces" => target_faces = Some(next_value(&mut args, &arg)?.parse()?),
            "--hierarchy-orientation-iters" => {
                hierarchy_orientation_iterations = next_value(&mut args, &arg)?.parse()?
            }
            "--hierarchy-position-iters" => {
                hierarchy_position_iterations = next_value(&mut args, &arg)?.parse()?
            }
            "--orientation-iters" => {
                orientation_iterations = next_value(&mut args, &arg)?.parse()?
            }
            "--position-iters" => position_iterations = next_value(&mut args, &arg)?.parse()?,
            "--frozen-orientation-iters" => {
                frozen_orientation_iterations = next_value(&mut args, &arg)?.parse()?
            }
            "--frozen-position-iters" => {
                frozen_position_iterations = next_value(&mut args, &arg)?.parse()?
            }
            "--seed" => seed = Some(next_value(&mut args, &arg)?.parse()?),
            "--intrinsic" => mode = RemeshMode::Intrinsic,
            "--extrinsic" => mode = RemeshMode::Extrinsic,
            _ if arg.starts_with('-') => {
                return Err(format!("unknown flag: {arg}\n\n{}", usage()).into())
            }
            _ if input.is_none() => input = Some(PathBuf::from(arg)),
            _ => return Err(format!("unexpected argument: {arg}\n\n{}", usage()).into()),
        }
    }

    let Some(target) = target(edge_length, target_vertices, target_faces) else {
        return Err(usage().into());
    };

    match (input, output) {
        (Some(input), Some(output)) => Ok(Args {
            input,
            output,
            target,
            hierarchy_orientation_iterations,
            hierarchy_position_iterations,
            orientation_iterations,
            position_iterations,
            frozen_orientation_iterations,
            frozen_position_iterations,
            seed,
            mode,
        }),
        _ => Err(usage().into()),
    }
}

fn target(
    edge_length: Option<f64>,
    target_vertices: Option<usize>,
    target_faces: Option<usize>,
) -> Option<RemeshTarget> {
    match (edge_length, target_vertices, target_faces) {
        (Some(length), None, None) => Some(RemeshTarget::EdgeLength(length)),
        (None, Some(vertices), None) => Some(RemeshTarget::VertexCount(vertices)),
        (None, None, Some(faces)) => Some(RemeshTarget::FaceCount(faces)),
        _ => None,
    }
}

fn next_value<I>(args: &mut I, flag: &str) -> Result<String, Box<dyn Error>>
where
    I: Iterator<Item = String>,
{
    args.next()
        .ok_or_else(|| format!("missing value for {flag}").into())
}

fn print_report(label: &str, report: &MeshReport, baseline: Option<(Option<f64>, Option<f64>)>) {
    eprintln!(
        "{label}: V={} F={} quads={} non-quads={} area={:.9} abs-volume={:.9}",
        report.vertex_count,
        report.face_count,
        report.quad_face_count,
        report.non_quad_face_count,
        report.area,
        report.abs_volume,
    );
    eprintln!(
        "{label}: boundary edges={} non-manifold edges={} invalid-lt3={} invalid-repeat={} invalid-index={} invalid-quad={} isolated vertices={}",
        report.boundary_edge_count,
        report.nonmanifold_edge_count,
        report.fewer_than_three_face_count,
        report.repeated_vertex_face_count,
        report.invalid_vertex_index_face_count,
        report.invalid_quad_face_count,
        report.isolated_vertex_count,
    );
    if let Some((area_ratio, volume_ratio)) = baseline {
        if let Some(value) = area_ratio {
            eprintln!("{label}: area ratio vs input = {:.3}", value);
        }
        if let Some(value) = volume_ratio {
            eprintln!("{label}: volume ratio vs input = {:.3}", value);
        }
    }
}

fn usage() -> &'static str {
    "usage: remesh <input.obj> -o <output.obj> (--edge-length L | --target-vertices N | --target-faces N) [--hierarchy-orientation-iters N] [--hierarchy-position-iters N] [--orientation-iters N] [--position-iters N] [--frozen-orientation-iters N] [--frozen-position-iters N] [--seed N] [--intrinsic | --extrinsic]"
}
