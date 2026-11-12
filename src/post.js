import * as THREE from 'three';
import { FULLSCREEN_VERT } from './glsl.js';

const pass = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({
  vertexShader: FULLSCREEN_VERT,
  fragmentShader,
  uniforms,
  depthTest: false,
  depthWrite: false,
  ...extra,
});

// Adds one jittered sample into the accumulation buffer.
export const makeAccumulate = () => pass(/* glsl */`
  uniform sampler2D tSrc;
  uniform float weight;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tSrc, vUv) * weight; }`,
  { tSrc: { value: null }, weight: { value: 1 } },
  { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, transparent: true });

// One-off, high-quality blur of everything behind the focal plane (runs at load).
// Input alpha is view depth.
export const makePlateBlur = () => pass(/* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 texel;
  uniform float focus;
  uniform float cocScale;
  uniform float cocMax;
  varying vec2 vUv;
  const int TAPS = 180;
  float cocFar(float z) { return clamp(cocScale * (1.0 / focus - 1.0 / z), 0.0, cocMax); }
  void main() {
    vec4 c = texture2D(tSrc, vUv);
    float cc = cocFar(c.a);
    if (c.a < focus) { gl_FragColor = vec4(c.rgb, 1.0); return; }
    vec3 sum = c.rgb / (cc * cc + 1.0);
    float wsum = 1.0 / (cc * cc + 1.0);
    float area = 3.14159 * cocMax * cocMax / float(TAPS);
    for (int i = 1; i < TAPS; i++) {
      float fi = float(i);
      float r = sqrt(fi / float(TAPS)) * cocMax;
      float a = fi * 2.399963;
      vec2 o = vec2(cos(a), sin(a)) * r;
      vec4 s = texture2D(tSrc, vUv + o * texel);
      float sc = cocFar(s.a);
      float w = clamp(sc - r + 1.0, 0.0, 1.0) * area / (3.14159 * sc * sc + 1.0);
      sum += s.rgb * w;
      wsum += w;
    }
    gl_FragColor = vec4(sum / wsum, 1.0);
  }`,
  { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, focus: { value: 8.6 }, cocScale: { value: 100 }, cocMax: { value: 12 } });

// Per frame: the baked plate plus the moving bottle's reflection in the ground.
// Output alpha = 1 - near-field blur amount.
export const makeComposite = () => pass(/* glsl */`
  uniform sampler2D tPlate;
  uniform sampler2D tData;
  uniform sampler2D tMirror;
  uniform float streak; // strength of the bottle's reflection on wet stone
  varying vec2 vUv;
  void main() {
    vec3 col = texture2D(tPlate, vUv).rgb;
    vec4 d = texture2D(tData, vUv);
    if (d.z != 0.0) {
      // wet stone gives a soft, glossy reflection; still water a sharp one
      vec4 b;
      if (d.z < 0.0) {
        // each wet facet mirrors a slightly soft piece of the bottle (glints), and the rough
        // surface also drags the bright parts into a streak towards the viewer
        b = textureLod(tMirror, d.xy, 1.2);
        vec3 smear = (textureLod(tMirror, d.xy, 3.0).rgb
                    + textureLod(tMirror, d.xy + vec2(0.0, 0.07), 3.0).rgb
                    + textureLod(tMirror, d.xy - vec2(0.0, 0.07), 3.0).rgb) / 3.0;
        col = col * (1.0 - b.a * 0.8) + (b.rgb + smear) * abs(d.z) * streak;
      } else {
        b = textureLod(tMirror, d.xy, 0.0);
        col = col * (1.0 - b.a) + b.rgb * d.z;
      }
    }
    gl_FragColor = vec4(col, 1.0 - d.w);
  }`,
  { tPlate: { value: null }, tData: { value: null }, tMirror: { value: null }, streak: { value: 5.0 } });

// Per frame, at quarter resolution: bright areas only, for the lens glow.
export const makeBloomDown = () => pass(/* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 texel;
  varying vec2 vUv;
  vec3 bright(vec2 uv) {
    vec3 c = texture2D(tSrc, uv).rgb;
    float l = max(c.r, max(c.g, c.b));
    return c * smoothstep(0.7, 2.2, l);
  }
  void main() {
    vec3 c = bright(vUv + texel * vec2(-1.0, -1.0)) + bright(vUv + texel * vec2(1.0, -1.0))
           + bright(vUv + texel * vec2(-1.0, 1.0)) + bright(vUv + texel * vec2(1.0, 1.0));
    gl_FragColor = vec4(c * 0.25, 1.0);
  }`,
  { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });

export const makeBloomBlur = () => pass(/* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 dir; // texel step along the blur axis
  varying vec2 vUv;
  void main() {
    // 9-tap gaussian folded into 5 bilinear fetches
    vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
    c += (texture2D(tSrc, vUv + dir * 1.3846153846).rgb + texture2D(tSrc, vUv - dir * 1.3846153846).rgb) * 0.3162162162;
    c += (texture2D(tSrc, vUv + dir * 3.2307692308).rgb + texture2D(tSrc, vUv - dir * 3.2307692308).rgb) * 0.0702702703;
    gl_FragColor = vec4(c, 1.0);
  }`,
  { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });

// Per frame: foreground blur (only below the focal line), glow, grain, vignette, tone curve.
export const makeFinal = () => pass(/* glsl */`
  uniform sampler2D tMain;
  uniform sampler2D tBloom;
  uniform vec2 texel;
  uniform float cocMax;
  uniform float dofTop;   // uv.y above which nothing is out of focus in the foreground
  uniform float time;
  uniform float exposure;
  varying vec2 vUv;
  const int TAPS = 64;

  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

  // ACES filmic (Stephen Hill's fit)
  vec3 rrtOdt(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 aces(vec3 c) {
    const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
    const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
    c *= exposure / 0.6;
    c = inM * c;
    c = rrtOdt(c);
    c = outM * c;
    return clamp(c, 0.0, 1.0);
  }

  void main() {
    vec4 c = texture2D(tMain, vUv);
    vec3 col = c.rgb;
    if (vUv.y < dofTop) {
      float cc = (1.0 - c.a) * cocMax;
      vec3 sum = col / (cc * cc + 1.0);
      float wsum = 1.0 / (cc * cc + 1.0);
      float area = 3.14159 * cocMax * cocMax / float(TAPS);
      float rot = ign(gl_FragCoord.xy) * 6.2831853;
      for (int i = 1; i < TAPS; i++) {
        float fi = float(i);
        float r = sqrt(fi / float(TAPS)) * cocMax;
        float a = fi * 2.399963 + rot;
        vec2 o = vec2(cos(a), sin(a)) * r;
        vec4 s = texture2D(tMain, vUv + o * texel);
        float sc = (1.0 - s.a) * cocMax;
        float w = clamp(sc - r + 1.0, 0.0, 1.0) * area / (3.14159 * sc * sc + 1.0);
        sum += s.rgb * w;
        wsum += w;
      }
      col = sum / wsum;
    }

    // lens: soft glow around bright areas, gentle vignette
    col += texture2D(tBloom, vUv).rgb * 0.07;
    vec2 q = vUv - 0.5;
    col *= 1.0 - 0.42 * smoothstep(0.25, 0.95, dot(q, q) * 2.0);

    col = aces(col);
    col = pow(col, vec3(1.0 / 2.2));

    // film grain, stronger in the mid-tones
    float n = fract(sin(dot(gl_FragCoord.xy + fract(time) * 173.0, vec2(12.9898, 78.233))) * 43758.5453);
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col += (n - 0.5) * 0.035 * (1.0 - 0.6 * luma);

    gl_FragColor = vec4(col, 1.0);
  }`,
  { tMain: { value: null }, tBloom: { value: null }, texel: { value: new THREE.Vector2() }, cocMax: { value: 12 }, dofTop: { value: 0.3 }, time: { value: 0 }, exposure: { value: 1.0 } });
