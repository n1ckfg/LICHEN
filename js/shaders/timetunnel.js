// Time Tunnel — a liquid feedback tunnel lighting the input as its walls.
//
// The tunnel is ported from the WebGL sketch `shiny.html`: two feedback
// "worlds" (see TimeTunnelModule) each run `timetunnelFeedbackFrag`, and
// `timetunnelBlendFrag` cross-dissolves them and draws the warp-in zoom, the
// speed beams and streaks, and the black pit fringed with lightning.
//
// The sketch drove its feedback pass from a Game of Life grid, but the grid
// never reached the shader, as in SpiralGalaxy's sketch: it was uploaded as raw
// 0/1 bytes in a gl.ALPHA texture, so a live cell read as 1/255. Every term it
// fed sat on its golVal = 0 value: swirl 0.3, density 0.4, speed 0.5, feedback
// delay 0.010, and a dye of smoothstep(0.6, 1.0, 1/255) = 0, which zeroed the
// dye injection, the swirl eddies and the core's extra amber. Those terms are
// gone, and the 0.5 speed is the Spin knob.
//
// On top of it is the original TimeTunnel's mapping of the input: the inverse
// radius tunnel, mirrored top to bottom and max-combined. That is the material.
// The tunnel's light (everything the sketch draws) shines on it from the pit:
// a bump normal from the material's luminance gives it a diffuse and specular
// response, and the same normal refracts the light field and bends the rays.

// The noise lattice, filled once by timetunnelLatticeFrag: texel (i, j) holds
// the hashes of lattice cell (i, j)'s four corners, wrapping at NOISE_SIZE. A
// value noise then reads all four corners in one texture read, where hashing
// them costs four sin() calls. That took the two feedback passes from 1.0 to
// 0.4 ms at 1280x960 (see TimeTunnel Module in ARCHITECTURE.md). The field
// differs from the sketch's, which hashed every lattice point, but its
// statistics don't.
export const NOISE_SIZE = 256;

const HASH = `
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
`;

const NOISE = `
uniform sampler2D u_noise;   // the noise lattice
${HASH}
// Value noise with a smoothstep fade, its corners read from the lattice
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 h = texture2D(u_noise, (mod(i, ${NOISE_SIZE}.0) + 0.5) / ${NOISE_SIZE}.0);
  return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
}

// Map an angle onto a circle in noise space. atan() has a branch cut along the
// -x axis, so feeding an angle to noise as a linear coordinate tears the field
// along that ray. A circle is continuous by construction.
vec2 ring(float ang, float radius) { return vec2(cos(ang), sin(ang)) * radius; }
`;

export const timetunnelLatticeFrag = `
precision highp float;
${HASH}
void main() {
  vec2 i = floor(gl_FragCoord.xy);
  vec2 j = mod(i + 1.0, ${NOISE_SIZE}.0);
  gl_FragColor = vec4(hash(i), hash(vec2(j.x, i.y)), hash(vec2(i.x, j.y)), hash(j));
}
`;

export const timetunnelFeedbackFrag = `
precision highp float;

uniform sampler2D u_prev;    // this world's previous frame
uniform vec2 uResolution;    // fragResolution(): the pass works in gl_FragCoord
uniform float u_age;         // world-local seconds; resets with the world
uniform float u_spinT;       // world-local spin clock (age x Spin)
uniform float u_trail;       // retention of the main feedback tap
uniform float u_period;      // seconds between shockwaves
uniform float u_shock;       // shockwave and shard strength

${NOISE}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = rot * p * 2.0 + vec2(100.0);
    a *= 0.5;
  }
  return v;
}

vec2 hash2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

// Squared distance to the nearest feature point; the nearest cell id and the
// second-nearest squared distance come out through the out params.
float voronoi(vec2 p, out vec2 cellId, out float d2) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float d1 = 8.0;
  d2 = 8.0;
  vec2 best = ip;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = ip + vec2(float(x), float(y));
      vec2 diff = vec2(float(x), float(y)) + hash2(cell) - fp;
      float d = dot(diff, diff);
      if (d < d1) { d2 = d1; d1 = d; best = cell; }
      else if (d < d2) { d2 = d; }
    }
  }
  cellId = best;
  return d1;
}

void main() {
  // gl_FragCoord, not vTexCoord: the feedback tap must address u_prev in the
  // orientation the previous frame wrote it (see SpiralGalaxy).
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);

  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float r = length(p);
  float a = atan(p.y, p.x);

  float twist = a + u_spinT * 0.45 / (1.0 + r * 0.5);

  // Feedback sampling with swirl and a liquid wobble
  float wob1 = fbm(p * 3.0 + vec2(u_age * 0.26, 0.0));
  float wob2 = fbm(p * 3.0 + vec2(5.0, -u_age * 0.20));
  vec2 offset = vec2(cos(twist), sin(twist)) * 0.010 * r + (vec2(wob1, wob2) - 0.5) * 0.035;
  vec2 o = offset * aspect;

  vec4 col = texture2D(u_prev, uv + o) * u_trail;
  col += texture2D(u_prev, uv + o * 0.5) * 0.03;
  col += texture2D(u_prev, uv - o * 0.25) * 0.02;

  float n1 = fbm(ring(twist, 2.0) + vec2(0.0, r * 3.0 - u_spinT * 0.56));
  float n2 = fbm(ring(twist, 1.5) + vec2(5.0, r * 2.5 + u_spinT * 0.42));

  // Cloud contours: the field is cut into bands, each interior darkens toward
  // ink and each band edge glows as a thin amber line.
  float cloudField = clamp((n1 * 0.6 + n2 * 0.4) - r * 0.20 + 0.12, 0.0, 1.0);
  float cf = fract(cloudField * 9.0);
  float contour = 1.0 - smoothstep(0.02, 0.10, min(cf, 1.0 - cf));
  col.rgb *= mix(1.0, 0.5, smoothstep(0.0, 0.35, cloudField) * (1.0 - contour));
  col.rgb += vec3(1.0, 0.62, 0.25) * contour * 0.05;

  // Radial fade (tunnel depth)
  float fade = smoothstep(0.0, 1.2, r);
  col.rgb *= 1.0 - fade * fade * 0.85;

  // Ripples, at the sketch's density of 0.4
  float ripple1 = sin(r * 18.0 - u_spinT * 2.8 + n1 * 4.0);
  float ripple2 = sin(r * 12.0 + a * 3.0 + u_spinT * 2.1);
  float ripple = (ripple1 * 0.6 + ripple2 * 0.4) * 0.5 + 0.5;
  ripple = pow(ripple, 4.0) * 0.1;
  col.rgb += vec3(0.95, 0.55, 0.22) * ripple * 0.25 * smoothstep(0.8, 0.2, r);

  // Bright core
  col.rgb += vec3(1.0, 0.72, 0.40) * exp(-r * 3.0) * 0.125;

  // Expanding shockwave: a hot amber ring grows from the centre and fades
  float shockT = fract(u_age / u_period);
  float shockR = shockT * 1.5;
  float shockWidth = 0.04 + shockT * 0.15;
  float shock = exp(-pow((r - shockR) / shockWidth, 2.0));
  float shockFade = (1.0 - shockT) * (1.0 - shockT);
  col.rgb += vec3(1.0, 0.30, 0.05) * shock * shockFade * 0.40 * u_shock;

  // Black fragments shattering in the ring's wake. Voronoi chunks stay put
  // while the ring sweeps past; each cracks, twists, splits and crumbles.
  float wakeBehind = shockR - r;
  float wake = exp(-pow(max(wakeBehind, 0.0) / 0.34, 2.0))
             * step(0.0, wakeBehind)
             * smoothstep(0.0, 0.10, wakeBehind + 0.02)
             * shockFade * min(u_shock, 1.0);
  if (wake > 0.003) {
    vec2 vp = p * 14.0;
    vec2 cellId;
    float d2;
    float d1 = sqrt(voronoi(vp, cellId, d2));
    float edge = sqrt(d2) - d1;  // 0 at borders, grows inward

    vec2 local = vp - (cellId + hash2(cellId));

    float h1 = hash(cellId * 3.13);
    float h2 = hash(cellId * 9.31 + 4.7);
    float h3 = hash(cellId * 7.77 + 13.2);

    float crumble = clamp(wakeBehind * 2.5, 0.0, 1.0);

    // Each cell twists round its feature point, faster as it degrades
    float dir = step(0.5, h3) * 2.0 - 1.0;
    float twistAng = crumble * crumble * dir * (1.5 + h1 * 3.0);
    float ca = cos(twistAng), sa = sin(twistAng);
    vec2 tloc = vec2(ca * local.x - sa * local.y, sa * local.x + ca * local.y);

    // A finer Voronoi in the twisted space splits each cell into shards
    vec2 subId;
    float sd2;
    float sd1 = sqrt(voronoi(tloc * 3.0 * (1.0 + crumble * 0.35), subId, sd2));
    float subEdge = sqrt(sd2) - sd1;

    float sh1 = hash(subId * 5.17 + cellId * 3.0);
    float sh2 = hash(subId * 8.93 + cellId * 7.0);

    float subCrumble = clamp(crumble * (1.5 - sh1 * 0.9) - sh2 * 0.12, 0.0, 1.0);
    float subInset = 0.05 + sh1 * 0.10 + subCrumble * 0.30;
    float subMask = smoothstep(subInset, subInset + 0.07, subEdge);

    float insetEff = 0.05 + h1 * 0.12 + crumble * 0.26;
    float mask = smoothstep(insetEff, insetEff + 0.08, edge) * subMask;

    float rim = smoothstep(0.14, 0.02, subEdge);

    float heat = exp(-pow(max(wakeBehind, 0.0) / 0.10, 2.0));
    float sheen = 0.5 + 0.5 * sin(a * 14.0 + h2 * 12.56);

    vec3 metal = vec3(0.015, 0.015, 0.02);
    metal += vec3(0.78, 0.58, 0.38) * rim * (0.35 + heat * 0.9) * (0.6 + 0.4 * sheen);
    metal += vec3(1.0, 0.35, 0.10) * rim * heat * 1.4;

    float shardAlpha = clamp(wake * mask * 1.25 * (1.0 - subCrumble * 0.85), 0.0, 1.0);
    col.rgb = mix(col.rgb, metal, shardAlpha);

    // Dust, in the twisted space so it swirls with the pieces
    float dustAmt = wake * smoothstep(0.04, 0.30, crumble) * (1.0 - crumble);
    float dust = smoothstep(0.70, 0.95, hash(floor(tloc * 18.0 + cellId * 11.0))) * dustAmt;
    dust += smoothstep(0.82, 0.98, hash(floor(tloc * 7.5 + cellId * 5.0))) * dustAmt * 0.7;
    vec3 dustCol = vec3(0.62, 0.48, 0.30) * (0.45 + heat * 0.55);
    col.rgb = mix(col.rgb, dustCol, clamp(dust, 0.0, 1.0) * 0.80);
  }

  // Subtle vignette
  col.rgb *= 1.0 - length(uv - 0.5) * 0.72;

  col.rgb = pow(col.rgb, vec3(0.92));

  gl_FragColor = vec4(col.rgb, 1.0);
}
`;

// The bolts' vertices: TimeTunnelModule.BOLTS bolts of BOLT_POINTS points each,
// the first at the centre. They depend only on the clock, so the module walks
// them once a frame instead of every pixel walking all of them.
export const BOLTS = 4;
export const BOLT_POINTS = 13;

// Composites the two worlds. With `material`, it also maps the input onto the
// tunnel and lights it; without, the module is a source showing the sketch.
// `material` is 'shiny', for walls that repeat the input mirrored, or
// 'classic', for the original shader's walls: the input clamped to the edge,
// with u_travel the absolute clock times Speed, so in practice its leftmost
// column, drawn as rings.
export const timetunnelBlendFrag = (material) => `
precision highp float;
varying vec2 vTexCoord;

uniform sampler2D tex0;      // world A
uniform sampler2D tex1;      // world B
uniform float u_mix;         // weight of world B
uniform vec2 uResolution;
uniform float u_time;        // seconds into the loop
uniform float u_warp;        // depth of the warp-in zoom
uniform float u_zt;          // phase of the warp-in zoom, 0..1
uniform float u_rays;        // beams and streaks
uniform float u_pit;         // the pit's mean radius
uniform vec2 u_pitOff;       // the pit's wandering centre, in uv
uniform vec2 u_wc1;          // the pit edge's three noise orbits
uniform vec2 u_wc2;
uniform vec2 u_wc3;
uniform vec2 u_o2;
uniform float u_bloomT;      // the bloom texture's drift
uniform float u_rimPulse;
uniform float u_flicker;     // frame-to-frame brightness flicker
uniform vec2 u_bolt[${BOLTS * BOLT_POINTS}];
uniform vec4 u_boltEnv;      // each bolt's pulse, times Bolts
uniform vec2 u_hueCS;        // cos and sin of Hue
${material ? `
uniform sampler2D u_in;      // the material
uniform float u_zoom;
uniform float u_travel;      // how far the walls have scrolled
uniform float u_light;       // diffuse response
uniform float u_bump;        // normal strength
uniform float u_shine;       // specular response
uniform float u_refract;     // how far the normal bends the light
` : ''}

${NOISE}

vec3 hueRotate(vec3 c) {
  const vec3 k = vec3(0.57735027);
  return c * u_hueCS.x + cross(k, c) * u_hueCS.y + k * dot(k, c) * (1.0 - u_hueCS.x);
}
${material ? `
${material === 'classic' ? `
// The input clamped to the edge, as the original shader read it
vec4 wall(vec2 t) {
  return texture2D(u_in, t);
}` : `
// The input mirrored on both axes, so the walls repeat without seams
vec4 wall(vec2 t) {
  return texture2D(u_in, 1.0 - abs(1.0 - mod(t, 2.0)));
}`}

// The original TimeTunnel: an inverse-radius tunnel, and its mirror top to
// bottom, combined by max. rInv is depth, so the far wall is brighter.
vec4 tunnel(vec2 st, vec2 aspect) {
  vec2 a = u_zoom * (st - 0.5) * aspect;
  vec2 b = vec2(a.x, -a.y);
  float rInv = 1.0 / length(a);
  vec2 shift = vec2(rInv + u_travel, 0.5);
  return max(wall(a * rInv - shift), wall(b * rInv - shift)) * (rInv * 0.5);
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
` : ''}

void main() {
  vec2 uv = vTexCoord;
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 toAspect = uResolution / min(uResolution.x, uResolution.y);

  // Warp-in zoom: a sharp rush toward the centre
  float ramp = smoothstep(0.0, 0.22, u_zt) * (1.0 - smoothstep(0.40, 0.62, u_zt));
  float zoom = 1.0 + pow(ramp, 1.8) * u_warp;
  vec2 q = (uv - 0.5) / zoom + 0.5;

  vec2 d = uv - 0.5;
  vec2 aD = d * toAspect;
  float aR = length(aD);
  float ang = atan(aD.y, aD.x);

  vec2 dp = (uv - 0.5 - u_pitOff) * toAspect;
  float rr = length(dp);
  float aa = atan(dp.y, dp.x);
${material ? `
  // The material and its bump normal, from two neighbouring taps
  vec4 m = tunnel(q, aspect);
  vec2 px = 1.5 / (uResolution * zoom);
  float h = luma(m.rgb);
  float hx = luma(tunnel(q + vec2(px.x, 0.0), aspect).rgb);
  float hy = luma(tunnel(q + vec2(0.0, px.y), aspect).rgb);
  vec3 N = normalize(vec3((h - hx) * u_bump * 4.0, (h - hy) * u_bump * 4.0, 1.0));

  // The light field and the rays bend over the material's relief
  q += N.xy * u_refract * 0.02;
  vec2 radial = aD / max(aR, 1e-4);
  ang += dot(N.xy, vec2(-radial.y, radial.x)) * u_refract * 0.5;
  aR += dot(N.xy, radial) * u_refract * 0.05;
` : ''}
  vec3 c = mix(texture2D(tex0, q).rgb, texture2D(tex1, q).rgb, u_mix);

  // Radiating speed beams and hyperspace streaks
  float beams = pow(abs(sin(ang * 24.0 + 0.4 * sin(ang * 7.0 + u_time * 1.3))), 50.0);
  vec2 bin = vec2(floor(ang * 34.0), floor(aR * 14.0 - u_time * 18.0));
  float hh = hash(bin);
  float streak = smoothstep(0.55, 0.82, hh);
  vec3 streakCol = mix(vec3(1.0, 0.88, 0.60), vec3(1.0, 0.62, 0.25), hash(bin + 3.7));
  c = mix(c, streakCol, clamp((beams * (0.06 + ramp * 0.18) + streak * (0.10 + ramp * 0.34)) * u_rays, 0.0, 1.0));

  // Textured noise so the streaks don't go flat
  float tex = noise(uv * vec2(90.0, 56.0) + vec2(u_time * 2.0, u_time * 0.7));
  c += (tex - 0.5) * (0.05 + ramp * 0.10);

  // Bright core burst at the peak of the zoom
  float flash = smoothstep(0.04, 0.24, u_zt) * (1.0 - smoothstep(0.26, 0.52, u_zt));
  c = mix(c, vec3(1.0, 0.97, 0.90), flash * flash * smoothstep(0.85, 0.32, aR) * 0.11);

  // The black pit, its edge writhing on three octaves of noise
  float fringeR = u_pit
                + (noise(ring(aa, 2.0) + u_wc1) - 0.5) * 0.12
                + (noise(ring(aa, 3.5) + u_wc2) - 0.5) * 0.065
                + (noise(ring(aa, 5.0) + u_wc3) - 0.5) * 0.030;
  float centerMask = u_pit > 0.0 ? smoothstep(fringeR + 0.03, fringeR - 0.03, rr) : 0.0;
  c = mix(c, vec3(0.0), centerMask);

  // Lightning. Nothing it draws reaches past rr = 0.41, so only the middle
  // of the frame walks the bolts.
  vec3 amber = vec3(0.98, 0.58, 0.16);
  if (rr < 0.42) {
    float line = 0.0, glow = 0.0, bloom = 0.0;
    for (int b = 0; b < ${BOLTS}; b++) {
      float env = b == 0 ? u_boltEnv.x : b == 1 ? u_boltEnv.y : b == 2 ? u_boltEnv.z : u_boltEnv.w;
      if (env < 0.002) continue;
      float best = 8.0;
      vec2 pos = u_bolt[b * ${BOLT_POINTS}];
      for (int i = 1; i < ${BOLT_POINTS}; i++) {
        vec2 next = u_bolt[b * ${BOLT_POINTS} + i];
        vec2 s = next - pos;
        float t = clamp(dot(dp - pos, s) / max(dot(s, s), 1e-6), 0.0, 1.0);
        best = min(best, length(dp - pos - s * t));
        pos = next;
      }
      line += exp(-best * 95.0) * env;
      glow += exp(-best * 26.0) * 0.8 * env;
      bloom += exp(-best * 10.0) * env;
    }
    bloom *= 0.55 + 0.5 * noise(ring(aa, 1.0) * 9.0 + vec2(0.0, rr * 20.0 - u_bloomT));
    float bloomMask = smoothstep(0.36, 0.10, rr + (noise(ring(aa, 1.0) * 6.0 + u_o2) - 0.5) * 0.10);
    c += amber * (glow + bloom) * bloomMask * 0.45;
    c += vec3(1.0, 0.88, 0.70) * line * centerMask * 0.9;
  }

  // Thin amber rim round the pit, and a soft halo hugging it
  if (u_pit > 0.0) {
    float rim = smoothstep(0.022, 0.0, abs(rr - fringeR));
    c += amber * rim * u_rimPulse * 0.6;
    float halo = exp(-pow((rr - fringeR - 0.030) / 0.085, 2.0));
    c += amber * halo * (0.05 + 0.05 * u_rimPulse);
  }

  c *= u_flicker;
  c = hueRotate(c);
${material ? `
  // The tunnel's light falls on the material from the pit. Flat material is
  // lit by the light as it is; relief facing the pit takes more and glints.
  vec3 L = max(c, 0.0);
  vec3 Ld = normalize(vec3(-dp / max(rr, 1e-4) * 0.8, 0.6));
  float diff = max(dot(N, Ld), 0.0) / 0.6;
  float spec = pow(max(dot(N, normalize(Ld + vec3(0.0, 0.0, 1.0))), 0.0), 32.0);
  vec3 alb = min(m.rgb, vec3(2.0)) * (1.0 - centerMask);
  c += alb * (0.08 + L * 2.5 * diff) * u_light + L * spec * u_shine * 3.0;
${material === 'classic' ? `
  // The pit is a window onto the Classic picture, unlit and clamped as the
  // original's 8-bit output was, so its glow shows at the end of the tunnel.
  // It is sampled at uv, not q: through the warp-in's zoom, its white centre
  // would fill the pit.
  if (centerMask > 0.0) c += min(tunnel(uv, aspect).rgb, vec3(1.0)) * centerMask;` : ''}
` : ''}
  c += (hash(gl_FragCoord.xy + fract(u_time * 11.3) * 57.0) - 0.5) * 0.07;

  gl_FragColor = vec4(c, 1.0);
}
`;

// Classic: the original TimeTunnel shader, unchanged, for patches made with it.
// It reads its input clamped to the edge with an offset that grows with the
// absolute clock, so in practice it shows the input's leftmost column.
export const timetunnelClassicFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float time;
uniform vec2 uResolution;
uniform float zoom;
uniform float speed;

void main() {
  vec2 uv = zoom * (vTexCoord - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float rInv = 1.0 / length(uv);
  uv = uv * rInv - vec2(rInv + time * speed, 0.5);
  vec4 col = texture2D(tex0, uv) * rInv / 2.0;

  vec2 flipped = zoom * (vec2(vTexCoord.x, 1.0 - vTexCoord.y) - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float rInvF = 1.0 / length(flipped);
  flipped = flipped * rInvF - vec2(rInvF + time * speed, 0.5);
  vec4 colF = texture2D(tex0, flipped) * rInvF / 2.0;

  gl_FragColor = max(col, colF);
}
`;
