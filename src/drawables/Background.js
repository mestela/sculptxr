import Buffer from '../render/Buffer.js';
import Shader from '../render/ShaderLib.js';
import Enums from '../misc/Enums.js';
import ShaderPBR from '../render/shaders/ShaderPBR.js';
import pbrGLSL from '../render/shaders/glsl/pbr.glsl.js';
import * as THREE from 'three';

const BG_GREY = 0x323232; // default "fixed grey" background

// Fullscreen env backdrop — ports SculptGL's mainBackground.glsl into a three.js
// RawShaderMaterial. Reuses pbrGLSL's octahedral LogLUV panorama decode
// (texturePanoramaLod) and the SH evaluation, so the built-in environment atlases
// render as a skybox without converting them. Direction is reconstructed per pixel
// from the camera rotation (uIblTransform), like the original.
const ENV_BG_VERT = `precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vTexCoord;
void main() {
  vTexCoord = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const ENV_BG_FRAG = `precision highp float;
${pbrGLSL}
varying vec2 vTexCoord;
uniform int uBackgroundType;
uniform float uBlur;
uniform float uExposure;
vec3 _lin2srgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(0.45454545)); }
void main() {
  vec3 dir = normalize(uIblTransform * vec3(vTexCoord * 2.0 - 1.0, -1.0));
  vec3 color = (uBackgroundType == 1) ? texturePanoramaLod(dir, uBlur * uBlur)
                                      : sphericalHarmonics(dir);
  gl_FragColor = vec4(_lin2srgb(color * uExposure), 1.0);
}`;

class Background {

  constructor(gl, main) {
    this._main = main;
    this._gl = gl; // webgl context

    this._vertexBuffer = new Buffer(gl, gl.ARRAY_BUFFER, gl.STATIC_DRAW, "BG_Vert"); // vertices buffer
    this._texCoordBuffer = new Buffer(gl, gl.ARRAY_BUFFER, gl.STATIC_DRAW, "BG_Tex"); // tex coord buffer
    this._fill = true; // if the canvas should be fille by the background

    this._monoTex = null;
    this._texture = null; // texture background
    this._threeTex = null; // three.js texture for scene.background/environment
    this._texWidth = 1;
    this._texHeight = 1;

    this._type = 0; // 0: fixed grey, 1 env spec, 2 env ambient
    this._blur = 0.0;

    this.init();
  }

  init() {
    this.getTexCoordBuffer().update(new Float32Array([0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0]));
    this._monoTex = this.createOnePixelTexture(50, 50, 50, 255);
    document.getElementById('backgroundopen').addEventListener('change', this.loadBackground.bind(this), false);
  }

  loadBackground(event) {
    if (event.target.files.length === 0)
      return;

    var file = event.target.files[0];
    if (!file.type.match('image.*'))
      return;

    var self = this;
    var reader = new FileReader();
    reader.onload = function (evt) {
      var bg = new Image();
      bg.src = evt.target.result;

      bg.onload = function () {
        self._texWidth = bg.width;
        self._texHeight = bg.height;
        if (self._threeTex) self._threeTex.dispose();
        self._threeTex = new THREE.Texture(bg);
        self._threeTex.colorSpace = THREE.SRGBColorSpace;
        self._threeTex.needsUpdate = true;
        self._applyBackground();
        self._main.render();
      };
    };

    document.getElementById('backgroundopen').value = '';
    reader.readAsDataURL(file);
  }

  getGL() {
    return this._gl;
  }

  getBlur() {
    return this._blur;
  }

  getVertexBuffer() {
    return this._vertexBuffer;
  }

  getTexCoordBuffer() {
    return this._texCoordBuffer;
  }

  release() {
    this.deleteTexture();
    this.getVertexBuffer().release();
    this.getTexCoordBuffer().release();
  }

  getType() {
    return this._type;
  }

  setType(val) {
    this._type = val;
    this._applyBackground();
  }

  // Apply the background to the three.js scene (desktop/tablet). Skipped during XR
  // sessions — VR-opaque and AR-passthrough backgrounds are managed separately and
  // we must not stamp a colour over passthrough.
  _applyBackground() {
    const scene = this._main && this._main._scene;
    if (!scene) return;
    if (this._main._renderer && this._main._renderer.xr && this._main._renderer.xr.isPresenting) return;

    scene.backgroundBlurriness = this._blur || 0;

    // A user-imported image takes precedence and is used per type (equirect for env).
    const tex = this._threeTex;
    if (tex) {
      this._hideEnvQuad();
      this._applyTexture(scene, tex);
      return;
    }

    if (this._type === 0) {           // Image type, nothing imported → grey
      this._hideEnvQuad();
      scene.background = new THREE.Color(BG_GREY);
      scene.environment = null;
      return;
    }

    // Environment (1) / Ambient env (2): render the built-in LogLUV atlas via the
    // fullscreen backdrop quad (decoded panorama, or SH for type 2).
    scene.background = null;          // the quad provides the backdrop
    scene.environment = null;
    this._showEnvQuad();
  }

  _ensureEnvQuad() {
    if (this._envQuad) return this._envQuad;
    const scene = this._main && this._main._scene;
    if (!scene) return null;
    const sph = [];
    for (let i = 0; i < 9; i++) sph.push(new THREE.Vector3());
    const mat = new THREE.RawShaderMaterial({
      uniforms: {
        uTexture0:       { value: null },
        uBackgroundType: { value: 1 },
        uIblTransform:   { value: new THREE.Matrix3() },
        uSPH:            { value: sph },
        uEnvSize:        { value: new THREE.Vector2(512, 1024) },
        uBlur:           { value: 0 },
        uExposure:       { value: 1 },
      },
      vertexShader: ENV_BG_VERT,
      fragmentShader: ENV_BG_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    quad.renderOrder = -Infinity; // draw before the scene meshes
    quad.onBeforeRender = (renderer, scn, camera) => {
      // Never draw the desktop env backdrop inside an XR session (it would cover
      // VR-opaque / AR passthrough). _applyBackground re-shows it on XR exit.
      if (this._main._renderer && this._main._renderer.xr && this._main._renderer.xr.isPresenting) {
        quad.visible = false;
        return;
      }
      this._updateEnvUniforms(camera);
    };
    scene.add(quad);
    this._envQuad = quad;
    this._envMat = mat;
    return quad;
  }

  _updateEnvUniforms(camera) {
    if (!this._envMat) return;
    const u = this._envMat.uniforms;
    u.uIblTransform.value.setFromMatrix4(camera.matrixWorld); // camera world rotation
    u.uBackgroundType.value = this._type;
    u.uBlur.value = this._blur || 0;
    const env = ShaderPBR.environments && ShaderPBR.environments[ShaderPBR.idEnv ?? 0];
    if (env && env.sph) {
      for (let i = 0; i < 9; i++)
        u.uSPH.value[i].set(env.sph[i * 3], env.sph[i * 3 + 1], env.sph[i * 3 + 2]);
    }
    // Per-HDRI baseline exposure × the rendering panel's exposure slider (read live).
    const envExp = env && env.exposure !== undefined ? env.exposure : 1.0;
    u.uExposure.value = envExp * (this._main.getExposure ? this._main.getExposure() : 1.0);
  }

  _showEnvQuad() {
    const quad = this._ensureEnvQuad();
    if (!quad) return;
    quad.visible = true;
    if (this._type === 1) { // panorama needs the atlas texture; SH (type 2) doesn't
      this._loadSelectedEnv((t) => {
        if (t && this._envMat) {
          this._envMat.uniforms.uTexture0.value = t;
          if (t.image) this._envMat.uniforms.uEnvSize.value.set(t.image.width, t.image.height);
        }
        this._main.render?.();
      });
    }
  }

  _hideEnvQuad() {
    if (this._envQuad) this._envQuad.visible = false;
  }

  _applyTexture(scene, tex) {
    if (this._type === 1) {            // Environment: visible skybox + reflections
      tex.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = tex;
      scene.environment = tex;
    } else if (this._type === 2) {     // Ambient env: lighting only, grey backdrop
      tex.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = new THREE.Color(BG_GREY);
      scene.environment = tex;
    } else {                           // Image: flat backdrop
      tex.mapping = THREE.UVMapping;
      scene.background = tex;
      scene.environment = null;
    }
  }

  // Load (and cache) the currently-selected built-in HDRI equirect PNG.
  _loadSelectedEnv(cb) {
    const list = ShaderPBR.environments;
    const id = ShaderPBR.idEnv ?? 0;
    const env = list && list[id];
    if (!env) { cb(null); return; }
    if (this._envTex && this._envTexId === id) { cb(this._envTex); return; }
    new THREE.TextureLoader().load(env.path, (t) => {
      // Raw LogLUV atlas data — must NOT be sRGB-decoded or mip-generated; the
      // shader does manual mip sampling (toUVMipmap) + LogLUV decode.
      t.colorSpace = THREE.NoColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.flipY = true; // three.js default; the atlas mip offsets assume top-origin rows
      t.needsUpdate = true;
      if (this._envTex) this._envTex.dispose();
      this._envTex = t;
      this._envTexId = id;
      cb(t);
    }, undefined, () => cb(null));
  }

  onResize(width, height) {
    var ratio = (width / height) / (this._texWidth / this._texHeight);
    var comp = this._fill || this._type !== 0 ? 1.0 / ratio : ratio;
    var x = comp < 1.0 ? 1.0 : 1.0 / ratio;
    var y = comp < 1.0 ? ratio : 1.0;
    this.getVertexBuffer().update(new Float32Array([-x, -y, x, -y, -x, y, x, y]));
  }

  getTexture() {
    return this._texture ? this._texture : this._monoTex;
  }

  createOnePixelTexture(r, g, b, a) {
    var gl = this._gl;
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r, g, b, a]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  loadBackgroundTexture(tex) {
    var gl = this._gl;
    this.deleteTexture();

    this._texWidth = tex.width;
    this._texHeight = tex.height;
    this._texture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  deleteTexture() {
    if (this._texture) {
      this._texWidth = this._texHeight = 1;
      this._gl.deleteTexture(this._texture);
      this._texture = null;
    }
    if (this._threeTex) {
      this._threeTex.dispose();
      this._threeTex = null;
    }
    this._applyBackground(); // revert to the default grey
  }

  render() {
    Shader[Enums.Shader.BACKGROUND].getOrCreate(this._gl).draw(this);
  }
}

export default Background;
