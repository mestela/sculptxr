const renderer = window.sculptgl ? window.sculptgl._renderer : window.app._renderer;
const gl = renderer.getContext();

const oldRender = renderer.render.bind(renderer);

renderer.render = function(scene, camera) {
    if (renderer.xr.isPresenting && !window._loggedGLState) {
        console.log("=== RAW WEBGL STATE AT RENDER START ===");
        console.log("Viewport:", gl.getParameter(gl.VIEWPORT));
        console.log("Color Mask:", gl.getParameter(gl.COLOR_WRITEMASK));
        console.log("Depth Mask:", gl.getParameter(gl.DEPTH_WRITEMASK));
        console.log("Depth Test:", gl.getParameter(gl.DEPTH_TEST));
        console.log("Depth Func:", gl.getParameter(gl.DEPTH_FUNC));
        console.log("Cull Face Enabled:", gl.getParameter(gl.CULL_FACE));
        console.log("Cull Face Mode:", gl.getParameter(gl.CULL_FACE_MODE));
        console.log("Front Face:", gl.getParameter(gl.FRONT_FACE));
        console.log("Blend Enabled:", gl.getParameter(gl.BLEND));
        console.log("Polygon Offset Fill:", gl.getParameter(gl.POLYGON_OFFSET_FILL));
        console.log("Active Texture:", gl.getParameter(gl.ACTIVE_TEXTURE));
        
        // Let's also check the actual Framebuffer bound
        const fbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        console.log("Bound FBO:", fbo ? "Yes" : "null (Default Canvas)");
        
        window._loggedGLState = true;
    }
    
    // Actually call original render
    oldRender(scene, camera);
};
console.log("WebGL Sniffer Armed.");
