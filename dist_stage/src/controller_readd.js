const app = window.sculptgl || window.app;
const scene = app._scene;
const renderer = app._renderer;

window._readdMenu = function() {
    if (!renderer.xr.isPresenting) {
        console.log("Enter VR first!");
    }
    
    // The Scene instance holds the controller variables
    if (scene._vrControllerLeftGrip && scene._vrMenu) {
        scene._vrControllerLeftGrip.add(scene._vrMenu.mesh);
        console.log("Re-added VRMenu to Left Grip");
        scene._vrMenu.mesh.visible = true;
    }
    
    if (scene._vrControllerLeftGrip && scene._vrMiniHUD) {
        scene._vrControllerLeftGrip.add(scene._vrMiniHUD.mesh);
        console.log("Re-added MiniHUD to Left Grip");
        scene._vrMiniHUD.mesh.visible = true;
    }
    
    // Make the lasers THICK and RED so they are impossible to miss
    if (scene._vrControllerLeft) {
        scene._vrControllerLeft.children.forEach(c => {
            if (c.geometry && c.geometry.type === "CylinderGeometry") {
                c.material.color.setHex(0xff0000); // Solid Red
                c.material.transparent = false;
                c.material.opacity = 1.0;
                c.material.blending = window.THREE.NormalBlending;
                c.material.depthTest = false; // Draw over everything
                c.scale.set(10, 1, 10); // 10x Thicker
                console.log("Enhanced left pointer ray");
            }
        });
    }

    if (scene._vrControllerRight) {
        scene._vrControllerRight.children.forEach(c => {
            if (c.geometry && c.geometry.type === "CylinderGeometry") {
                c.material.color.setHex(0xff0000); // Solid Red
                c.material.transparent = false;
                c.material.opacity = 1.0;
                c.material.blending = window.THREE.NormalBlending;
                c.material.depthTest = false;
                c.scale.set(10, 1, 10);
                console.log("Enhanced right pointer ray");
            }
        });
    }
}
console.log("Run window._readdMenu() in console while in VR.");
