const renderer = window.sculptgl ? window.sculptgl._renderer : window.app._renderer;
const grip0 = renderer.xr.getControllerGrip(0);
const grip1 = renderer.xr.getControllerGrip(1);

console.log("=== FORCING CONTROLLER VISIBILITY ===");

function forceUpdate(grip) {
    if (!grip) return;
    const modelGroup = grip.children[0];
    if (!modelGroup) return;
    
    modelGroup.traverse(child => {
        if (child.isMesh) {
            child.frustumCulled = false;
            if (child.material) {
                child.material.side = 2; // THREE.DoubleSide
                child.material.depthTest = false; // Draw over everything
                child.material.depthWrite = false;
                child.material.color.setHex(0xff0000); // Bright Red
                child.material.emissive.setHex(0xff0000); // Glow Red
                child.material.needsUpdate = true;
            }
        }
    });
}

forceUpdate(grip0);
forceUpdate(grip1);

// Let's also add an emergency huge sphere directly to the controller constraint
const mesh = new window.THREE.Mesh(
    new window.THREE.SphereGeometry(0.5, 16, 16),
    new window.THREE.MeshBasicMaterial({color: 0x00ff00, wireframe: true, depthTest: false})
);
grip0.add(mesh);

console.log("Forced red emissive, no depth test, double sided, plus giant green sphere attached to grip.");
