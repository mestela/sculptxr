# Elastic Brush Concepts (Pseudo-Kelvinlets)

To achieve an organic, "fleshy," or rubber-like feeling of elasticity without the massive performance cost of true Kelvinlets or ARAP (As-Rigid-As-Possible) matrix solvers, SculptXR can utilize several "pseudo-elastic" tricks. 

These tricks rely on faking soft-body physics using calculations that run rapidly during a standard brush stroke.

### 1. Volume-Preserving Grab (Pseudo-Kelvinlet)
Real tissue preserves volume. If you stretch it, it pinches in the middle. If you compress it, it bulges outwards. 
- **The Trick**: Take the standard Move/Grab tool, and analyze the displacement vector of the controller. For all the vertices captured in the brush, apply the forward translation, but also push them *inward* (toward the axis of the drag) based on how far they were stretched. 
- **Cost**: Extremely cheap. Requires only a few extra dot products per vertex to squash/stretch them perpendicularly to the controller movement.

### 2. Topological Grab (Surface Distance)
A standard brush selects everything inside a perfect mathematical 3D sphere. Because of this, pulling the upper lip of a character might accidentally grab the lower lip because they occupy the same 3D space. 
- **The Trick**: When the trigger is pulled, the tool runs a lightning-fast "Flood Fill" (Breadth-First Search) across the polygon edges starting from the center vertex, measuring distance travelling *along the physical surface* rather than Euclidean space.
- **Cost**: Medium cost on the very first frame of the stroke (to map the topological distances), but exactly the same speed as a regular brush while dragging. Makes grabbing feel much more like grabbing a specific piece of connected skin.

### 3. Laplacian Move (Stretchy Fabric)
When you pull a standard vertex, the polygons at the very edge of the brush stretch horribly, while the ones in the center stay completely rigid.
- **The Trick**: Combine pulling and smoothing. Every frame the proxy translates, immediately run 1 or 2 passes of Laplacian Smoothing on *just* the moving vertices. This instantly distributes the polygon tension, making it look like stretchy pantyhose or fabric being pulled over a shape.
- **Cost**: Very cheap. SculptXR already has highly optimized smoothing functions that can be injected straight into the drag loop.

### 4. Spring / Jiggle Move
When you grab something and whip your hand, a standard move brush rigidly locks the geometry to your hand 1:1. 
- **The Trick**: Assign a temporary physics "Velocity" to the vertices in the brush. When the hand moves, pull them via invisible rubber bands. They trail behind the controller and "boing" into place when movement stops.
- **Cost**: Cheap. Requires tracking momentum and damping equations for the vertices while the trigger is held down.
