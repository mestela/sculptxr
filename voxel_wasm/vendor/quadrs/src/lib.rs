#![doc = include_str!("../README.md")]

mod api;
mod boundary;
mod connectivity;
mod extract;
mod field;
mod geom;
mod graph;
mod hierarchy;
mod meshio;
mod metrics;
mod preprocess;
mod rng;
mod rotational_symmetry;
mod topology;

pub use crate::api::{
    analyze_mesh, remesh, remesh_with_groups, MeshReport, RemeshError, RemeshMode, RemeshOptions,
    RemeshResult, RemeshTarget,
};
pub use crate::meshio::{load_obj, write_obj, Mesh, Vec3};
