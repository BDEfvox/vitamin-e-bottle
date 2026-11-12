import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { makeSky, makeDunes, makeEnvGround, makeLightCards } from './world.js';
import { makeGround } from './ground.js';
import { makeBottle } from './bottle.js';
import { makeAccumulate, makePlateBlur, makeComposite, makeFinal, makeBloomDown, makeBloomBlur } from './post.js';

// How this stays fast: the camera never moves, so the sky, the dunes, the wet
// gravel and all of the background blur are rendered once at load into a single
// image (the "plate"). Each frame only draws the bottle twice (once for its
// reflection), one full-screen composite and one finishing pass.

// ---------- motion (Minecraft dropped-item timing) ----------
// Minecraft: bob = sin(age / 10) * 0.1 + 0.1 and spin = age / 20 rad, at 20 ticks/s,
// i.e. a bob every pi seconds and a full turn every 2*pi seconds.
const SPIN_SPEED = 1.0;   // rad / s
const BOB_SPEED = 2.0;    // rad / s
const BOB_AMOUNT = 0.085; // world units, the bottle is ~1.8 tall
const HOVER = 0.19;       // mean height of the bottle base above the ground

const params = new URLSearchParams(location.search);
const MAX_RES = parseInt(params.get('res'), 10) || 1440; // internal square resolution cap
const BAKE_SAMPLES = 48;
const BLUR_AT_INFINITY = 10 / 1080; // background blur radius, as a fraction of the frame

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({
  antialias: false, alpha: false, depth: false, stencil: false,
  powerPreference: 'high-performance',
});
renderer.autoClear = false;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setPixelRatio(1);
document.body.prepend(renderer.domElement);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

// ---------- cameras ----------
const CAM = new THREE.Vector3(0, 0.72, 8.6);
const camera = new THREE.PerspectiveCamera(22, 1, 0.5, 600);
camera.position.copy(CAM);
camera.lookAt(0, 0.99, 0);
camera.updateMatrixWorld();

// The reflection in a flat mirror is what a camera at the mirrored position
// sees, so the bottle's reflection is rendered from below the ground.
const mirrorCam = new THREE.PerspectiveCamera(17.5, 1, 1, 40);
mirrorCam.position.set(CAM.x, -CAM.y, CAM.z);
mirrorCam.lookAt(0, 1.05, 0);
mirrorCam.updateMatrixWorld();
const mirrorMatrix = new THREE.Matrix4()
  .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
  .multiply(mirrorCam.projectionMatrix)
  .multiply(mirrorCam.matrixWorldInverse);

const focus = -new THREE.Vector3(0, 0.6, 0.34).applyMatrix4(camera.matrixWorldInverse).z;

// ---------- static world ----------
const world = new THREE.Scene();
const sky = makeSky();
const dunes = makeDunes();
const ground = makeGround();
const envGround = makeEnvGround();
const cards = makeLightCards();
world.add(sky, dunes, ground, envGround, cards);
const show = (...visible) => {
  for (const o of [sky, dunes, ground, envGround, cards]) o.visible = visible.includes(o);
};

// what the ground reflects: sky and dunes as seen from the mirrored camera
const envCubeRT = new THREE.WebGLCubeRenderTarget(1024, {
  type: THREE.HalfFloatType,
  generateMipmaps: true,
  minFilter: THREE.LinearMipmapLinearFilter,
});
{
  const cubeCam = new THREE.CubeCamera(0.05, 600, envCubeRT);
  cubeCam.position.copy(mirrorCam.position);
  show(sky, dunes);
  cubeCam.update(renderer, world);
}
ground.material.uniforms.envCube.value = envCubeRT.texture;
ground.material.uniforms.mirrorMatrix.value.copy(mirrorMatrix);
ground.material.uniforms.focus.value = focus;

// ---------- the bottle ----------
const bottleScene = new THREE.Scene();
const bottle = makeBottle(maxAniso);
bottleScene.add(bottle);
{
  // image-based light for the bottle: the real surroundings plus soft light cards
  show(sky, dunes, envGround, cards);
  const pmrem = new THREE.PMREMGenerator(renderer);
  bottleScene.environment = pmrem.fromScene(world, 0, 0.1, 600, {
    size: 512,
    position: new THREE.Vector3(0, 1.0, 0),
  }).texture;
  bottleScene.environmentIntensity = 0.8;
  pmrem.dispose();
}

// ---------- passes and buffers ----------
const accumulate = makeAccumulate();
const plateBlur = makePlateBlur();
const composite = makeComposite();
const final = makeFinal();
const bloomDown = makeBloomDown();
const bloomBlur = makeBloomBlur();
const quad = new FullScreenQuad(composite);
const zeroMat = new THREE.ShaderMaterial({
  vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
});

let res = 0;
let plateRT, dataRT, mirrorRT, mainRT, bloomA, bloomB;
const halton = (i, b) => {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
};

function bake(size) {
  const t0 = performance.now();
  res = size;
  for (const rt of [plateRT, dataRT, mirrorRT, mainRT, bloomA, bloomB]) rt?.dispose();

  const hdr = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const sampleRT = new THREE.WebGLRenderTarget(res, res, { ...hdr, depthBuffer: true });
  const accRT = new THREE.WebGLRenderTarget(res, res, { ...hdr, depthBuffer: false });
  plateRT = new THREE.WebGLRenderTarget(res, res, { ...hdr, depthBuffer: false });
  dataRT = new THREE.WebGLRenderTarget(res, res, {
    type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
  });
  const mirrorRes = res > 1100 ? 1024 : 768;
  mirrorRT = new THREE.WebGLRenderTarget(mirrorRes, mirrorRes, {
    ...hdr, depthBuffer: true, samples: 4,
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
  });
  mainRT = new THREE.WebGLRenderTarget(res, res, { ...hdr, depthBuffer: true, samples: 4 });
  const q = Math.round(res / 4);
  bloomA = new THREE.WebGLRenderTarget(q, q, { ...hdr, depthBuffer: false });
  bloomB = new THREE.WebGLRenderTarget(q, q, { ...hdr, depthBuffer: false });
  bloomDown.uniforms.texel.value.set(1 / res, 1 / res);
  final.uniforms.tBloom.value = bloomA.texture;

  const cocMax = BLUR_AT_INFINITY * res;
  const cocScale = cocMax * focus;
  const gu = ground.material.uniforms;
  gu.cocScale.value = cocScale;
  gu.cocMax.value = cocMax;

  renderer.setClearColor(0x000000, 0);

  // 1. static scene, averaged over jittered samples (anti-aliases the gravel)
  show(sky, dunes, ground);
  gu.mode.value = 0;
  renderer.setRenderTarget(accRT);
  renderer.clear(true, false, false);
  accumulate.uniforms.tSrc.value = sampleRT.texture;
  accumulate.uniforms.weight.value = 1 / BAKE_SAMPLES;
  for (let i = 0; i < BAKE_SAMPLES; i++) {
    camera.setViewOffset(res, res, halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5, res, res);
    gu.seed.value = i;
    renderer.setRenderTarget(sampleRT);
    renderer.clear(true, true, false);
    renderer.render(world, camera);
    renderer.setRenderTarget(accRT);
    quad.material = accumulate;
    quad.render(renderer);
  }
  camera.clearViewOffset();

  // 2. blur everything behind the focal plane, once
  plateBlur.uniforms.tSrc.value = accRT.texture;
  plateBlur.uniforms.texel.value.set(1 / res, 1 / res);
  plateBlur.uniforms.focus.value = focus;
  plateBlur.uniforms.cocScale.value = cocScale;
  plateBlur.uniforms.cocMax.value = cocMax;
  renderer.setRenderTarget(plateRT);
  quad.material = plateBlur;
  quad.render(renderer);

  // 3. lookup data for the bottle's moving reflection
  show(dunes, ground);
  gu.mode.value = 1;
  const duneMat = dunes.material;
  dunes.material = zeroMat;
  renderer.setRenderTarget(dataRT);
  renderer.clear(true, true, false);
  renderer.render(world, camera);
  dunes.material = duneMat;

  sampleRT.dispose();
  accRT.dispose();

  composite.uniforms.tPlate.value = plateRT.texture;
  composite.uniforms.tData.value = dataRT.texture;
  composite.uniforms.tMirror.value = mirrorRT.texture;
  final.uniforms.tMain.value = mainRT.texture;
  final.uniforms.texel.value.set(1 / res, 1 / res);
  final.uniforms.cocMax.value = cocMax;
  const focalLine = new THREE.Vector3(0, 0, CAM.z - focus).project(camera);
  final.uniforms.dofTop.value = 0.5 + 0.5 * focalLine.y + (cocMax + 2) / res;

  renderer.setRenderTarget(null);
  window.__bakeMs = Math.round(performance.now() - t0);
}

function layout() {
  const css = Math.floor(Math.min(window.innerWidth, window.innerHeight));
  const size = Math.max(256, Math.min(Math.round(css * window.devicePixelRatio), MAX_RES));
  renderer.domElement.style.width = renderer.domElement.style.height = css + 'px';
  if (size !== res) {
    renderer.setSize(size, size, false);
    bake(size);
  }
}
layout();
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layout, 150);
});

// ---------- frame ----------
function draw(t) {
  bottle.rotation.y = t * SPIN_SPEED;
  bottle.position.y = HOVER + Math.sin(t * BOB_SPEED) * BOB_AMOUNT;

  // bottle as seen by the mirror
  renderer.setRenderTarget(mirrorRT);
  renderer.clear(true, true, false);
  renderer.render(bottleScene, mirrorCam);

  // plate + reflection, then the bottle itself
  renderer.setRenderTarget(mainRT);
  renderer.clear(false, true, false);
  quad.material = composite;
  quad.render(renderer);
  renderer.render(bottleScene, camera);

  // lens glow: bright areas at quarter size, blurred twice
  bloomDown.uniforms.tSrc.value = mainRT.texture;
  renderer.setRenderTarget(bloomA);
  quad.material = bloomDown;
  quad.render(renderer);
  quad.material = bloomBlur;
  const bt = 1 / bloomA.width;
  for (let i = 0; i < 2; i++) {
    const step = bt * (1 + i * 1.5);
    bloomBlur.uniforms.tSrc.value = bloomA.texture;
    bloomBlur.uniforms.dir.value.set(step, 0);
    renderer.setRenderTarget(bloomB);
    quad.render(renderer);
    bloomBlur.uniforms.tSrc.value = bloomB.texture;
    bloomBlur.uniforms.dir.value.set(0, step);
    renderer.setRenderTarget(bloomA);
    quad.render(renderer);
  }

  // finish to screen
  renderer.setRenderTarget(null);
  final.uniforms.time.value = t;
  quad.material = final;
  quad.render(renderer);
}

// ---------- loop ----------
const frozen = params.get('t'); // ?t=<seconds> shows a still
let start = null;
let pausedAt = null;
let now = 0;
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  if (pausedAt === null) pausedAt = now;
  else { start += now - pausedAt; pausedAt = null; }
});

function tick(ts) {
  now = ts;
  if (start === null) start = ts;
  const t = frozen !== null ? (parseFloat(frozen) || 0) : ((pausedAt ?? ts) - start) / 1000;
  draw(t);
  requestAnimationFrame(tick);
}
draw(frozen !== null ? (parseFloat(frozen) || 0) : 0);
requestAnimationFrame(tick);

// Measures the real cost of a frame (GPU included), independent of the display's refresh rate.
// (Reading a pixel back forces the GPU to finish everything queued.)
window.__bench = (frames = 200) => {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  draw(0);
  sync();
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) draw(i / 60);
  sync();
  return { msPerFrame: +((performance.now() - t0) / frames).toFixed(2), res };
};
