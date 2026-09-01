// Ink Drops — a sheet of cold-press paper worked in watercolour: splashes
// bloom and shatter, fat drops fall in and soak out huge, and a wet rag is
// dragged across it, lifting pigment back off. Ported from the WebGL2 sketch
// `splottissimo.html`, which runs three passes over a persistent accumulation
// buffer (see InkDropsModule.js for the CPU-side simulation that feeds them):
//
//   bake — settled drops stamped permanently into the paper (dst *= transmittance)
//   lift — evaporation plus the solvent wipe, both walking the sheet back to white
//   main — the paper, the baked stains, and the drops still wet on the surface
//
// Port notes: the sketch is GLSL ES 3.00 and LICHEN is ES 1.00, so `texture` is
// `texture2D`, `fragColor` is `gl_FragColor`, and the `continue` skips are
// written as plain conditionals. The bake pass multiplied into its target with
// `blendFunc(ZERO, SRC_COLOR)`; here it ping-pongs and multiplies the previous
// buffer in the shader, which keeps the pass independent of p5's blend state.
export const INK_MAXD = 32;         // drops uploaded per pass
export const INK_MAXR = 12;         // concentric ring (solvent wipe) slots
export const INK_RING_LIFE = 9.0;   // seconds from a wipe's impact to fully dried

const RING_FADE_AT = 0.40;  // fraction of that life before the wipe starts drying off
const RING_SMEAR = 0.075;   // how far the bands are dragged out of true
const RING_DRAG = 0.012;    // how far lifted pigment is smeared along the wipe

const HEAD = `
precision highp float;
#define MAXD ${INK_MAXD}
#define MAXR ${INK_MAXR}
#define RLIFE ${INK_RING_LIFE.toFixed(1)}
#define RFADE ${RING_FADE_AT.toFixed(3)}
#define RSMEAR ${RING_SMEAR.toFixed(4)}
#define RDRAG ${RING_DRAG.toFixed(4)}
`;

const COMMON = `
uniform vec2 uRes;
uniform vec4 uA[MAXD];   // xy center (uv) | z radius (y-units) | w seed
uniform vec4 uB[MAXD];   // x strength | y fragmentation | z squash | w tendril amount
uniform vec4 uC[MAXD];   // rgb ink transmission colour | a softness (big stain)
uniform int  uCount;
uniform vec4 uRing[MAXR];   // xy origin (min-dimension units) | z age | w seed
uniform vec4 uRingB[MAXR];  // x fade (1 while alive, ramped to 0 when retired)
uniform int  uRingCount;

// Two spaces, and they must not be confused. texUV addresses the framebuffer
// itself: v = y / H is exactly the row being written, so it is the only uv that
// may read the sheet back -- reading through the flipped one mirrors the whole
// sheet on every ping-pong. sheetUV is the composition's own space, y up: the
// UI blits the output with v flipped, so gl_FragCoord.y runs top-down on
// screen, and flipping it back is what keeps the falling stains falling down.
vec2 texUV(){ return gl_FragCoord.xy / uRes; }
vec2 sheetUV(){ return vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes; }

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){
    s += a * vnoise(p);
    p = p * 2.03 + 17.13;
    a *= 0.5;
  }
  return s;
}

float fbm3(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){
    s += a * vnoise(p.xy + p.z * 0.3);
    p = p * 2.03 + vec3(17.13, 17.13, 7.31);
    a *= 0.5;
  }
  return s;
}

// Paper tooth is fixed in screen space, so every layer pools into the same fibres.
float paperTooth(vec2 uv, float asp){
  vec2 q = vec2(uv.x * asp, uv.y);
  return fbm(q * 68.0) * 0.62 + fbm(q * 11.0 + 5.0) * 0.38;
}

// Cold-press paper base color with cloud mottle
vec3 paperColor(vec2 uv, float asp){
  float cloud = fbm(vec2(uv.x * asp, uv.y) * 3.7 + 12.0);
  vec3 paper = vec3(0.988, 0.981, 0.968);
  paper *= 0.962 + paperTooth(uv, asp) * 0.052 + (cloud - 0.5) * 0.030;
  return paper;
}

// Pigment density of one drop at aspect-corrected offset p (y up).
// soft > 0.5 takes the big-stain path: a large, slow, tendril-free wash.
float dropDensity(vec2 p, float R, float seed, float squash, float tendril,
                  float frag, float soft, float tooth){
  p.y /= max(squash, 0.05);

  if (soft > 0.5){
    if (dot(p, p) > R * R * 4.0) return 0.0;
    vec2 sq = p / max(R, 1e-5);
    // one warp only: these cover a lot of screen, so they stay cheap
    vec2 w = vec2(fbm3(vec3(sq * 0.92, seed)), fbm3(vec3(sq * 0.92, seed + 31.7))) - 0.5;
    float d = length(sq + w * 0.44);
    float blob = 1.0 - smoothstep(0.25, 1.0, d);           // soaked body
    float ring = smoothstep(0.55, 0.95, d) * (1.0 - smoothstep(0.95, 1.42, d));
    return (blob * 0.74 + ring * 0.46) * (0.84 + 0.30 * tooth);
  }

  if (dot(p, p) > R * R * 9.0) return 0.0;

  vec2 sp = p / max(R, 1e-5);
  float ang = atan(sp.y, sp.x);
  vec2 ac = vec2(cos(ang), sin(ang));      // seamless sampling around the rim

  // domain warp -> lopsided, hand-blotted silhouette
  vec2 w = vec2(fbm3(vec3(sp * 1.55, seed)), fbm3(vec3(sp * 1.55, seed + 31.7))) - 0.5;
  float d = length(sp + w * 0.30);

  // capillary tendrils: sparse sharp fingers creeping out along the grain
  float n1 = fbm3(vec3(ac * 3.1, seed * 1.7));
  float n2 = fbm3(vec3(ac * 9.3, seed * 3.1));
  float spikes = pow(clamp(n1 * 0.78 + n2 * 0.52 - 0.34, 0.0, 1.0), 1.7) * 2.2;
  float edge = 1.0 + tendril * (0.52 * spikes + 0.12 * (n1 - 0.5));

  float body   = smoothstep(edge, edge - 0.30, d);            // solid mass
  float halo   = smoothstep(edge * 1.80, edge * 0.42, d);     // wide translucent bleed
  float ring   = exp(-pow((d - edge * 0.93) / 0.115, 2.0));   // pigment pooling at the rim
  float thread = smoothstep(edge * (1.0 + tendril * 1.05), edge * 0.98, d) * spikes;

  float dens = body * 0.86 + halo * 0.19 + ring * 0.52 + thread * 0.30;

  // fragmentation: noise carves the wash into shards that break apart at the rim
  // while the core stays intact
  if (frag > 0.002){
    float shard = fbm3(vec3(sp * 3.4 + seed, seed * 0.7));
    float carve = smoothstep(0.30, 0.66, shard + (1.0 - min(d, 1.0)) * 0.38);
    dens *= mix(1.0, carve, frag);
  }

  return dens * (0.82 + 0.36 * tooth);                        // granulation
}

// signed distance to a ring of radius r, half-thickness w (positive outside the band)
float sdRing(float d, float r, float w){ return abs(d - r) - w; }

// alpha compositing: stays in [0,1] no matter how many rings overlap
float over(float acc, float add){ return acc + (1.0 - acc) * add; }

// A wet blotter dropped on the sheet: concentric bands of solvent that wick
// outward and lift pigment instead of laying any down. Nothing is drawn, so
// this returns pure coverage -- and it is deliberately ragged: the sample point
// is dragged around by noise so the bands smear, tear and wander rather than
// reading as the clean annuli they came from.
float ringLift(vec2 p, vec2 origin, float age, float seed, float tooth){
  if (age <= 0.0 || age >= RLIFE) return 0.0;

  vec2 q = p - origin;
  float d0 = length(q);

  // spread decelerates and is bounded, so a wipe can never flood the screen
  float R = 0.30 * (1.0 - exp(-age * 0.45));
  if (d0 > R * 1.15 + RSMEAR * 2.5) return 0.0;   // reject before paying for noise

  // five taps, reused for both the smear and the patchiness -- fbm here would
  // cost 4x this and the bands are too ragged to show the difference
  float n1 = vnoise(q * 7.0  + seed * 19.0);
  float n2 = vnoise(q * 7.0  + seed * 41.0);
  float n3 = vnoise(q * 23.0 + seed * 7.3);
  float n4 = vnoise(q * 23.0 + seed * 3.9);
  float n5 = vnoise(q * 47.0 + seed * 5.1);

  float a = atan(q.y, q.x);
  float wob = 1.0 + 0.075 * sin(a * 5.0 + seed * 6.283)
                  + 0.050 * sin(a * 9.0 - seed * 3.141)
                  + 0.030 * sin(a * 17.0 + seed * 1.7);

  // the smear: drag the sample far enough that the bands tear open
  vec2 warp = (vec2(n1, n2) - 0.5) * RSMEAR + (vec2(n3, n4) - 0.5) * (RSMEAR * 0.40);
  float d = length(q + warp) * wob;

  // The lift is permanent, so anything that sits still keeps eating the same
  // pixels until they are bare white. Only the advancing front stays wet at
  // full strength; every stationary term dries off instead.
  float dry = exp(-age * 0.5);

  float lift = 0.0;

  // the wet front: a rag's width rather than a pen line
  float w = 0.020 + 0.016 * exp(-age * 0.4);
  lift += 0.95 * (1.0 - smoothstep(-w, w * 0.6, sdRing(d, R, w)));

  // bands the advancing front left behind, drying as they go
  for (int i = 1; i <= 4; i++){
    float fi = float(i);
    float sr = R * (1.0 - 0.16 * fi);
    float sw = 0.010 + 0.004 * sin(sr * 40.0 + fi + seed * 6.0);
    lift += (0.42 / fi) * (0.30 + 0.70 * dry)
          * (1.0 - smoothstep(-sw, sw * 0.7, sdRing(d, sr, sw)));
  }

  // The bands do the erasing; the interior only gets a breath of it. At any
  // real strength this term wipes the whole disc bare in a couple of seconds,
  // which reads as a hole punched in the picture rather than a wipe.
  lift += 0.07 * dry * (1.0 - smoothstep(R * 0.15, R, d));

  // and the pool at the point of impact comes up clean, briefly
  float pool = 0.014 + 0.034 * (1.0 - exp(-age * 0.35));
  lift += 0.55 * exp(-age * 0.7) * (1.0 - smoothstep(pool * 0.45, pool, d));

  // messy coverage: the rag tears open where it barely touched, lifts clean
  // where it bit, and pigment held in the tooth of the paper resists it
  lift *= smoothstep(0.10, 0.52, n3 * 0.45 + n5 * 0.35 + n1 * 0.20) * 1.40;
  lift *= 1.15 - 0.45 * tooth;

  float env = smoothstep(0.0, 0.3, age) * (1.0 - smoothstep(RLIFE * RFADE, RLIFE, age));
  return clamp(lift, 0.0, 1.0) * env;
}

// Beer-Lambert: ink transmitting colour col absorbs (1 - col)
vec3 pigment(float dens, vec3 col){
  return exp(-dens * (1.0 - col) * 2.35);
}

// 3x3 gaussian + a whisper of pigment separation
vec3 sampleStain(vec2 uv, sampler2D accum){
  vec2 px = 1.35 / uRes;
  vec3 s = texture2D(accum, uv).rgb * 4.0;
  s += (texture2D(accum, uv + vec2(px.x, 0.0)).rgb +
        texture2D(accum, uv - vec2(px.x, 0.0)).rgb +
        texture2D(accum, uv + vec2(0.0, px.y)).rgb +
        texture2D(accum, uv - vec2(0.0, px.y)).rgb) * 2.0;
  s += texture2D(accum, uv + px).rgb +
       texture2D(accum, uv - px).rgb +
       texture2D(accum, uv + vec2(px.x, -px.y)).rgb +
       texture2D(accum, uv - vec2(px.x, -px.y)).rgb;
  s /= 16.0;

  s.r = mix(s.r, texture2D(accum, uv + px * 1.15).r, 0.30);
  s.b = mix(s.b, texture2D(accum, uv - px * 1.15).b, 0.30);
  return s;
}

// The wet drops the pass is carrying, as a transmittance the paper is seen through.
vec3 wetTransmittance(vec2 uv, float asp, float tooth){
  vec3 T = vec3(1.0);
  for (int i = 0; i < MAXD; i++){
    if (i >= uCount) break;
    vec2 p = vec2((uv.x - uA[i].x) * asp, uv.y - uA[i].y);
    float dens = dropDensity(p, uA[i].z, uA[i].w, uB[i].z, uB[i].w,
                             uB[i].y, uC[i].a, tooth) * uB[i].x;
    if (dens > 0.0) T *= pigment(dens, uC[i].rgb);
  }
  return T;
}
`;

// Settled drops, stamped permanently into the paper: the previous sheet times
// their transmittance. The wipe coverage parked in alpha is passed through.
export const inkDropsBakeFrag = HEAD + COMMON + `
uniform sampler2D uSrc;
void main(){
  vec2 uv = sheetUV();
  float asp = uRes.x / uRes.y;
  vec4 prev = texture2D(uSrc, texUV());
  gl_FragColor = vec4(prev.rgb * wetTransmittance(uv, asp, paperTooth(uv, asp)), prev.a);
}
`;

// Evaporation, plus the solvent wipe. Both walk the sheet back toward paper
// white, so they share a pass -- and the wipe's coverage is parked in the
// accumulation buffer's alpha, which nothing else uses, so the composite can
// read it back with one texture fetch instead of re-running the ring loop.
export const inkDropsLiftFrag = HEAD + COMMON + `
uniform sampler2D uSrc;
uniform float uAmt;    // evaporation this step
uniform float uLift;   // solvent strength this step (per-second rate * dt)
void main(){
  vec2 uv = sheetUV();
  vec2 tuv = texUV();
  float asp = uRes.x / uRes.y;
  vec2 pr = (uv - 0.5) * vec2(asp, 1.0);   // min-dimension units, y up
  float tooth = paperTooth(uv, asp);

  float lift = 0.0, strongest = 0.0;
  vec2 dir = vec2(0.0);
  for (int i = 0; i < MAXR; i++){
    if (i >= uRingCount) break;
    float f = uRingB[i].x;
    if (f > 0.0){
      float c = ringLift(pr, uRing[i].xy, uRing[i].z, uRing[i].w, tooth) * f;
      if (c > strongest){                     // smear along whichever wipe dominates here
        strongest = c;
        vec2 v = pr - uRing[i].xy;
        dir = v / max(length(v), 1e-4);
      }
      lift = over(lift, c);
    }
  }

  vec3 src = texture2D(uSrc, tuv).rgb;

  if (lift > 0.0){
    // a rag drags pigment as well as removing it; dir is in sheet space, whose
    // y runs opposite the texture's, so the offset is flipped to sample along it
    vec2 off = (dir * RDRAG * lift) / vec2(asp, 1.0);
    src = mix(src, texture2D(uSrc, tuv - vec2(off.x, -off.y)).rgb, 0.55 * lift);
    src = mix(src, vec3(1.0), clamp(lift * uLift, 0.0, 1.0));
  }

  gl_FragColor = vec4(min(src + uAmt, vec3(1.0)), lift);
}
`;

export const inkDropsMainFrag = HEAD + COMMON + `
uniform sampler2D uAccum;
uniform float uTime;
uniform float uGrain;

void main(){
  vec2 uv = sheetUV();
  vec2 tuv = texUV();
  float asp = uRes.x / uRes.y;
  float tooth = paperTooth(uv, asp);

  // --- cold-press paper, already wiped by the lift pass ---
  vec3 col = paperColor(uv, asp) * sampleStain(tuv, uAccum);

  // solvent coverage the lift pass parked in alpha; the baked layer has already
  // had it applied, so it is only owed to drops that have yet to settle
  float lift = texture2D(uAccum, tuv).a;

  // --- drops still wet on the surface ---
  // the wipe thins them before they ever settle
  col *= mix(wetTransmittance(uv, asp, tooth), vec3(1.0), lift);

  // --- finish ---
  // vignette
  col *= 1.0 - 0.16 * pow(length((uv - 0.5) * vec2(asp * 0.95, 1.0)), 2.4);
  // subtle film grain
  col += (hash21(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * 0.014 * uGrain;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
