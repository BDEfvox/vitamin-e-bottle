import * as THREE from 'three';
import { makeLabelTexture } from './label.js';

const BODY_R = 0.34;
const SEGMENTS = 192;

const arc = (cx, cy, r, a0, a1, n) => {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + (a1 - a0) * (i / n)) * Math.PI / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
};
const bezier = (p0, p1, p2, p3, n) => {
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return pts;
};
const line = (a, b, n) => {
  const pts = [];
  for (let i = 1; i <= n; i++) pts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  return pts;
};
const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// occlusion along a lathe profile, stored in a 1 x N texture (v runs along the profile)
function profileAO(pts, fn) {
  const data = new Uint8Array(pts.length * 4);
  pts.forEach(([r, y], i) => {
    const v = Math.round(255 * Math.min(1, Math.max(0, fn(r, y))));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, 1, pts.length, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// soft cloudy noise, used to vary roughness slightly across a surface
function cloudTexture(size, lo, hi, streak = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const mid = Math.round(255 * (lo + hi) / 2);
  g.fillStyle = `rgb(${mid},${mid},${mid})`;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = (6 + Math.random() * 46) * size / 512;
    const v = Math.round(255 * (lo + Math.random() * (hi - lo)));
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        grad.addColorStop(0, `rgba(${v},${v},${v},0.22)`);
        grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = grad;
        g.save();
        g.translate(x + ox, y + oy);
        g.scale(streak, 1);
        g.translate(-(x + ox), -(y + oy));
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        g.restore();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function makeBottle(maxAnisotropy) {
  const bottle = new THREE.Group();

  const lathe = (pts, mat) => {
    const geo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y)), SEGMENTS);
    const m = new THREE.Mesh(geo, mat);
    bottle.add(m);
    return m;
  };

  // ----- glass body: shallow punt, rounded heel, straight wall, round shoulder, neck -----
  const body = [
    [0, 0.018], [0.12, 0.014], [0.22, 0.006], [0.268, 0.0],
    ...arc(0.28, 0.062, 0.062, -90, 0, 12).slice(1),
    ...line([0.342, 0.062], [0.342, 0.9], 6),
    ...arc(0.165, 0.9, 0.177, 0, 68, 22).slice(1),
  ];
  {
    const p0 = body[body.length - 1];
    const a = 68 * Math.PI / 180;
    const t0 = [-Math.sin(a), Math.cos(a)];
    body.push(...bezier(p0, [p0[0] + t0[0] * 0.055, p0[1] + t0[1] * 0.055], [0.15, 1.092], [0.15, 1.128], 10));
    body.push([0.15, 1.17]);
  }
  const roughCloud = cloudTexture(512, 0.8, 1.0);
  roughCloud.repeat.set(2, 2);
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x050505,
    roughness: 0.36,
    roughnessMap: roughCloud,
    specularIntensity: 0.75,
    metalness: 0.0,
    // the collar overhangs the shoulder and shades it; the base faces the ground
    aoMap: profileAO(body, (r, y) => Math.min(1 - 0.8 * smooth(1.0, 1.1, y), 0.55 + 0.45 * smooth(0.0, 0.06, y))),
  });
  lathe(body, glass);

  // ----- anodised gold collar -----
  const collar = [
    [0.152, 1.106], [0.188, 1.106],
    ...arc(0.188, 1.119, 0.013, -90, 0, 6).slice(1),
    ...line([0.201, 1.119], [0.201, 1.35], 4),
    ...arc(0.173, 1.35, 0.028, 0, 90, 10).slice(1),
    [0.15, 1.378], [0.128, 1.378],
  ];
  const brushed = cloudTexture(256, 0.72, 1.0, 14);
  brushed.repeat.set(3, 1);
  const gold = new THREE.MeshPhysicalMaterial({
    color: 0xe9a430,
    metalness: 1.0,
    roughness: 0.24,
    roughnessMap: brushed,
    anisotropy: 0.5,
    anisotropyRotation: Math.PI / 2, // turned metal: highlights run along the axis
    aoMap: profileAO(collar, (r, y) => 0.55 + 0.45 * smooth(1.106, 1.125, y)),
  });
  lathe(collar, gold);

  // ----- rubber bulb: flange, waist, tapered stem, dome -----
  const bulb = [
    [0.128, 1.374], [0.15, 1.376],
    ...arc(0.152, 1.39, 0.014, -90, 0, 6).slice(1),
    ...arc(0.152, 1.408, 0.014, 0, 90, 6),
    ...bezier([0.152, 1.422], [0.14, 1.424], [0.136, 1.44], [0.135, 1.47], 8),
    ...line([0.135, 1.47], [0.124, 1.655], 5),
    ...arc(0, 1.655, 1, 0, 90, 24).slice(1).map(([c, s]) => [0.124 * c, 1.655 + 0.165 * (s - 1.655)]),
  ];
  const rubber = new THREE.MeshPhysicalMaterial({
    color: 0x050505,
    roughness: 0.56,
    metalness: 0.0,
    sheen: 0.35,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color(0x2a2a2a),
    aoMap: profileAO(bulb, (r, y) => 0.45 + 0.55 * smooth(1.376, 1.45, y)),
  });
  lathe(bulb, rubber);

  // ----- printed label wrapped around the straight wall -----
  const LABEL_H = 0.74;
  const r = BODY_R + 0.0035;
  const tex = makeLabelTexture(2 * Math.PI * r / LABEL_H);
  tex.anisotropy = maxAnisotropy;
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, LABEL_H, SEGMENTS, 1, true),
    new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      roughness: 0.62,
      metalness: 0.0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      // keep the alpha already in the buffer: it carries focus / coverage data
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    })
  );
  label.position.y = 0.48;
  label.rotation.y = -Math.PI / 2; // front panel (u = 0.25) faces +Z
  bottle.add(label);

  return bottle;
}
