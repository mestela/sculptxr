# quadrs

Experimental quad remeshing library and CLI tools based on Instant Meshes.

## Library

The public API is centered around `Mesh`, `RemeshOptions`, `RemeshTarget`, `remesh`, `load_obj`, and `write_obj`.

```rust
use quadrs::{remesh, Mesh, RemeshOptions, RemeshTarget, Vec3};

let mesh = Mesh {
    vertices: vec![
        Vec3::new(0.0, 0.0, 0.0),
        Vec3::new(1.0, 0.0, 0.0),
        Vec3::new(1.0, 1.0, 0.0),
        Vec3::new(0.0, 1.0, 0.0),
    ],
    faces: vec![vec![0, 1, 2], vec![0, 2, 3]],
};

let mut options = RemeshOptions::new(RemeshTarget::FaceCount(4));
options.seed = Some(1337);

let result = remesh(&mesh, &options)?;
assert!(result.mesh.faces.iter().all(|face| face.len() == 4));
# Ok::<(), quadrs::RemeshError>(())
```

## CLI

Build:

```bash
cargo build --release --bins
```

Remesh an OBJ file:

```bash
cargo run --release --bin remesh -- input.obj -o output.obj --target-faces 3000
```

Use `--seed 1337` to make a run reproducible. If `--seed` is omitted, `remesh` seeds itself from the current system time.

Run an end-to-end remesh check:

```bash
sh/test-remesh.sh teapot --target-faces 1000 --seed 1337
```

It uses `meshes/<name>.obj` when present. For known public meshes such as `teapot`, it downloads `meshes/<name>.obj` on first run, builds `remesh` in release mode, and writes `meshes/<name>-remeshed.obj`.

Useful tools:

```bash
cargo run --release --bin mesh-stats -- output.obj
```

## Reference

Run the C++ reference implementation directly:

```bash
scripts/run_reference.sh -d -i -b -f 3000 -o output.obj input.obj
```

`scripts/run_reference.sh` will:

1. Check for an existing Instant Meshes binary.
2. If missing, clone the reference repository into `/tmp/instant-meshes`.
3. Build it into `/tmp/instant-meshes-build`.
4. Run it with the arguments you provide.

## Sources

Original paper:

https://igl.ethz.ch/projects/instant-meshes/instant-meshes-SA-2015-jakob-et-al-compressed.pdf

Reference implementation:

https://github.com/wjakob/instant-meshes
