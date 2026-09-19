const renderer = window.sculptgl ? window.sculptgl._renderer : window.app._renderer;
const camera = window.sculptgl ? window.sculptgl._camera.getThreeCamera() : window.app._camera;
const grip0 = renderer.xr.getControllerGrip(0);
const THREE = window.sculptgl._scene.constructor; // Hack to get THREE namespace from Scene constructor

window._sniffMatrix = function() {
    if (!renderer.xr.isPresenting) {
        console.log("Enter VR first!");
        return;
    }
    
    // WebXR updates camera matrixWorld and projectionMatrix implicitly via the WebXRManager.
    // Let's force an update just in case, then dump the raw values WebGL uses.
    
    // Get the XR camera (it's an ArrayCamera with 2 cameras, one per eye)
    const xrCamera = renderer.xr.getCamera(camera);
    
    console.log("=== XR CAMERA MATRICES ===");
    if (xrCamera.cameras && xrCamera.cameras.length > 0) {
        const eye0 = xrCamera.cameras[0];
        console.log("Eye 0 Position:", eye0.position.x.toFixed(3), eye0.position.y.toFixed(3), eye0.position.z.toFixed(3));
        
        grip0.updateMatrixWorld(true);

        // Get Vector3 constructor from the position object
        const Vec3 = grip0.position.constructor;
        const ptGripWorld = new Vec3().setFromMatrixPosition(grip0.matrixWorld);
        
        console.log("Grip Position (World):", ptGripWorld.x.toFixed(3), ptGripWorld.y.toFixed(3), ptGripWorld.z.toFixed(3));
        
        // Project Grip Position into Screen Space (NDC: -1 to 1)
        const pt = ptGripWorld.clone();
        pt.project(eye0);
        console.log("Grip Projected NDC (X,Y,Z):", pt.x.toFixed(3), pt.y.toFixed(3), pt.z.toFixed(3));
        if (pt.z < -1 || pt.z > 1) console.log("WARNING: Controller is OUTSIDE the Frustum Clip bounds!");
        if (Math.abs(pt.x) > 1 || Math.abs(pt.y) > 1) console.log("WARNING: Controller is OFF-SCREEN!");
    } else {
        console.log("No stereo cameras found on XRCamera!");
    }
}
console.log("Run window._sniffMatrix() in console while in VR.");
