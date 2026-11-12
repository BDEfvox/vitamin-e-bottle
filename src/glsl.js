// Shared GLSL snippets.

export const NOISE = /* glsl */`
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return s;
}
`;

// Overcast sky: bright, nearly white, a soft brighter patch where the sun
// sits behind the cloud, faint mottling. Below the horizon it is dark.
export const SKY = /* glsl */`
const vec3 SUN_DIR = vec3(-0.4595, 0.4595, -0.7601);
vec3 skyColor(vec3 d) {
  float h = d.y;
  vec3 col = mix(vec3(1.5), vec3(2.25), smoothstep(-0.02, 0.65, h));
  col += vec3(1.3) * pow(max(dot(d, SUN_DIR), 0.0), 5.0);
  vec2 cuv = d.xz / (abs(h) + 0.3);
  col *= 0.9 + 0.2 * fbm(cuv * 1.3 + 4.0);
  return mix(vec3(0.012), col, smoothstep(-0.03, 0.0, h));
}
`;

export const FULLSCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
