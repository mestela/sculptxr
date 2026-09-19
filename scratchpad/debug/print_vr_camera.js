const cam = window.threeCamera || (window.sculptxr && window.sculptxr._camera ? window.sculptxr._camera.getThreeCamera() : null);
const scene = window.sculptxr ? window.sculptxr._scene : null;
const group = window.sculptxr ? window.sculptxr._worldGroup : null;

if (!cam) {
    console.log("No threeCamera found on window or sculptxr");
} else {
    console.log("Camera Position:", cam.position.toArray().map(v => v.toFixed(3)));
    console.log("Camera Rotation:", cam.rotation.toArray().slice(0, 3).map(v => v.toFixed(3)));
    console.log("Camera parent is Scene?:", cam.parent === scene);
}

if (!group) {
    console.log("No worldGroup found");
} else {
    console.log("WorldGroup Position:", group.position.toArray().map(v => v.toFixed(3)));
    console.log("WorldGroup Rotation:", group.rotation.toArray().slice(0, 3).map(v => v.toFixed(3)));
    console.log("WorldGroup parent is Scene?:", group.parent === scene);
}
