// WetPaint's passes, from the Ink Smears sketch (ink-smears/index.html), in
// GLSL ES 1.00. The sketch's state texture is kept: rgb is pigment absorption
// (subtractive ink), a is wetness. Every pass but the last works in the
// sketch's sim space, gl_FragCoord with y up, so its forces (drips fall to low
// y) read as written. The UI shows a framebuffer with gl_FragCoord.y running
// top-down, so the display pass turns the state upright (see WetPaint Module
// in ARCHITECTURE.md).

// Segments a brush pass draws, as the sketch's MAXSEG
export const WET_PAINT_SEGMENTS = 64;

const COMMON = `
precision highp float;
float h11(float x){ return fract(sin(x * 127.1) * 43758.5453); }
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n1(float x){ float i = floor(x), f = fract(x); f = f*f*(3.-2.*f); return mix(h11(i), h11(i+1.), f); }
float n2(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
}
float dens(vec4 s){ return (s.r + s.g + s.b) * .3333; }
`;

// 1) Brush: stamps capsule segments with bristle streaks and dry-brush
//    breakup, and drags the ink just behind the brush forward (the smear)
export const wetPaintBrushFrag = COMMON + `
uniform sampler2D uState;
uniform vec2 uRes;
uniform float uCount;
uniform vec4 uSeg[${WET_PAINT_SEGMENTS}];   // p0.xy, p1.xy (sim px)
uniform vec4 uAux[${WET_PAINT_SEGMENTS}];   // r0, r1, load, seed
uniform vec3 uInk;
uniform float uWater;
void main(){
  vec2 vUv = gl_FragCoord.xy / uRes;
  vec2 px = gl_FragCoord.xy;
  vec4 s = texture2D(uState, vUv);
  for (int i = 0; i < ${WET_PAINT_SEGMENTS}; i++) {
    if (float(i) >= uCount) break;
    vec4 sg = uSeg[i], ax = uAux[i];
    vec2 a = sg.xy, ab = sg.zw - sg.xy;
    float L2 = dot(ab, ab), L = sqrt(L2);
    float t = L2 > 1e-6 ? clamp(dot(px - a, ab) / L2, 0., 1.) : 0.;
    float r = mix(ax.x, ax.y, t);
    vec2 d = px - (a + ab * t);
    float dist = length(d);
    if (dist > r) continue;
    vec2 dir = L2 > 1e-6 ? ab / L : vec2(0, 1);
    vec2 nrm = vec2(-dir.y, dir.x);
    float across = dot(d, nrm) / r;
    float load = ax.z, seed = ax.w;
    float soft = 1. - smoothstep(.55, 1., dist / r);

    // bristles: streaks that stay fixed across the brush, gap out as it dries
    float br = n1(across * 13. + seed * 31.) * .6 + n1(across * 41. + seed * 7.) * .4;
    float dry = 1. - load;
    float cover = smoothstep(dry * .85 - .12, dry * .85 + .12, br);
    cover *= mix(1., step(.3, h21(floor(px * .8) + seed)), dry * dry);

    // smear: pull what lies just behind the brush into its footprint
    vec4 behind = texture2D(uState, (px - dir * r * .5) / uRes);
    float sm = soft * (uWater > .5 ? .45 : .2) * min(L / r + .15, 1.);
    s.rgb = mix(s.rgb, behind.rgb, sm);

    if (uWater > .5) {
      s.a = max(s.a, soft * .95);
      s.rgb *= 1. - soft * .015;
    } else {
      float dep = soft * cover * load * (.035 + .28 * min(L / r, 1.));
      s.rgb += uInk * dep;
      s.a = min(1., s.a + soft * cover * .35 * load);
    }
  }
  gl_FragColor = vec4(min(s.rgb, vec3(2.6)), s.a);
}`;

// 2) Smear and drip. Its output is the next frame's input, and every force
//    comes from the image itself:
//      - gravity acts only on heavy wet ink, channelled into wandering rivulets
//      - ink flows along its own contours (the curl of the density gradient)
//      - wet ink bleeds down its own gradient
//      - Vortex: wet regions are sampled from a turned, zoomed copy
export const wetPaintSmearFrag = COMMON + `
uniform sampler2D uState;
uniform vec2 uRes, uTexel;
uniform float uTime, uGravity, uSwirl, uBleed, uDry, uVortex, uAspect;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 s  = texture2D(uState, uv);
  vec2 e  = uTexel * 1.5;
  vec4 sr = texture2D(uState, uv + vec2(e.x, 0)), sl = texture2D(uState, uv - vec2(e.x, 0));
  vec4 su = texture2D(uState, uv + vec2(0, e.y)), sd = texture2D(uState, uv - vec2(0, e.y));
  vec4 above = texture2D(uState, uv + vec2(0, 3. * uTexel.y));
  vec2 g = vec2(dens(sr) - dens(sl), dens(su) - dens(sd));

  float wetN  = max(max(max(s.a, sr.a), max(sl.a, su.a)), sd.a);
  float heavy = max(smoothstep(.75, 1.5, dens(s)) * s.a, smoothstep(.75, 1.5, dens(above)) * above.a);

  // rivulets: gravity's strength varies across x and meanders slowly down the page
  float cx  = uv.x * uRes.x / 16. + n1(uv.y * uRes.y / 220. + uTime * .03) * 3.;
  float col = n1(cx);
  float dcol = n1(cx + .35) - n1(cx - .35);

  vec2 v = vec2(0);
  v.y -= uGravity * heavy * (.2 + 1.6 * col * col);
  v.x += uGravity * heavy * dcol * 2.2;

  // contour flow, its direction flipping region to region: a marbled shear
  float swirlSign = (n2(uv * vec2(uAspect, 1.) * 2.5 + uTime * .015) - .5) * 2.;
  v += vec2(-g.y, g.x) * uSwirl * wetN * swirlSign * 3.;
  v -= g * uBleed * wetN * 3.;

  float sp = length(v);
  if (sp > 3.) v *= 3. / sp;
  vec2 srcUv = uv - v * uTexel;

  if (uVortex > 0.) {
    vec2 c = uv - .5; c.x *= uAspect;
    float ang = uVortex * .003 * (1. + .5 * sin(uTime * .2));
    c = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * c * (1. + uVortex * .0012);
    c.x /= uAspect;
    srcUv = mix(srcUv, c + .5 - v * uTexel, wetN);
  }

  vec4 a = texture2D(uState, srcUv);
  vec4 blur = (texture2D(uState, srcUv + vec2(uTexel.x, 0)) + texture2D(uState, srcUv - vec2(uTexel.x, 0)) +
               texture2D(uState, srcUv + vec2(0, uTexel.y)) + texture2D(uState, srcUv - vec2(0, uTexel.y))) * .25;
  a = mix(a, blur, wetN * uBleed * .6);

  // moving ink leaves a stain where it was
  a.rgb = max(a.rgb, s.rgb * .4);

  // evaporation: thin films dry first, pools linger
  a.a = max(0., a.a - uDry * (1.6 - min(dens(a), 1.2)) * (uVortex > 0. ? .6 : 1.));

  // drain off the bottom edge
  a *= smoothstep(0., 4. * uTexel.y, uv.y);
  gl_FragColor = a;
}`;

// 3) Display: subtractive ink on textured paper, darker edges, a wet gloss.
//    Row 0 of the output is the top of the picture, the sim's last row.
export const wetPaintShowFrag = COMMON + `
uniform sampler2D uState;
uniform vec2 uRes, uTexel;
void main(){
  vec2 uv = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes;
  vec4 s = texture2D(uState, uv);
  vec2 e = uTexel;
  vec2 g = vec2(dens(texture2D(uState, uv + vec2(e.x, 0))) - dens(texture2D(uState, uv - vec2(e.x, 0))),
                dens(texture2D(uState, uv + vec2(0, e.y))) - dens(texture2D(uState, uv - vec2(0, e.y))));
  vec2 p = uv * uRes;
  float fiber = n2(p * vec2(.35, .08)) * .5 + n2(p * .9) * .3 + h21(floor(p)) * .2;
  vec3 paper = vec3(.945, .915, .855) * (.965 + .05 * fiber);
  float d = dens(s);
  vec3 pig = s.rgb * (1. + clamp(length(g) * 4., 0., 1.) * .7) * (.88 + .24 * fiber);
  vec3 col = paper * exp(-pig * 2.3);
  col *= 1. - s.a * .12 * smoothstep(.02, .3, d);
  vec3 n = normalize(vec3(-g * 7., 1.));
  float spec = pow(max(dot(n, normalize(vec3(-.45, .6, 1.))), 0.), 60.);
  col += spec * s.a * smoothstep(.1, .6, d) * .35;
  vec2 q = uv - .5;
  col *= 1. - dot(q, q) * .25;
  gl_FragColor = vec4(col, 1);
}`;

// 4) Pickup: the state under the brush, into a 1 x 1 8-bit buffer for reading
//    back, scaled so pigment up to the brush pass's cap of 2.6 fits
export const WET_PAINT_PICK_SCALE = 2.6;

export const wetPaintPickFrag = `
precision highp float;
uniform sampler2D uState;
uniform vec2 uPos;   // sim uv
void main(){
  vec4 s = texture2D(uState, uPos);
  gl_FragColor = vec4(clamp(s.rgb / ${WET_PAINT_PICK_SCALE.toFixed(1)}, 0., 1.), 1.);
}`;
