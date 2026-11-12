import * as THREE from 'three';
import { NOISE } from './glsl.js';

// Wet gravel, evaluated once at load (the camera never moves).
//
// mode 0: static radiance of the ground reflecting sky and dunes. Alpha = view depth.
// mode 1: per-pixel data needed to add the moving bottle's reflection each frame:
//         xy = where to look in the bottle mirror image, z = reflection weight
//         (negative on rough stone, positive on still water),
//         w  = near-field blur amount (0..1).
export function makeGround() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      envCube: { value: null },
      mirrorMatrix: { value: new THREE.Matrix4() },
      mode: { value: 0 },
      seed: { value: 0 },
      focus: { value: 8.6 },
      cocScale: { value: 100 }, // px * world units
      cocMax: { value: 12 },    // px
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      varying float vViewZ;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform samplerCube envCube;
      uniform mat4 mirrorMatrix;
      uniform int mode;
      uniform float seed;
      uniform float focus;
      uniform float cocScale;
      uniform float cocMax;
      varying vec3 vWorld;
      varying float vViewZ;
      ${NOISE}

      // one layer of rounded, slightly elongated pebbles; height in cell units
      float pebbles(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        float h = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 c = i + g;
            vec2 o = hash22(c);
            vec2 r = g + 0.5 + (o - 0.5) * 0.72 - f;
            float k = hash12(c + 17.3);
            float rad = mix(0.3, 0.6, k);
            float a = 6.2831 * hash12(c + 3.1);
            vec2 e = vec2(cos(a), sin(a));
            vec2 q = vec2(dot(r, e) * mix(0.68, 1.0, o.x), dot(r, vec2(-e.y, e.x)));
            float d = length(q) / rad;
            float cap = sqrt(max(1.0 - d * d, 0.0));
            h = max(h, cap * rad * mix(0.5, 0.9, o.y));
          }
        }
        return h;
      }

      float groundHeight(vec2 p) {
        float h1 = pebbles(p * 8.0) / 8.0;
        float h2 = pebbles(p * 17.0 + 7.7) / 17.0;
        float h3 = pebbles(p * 39.0 + 3.3) / 39.0;
        float h = max(h1, max(h2, h3));
        h += (vnoise(p * 150.0) - 0.5) * 0.0016 + (vnoise(p * 420.0) - 0.5) * 0.0006;
        return h;
      }

      // how deep the standing water is at this spot
      float waterLevel(vec2 p) {
        float n = fbm(p * 0.42 + 3.1);
        float pools = smoothstep(0.57, 0.7, n);
        // keep the strip in front of the bottle as wet stone, so its reflection streaks
        pools *= smoothstep(0.7, 1.5, length((p - vec2(0.2, 2.0)) / vec2(1.1, 2.8)));
        // a shallow pool off to the left, in front of the bottle
        vec2 q = (p - vec2(-1.9, 1.9)) / vec2(1.4, 0.5);
        pools = max(pools, 1.0 - smoothstep(0.5, 1.0, dot(q, q) + (vnoise(p * 1.7) - 0.5) * 0.6));
        float film = 0.008 + 0.01 * vnoise(p * 2.3 + 9.0);
        return mix(film, 0.07, pools);
      }

      void main() {
        vec2 p = vWorld.xz;
        vec3 toCam = cameraPosition - vWorld;
        vec3 V = normalize(toCam);

        float e = 0.0012;
        float h = groundHeight(p);
        float hx = groundHeight(p + vec2(e, 0.0));
        float hz = groundHeight(p + vec2(0.0, e));
        vec3 Ns = normalize(vec3(h - hx, e, h - hz));

        float level = waterLevel(p);
        float stone = smoothstep(-0.002, 0.004, h - level); // 1 = stone above water
        float flatness = 1.0 - stone;
        vec3 N = normalize(mix(vec3(0.0, 1.0, 0.0), Ns, stone));

        // wet glints: small mirror-like facets, most tipped a little towards the viewer.
        // They catch the sky as white specks, and the bottle where it stands in the way.
        vec2 gp = p * 64.0;
        vec2 gc = floor(gp);
        vec2 gr = hash22(gc + 91.7);
        float spot = step(0.78, hash12(gc + 5.3))
          * smoothstep(0.42, 0.3, length(fract(gp) - 0.5 - (gr - 0.5) * 0.3)) * stone;
        vec2 fwd = normalize(toCam.xz);
        vec2 side = vec2(-fwd.y, fwd.x);
        float tip = gr.x * gr.x * 0.6;
        float lean = (gr.y - 0.5) * 0.5;
        vec3 Ng = normalize(vec3(fwd.x * tip + side.x * lean, 1.0, fwd.y * tip + side.y * lean));
        N = normalize(mix(N, Ng, spot));

        // per-pass jitter: softens the lobe a little on wet stone
        vec2 rnd = hash22(gl_FragCoord.xy + seed * 19.19) - 0.5;
        vec3 Nj = normalize(N + vec3(rnd.x, 0.0, rnd.y) * mix(0.004, 0.05, stone * (1.0 - spot)));

        vec3 R = reflect(-V, Nj);
        float NoV = clamp(dot(Nj, V), 0.0, 1.0);
        float F = 0.028 + 0.972 * pow(1.0 - NoV, 5.0);

        // at this grazing angle crevices are mostly hidden behind their neighbours,
        // and rays that bounce low run into other stones
        float crevice = smoothstep(level - 0.004, level + 0.03, h);
        float seen = mix(1.0, 0.12 + 0.88 * crevice, stone);
        float escape = mix(1.0, smoothstep(-0.05, 0.16, R.y), stone);
        // rough wet rock scatters most of the light; still water and glints mirror it
        float gloss = mix(mix(1.0, 0.2, stone), 1.0, spot);
        float weight = F * seen * escape * gloss;

        float viewZ = vViewZ;

        if (mode == 0) {
          vec3 Rs = vec3(R.x, abs(R.y), R.z);
          float lod = mix(1.2, 2.2, flatness);
          vec3 env = textureLod(envCube, Rs, lod).rgb;
          vec3 col = vec3(0.0026) * seen + env * weight;
          gl_FragColor = vec4(col, viewZ);
          return;
        }

        // ---- mode 1: lookup for the bottle's reflection ----
        // the bottle is treated as a card standing on z = 0, facing the camera
        // Still water mirrors the bottle exactly. On wet stone each facet tips by a random
        // amount towards the viewer, so it picks up a random height of the bottle straight
        // ahead of it: together the facets read as a sparkling streak running to the viewer.
        vec3 Rc = reflect(-V, vec3(0.0, 1.0, 0.0));
        float w = F * seen * min(1.0, gloss * 3.0);
        vec2 uvB = vec2(0.0);
        float hit = 0.0;
        if (vWorld.z > -0.7) {
          float d = max(vWorld.z, 0.0) / -Rc.z + 0.35;
          vec4 q = mirrorMatrix * vec4(vWorld + Rc * d, 1.0);
          uvB = q.xy / q.w;
          if (stone > 0.5) {
            vec2 fc = mix(floor(p * 150.0), gc, step(0.5, spot));
            vec2 fr = hash22(fc + 47.1);
            uvB.y = mix(uvB.y, 0.95, pow(fr.x, 1.4));
            uvB.x += (fr.y - 0.5) * (0.03 + 0.09 * fr.x);
          }
          hit = step(0.002, uvB.x) * step(uvB.x, 0.998) * step(0.002, uvB.y) * step(uvB.y, 0.998);
        }
        float nearCoc = clamp(cocScale * (1.0 / viewZ - 1.0 / focus) / cocMax, 0.0, 1.0);
        // a reflection in still water is as sharp as the thing it reflects
        nearCoc *= mix(1.0, 0.12, flatness);
        // sign of z marks rough stone (soft reflection) versus still water (sharp)
        gl_FragColor = vec4(uvB, w * hit * (stone > 0.5 ? -1.0 : 1.0), nearCoc);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;
  return mesh;
}
