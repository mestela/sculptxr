const renderer = window.sculptgl ? window.sculptgl._renderer : window.app._renderer;
const grip = renderer.xr.getControllerGrip(0);
const modelGroup = grip.children[0];

console.log("=== CONTROLLER MESH DIAGNOSTICS ===");
let mCount = 0;
modelGroup.traverse(child => {
    if (child.isMesh) {
        console.log(`Mesh [${mCount}] - Name: ${child.name}`);
        console.log(`  Visible: ${child.visible}, FrustumCulled: ${child.frustumCulled}`);
        console.log(`  DrawMode: ${child.drawMode}, Type: ${child.type}`);
        
        let mArr = child.matrixWorld.elements;
        console.log(`  WorldMatrix: Pos(${mArr[12].toFixed(3)}, ${mArr[13].toFixed(3)}, ${mArr[14].toFixed(3)}) Scale(${Math.hypot(mArr[0], mArr[1], mArr[2]).toFixed(3)})`);
        
        if (child.material) {
             console.log(`  Material: ${child.material.type}, Color: ${child.material.color ? child.material.color.getHexString() : 'N/A'}, DepthTest: ${child.material.depthTest}, DepthWrite: ${child.material.depthWrite}`);
        }
        
        if (child.geometry) {
             child.geometry.computeBoundingBox();
             let bb = child.geometry.boundingBox;
             console.log(`  Geometry BB: Min(${bb.min.x.toFixed(3)}, ${bb.min.y.toFixed(3)}, ${bb.min.z.toFixed(3)}) Max(${bb.max.x.toFixed(3)}, ${bb.max.y.toFixed(3)}, ${bb.max.z.toFixed(3)})`);
        }
        
        mCount++;
    }
});
