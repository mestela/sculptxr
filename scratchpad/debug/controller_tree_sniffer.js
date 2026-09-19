const renderer = window.sculptgl ? window.sculptgl._renderer : window.app._renderer;
const scene = window.sculptgl ? window.sculptgl._scene : window.app._scene;

window._sniffControllers = function() {
    if (!renderer.xr.isPresenting) {
        console.log("Enter VR first!");
        // return;
    }
    
    console.log("=== XR CONTROLLER HIERARCHY ===");
    const c0 = renderer.xr.getController(0);
    const c1 = renderer.xr.getController(1);
    const g0 = renderer.xr.getControllerGrip(0);
    const g1 = renderer.xr.getControllerGrip(1);

    function dumpNode(node, depth = 0) {
        if (!node) return;
        let pad = "  ".repeat(depth);
        let info = `${node.type} (${node.name || 'unnamed'}) Vis=${node.visible} Pos=[${node.position.x.toFixed(3)}, ${node.position.y.toFixed(3)}, ${node.position.z.toFixed(3)}] Scale=[${node.scale.x.toFixed(3)}, ${node.scale.y.toFixed(3)}, ${node.scale.z.toFixed(3)}]`;
        if (node.geometry) info += ` GeoBounds=${node.geometry.boundingBox ? "Yes" : "null"}`;
        if (node.material) info += ` Mat=${node.material.type} Color=${node.material.color ? node.material.color.getHex().toString(16) : 'N/A'}`;
        console.log(pad + "-> " + info);
        
        node.children.forEach(c => dumpNode(c, depth + 1));
    }

    console.log("--- Controller 0 (Target Ray) ---");
    dumpNode(c0);
    console.log("--- Controller 1 (Target Ray) ---");
    dumpNode(c1);
    console.log("--- Grip 0 (Model) ---");
    dumpNode(g0);
    console.log("--- Grip 1 (Model) ---");
    dumpNode(g1);
}
console.log("Run window._sniffControllers() in console while in VR.");
