import * as THREE from 'three';
import { NOISE, SKY } from './glsl.js';

// ---------- CPU noise (dune shapes) ----------
const hash2 = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
};
const vnoise = (x, y) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};
const fbm = (x, y, oct) => {
  let amp = 0.5, sum = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x, y);
    x = x * 2.03 + 17.1; y = y * 2.03 + 9.7; amp *= 0.5;
  }
  return sum;
};
// sharp crests, smooth troughs
const ridged = (x, y, oct) => {
  let amp = 0.5, sum = 0, weight = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(vnoise(x, y) * 2 - 1);
    n = n * n * weight;
    weight = Math.min(1, n * 1.6);
    sum += amp * n;
    x = x * 2.07 + 31.3; y = y * 2.07 + 4.9; amp *= 0.5;
  }
  return sum;
};
const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bump = (x, z, cx, cz, rx, rz) => Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2));

function duneHeight(x, z) {
  // domain warp for flowing, wind-shaped forms
  const wx = x + 7 * (fbm(x * 0.035 + 3.1, z * 0.035, 3) - 0.5);
  const wz = z + 7 * (fbm(x * 0.035, z * 0.035 + 8.4, 3) - 0.5);
  const u = wx * 0.06 + wz * 0.022, v = wz * 0.085 - wx * 0.014;
  const shape = 0.3 + 1.0 * ridged(u, v, 5) + 0.12 * fbm(u * 4.0, v * 4.0, 3);
  const mass =
    11.5 * bump(x, z, -13, -30, 11, 13) +   // tall mound, left
    4.6 * bump(x, z, 2, -31, 10, 9) +       // saddle behind the bottle
    5.6 * bump(x, z, 14, -44, 13, 13) +     // lower ridge, right
    4.2 * bump(x, z, -2, -70, 30, 14) +     // middle distance
    6.5 * bump(x, z, 30, -105, 60, 22) +    // far backdrop
    7.5 * bump(x, z, -55, -80, 34, 30);
  const rise = smooth(-8.5, -19, z);
  return mass * shape * rise - 0.25;
}

// ---------- sky ----------
export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      ${NOISE}
      ${SKY}
      void main() {
        gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0e4);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

// ---------- dunes ----------
export function makeDunes() {
  const NX = 640, NZ = 460;
  const X0 = -110, X1 = 110, Z0 = -6, Z1 = -150;
  const geo = new THREE.PlaneGeometry(1, 1, NX, NZ);
  const pos = geo.attributes.position;
  const W = NX + 1, H = NZ + 1;
  const heights = new Float32Array(W * H);
  const dx = (X1 - X0) / NX, dz = (Z1 - Z0) / NZ;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = X0 + i * dx, z = Z0 + j * dz;
      const h = duneHeight(x, z);
      heights[j * W + i] = h;
      pos.setXYZ(j * W + i, x, h, z);
    }
  }
  geo.computeVertexNormals();
  // PlaneGeometry winds for +Z normals; after remapping to XZ make sure normals face up
  const nrm = geo.attributes.normal;
  if (nrm.getY(Math.floor(W * H / 2)) < 0) {
    const idx = geo.index;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
    geo.computeVertexNormals();
  }

  // sky visibility per vertex: scan the horizon in 8 directions
  const ao = new Float32Array(W * H);
  const dirs = 8, steps = 10;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const h0 = heights[j * W + i];
      let occ = 0;
      for (let d = 0; d < dirs; d++) {
        const a = (d / dirs) * Math.PI * 2;
        const sx = Math.cos(a), sz = Math.sin(a);
        let maxTan = 0;
        for (let s = 1; s <= steps; s++) {
          const r = s * s * 0.35 + 0.65; // in grid cells, growing stride
          const ii = Math.round(i + sx * r), jj = Math.round(j + sz * r);
          if (ii < 0 || jj < 0 || ii >= W || jj >= H) break;
          const dist = Math.hypot((ii - i) * dx, (jj - j) * dz);
          const t = (heights[jj * W + ii] - h0) / dist;
          if (t > maxTan) maxTan = t;
        }
        occ += Math.sin(Math.atan(maxTan));
      }
      ao[j * W + i] = 1 - occ / dirs;
    }
  }
  geo.setAttribute('ao', new THREE.BufferAttribute(ao, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      attribute float ao;
      varying vec3 vWorld;
      varying vec3 vN;
      varying float vAO;
      varying float vViewZ;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vN = normal;
        vAO = ao;
        vec4 mv = viewMatrix * wp;
        vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vWorld;
      varying vec3 vN;
      varying float vAO;
      varying float vViewZ;
      ${NOISE}
      ${SKY}
      void main() {
        if (vWorld.y < 0.0) discard;
        vec3 N = normalize(vN);
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 p = vWorld.xz;

        // wind ripples: warped stripes running along the slopes, two scales
        vec2 wdir = normalize(vec2(0.86, 0.5));
        float warp = fbm(p * 0.11) * 9.0;
        float amp = 0.05 + 0.2 * vnoise(p * 0.17 + 5.0);
        float d1 = cos(dot(p, wdir) * 4.6 + warp * 2.4) * amp;
        float d2 = cos(dot(p, wdir.yx * vec2(-1.0, 1.0)) * 1.1 + dot(p, wdir) * 11.0 + warp * 4.0) * amp * 0.55;
        // fine grain so the slopes read as sand, not plastic
        vec2 grit = (vec2(vnoise(p * 9.0), vnoise(p * 9.0 + 41.0)) - 0.5) * 0.22;
        N = normalize(N + vec3(wdir.x, 0.0, wdir.y) * (d1 + d2) + vec3(grit.x, 0.0, grit.y));

        float NoV = clamp(dot(N, V), 0.0, 1.0);
        vec3 R = reflect(-V, N);
        float ao = clamp(vAO, 0.0, 1.0);
        ao = ao * ao;

        // damp black sand: weak diffuse, broad glossy sheen from the sky
        float rough = 0.46;
        float F = 0.04 + (1.0 - rough - 0.04) * pow(1.0 - NoV, 5.0);
        vec3 Rr = normalize(mix(R, N, rough * rough));
        vec3 env = skyColor(vec3(Rr.x, max(Rr.y, 0.03), Rr.z));
        float horizon = smoothstep(-0.25, 0.3, R.y);
        vec3 spec = env * F * horizon * ao * 0.16;
        spec += vec3(1.3) * pow(max(dot(R, SUN_DIR), 0.0), 14.0) * (0.03 + 0.4 * pow(1.0 - NoV, 3.0)) * ao;
        vec3 diff = vec3(0.006) * mix(0.25, 2.0, 0.5 + 0.5 * N.y) * ao;
        vec3 col = diff + spec;

        // haze
        float fog = 1.0 - exp(-dist * 0.0032);
        col = mix(col, vec3(1.0), fog * fog * 0.55 + fog * 0.03);
        gl_FragColor = vec4(col, vViewZ);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

// Cheap stand-in for the wet ground, used only in the bottle's environment map:
// dark looking straight down, mirror-bright at grazing angles.
export function makeEnvGround() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vWorld;
      ${NOISE}
      ${SKY}
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
        float F = 0.03 + 0.97 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
        float wet = smoothstep(0.42, 0.6, fbm(vWorld.xz * 0.5 + 3.1));
        vec3 col = vec3(0.004) + skyColor(R) * F * mix(0.22, 0.8, wet);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat);
  m.rotation.x = -Math.PI / 2;
  return m;
}

// Soft light cards, also only for the bottle's environment map.
export function makeLightCards() {
  const group = new THREE.Group();
  const card = (x, y, z, w, h, power) => {
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { power: { value: power } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float power;
        varying vec2 vUv;
        void main() {
          vec2 q = abs(vUv - 0.5) * 2.0;
          float soft = (1.0 - smoothstep(0.55, 1.0, q.x)) * (1.0 - smoothstep(0.7, 1.0, q.y));
          gl_FragColor = vec4(vec3(power * soft), 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.lookAt(0, 1, 0);
    group.add(m);
  };
  card(-8, 4.5, 6.5, 2.0, 11, 20.0);  // key, front left
  card(8.5, 4, -4.5, 2.2, 11, 12.0);  // rim, back right
  card(-9, 3.5, -3, 1.6, 9, 5.0);     // thin rim, back left
  // black flags: they block the sky and give the metal and glass their dark bands
  const flag = (x, y, z, w, h) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: 0x030303, side: THREE.DoubleSide })
    );
    m.position.set(x, y, z);
    m.lookAt(0, 1, 0);
    group.add(m);
  };
  flag(6.5, 3, 7, 7, 9);
  flag(-2.5, 3, 10, 5, 9);
  return group;
}
