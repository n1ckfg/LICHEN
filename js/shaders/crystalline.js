// Crystalline — a ray-marched signed distance field built from 3D Voronoi
// cells: a faceted object that assembles, holds, then bursts along its own
// cell boundaries and reassembles, on a loop.
//
// Ported from the WebGL2 sketch `crystalline_entity`. GLSL ES 3.00 -> 1.00:
// `out vec4 fragColor` becomes `gl_FragColor`, and the screen uv is derived
// from `vTexCoord` rather than `gl_FragCoord`, so the pass is independent of
// the framebuffer's pixel density — `uResolution` is only ever read for its
// aspect ratio.
//
// Two dead parameters in the sketch are wired up here rather than dropped:
//
//   - The assemble half of the cycle never reached the image. `map()` computed
//     `assemblyScale` from the cycle phase and then never referenced it, so the
//     only thing the 60 s loop actually drove was the shatter, which ramped
//     0 -> 1 and snapped back to 0 at the wrap. Assembly and shatter are the
//     same quantity inverted, so there is one control here: `uShatter` eases
//     1 -> 0 over the first third, holds at 0, then eases 0 -> 1 over the last
//     third. That is the cycle the sketch's own notes describe, and it closes
//     the loop without the jump the original had at the 60 s mark.
//
//   - `calcNormal()` took the shatter amount and ignored it, so during the
//     burst the surface was shaded by a normal taken from the *unburst* field.
//     The burst offset is constant within a cell, so the shaded point is
//     simply the sample point pushed back by that offset; normal, material and
//     edge glow all read the field there, and a shard now keeps its own facets
//     and colour as it flies instead of sweeping through a fixed world field.
export const crystallineFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform vec2 uResolution;   // aspect ratio only
uniform float uTime;
uniform float uShatter;     // 0 assembled, 1 fully burst
uniform float uBurst;       // how far the cells fly apart
uniform float uScale;       // voronoi cells per unit
uniform float uDist;        // camera orbit radius
uniform float uOrbit;       // orbit rate
uniform float uHue;         // base hue of the crystal
uniform float uGlow;        // edge glow gain
uniform float uSteps;       // march budget

#define TAU 6.28318530718
#define MAX_STEPS 80

// Fast polynomial hashes — no sin, so they stay stable across drivers
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash11(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.xyz + p.yzx) * p.zxy);
}

float sdSphere(vec3 p, float r) { return length(p) - r; }

// Nearest and second-nearest feature point over the 3x3x3 neighbourhood
vec2 voronoi(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec2 res = vec2(1e9);
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 n = vec3(x, y, z);
    vec3 pt = hash33(i + n);
    vec3 d = f - n - pt;
    float dist = dot(d, d);
    if (dist < res.x) {
      res.y = res.x;
      res.x = dist;
    } else if (dist < res.y) {
      res.y = dist;
    }
  }
  return sqrt(res);
}

// Small exactly on a cell boundary: this is the facet line work
float voronoiEdges(vec3 p, float scale) {
  vec2 v = voronoi(p * scale);
  return v.y - v.x;
}

// Cell density breathes, which is what makes the facets crawl
float cellScale(float time) { return uScale * (1.0 + 0.25 * sin(time * 0.3)); }

// The field the ray marches: cheap, so the march can afford many steps
float crystalBaseSDF(vec3 p, float time) {
  return voronoiEdges(p, cellScale(time));
}

// Each cell flies off in its own hashed direction. Constant within a cell, so
// the field stays a distance field everywhere except at the cell walls.
vec3 burstOffset(vec3 p, float time) {
  vec3 cellHash = hash33(floor(p * cellScale(time)));
  vec3 dir = normalize(cellHash - 0.5);
  return dir * (uShatter * uBurst * 3.0 * (0.5 + 0.5 * cellHash.x));
}

// Sphere-tracing with an escape accelerator: the voronoi edge field is a foam
// that fills all space, so beyond the bounding sphere the ray is stepped by the
// sphere's own distance instead and leaves without hitting anything.
float map(float time, vec3 ro, vec3 rd) {
  float t = 0.0;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (float(i) >= uSteps) break;

    vec3 p = ro + rd * t;
    float d;
    float boundDist = sdSphere(p, 4.0);
    if (boundDist > 0.5 && uShatter <= 0.0) {
      d = boundDist;
    } else {
      if (uShatter > 0.0) p += burstOffset(p, time);
      d = crystalBaseSDF(p, time);
    }

    if (d < 0.001) return t;
    t += max(d * 0.8, 0.01);
    if (t > 20.0) break;
  }
  return -1.0;
}

// The field the surface is shaded from is the base plus an organic wobble (two
// octaves of value noise) and a second, finer cell layer read as internal
// facets. Shading reads it at five points: the hit, for the edge glow, and the
// four taps of a tetrahedron normal, 0.001 away. All five almost always share
// a lattice cell, so each layer below is evaluated for the five at once: one
// set of 27 feature points per voronoi layer and 8 corner hashes per noise
// octave, instead of five. A tap that falls across a cell wall from the hit is
// measured from the hit's cell; its fractional position lands just outside
// 0..1, which changes nothing unless a third cell over was needed.

// voronoi() for a centre point c and four taps a, b, g, h: F2 - F1 for c, and
// for the taps as a vec4. The nearest-two update is the branch-free form of
// voronoi()'s, and keeps the same two values.
void voronoiEdges5(vec3 c, vec3 a, vec3 b, vec3 g, vec3 h, out float e0, out vec4 e4) {
  vec3 i = floor(c);
  vec3 fc = c - i, fa = a - i, fb = b - i, fg = g - i, fh = h - i;
  vec2 r0 = vec2(1e9);
  vec4 rx = vec4(1e9), ry = vec4(1e9);
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 n = vec3(x, y, z);
    vec3 pt = hash33(i + n);
    vec3 d0 = fc - n - pt, d1 = fa - n - pt, d2 = fb - n - pt, d3 = fg - n - pt, d4 = fh - n - pt;
    float dist = dot(d0, d0);
    vec4 dist4 = vec4(dot(d1, d1), dot(d2, d2), dot(d3, d3), dot(d4, d4));
    r0.y = min(r0.y, max(r0.x, dist));
    r0.x = min(r0.x, dist);
    ry = min(ry, max(rx, dist4));
    rx = min(rx, dist4);
  }
  r0 = sqrt(r0);
  e0 = r0.y - r0.x;
  e4 = sqrt(ry) - sqrt(rx);
}

// Trilinear value noise with a smoothstep fade, for c and four taps
void noise5(vec3 c, vec3 a, vec3 b, vec3 g, vec3 h, out float v0, out vec4 v4) {
  vec3 i = floor(c);
  float c000 = hash11(i),                   c100 = hash11(i + vec3(1, 0, 0));
  float c010 = hash11(i + vec3(0, 1, 0)),   c110 = hash11(i + vec3(1, 1, 0));
  float c001 = hash11(i + vec3(0, 0, 1)),   c101 = hash11(i + vec3(1, 0, 1));
  float c011 = hash11(i + vec3(0, 1, 1)),   c111 = hash11(i + vec3(1, 1, 1));

  vec3 f = c - i;
  f = f * f * (3.0 - 2.0 * f);
  v0 = mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
           mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);

  vec4 fx = vec4(a.x, b.x, g.x, h.x) - i.x;
  vec4 fy = vec4(a.y, b.y, g.y, h.y) - i.y;
  vec4 fz = vec4(a.z, b.z, g.z, h.z) - i.z;
  fx = fx * fx * (3.0 - 2.0 * fx);
  fy = fy * fy * (3.0 - 2.0 * fy);
  fz = fz * fz * (3.0 - 2.0 * fz);
  v4 = mix(mix(mix(vec4(c000), vec4(c100), fx), mix(vec4(c010), vec4(c110), fx), fy),
           mix(mix(vec4(c001), vec4(c101), fx), mix(vec4(c011), vec4(c111), fx), fy), fz);
}

const vec2 NORMAL_TAP = vec2(1.0, -1.0) * 0.5773 * 0.001;

// The shading field at p (s0) and at its four normal taps (s4)
void crystalSDF5(vec3 p, float time, out float s0, out vec4 s4) {
  vec2 e = NORMAL_TAP;
  vec3 pa = p + e.xyy, pb = p + e.yyx, pg = p + e.yxy, ph = p + e.xxx;

  float cs = cellScale(time);
  float edges0; vec4 edges4;
  voronoiEdges5(p * cs, pa * cs, pb * cs, pg * cs, ph * cs, edges0, edges4);

  vec3 wob = vec3(time * 0.1);
  vec3 q0 = p * 3.0 + wob, qa = pa * 3.0 + wob, qb = pb * 3.0 + wob, qg = pg * 3.0 + wob, qh = ph * 3.0 + wob;
  float fbm0 = 0.0, amp = 0.5, n0;
  vec4 fbm4 = vec4(0.0), n4;
  for (int k = 0; k < 2; k++) {
    noise5(q0, qa, qb, qg, qh, n0, n4);
    fbm0 += amp * n0;
    fbm4 += amp * n4;
    q0 *= 2.0; qa *= 2.0; qb *= 2.0; qg *= 2.0; qh *= 2.0;
    amp *= 0.5;
  }
  edges0 += 0.03 * fbm0;
  edges4 += 0.03 * fbm4;

  vec3 drift = time * 0.2 * vec3(1.0, 1.3, 0.7);
  float cells0; vec4 cells4;
  voronoiEdges5(p * 1.5 + drift, pa * 1.5 + drift, pb * 1.5 + drift, pg * 1.5 + drift, ph * 1.5 + drift, cells0, cells4);
  s0 = edges0 - 0.5 / (1.0 + 10.0 * abs(cells0)) * 0.02;
  s4 = edges4 - 0.5 / (1.0 + 10.0 * abs(cells4)) * 0.02;
}

vec3 crystalColor(vec3 p, vec3 n, vec3 rd, float time, float dist) {
  float hue = uHue + 0.15 * sin(time * 0.4 + p.x * 0.5);
  vec3 base = vec3(
    0.5 + 0.5 * cos(TAU * hue),
    0.3 + 0.4 * cos(TAU * (hue + 0.33)),
    0.7 + 0.3 * cos(TAU * (hue + 0.66))
  );

  float fresnel = pow(1.0 - abs(dot(n, rd)), 3.0);
  float iridescence = 0.5 + 0.5 * sin(dist * 50.0 + time * 2.0 + p.y * 10.0);

  float caustics = 0.0;
  for (int i = 0; i < 3; i++) {
    vec3 q = p * (2.0 + float(i)) + time * 0.3;
    caustics += 0.3 * smoothstep(0.0, 0.02, abs(sin(q.x * 20.0) * cos(q.y * 20.0)));
  }

  vec3 col = base * (0.3 + 0.7 * fresnel)
           + vec3(iridescence) * fresnel * 0.5
           + vec3(caustics) * 0.5;

  // Thickness-based subsurface approximation
  col += base * (1.0 / (1.0 + dist * 5.0)) * 0.3;
  return col;
}

void main() {
  vec2 res = uResolution;
  vec2 uv = (vTexCoord - 0.5) * (res / min(res.x, res.y));
  uv.y = -uv.y;   // vTexCoord runs top-down inside a framebuffer

  float time = uTime;

  float orbitAngle = time * 0.05 * uOrbit;
  vec3 ro = vec3(uDist * sin(orbitAngle), 0.5 * uDist * sin(time * 0.07), uDist * cos(orbitAngle));
  vec3 fw = normalize(-ro);
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
  vec3 up = cross(fw, rt);
  vec3 rd = normalize(uv.x * rt + uv.y * up + 1.5 * fw);

  float dist = map(time, ro, rd);
  vec3 col = vec3(0.02, 0.01, 0.03);   // deep space

  if (dist > 0.0) {
    // Shade in the field's own frame: the burst offset is constant within a
    // cell, so this is the point the shard was carved from.
    vec3 pos = ro + rd * dist;
    vec3 sp = pos + burstOffset(pos, time);
    float s0; vec4 s4;
    crystalSDF5(sp, time, s0, s4);
    // 4-tap tetrahedron normal, cheaper than the 6-tap central difference and
    // accurate enough for a field this noisy
    vec2 e = NORMAL_TAP;
    vec3 n = normalize(e.xyy * s4.x + e.yyx * s4.y + e.yxy * s4.z + e.xxx * s4.w);
    col = crystalColor(sp, n, rd, time, dist);

    float edgeGlow = smoothstep(0.02, 0.0, abs(s0));
    col += vec3(0.3, 0.5, 0.8) * edgeGlow * uGlow;
  }

  // Volumetric motes, only while the object is coming apart
  if (uShatter > 0.0) {
    for (int i = 0; i < 5; i++) {
      vec3 partPos = ro + rd * (float(i) * 0.5 + uShatter * 2.0);
      float d = length(partPos - vec3(sin(time + float(i)), cos(time * 1.3 + float(i)), 0.0));
      float particle = smoothstep(0.1, 0.0, d) * uShatter * (0.5 + 0.5 * hash11(float(i)));
      col += vec3(0.8, 0.6, 1.0) * particle * 0.1;
    }
  }

  col *= 0.8 + 0.2 * (1.0 - length(uv) * 0.7);   // vignette
  col = col / (col + vec3(1.0));                 // Reinhard
  col = pow(col, vec3(1.0 / 2.2));

  gl_FragColor = vec4(col, 1.0);
}
`;
