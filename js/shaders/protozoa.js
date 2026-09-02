// Protozoa — a watercolour bleed simulation suspended in a swamp scene.
//
// Ported from the WebGL2 sketch `protozoa-effect` (Sporky3), which itself grew
// out of an earlier version of this module: the six watercolour passes below
// are that module's own shaders, re-tuned for use as a layer inside a dark
// scene rather than as a full-frame wash on white paper. See ARCHITECTURE.md
// for what changed and why.
//
// GLSL ES 3.00 -> 1.00 throughout: `in`/`out` become `varying`/`gl_FragColor`,
// `texture` becomes `texture2D`, and the auto-exposure's `textureLod(..., 20.0)`
// readback of a mipmapped target — which WebGL1 has no equivalent for — is
// replaced by an explicit two-stage reduction (protozoaMeanFrag).

export const PROTO_MAX_CELLS = 50;    // colony emitters uploaded per frame
export const PROTO_SIM_SHORT = 340;   // sim texels across the short axis
export const PROTO_SIM_LONG_MAX = 900;

// Shared by the GPU geometry and the CPU emitters that ride the snake bodies.
// Declared once here and interpolated into the shader so the two cannot drift.
export const PROTO_SEG_LAG = 0.26;    // seconds of lag between body segments
export const PROTO_SEG_LEN = 0.15;    // spatial spacing between body segments

// Mean density the bloom weight was tuned against, and the reduction footprint
export const PROTO_PIGMENT_TARGET = 0.065;
const MEAN_TAPS = 8;                  // taps per axis, per reduction stage

// ---------------------------------------------------------------------------
// 1. Inject — Gaussian colony blobs added onto the persistent field.
//
// The sketch drew this with additive blending straight onto the live target.
// Here it reads the field and adds in the shader instead, which keeps the pass
// independent of p5's blend state and lets every pass run under REPLACE.
// ---------------------------------------------------------------------------
export const protozoaInjectFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform vec2 u_resolution;
uniform sampler2D u_texture;
uniform vec2 u_positions[${PROTO_MAX_CELLS}];
uniform vec3 u_rgbColors[${PROTO_MAX_CELLS}];
uniform float u_radii[${PROTO_MAX_CELLS}];
uniform int u_numColors;

void main() {
  // Normalise against the SHORT axis, matching how the scene builds its own uv.
  // Dividing by height alone made a colony's on-screen size track window
  // height, so the same radius drew a far bigger blob in a portrait window.
  vec2 aspect = u_resolution / min(u_resolution.x, u_resolution.y);
  vec3 finalColor = vec3(0.0);

  for (int i = 0; i < ${PROTO_MAX_CELLS}; i++) {
    if (i >= u_numColors) break;

    vec2 center = u_positions[i];
    float radius = u_radii[i];

    if (center.x < 0.0) continue;

    // Aspect-corrected so colonies stay round on any canvas.
    float dist = length((vTexCoord - center) * aspect);
    float gaussian = exp(-0.5 * pow(dist / max(radius * 0.5, 0.001), 2.0));
    finalColor += u_rgbColors[i] * gaussian;
  }

  gl_FragColor = texture2D(u_texture, vTexCoord) + vec4(finalColor, 0.0);
}`;

// ---------------------------------------------------------------------------
// 2. Diffuse — Laplacian spread of pigment
// ---------------------------------------------------------------------------
export const protozoaDiffuseFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform vec2 u_resolution;
uniform sampler2D u_texture;
uniform float u_diffusionRate;
uniform float u_pigmentGamma;

void main() {
  vec2 texel = 1.0 / u_resolution;

  vec4 center = texture2D(u_texture, vTexCoord);

  vec4 top = texture2D(u_texture, vTexCoord + vec2(0.0, texel.y));
  vec4 bottom = texture2D(u_texture, vTexCoord + vec2(0.0, -texel.y));
  vec4 left = texture2D(u_texture, vTexCoord + vec2(-texel.x, 0.0));
  vec4 right = texture2D(u_texture, vTexCoord + vec2(texel.x, 0.0));

  vec4 laplacian = (top + bottom + left + right - 4.0 * center) * 0.25;
  vec4 diffused = center + laplacian * u_diffusionRate;
  // This was a hardcoded 0.95. Any exponent below 1 is a DC gain on sub-unit
  // values, so with diffusion spreading a trace everywhere the field
  // self-excites to a flat grey and loses all structure — invisible when the
  // result is a full-frame wash on white paper, fatal as a scene layer.
  // >= 1.0 keeps it stable; 1.0 is neutral.
  diffused.rgb = pow(max(diffused.rgb, 0.0), vec3(u_pigmentGamma));

  gl_FragColor = diffused;
}`;

// ---------------------------------------------------------------------------
// 3. Bleed — directional spread along procedural paper fibre, plus drying loss
// ---------------------------------------------------------------------------
export const protozoaBleedFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform vec2 u_resolution;
uniform sampler2D u_texture;
uniform float u_bleedStrength;
uniform float u_paperFreq;   // fibre cycles per texel
uniform float u_dry;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);

  float a = hash(i.x + i.y * 57.0);
  float b = hash(i.x + i.y * 57.0 + 1.0);
  float c = hash(i.x + 1.0 + i.y * 57.0);
  float d = hash(i.x + 1.0 + i.y * 57.0 + 1.0);

  vec2 u = f * f * (3.0 - 2.0 * f);

  return mix(a, b, u.x) +
         (c - a) * u.x * (1.0 - u.y) +
         (d - b) * u.y * (1.0 - u.x);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;

  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }

  return value;
}

void main() {
  vec2 texel = 1.0 / u_resolution;

  vec4 color = texture2D(u_texture, vTexCoord);

  // Fibre measured in texels, so the grain is the same size and isotropic
  // whatever shape the buffer is. The original's uv * 800.0 aliased into
  // per-pixel static as soon as the buffer got large.
  float paper = fbm(vTexCoord * u_resolution * u_paperFreq);
  paper = smoothstep(0.3, 0.7, paper);

  vec2 fiberDir = vec2(cos(paper * 6.28), sin(paper * 6.28));

  vec4 bleedSample1 = texture2D(u_texture, vTexCoord + fiberDir * texel * 2.0);
  vec4 bleedSample2 = texture2D(u_texture, vTexCoord - fiberDir * texel * 2.0);

  vec4 bled = (bleedSample1 + bleedSample2) * 0.5;

  float bleedMask = smoothstep(0.4, 0.6, paper) * u_bleedStrength;

  color.rgb = mix(color.rgb, bled.rgb, bleedMask);
  // Absorption into the paper. The original's fixed 0.1 loses 5%/frame, which
  // only ever balanced against the diffuse pass's gain; with that gone it's a
  // knob. This is also what damps the loop: the term below falls as density
  // rises, so the field cannot run away.
  color.rgb *= (1.0 - paper * u_dry);

  float intensity = length(color.rgb);
  color.rgb *= 1.0 - intensity * 0.1;

  gl_FragColor = color;
}`;

// ---------------------------------------------------------------------------
// 4. Feedback — gradient-driven ripple displacement, decaying toward the wash
// ---------------------------------------------------------------------------
export const protozoaFeedbackFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_texture;
uniform float u_feedback;
uniform vec3 u_wash;

void main() {
  vec2 texel = 1.0 / u_resolution;

  vec4 current = texture2D(u_texture, vTexCoord);
  float intensity = length(current.rgb);

  float left = length(texture2D(u_texture, vTexCoord - vec2(texel.x, 0.0)).rgb);
  float right = length(texture2D(u_texture, vTexCoord + vec2(texel.x, 0.0)).rgb);
  float up = length(texture2D(u_texture, vTexCoord + vec2(0.0, texel.y)).rgb);
  float down = length(texture2D(u_texture, vTexCoord - vec2(0.0, texel.y)).rgb);

  vec2 gradient = vec2(right - left, up - down);

  float rippleFreq = 15.0;
  float rippleSpeed = 3.0;
  float ripplePhase = intensity * rippleFreq - u_time * rippleSpeed;
  float ripple = sin(ripplePhase) * 0.5 + 0.5;

  vec2 displacement = normalize(gradient + vec2(0.001)) * ripple * texel * 3.0 * intensity;

  vec4 rippled = texture2D(u_texture, vTexCoord - displacement);

  vec4 blended = mix(current, rippled, 0.3 * intensity);
  // The original washed toward paper white; here the pigment settles out into
  // dark swamp water instead, so the composite has chroma left to work with.
  vec4 result = mix(blended, vec4(u_wash, 1.0), 1.0 - u_feedback);
  result.rgb *= 0.998;
  // The loop is self-limiting (bleed damps by intensity), but this is the last
  // stage of the persistent chain — cap it so a pathological frame can't drive
  // the bleed pass's (1 - intensity * 0.1) term negative and flip sign.
  result.rgb = clamp(result.rgb, 0.0, 3.0);

  gl_FragColor = result;
}`;

// ---------------------------------------------------------------------------
// 5. Banding — per-channel separation and reticulation.
//
// Strictly a look pass, run outside the persistent chain: its per-frame channel
// offsets are sub-texel, but inside the loop they accumulate into whole-texel
// chroma drift within seconds.
// ---------------------------------------------------------------------------
export const protozoaBandingFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_texture;
uniform float u_bandingStrength;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i.x + i.y * 57.0);
  float b = hash(i.x + i.y * 57.0 + 1.0);
  float c = hash(i.x + 1.0 + i.y * 57.0);
  float d = hash(i.x + 1.0 + i.y * 57.0 + 1.0);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.x * (1.0 - u.y) + (d - b) * u.y * (1.0 - u.x);
}

void main() {
  vec4 color = texture2D(u_texture, vTexCoord);

  float intensity = length(color.rgb);

  float bands = sin(vTexCoord.x * 50.0 + u_time * 2.0) * sin(vTexCoord.y * 50.0 + u_time * 1.5);
  bands += noise(vTexCoord * 30.0 + u_time * 0.5) * 0.5;

  float bandThreshold = 0.5 + intensity * 0.3;
  float bandMask = smoothstep(bandThreshold - 0.1, bandThreshold + 0.1, bands);

  vec3 separated = color.rgb;
  float shift = bandMask * u_bandingStrength * 0.02;

  separated.r = texture2D(u_texture, vTexCoord + vec2(shift, 0.0)).r;
  separated.g = texture2D(u_texture, vTexCoord + vec2(0.0, shift * 0.7)).g;
  separated.b = texture2D(u_texture, vTexCoord - vec2(shift * 0.5, shift * 0.5)).b;

  float bandEffect = 1.0 - bandMask * u_bandingStrength * 0.8;

  float maxBrightness = 0.9;
  separated = min(separated, vec3(maxBrightness));

  color.rgb = separated * bandEffect;
  color.rgb += (separated.rgb - color.rgb) * bandMask * 0.2;

  gl_FragColor = color;
}`;

// ---------------------------------------------------------------------------
// 6. Display — tone map, gamma, soft temporal trail, and pigment density
//    written into alpha for the reduction below
// ---------------------------------------------------------------------------
export const protozoaDisplayFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_texture;
uniform sampler2D u_previousTexture;

vec3 toneMap(vec3 color) {
  return color / (color + vec3(1.0));
}

vec3 gammaCorrect(vec3 color, float gamma) {
  return pow(color, vec3(1.0 / gamma));
}

void main() {
  vec4 current = texture2D(u_texture, vTexCoord);

  vec2 offset = vec2(sin(vTexCoord.y * 10.0 + u_time * 0.5), cos(vTexCoord.x * 10.0 + u_time * 0.5)) * 0.001;
  vec4 previous = texture2D(u_previousTexture, vTexCoord + offset);

  vec4 result = mix(current, previous, 0.1);

  result.rgb = toneMap(max(result.rgb, 0.0));
  result.rgb = gammaCorrect(max(result.rgb, 0.0), 2.2);

  float dist = length(vTexCoord - 0.5) * 1.5;
  result.rgb *= 1.0 - dist * 0.1;

  // Pigment density into alpha. Nothing downstream composites with this
  // texture's alpha, so it is free to carry the one quantity the scene needs
  // frame-wide: reducing it to a single mean is what the auto-exposure runs on.
  float floorC = min(result.r, min(result.g, result.b));
  float dens = max(max(result.r - floorC, result.g - floorC), result.b - floorC);

  gl_FragColor = vec4(result.rgb, dens);
}`;

// ---------------------------------------------------------------------------
// Mean density reduction.
//
// The sketch mipmapped the display target and read level 20 — a 1x1 average —
// straight from the scene shader. WebGL1 has no fragment-shader LOD select, and
// p5 does not expose its framebuffer textures' mip chain, so the mean is built
// explicitly instead: one pass reduces the field to MEAN_TAPS x MEAN_TAPS, a
// second reduces that to 1x1, each output texel averaging MEAN_TAPS^2 stratified
// samples of its own region. Two stages give 4096 effective samples for two
// draws totalling 65 pixels.
// ---------------------------------------------------------------------------
export const protozoaMeanFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform sampler2D u_texture;
uniform float u_cells;   // output texels per axis

void main() {
  vec2 base = floor(vTexCoord * u_cells) / u_cells;
  float step = 1.0 / (u_cells * ${MEAN_TAPS}.0);
  float sum = 0.0;

  for (int y = 0; y < ${MEAN_TAPS}; y++) {
    for (int x = 0; x < ${MEAN_TAPS}; x++) {
      sum += texture2D(u_texture, base + (vec2(float(x), float(y)) + 0.5) * step).a;
    }
  }

  gl_FragColor = vec4(0.0, 0.0, 0.0, sum / ${MEAN_TAPS * MEAN_TAPS}.0);
}`;

// ---------------------------------------------------------------------------
// Scene — snakes in a swamp, with the watercolour field blended in.
//
// Two clocks: u_ftime drives everything in the foreground, u_time the swamp,
// gas and grain, so slowing the snakes doesn't stall the whole frame. Both are
// accumulated on the CPU (see ProtozoaModule) rather than scaled here, so the
// Motion knob changes the rate without jumping the animation, and the emitters
// that ride the snake bodies read the same accumulated value.
// ---------------------------------------------------------------------------
export const protozoaSceneFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform float u_time;        // scene clock
uniform float u_ftime;       // foreground clock
uniform vec2 u_resolution;
uniform sampler2D u_protozoa;
uniform sampler2D u_mean;    // 1x1; frame-wide mean pigment density in alpha
uniform float u_gain;        // bloom weight at PIGMENT_TARGET density

#define PI 3.14159265359
#define SEG_LAG ${PROTO_SEG_LAG.toFixed(4)}
#define SEG_LEN ${PROTO_SEG_LEN.toFixed(4)}
#define FG_EDGE 0.018
#define PIGMENT_TARGET ${PROTO_PIGMENT_TARGET.toFixed(5)}

// Hash functions
float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }

float hash3d(float n) { return fract(sin(n) * 43758.5453); }
float hash2d(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// 3D noise for swamp gas
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 157.0 + 289.0 * i.z;
  float a = hash3d(n);
  float b = hash3d(n + 1.0);
  float c = hash3d(n + 157.0);
  float d = hash3d(n + 289.0);
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(hash3d(n + 158.0), hash3d(n + 289.0 + 1.0), f.x),
                 mix(hash3d(n + 446.0), hash3d(n + 735.0), f.x), f.y), f.z);
}

float fbm2(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    value += amplitude * noise2(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { v += a * noise3(p); p = p * 2.0 + vec3(0.13, 0.27, 0.05); a *= 0.5; }
  return v;
}

vec2 warp(vec2 p, float t) {
  float n1 = fbm2(p * 0.5 + t * 0.03, 4);
  float n2 = fbm2(p * 0.5 + t * 0.05 + 100.0, 4);
  return p + vec2(n1, n2) * 0.3;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// --- Protozoa field sampling ------------------------------------------------
// The watercolour buffer is pigment-on-haze. Splitting each texel into an
// achromatic floor (paper/murk) and the chroma above it (pigment) lets the
// swamp absorb the pigment without the paper washing the scene out.
float maxc(vec3 c) { return max(c.r, max(c.g, c.b)); }

vec3 protoInk(vec2 q) {
  vec3 c = texture2D(u_protozoa, q).rgb;
  return max(c - min(c.r, min(c.g, c.b)), vec3(0.0));
}

vec2 protoGrad(vec2 q) {
  vec2 e = 2.0 / u_resolution;
  return vec2(maxc(protoInk(q + vec2(e.x, 0.0))) - maxc(protoInk(q - vec2(e.x, 0.0))),
              maxc(protoInk(q + vec2(0.0, e.y))) - maxc(protoInk(q - vec2(0.0, e.y))));
}

// SDF primitives
float sdSphere(vec2 p, float r) { return length(p) - r; }

float snakeSegment(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// Organic clay snake — 2D
vec2 snakeSDF2D(vec2 p, float t, float seed) {
  float time = t * 0.8;
  vec2 base = vec2(sin(time + seed) * 0.6, cos(time * 0.7 + seed) * 0.5);

  // Head follows a lissajous-ish path. The harmonics sit close to the base
  // rate so the head sweeps rather than jitters against the body.
  vec2 head = base + vec2(sin(time * 0.62 + seed * 3.0) * 0.25, cos(time * 0.53 + seed * 5.0) * 0.2);

  float d = 0.0;       // seeded from segment 0 inside the loop
  float matId = 0.0;   // 0 = body, 1 = head, 2 = eye
  float segLen = SEG_LEN;
  float thickness = 0.08;
  vec2 prev = head;

  for (int i = 0; i < 12; i++) {
    // A longer lag spreads one undulation over more of the body, which reads
    // as a wave travelling down it instead of the whole tail flicking at once.
    float phase = time - float(i) * SEG_LAG + seed * 7.0;
    float side = sin(phase * 1.15) * 0.35 * (1.0 - float(i) * 0.06);
    float forward = cos(phase * 0.85) * 0.25 * (1.0 - float(i) * 0.04);
    vec2 curr = head + vec2(forward - float(i) * segLen, side);

    float r = thickness * (1.0 - float(i) * 0.05) + sin(phase * 1.6 + seed) * 0.012;
    float sd = snakeSegment(p, prev, curr, r);
    float hn = 1.0 - smoothstep(0.5, 4.5, float(i));

    // Smooth union rather than a hard min: a hard min leaves a crease in the
    // normal at every capsule joint, which lights as a fan of flat facets. The
    // blend weight also carries the material, so the head -> body ramp crosses
    // the joints without a seam.
    //
    // Seed from the first segment rather than blending against a large
    // sentinel: mix(x, y, a) evaluates as x + a * (y - x), so mixing away from
    // 1e5 quantises the result to that value's ulp (~0.008) — wide enough to
    // band the distance field every few pixels and moire in the normal.
    if (i == 0) {
      d = sd;
      matId = hn;
    } else {
      float k = 0.045;
      float h = clamp(0.5 + 0.5 * (d - sd) / k, 0.0, 1.0);
      d = mix(d, sd, h) - k * h * (1.0 - h);
      matId = mix(matId, hn, h);
    }

    prev = curr;
  }

  vec2 warped = warp(p * 3.0, t);
  float surfaceNoise = fbm2(warped + t * 0.2, 4) * 0.02;
  d += surfaceNoise;

  return vec2(d, matId);
}

// 3D snake SDF projected onto the plane — Lissajous path
vec2 mapSnake3D(vec3 p, float t, float phase) {
  vec3 pathPt;
  pathPt.x = sin(t * 1.3 + phase * PI) * 3.0 + sin(t * 0.6 + phase * 2.0) * 1.5;
  pathPt.y = sin(t * 1.1 + phase * 1.5) * 1.2 + 0.3;
  pathPt.z = cos(t * 1.1 + phase * PI) * 3.0 + cos(t * 0.8 + phase) * 1.3;

  vec3 pa = p - pathPt;
  float d = length(pa.xy);

  // Breathing rates kept near the path rate; at 3x and 4x they beat hard
  // against the body motion and read as a twitch.
  //
  // The radial ripples are shallow on purpose. A term added to an SDF must have
  // a gradient well below 1 or the result stops being a distance field and the
  // normals derived from it go unreliable; at the original amplitudes these
  // gradients were 1.5 and 0.32.
  float thickness = 0.4 + 0.12 * sin(t * 1.1 + phase * PI) * 0.5 + 0.06 * sin(length(pa.xy) * 10.0 + t * 0.8);

  float seg = sin(t * 1.3 + phase * PI + length(pa.xy) * 8.0) * 0.03;
  d += seg;

  float dist2D = length(p.xz - pathPt.xz);
  d = smin(d, dist2D, 0.15);

  // Headness falls off smoothly around the path point, so it applies whether
  // the body or the head SDF ends up nearest.
  float hn = 1.0 - smoothstep(thickness * 0.4, thickness * 2.0, dist2D);

  vec2 res = vec2(d, hn);

  float headD = dist2D - thickness * 1.5;
  res.x = smin(res.x, headD, 0.12);

  vec3 dir = vec3(cos(t * 1.3 + phase * PI) * 1.3, 0, cos(t * 1.1 + phase * PI) * 1.1);
  dir = normalize(dir);
  vec2 dir2 = vec2(dir.x, dir.z);
  vec2 eyeL = pathPt.xz + dir2 * 0.4 + vec2(0.25, 0.0);
  vec2 eyeR = pathPt.xz + dir2 * 0.4 + vec2(-0.25, 0.0);
  float e1 = sdSphere(p.xz - eyeL, 0.09);
  float e2 = sdSphere(p.xz - eyeR, 0.09);
  if (e1 < res.x) res = vec2(e1, 2.0);
  if (e2 < res.x) res = vec2(e2, 2.0);

  return res;
}

// Swamp background — a height field, not a distance field, which is why it is
// blended in with a wide smin radius
float swampBG2D(vec2 p, float t) {
  float water = sin(p.y * 8.0 + t * 0.5) * 0.15 + fbm2(p * 2.0 + t * 0.1, 4) * 0.2;

  float foliage = 0.0;
  for (int i = 0; i < 5; i++) {
    float layer = float(i) * 0.2 - 0.4;
    float n = fbm2(p * 3.0 + vec2(t * 0.02, 0.0) + float(i) * 100.0, 3);
    foliage += smoothstep(0.5, 0.7, n) * exp(-abs(p.y - layer) * 8.0) * 0.15;
  }

  float bubbles = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 center = hash2(vec2(float(i), t * 0.1)) * 2.0 - 1.0;
    float r = 0.05 + hash(float(i) + t * 0.05) * 0.08;
    float pulse = sin(t * 3.0 + float(i) * 10.0) * 0.5 + 0.5;
    bubbles += smoothstep(r, r * (0.8 + pulse * 0.4), length(p - center));
  }

  return water + foliage - bubbles * 0.1;
}

vec3 swampColor(vec2 p, float t) {
  vec3 waterCol = vec3(0.08, 0.12, 0.06);
  vec3 mudCol = vec3(0.18, 0.14, 0.08);
  vec3 rotCol = vec3(0.12, 0.10, 0.05);
  vec3 slimeCol = vec3(0.06, 0.15, 0.04);

  float water = sin(p.y * 8.0 + t * 0.5) * 0.15 + fbm2(p * 2.0 + t * 0.1, 4) * 0.2;
  float blend = smoothstep(-0.1, 0.1, water);

  vec3 col = mix(mudCol, waterCol, blend);
  col = mix(col, rotCol, smoothstep(0.0, 0.3, fbm2(p * 4.0 + t * 0.05, 3)));
  col += slimeCol * smoothstep(0.6, 0.8, fbm2(p * 5.0 - t * 0.03, 3));

  col += vec3(0.15, 0.12, 0.08) * pow(smoothstep(0.7, 1.0, fbm2(p * 10.0 + t * 0.2, 2)), 3.0);

  return col;
}

// matId is continuous: 0 = body, 1 = head, 2 = eye. Head and body share one
// lighting path with only the base colour interpolated, so the head reads as
// part of the animal rather than a flat unlit decal.
vec3 getSnakeColor(vec2 p, vec3 n, float t, float matId) {
  float headness = clamp(matId, 0.0, 1.0);

  float fresnel = pow(1.0 - max(0.0, dot(n, vec3(0.0, 0.0, 1.0))), 4.0);

  float pattern = sin(p.x * 8.0 + p.y * 6.0 + t * 0.5) * 0.5 + 0.5;
  vec3 baseColor1 = vec3(0.15, 0.35, 0.10);
  vec3 baseColor2 = vec3(0.25, 0.45, 0.15);
  vec3 baseColor = mix(baseColor1, baseColor2, pattern);

  // Spots thin out toward the head
  float spots = sin(p.x * 12.0 + p.y * 10.0) * sin(p.x * 11.0 + p.y * 9.0);
  spots = smoothstep(0.3, 0.7, spots) * 0.3 * (1.0 - headness * 0.7);
  baseColor += vec3(spots * 0.15, spots * 0.2, spots * 0.05);

  // Warm horn colour on the head, eased in along the neck
  baseColor = mix(baseColor, vec3(0.62, 0.56, 0.20), smoothstep(0.0, 1.0, headness));

  vec3 lightDir1 = normalize(vec3(0.4, 1.0, 0.3));
  vec3 lightDir2 = normalize(vec3(-0.5, 0.6, -0.4));
  float diff1 = max(0.0, dot(n, lightDir1));
  float diff2 = max(0.0, dot(n, lightDir2)) * 0.25;

  float sss = pow(max(0.0, dot(n, -lightDir1)), 0.4) * 0.35;

  vec3 hf = normalize(lightDir1 + n);
  float spec = pow(max(0.0, dot(n, hf)), 64.0) * 0.35;

  vec3 col = baseColor * (diff1 + diff2 + sss) + vec3(0.015)
           + mix(vec3(0.12, 0.18, 0.06), vec3(0.22, 0.20, 0.08), headness) * spec;
  col += fresnel * vec3(0.04, 0.08, 0.03);

  col += fresnel * vec3(0.1, 0.2, 0.05) * (0.5 + 0.5 * sin(p.x * 15.0 + t));

  // Eyes stay a hard highlight — they should read as a point, not a gradient
  col = mix(col, vec3(0.95, 0.9, 0.35), smoothstep(1.4, 1.8, matId));

  return col;
}

// The whole scene as one field, so shading and geometry can't disagree.
//   x = smooth-combined distance
//   y = material of the nearest surface (0 body, 1 head, 2 eye)
//   z = how far the nearest foreground surface is past the water line
vec3 sceneMap(vec2 p, float t, float ft) {
  vec2 s1 = snakeSDF2D(p, ft, 0.0);
  vec2 s2 = snakeSDF2D(p, ft, 1.0);
  vec2 s3 = mapSnake3D(vec3(p, 0.0), ft, 0.0);
  vec2 s4 = mapSnake3D(vec3(p, 0.0), ft, 1.0);
  float bg = swampBG2D(p, t);

  // Nearest foreground surface, resolved in one sweep. A chain of else-ifs
  // falls through to a farther snake whenever the nearest one fails the
  // background test, so the material can flip between frames.
  vec2 near = s1;
  if (s2.x < near.x) near = s2;
  if (s3.x < near.x) near = s3;
  if (s4.x < near.x) near = s4;

  // These fields have very different gradients — two distance fields, two
  // projected pseudo-3D ones and a height field — and at tight radii they meet
  // in hard planar folds.
  float d = smin(s1.x, s2.x, 0.09);
  d = smin(d, s3.x, 0.13);
  d = smin(d, s4.x, 0.13);
  d = smin(d, bg, 0.08);

  return vec3(d, near.y, near.x - (bg + 0.05));
}

// Central differences over sceneMap: sampling only part of the field means
// that wherever a 3D snake is nearest it is lit by a normal taken from
// different geometry, which shows as fine cross-hatching.
vec3 calcNormal(vec2 p, float t, float ft, float eps) {
  vec2 e = vec2(eps, 0.0);
  float dx = sceneMap(p + e.xy, t, ft).x - sceneMap(p - e.xy, t, ft).x;
  float dy = sceneMap(p + e.yx, t, ft).x - sceneMap(p - e.yx, t, ft).x;
  return normalize(vec3(dx, dy, eps * 2.0));
}

void main() {
  // Screen uv with y running up the displayed image, matching the space the
  // CPU emitters place colonies in. Inside a framebuffer vTexCoord.y runs
  // top-down, so this is the one flip in the module.
  vec2 suv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
  vec2 uv = (suv - 0.5) * (u_resolution / min(u_resolution.x, u_resolution.y)) * 1.5;

  float t = u_time;
  float ft = u_ftime;

  // Protozoa watercolour field, split into pigment and murk
  vec3 pzRaw = texture2D(u_protozoa, suv).rgb;
  float murk = min(pzRaw.r, min(pzRaw.g, pzRaw.b));
  vec3 ink = max(pzRaw - murk, vec3(0.0));
  float density = clamp(maxc(ink) * 3.2, 0.0, 1.0);
  vec3 pigment = ink * vec3(0.85, 1.25, 0.55);      // pull the colonies toward swamp hues
  vec3 pigHue = pigment / max(maxc(pigment), 1e-4); // hue only, for subtractive staining
  vec2 pgrad = protoGrad(suv);

  // Auto-exposure. A fixed weight can only be right for one canvas shape and
  // one colony density; the reduced mean carries how much pigment is actually
  // there, so the bloom can be normalised against it. The partial exponent
  // corrects between settings without flattening the blooms' own ebb and flow.
  //
  // The clamp is deliberately asymmetric. Pulling an over-dense frame down is
  // the whole point; pushing a sparse one up is not, and would flare the few
  // seconds after a clear, when the field is still refilling.
  float meanDens = texture2D(u_mean, vec2(0.5)).a;
  float expo = clamp(pow(PIGMENT_TARGET / max(meanDens, 1e-4), 0.65), 0.45, 1.12);

  vec3 m = sceneMap(uv, t, ft);
  float d = m.x;

  // Soft coverage in place of a hard silhouette test, so the snakes settle into
  // the water across a couple of pixels rather than snapping at the edge.
  float cover = 1.0 - smoothstep(-FG_EDGE, FG_EDGE, m.z);

  // Swamp background — colonies refract the water beneath them
  vec2 puv = uv + pgrad * 2.2;
  vec3 color = swampColor(puv, t);

  color *= 0.7 + 0.3 * smoothstep(-0.5, 0.5, d);

  float gas = fbm3(vec3(uv * 0.8, 0.0) + vec3(t * 0.08, 0.0, t * 0.04));
  gas = smoothstep(0.35, 0.75, gas) * 0.25;
  color += vec3(0.06, 0.12, 0.03) * gas;

  // Watercolour blend: pigment stains the water subtractively, the living
  // colonies bloom back over it, and the undissolved haze thickens into
  // suspended silt
  color *= mix(vec3(1.0), pigHue, density * 0.85 * mix(1.0, expo, 0.5));
  color += pigment * u_gain * expo * (0.7 + 0.6 * gas);
  color += vec3(0.05, 0.09, 0.04) * murk * 1.1;

  // Snake clay material, mixed over the water by coverage. Gated so the
  // eight-tap normal only runs for pixels that are actually on or near a snake.
  if (cover > 0.001) {
    vec3 n = calcNormal(uv, t, ft, 0.0035);
    vec3 lightDir = normalize(vec3(sin(t * 0.3) * 0.5, 0.8, cos(t * 0.3) * 0.5));
    float diff = max(dot(n, lightDir), 0.0);
    float rim = pow(1.0 - max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0), 2.0);

    vec3 clay = getSnakeColor(uv, n, ft, m.y);
    clay *= 0.4 + diff * 0.6;
    clay += vec3(0.15, 0.10, 0.06) * rim * 0.5;

    float spec = pow(max(dot(reflect(-lightDir, n), vec3(0.0, 0.0, 1.0)), 0.0), 32.0);
    clay += vec3(0.3, 0.25, 0.2) * spec * 0.3;

    // Silhouette glow, driven by the distance past the water line rather than
    // the smin-blended distance, which sits near zero across broad areas and so
    // smears this over the whole body. Kept narrow: at 0.055 it swallows a
    // whole snake (half-width ~0.08) and washes the body flat.
    float edge = 1.0 - smoothstep(0.0, 0.022, abs(m.z));
    clay += vec3(0.25, 0.15, 0.08) * edge * 0.35;
    clay += vec3(0.10, 0.14, 0.05) * edge * rim;

    // A thin film of protozoa clings to the wet clay, strongest at the rim, so
    // the colonies read as part of the scene rather than an overlay
    clay += pigment * 0.40 * expo * (0.35 + 0.65 * rim);

    color = mix(color, clay, cover);
  }

  // Fireflies, drifting and pulsing on the foreground clock
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 fp = vec2(sin(ft * 0.6 + fi * 2.1) * 3.5, cos(ft * 0.4 + fi * 1.3) * 3.5);
    fp.y += sin(ft * 1.2 + fi * 1.7) * 0.6 + 1.2;
    float fd = length(uv - fp);
    // smootherstep on the falloff so they swell in and out instead of blinking
    float g = 1.0 - clamp(fd / 0.2, 0.0, 1.0);
    float ff = g * g * g * (g * (g * 6.0 - 15.0) + 10.0) * (sin(ft * 4.0 + fi * 3.0) * 0.5 + 0.5);
    color += vec3(0.7, 0.95, 0.25) * ff * 0.7;
  }

  float vig = 1.0 - length(uv) * 0.3;
  color *= vig;

  float grain = hash2d(gl_FragCoord.xy * 0.1 + fract(t)) * 0.025;
  color += grain - 0.0125;

  color = pow(max(color, 0.0), vec3(1.0 / 2.2));
  color = pow(color, vec3(0.92, 0.98, 0.88));   // swampy green cast
  color = color / (color + 0.7);

  float ca = length(uv) * 0.012;
  color.r *= 1.0 + ca;
  color.b *= 1.0 - ca;
  color.g *= 1.05;

  gl_FragColor = vec4(color, 1.0);
}`;
