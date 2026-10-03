// Coils — a ray-marched liquid helix: a tube wound round a wriggling, bending
// axis, smooth-blended with a smaller copy of itself, seen from a slow orbit.
//
// Ported from the WebGL1 sketch `fooz.html`. Its constants are uniforms here,
// and each defaults to the sketch's value. The screen uv is derived from
// `vTexCoord` rather than `gl_FragCoord`, so the pass is independent of the
// framebuffer's pixel density, and `uResolution` is only read for its aspect
// ratio. Two quirks of the sketch are kept, because together they are its look:
//
//   - The field is far from a true distance. The coil's centre moves sideways
//     about 5.8 units per unit of height (radius 1.1 x 5 turns per 6 units),
//     but `sdCoil()` measures only across the slice, so it can overestimate the
//     distance nearly six times over. The march steps 0.9 of it, tunnels
//     through most of the tube, and draws it as torn, streaming ribbons; any
//     step that lands inside counts as a hit. Step (`uStepScale`) is that 0.9.
//     Turning it down to about 0.2, with Steps at 160, fills the ribbons back
//     in toward a solid tube.
//
//   - `calcNormal()` takes its differences backwards, so the normal points down
//     the field's gradient, into the tube. All the lighting uses it as written.
//     Flipping it changes every pixel the coil covers.
export const coilsFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform vec2 uResolution;   // aspect ratio only
uniform float uTime;
uniform float uAngle;       // camera orbit angle, accumulated in JS
uniform float uTurns;       // turns per 6 units of height
uniform float uRadius;      // coil radius
uniform float uThick;       // tube radius
uniform float uLobes;       // cross-section ripple gain
uniform float uBulge;       // swelling along the coil
uniform float uWriggle;     // sway of the whole coil
uniform float uBend;        // lean of the coil's axis
uniform float uMelt;        // smooth-min radius between the two coils
uniform float uDist;        // camera distance
uniform float uHue;         // palette offset
uniform float uStepScale;   // fraction of the field taken per march step
uniform float uSteps;       // march budget

#define TAU 6.28318
#define MAX_STEPS 160
#define SURF 0.0015
#define HEIGHT 6.0
#define SKETCH_DIST 2.6     // the sketch's camera distance

float smin(float a, float b, float k) {
  k = max(k, 1e-4);   // k = 0 is a plain min, but would divide by zero
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Coiled helix tube, wriggling
float sdCoil(vec3 p, float t) {
  // Wriggle the whole coil. Both offsets read the unmoved p.
  float w1 = sin(t * 0.7 + p.y * 0.6) * uWriggle;
  float w2 = cos(t * 0.9 + p.x * 0.5) * uWriggle;
  p.x += w1;
  p.z += w2;

  // Coil axis along y, with a slow bend
  p.x += uBend * sin(t * 0.4) * 0.5 * p.y * 0.35;
  p.z += uBend * cos(t * 0.3) * 0.4 * p.y * 0.35;

  float y = p.y;
  float ang = y * uTurns * TAU / HEIGHT + t * 0.8;

  // Coil centre path
  vec2 c = vec2(cos(ang), sin(ang)) * uRadius;

  // Twist the tube's cross-section: its radius varies with angle along the coil
  vec2 d = p.xz - c;
  float ang2 = atan(d.y, d.x);
  float twist = ang * 3.0 + t * 1.5;
  float r = uThick
          + uLobes * (0.12 * sin(ang2 * 3.0 + twist) + 0.08 * sin(ang2 * 5.0 - twist * 1.7));

  // Liquid bulging along the coil
  r += uBulge * sin(y * 9.0 - t * 3.0);

  return length(d) - r;
}

// A second, smaller coil, offset, blended in for a liquid feel
float sdCoil2(vec3 p, float t) {
  p.y -= 0.4 * sin(t * 0.5);
  p.xz *= 0.55;
  p.y *= 1.6;
  return sdCoil(p, t * 1.3 + 2.0) * 1.6;
}

float map(vec3 p, float t) {
  return smin(sdCoil(p, t), sdCoil2(p, t), uMelt);
}

// Backwards, as in the sketch: this points into the surface (see the note above)
vec3 calcNormal(vec3 p, float t) {
  vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(
    map(p - e.xyy, t) - map(p + e.xyy, t),
    map(p - e.yxy, t) - map(p + e.yxy, t),
    map(p - e.yyx, t) - map(p + e.yyx, t)
  ));
}

float softShadow(vec3 ro, vec3 rd, float t) {
  float res = 1.0, d = 0.02;
  for (int i = 0; i < 24; i++) {
    float h = map(ro + rd * d, t);
    res = min(res, 9.0 * h / d);
    d += max(h, 0.01);
    if (res < 0.005 || d > 4.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float calcAO(vec3 p, vec3 n, float t) {
  float occ = 0.0, sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.02 + 0.11 * float(i) / 4.0;
    occ += (h - map(p + n * h, t)) * sca;
    sca *= 0.85;
  }
  return clamp(1.0 - 2.0 * occ, 0.0, 1.0);
}

vec3 palette(float f) {
  return 0.5 + 0.5 * cos(TAU * (f + uHue + vec3(0.0, 0.33, 0.67)));
}

void main() {
  vec2 res = uResolution;
  vec2 uv = (vTexCoord * 2.0 - 1.0) * vec2(res.x / res.y, 1.0);
  uv.y = -uv.y;   // vTexCoord runs top-down inside a framebuffer
  float t = uTime;

  // Slow orbiting camera. Its height scales with distance, so Dist is a dolly.
  vec3 ro = uDist * vec3(sin(uAngle), 0.6 / SKETCH_DIST * sin(t * 0.3), cos(uAngle));
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * 1.6 + uv.x * rt + uv.y * up);

  // March out to 12 units at the sketch's distance
  float maxDist = uDist + 12.0 - SKETCH_DIST;
  float d = 0.0;
  float dist = 0.0;
  vec3 p = ro;
  bool hit = false;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (float(i) >= uSteps) break;
    p = ro + rd * dist;
    d = map(p, t);
    if (d < SURF || dist > maxDist) { hit = d < SURF; break; }
    dist += d * uStepScale;
  }

  vec3 bg = mix(vec3(0.02, 0.03, 0.06), vec3(0.06, 0.02, 0.08), uv.y * 0.5 + 0.5);
  bg += 0.02 * sin(uv.x * 3.0 + t) * sin(uv.y * 3.0 - t);
  vec3 col = bg;

  if (hit) {
    vec3 n = calcNormal(p, t);
    vec3 lig = normalize(vec3(0.6, 0.8, -0.4));
    float dif = clamp(dot(n, lig), 0.0, 1.0);
    float sh = softShadow(p + n * 0.02, lig, t);
    float ao = calcAO(p, n, t);
    float fre = pow(clamp(1.0 + dot(n, rd), 0.0, 1.0), 3.0);
    float spe = pow(clamp(dot(reflect(rd, n), lig), 0.0, 1.0), 24.0);

    // Iridescent liquid colour from normal and position
    float f = p.y * 0.15 + dot(n, vec3(0.0, 1.0, 0.0)) * 0.3 + t * 0.05;
    vec3 base = palette(f);

    col = base * (0.15 + 0.85 * dif * sh) * ao;
    col += fre * palette(f + 0.3) * 0.8;
    col += spe * 0.6 * vec3(1.0, 0.95, 0.9);

    // Subsurface-ish glow
    float sss = pow(clamp(dot(-rd, -lig), 0.0, 1.0), 3.0);
    col += sss * base * 0.25 * ao;
  }

  // Vignette and gamma. The vignette goes negative in the corners of a frame
  // wider than about 1.7:1, so it is floored before pow().
  col *= max(1.0 - 0.25 * dot(uv, uv), 0.0);
  col = pow(col, vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;
