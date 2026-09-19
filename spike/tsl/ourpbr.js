// ShaderPBR's ACTUAL BRDF, expressed as TSL nodes.
//
// The point is a like-for-like cost comparison, so this is a transcription rather than an
// improvement: the same GGX D, the same Schlick-Smith G with k = a/2, the same Schlick F, the
// same SH9 irradiance, and — the part that matters — the same DELIBERATELY NON-PHYSICAL
// falloff, 1/(1 + d²/r²). Scene units here are arbitrary and large (a camel is ~180 across),
// so inverse-square would want intensities in the thousands and blow out the moment a light
// moved closer. Swapping it for the physical law would change the feel of every existing scene
// and make the Falloff slider mean something else.
//
// What this tells us that a stock MeshPhysicalNodeMaterial cannot: what OUR shader costs once
// ported. The stock one is a different (mostly better) material; it answers a different
// question, and it is the other half of the A/B.
import * as THREE from 'three/webgpu';
import {
  Fn, uniformArray, uniform, Loop, If, Break, vec3, float, positionView, normalView,
  cameraViewMatrix, normalize, dot, max, pow, mix, smoothstep, abs, inversesqrt,
} from 'three/tsl';

export const MAX_LIGHTS = 8;

export function makeOurPBR(opts = {}) {
  const nbLights   = uniform(opts.nbLights ?? 4);
  const exposure   = uniform(opts.exposure ?? 1.0);
  const envIntensity = uniform(opts.envIntensity ?? 1.0);
  const baseColor  = uniform(new THREE.Color(0.85, 0.86, 0.9));

  const lightPos   = uniformArray(new Array(MAX_LIGHTS).fill(0).map(() => new THREE.Vector3()));
  const lightCol   = uniformArray(new Array(MAX_LIGHTS).fill(0).map(() => new THREE.Vector3(1, 1, 1)));
  const lightRange = uniformArray(new Array(MAX_LIGHTS).fill(30));
  // Nine coefficients, the same irradiance basis ShaderPBR uploads as uSPH.
  const sph = uniformArray(new Array(9).fill(0).map((_, i) =>
    new THREE.Vector3(0.14 - i * 0.008, 0.16 - i * 0.008, 0.2 - i * 0.009)));

  const sphericalHarmonics = Fn(([N]) => {
    const x = N.x, y = N.y, z = N.z.negate();
    return sph.element(0)
      .add(sph.element(1).mul(y)).add(sph.element(2).mul(z)).add(sph.element(3).mul(x))
      .add(sph.element(4).mul(y).mul(x)).add(sph.element(5).mul(y).mul(z))
      .add(sph.element(6).mul(z.mul(z).mul(3.0).sub(1.0)))
      .add(sph.element(7).mul(z.mul(x)))
      .add(sph.element(8).mul(x.mul(x).sub(y.mul(y))))
      .max(vec3(0.0));
  });

  const shade = Fn(() => {
    const N = normalize(normalView);
    const V = normalize(positionView).negate();
    const NdV = max(dot(N, V), float(1e-4));

    // Per-vertex roughness and metalness is what COLOR_1 carries in the real shader; a
    // procedural stand-in keeps the same per-fragment work without needing the attribute here.
    const rough = max(positionView.y.mul(3.0).sin().mul(0.2).add(0.45), float(0.0001));
    const metal = float(0.1);

    const linColor = vec3(baseColor);
    const albedo   = linColor.mul(float(1.0).sub(metal));
    const specular = mix(vec3(0.04), linColor, metal);

    // IBL diffuse, exactly as ours: SH irradiance times albedo, scaled by exposure and the
    // environment intensity added in #79's sibling change.
    const color = albedo.mul(sphericalHarmonics(N)).mul(exposure).mul(envIntensity).toVar();

    Loop({ start: 0, end: MAX_LIGHTS, type: 'int', condition: '<' }, ({ i }) => {
      If(i.greaterThanEqual(nbLights), () => { Break(); });

      const toL = cameraViewMatrix.mul(lightPos.element(i).toVec4(1.0)).xyz.sub(positionView);
      const dist2 = dot(toL, toL);
      const L = toL.mul(inversesqrt(max(dist2, float(1e-12))));
      const r = max(lightRange.element(i), float(1e-4));
      const att = float(1.0).div(float(1.0).add(dist2.div(r.mul(r))));   // OURS, not inverse-square
      const NdL = max(dot(N, L), float(0.0));

      const H = normalize(L.add(V));
      const NdH = max(dot(N, H), float(0.0));
      const VdH = max(dot(V, H), float(0.0));
      const a = rough.mul(rough);
      const a2 = a.mul(a);
      const dd = NdH.mul(NdH).mul(a2.sub(1.0)).add(1.0);
      const D = a2.div(max(dd.mul(dd).mul(3.14159265), float(1e-6)));
      const k = a.mul(0.5);
      const G = NdL.div(NdL.mul(float(1.0).sub(k)).add(k))
        .mul(NdV.div(NdV.mul(float(1.0).sub(k)).add(k)));
      const F = specular.add(vec3(1.0).sub(specular).mul(pow(float(1.0).sub(VdH), 5.0)));
      const spec = F.mul(D.mul(G).mul(0.25).div(max(NdL.mul(NdV), float(1e-4))));

      color.addAssign(
        lightCol.element(i).mul(exposure).mul(att).mul(NdL)
          .mul(albedo.mul(0.31830989).add(spec)));
    });

    return color;
  });

  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = shade();
  m.userData.tslUniforms = { nbLights, exposure, envIntensity, baseColor, lightPos, lightCol, lightRange };
  return m;
}
