import * as THREE from 'three';

export class VolumeRaymarcher {
  constructor(res, main) {
    this._res = res;
    this._main = main;
    
    this._size = 100.0; // Size of workspace workspace cubic space
    this._step = this._size / res;

    // Create 3D Texture
    const capacity = res * res * res;
    const data = new Float32Array(capacity); // Placeholder
    
    this._texture = new THREE.Data3DTexture(data, res, res, res);
    this._texture.format = THREE.RedFormat;
    this._texture.type = THREE.FloatType;
    this._texture.minFilter = THREE.NearestFilter;
    this._texture.magFilter = THREE.NearestFilter;
    this._texture.wrapS = THREE.ClampToEdgeWrapping;
    this._texture.wrapT = THREE.ClampToEdgeWrapping;
    this._texture.wrapR = THREE.ClampToEdgeWrapping;
    this._texture.needsUpdate = true;

    // Shader Material for Bounding Box Raymarching
    this._material = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vModelPosition;
        void main() {
          vModelPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler3D u_volumeTex;
        uniform vec3 u_boxWorldPos; // World center of the 4.0m visual box
        uniform mat4 u_invModelMatrix;
        uniform mat4 u_projMatrix;
        uniform mat4 u_viewMatrix;
        uniform mat4 modelMatrix; // Model matrix for World-to-Local
        varying vec3 vModelPosition;

        out vec4 fragColor;

        // Ray-AABB intersection
        bool intersectAABB(vec3 origin, vec3 dir, vec3 aabbMin, vec3 aabbMax, out float t0, out float t1) {
          vec3 invDir = 1.0 / dir;
          vec3 tBot = invDir * (aabbMin - origin);
          vec3 tTop = invDir * (aabbMax - origin);

          vec3 tMin = min(tBot, tTop);
          vec3 tMax = max(tBot, tTop);

          t0 = max(tMin.x, max(tMin.y, tMin.z));
          t1 = min(tMax.x, min(tMax.y, tMax.z));

          return t0 <= t1 && t1 > 0.0;
        }

        void main() {
          // Convert camera to Model Space for scale invariance!
          vec3 origin = (u_invModelMatrix * vec4(cameraPosition, 1.0)).xyz;
          vec3 dir = normalize(vModelPosition - origin);

          float t0, t1;
          vec3 boxMin = vec3(-50.0);
          vec3 boxMax = vec3(50.0);
          
          if (!intersectAABB(origin, dir, boxMin, boxMax, t0, t1)) {
            fragColor = vec4(1.0, 1.0, 0.0, 0.2); // Debug Yellow for miss AABB
            return; 
          }

          t0 = max(t0, 0.0); 
          
          const int MAX_STEPS = 16; // Lower steps for mobile performance!
          float stepSize = 100.0 / float(MAX_STEPS);
          
          bool hit = false;
          vec3 hitNorm = vec3(0.0, 1.0, 0.0);
          float t = t0;

          for (int i = 0; i < MAX_STEPS; i++) {
            if (t > t1) break;

            vec3 p = origin + dir * t;
            
            // Map local ray point 'p' to world space, then to 0.0-1.0 UV range of the simulation 32m box
            vec3 worldP = u_boxWorldPos + p;
            vec3 uv = (worldP - vec3(-16.0)) / 32.0; // Correctly map [-16, 16] meters to UV
            
            float val = texture(u_volumeTex, uv).r;

            if (val <= 0.0) { // SDF Surface check!
              hit = true;
              
              float s = 2.0 / float(textureSize(u_volumeTex, 0).x);
              float dX = texture(u_volumeTex, uv + vec3(s, 0, 0)).r - texture(u_volumeTex, uv - vec3(s, 0, 0)).r;
              float dY = texture(u_volumeTex, uv + vec3(0, s, 0)).r - texture(u_volumeTex, uv - vec3(0, s, 0)).r;
              float dZ = texture(u_volumeTex, uv + vec3(0, 0, s)).r - texture(u_volumeTex, uv - vec3(0, 0, s)).r;
              
              vec3 rawNorm = vec3(dX, dY, dZ);
              if (length(rawNorm) > 0.0001) {
                hitNorm = normalize(rawNorm);
              }
              break;
            }

            t += stepSize;
          }

          if (!hit) {
            discard; // Return transparency if we don't find a voxel surface!
          }

          // Lighting (Convert hitNorm to World Space to fix head-rolling!)
          vec3 worldNorm = normalize(mat3(modelMatrix) * hitNorm);
          vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
          float diffuse = max(dot(worldNorm, lightDir), 0.0);
          fragColor = vec4(vec3(diffuse), 1.0);

          vec4 clipPos = u_projMatrix * u_viewMatrix * modelMatrix * vec4(origin + dir * t, 1.0);
          gl_FragDepth = (clipPos.z / clipPos.w) * 0.5 + 0.5;
        }
      `,
      uniforms: {
        u_volumeTex: { value: this._texture },
        u_boxWorldPos: { value: new THREE.Vector3() },
        u_invModelMatrix: { value: new THREE.Matrix4() },
        u_projMatrix: { value: new THREE.Matrix4() },
        u_viewMatrix: { value: new THREE.Matrix4() }
      },
      transparent: true,
      side: THREE.BackSide, // Render inside if camera enters!
      glslVersion: THREE.GLSL3
    });

    this._geometry = new THREE.BoxGeometry(this._size, this._size, this._size);
    this._mesh = new THREE.Mesh(this._geometry, this._material);

    // Update inverse matrix before render
    const self2 = this;
    this._mesh.onBeforeRender = function(renderer, scene, camera) {
      self2._material.uniforms.u_invModelMatrix.value.copy(this.matrixWorld).invert();
      self2._material.uniforms.u_projMatrix.value.copy(camera.projectionMatrix);
      self2._material.uniforms.u_viewMatrix.value.copy(camera.matrixWorldInverse);
    };
  }

  getThreeMesh() {
    return this._mesh;
  }

  updateGrid(data) {
    const res = this._res;
    
    // Dispose old texture to prevent memory leak
    if (this._texture) {
      this._texture.dispose();
    }

    this._texture = new THREE.Data3DTexture(data, res, res, res);
    this._texture.format = THREE.RedFormat;
    this._texture.type = THREE.FloatType;
    this._texture.minFilter = THREE.NearestFilter;
    this._texture.magFilter = THREE.NearestFilter;
    this._texture.wrapS = THREE.ClampToEdgeWrapping;
    this._texture.wrapT = THREE.ClampToEdgeWrapping;
    this._texture.wrapR = THREE.ClampToEdgeWrapping;
    this._texture.needsUpdate = true;

    this._material.uniforms.u_volumeTex.value = this._texture;
  }
}
