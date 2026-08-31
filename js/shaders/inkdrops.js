// Ink Drops — drops of ink blooming into wet paper, each a bounded front of
// rings that spreads, soaks and fades. Ported from a WebGL2 sketch; the only
// changes are the GLSL ES 3.00 -> 1.00 downconvert (LICHEN is WebGL1) and the
// five constants the sketch was fixed on, opened up as uniforms.
export const inkDropsFrag = `
precision highp float;

uniform vec2 uResolution;
uniform float u_time;
uniform vec2 u_click;      // impact point in pixels, matching gl_FragCoord
uniform float u_click_t;
uniform float u_drops;     // how many of the slots below are live
uniform float u_life;      // seconds from impact to fully faded
uniform float u_spread;    // bounded radius of the wet front
uniform float u_wobble;    // organic radial distortion
uniform float u_grain;     // paper grain

const int DROPS = 8;       // slots compiled in; u_drops gates how many are used

// ---- SDFs ----
// signed distance to a ring of radius r, half-thickness w (positive outside the band)
float sdRing(float d, float r, float w){ return abs(d - r) - w; }

// ---- Noise ----
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for(int i = 0; i < 6; i++){ v += a*noise(p); p = rot*p*2.1; a *= 0.5; }
  return v;
}

// ---- Paper grain ----
float paperGrain(vec2 uv){
  float g = noise(uv*600.0)*0.06;
  float f = fbm(uv*200.0)*0.04;
  return (g + f) * u_grain;
}

// ---- Lifetime envelope: rises fast on impact, eases back to exactly 0 at u_life ----
float envelope(float age){
  return smoothstep(0.0, 0.3, age) * (1.0 - smoothstep(u_life*0.35, u_life, age));
}

// ---- One ink drop: bounded coverage in [0,1] ----
float drop(vec2 p, vec2 origin, float age, float seed){
  if(age <= 0.0 || age >= u_life) return 0.0;

  vec2 q = p - origin;
  float d = length(q);
  float a = atan(q.y, q.x);

  // organic radial distortion so nothing reads as a perfect circle
  float wob = 1.0 + u_wobble * (
      0.045*sin(a*5.0  + seed*6.283)
    + 0.030*sin(a*9.0  - seed*3.141)
    + 0.018*sin(a*15.0 + 1.7)
    + 0.060*(noise(q*7.0 + seed*23.0) - 0.5));
  d *= wob;

  // spread decelerates and is bounded, so a drop can never flood the screen
  float R = u_spread*(1.0 - exp(-age*0.45));

  float ink = 0.0;

  // leading edge: a true annulus, dark only in the band
  float w = 0.006 + 0.004*exp(-age*0.5);
  ink += 0.55*(1.0 - smoothstep(-w, 0.0, sdRing(d, R, w)));

  // trailing rings left behind by the advancing front
  for(int i = 1; i <= 4; i++){
    float fi = float(i);
    float sr = R*(1.0 - 0.16*fi);
    float sw = 0.0035 + 0.0010*sin(sr*40.0 + fi + seed*6.0);
    ink += (0.26/fi)*(1.0 - smoothstep(-sw, 0.0, sdRing(d, sr, sw)));
  }

  // faint wash of soaked paper inside the front
  ink += 0.14*(1.0 - smoothstep(R*0.2, R, d));

  // central pool at the point of impact
  float pr = 0.012 + 0.030*(1.0 - exp(-age*0.35));
  ink += 0.85*(1.0 - smoothstep(pr*0.45, pr, d));

  return clamp(ink, 0.0, 1.0) * envelope(age);
}

// alpha compositing: stays in [0,1] no matter how many drops overlap
float over(float acc, float add){ return acc + (1.0 - acc)*add; }

// ---- Paper color ----
vec3 paperColor(vec2 uv){
  vec3 base = vec3(0.94, 0.91, 0.86);
  base += paperGrain(uv) * 0.08;
  float vig = 1.0 - 0.25*length(uv);
  return base * vig;
}

// ---- Main ----
void main(){
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = (gl_FragCoord.xy - uResolution*0.5) / min(uResolution.x, uResolution.y);
  vec2 halfExtent = 0.5*uResolution / min(uResolution.x, uResolution.y);

  vec3 col = paperColor(uv);
  vec3 ink = vec3(0.05, 0.045, 0.04);
  float inkAlpha = 0.0;

  float t = u_time;

  // one new drop every u_life/u_drops seconds, so the slots stay evenly spaced
  float stagger = u_life / max(u_drops, 1.0);

  // ---- Rolling drops: each slot respawns at a new spot every u_life seconds ----
  for(int i = 0; i < DROPS; i++){
    float fi = float(i);
    float phase = (t + fi*stagger) / u_life;
    float gen   = floor(phase);            // which generation of this slot
    float age   = (phase - gen) * u_life;

    // jittered 4x2 grid keeps drops spread out; the cell rotates each
    // generation (3 and 8 are coprime) so no slot camps one corner
    float cell = mod(fi + gen*3.0, 8.0);
    vec2 cxy = vec2(mod(cell, 4.0), floor(cell*0.25));
    vec2 jit = vec2(hash(vec2(fi*7.13 + 0.5, gen*3.77 + 1.3)),
                    hash(vec2(gen*1.91 + fi*2.7, fi*5.23 + 4.1)));
    vec2 g01 = (cxy + 0.15 + 0.7*jit) / vec2(4.0, 2.0);
    vec2 o = (g01*2.0 - 1.0) * halfExtent * 0.85;

    float seed = hash(vec2(gen*13.0 + fi, fi*2.7 + 0.9));
    // slots at or past u_drops contribute nothing
    float live = step(fi + 0.5, u_drops);
    inkAlpha = over(inkAlpha, drop(p, o, age, seed) * live);
  }

  // ---- Click to add drops ----
  vec2 cp = (u_click - uResolution*0.5) / min(uResolution.x, uResolution.y);
  inkAlpha = over(inkAlpha, drop(p, cp, t - u_click_t, 0.37));

  // ---- Apply ink ----
  col = mix(col, ink, inkAlpha);

  // slight warm cast where the ink pools
  col = mix(col, ink + vec3(0.02, 0.015, 0.01), inkAlpha * 0.3);

  // paper grain still reads through soaked ink
  col += paperGrain(uv) * inkAlpha * 0.15;

  // carbon black with a touch of warmth
  col = mix(col, col * vec3(0.95, 0.92, 0.9), smoothstep(0.0, 0.3, inkAlpha) * 0.1);

  col = pow(max(col, 0.0), vec3(0.95));
  gl_FragColor = vec4(col, 1.0);
}
`;
