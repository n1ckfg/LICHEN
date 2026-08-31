// Time Tunnel — a rotating video-feedback tunnel.
//
// Ported from a WebGL sketch that drove the tunnel from a Game of Life grid.
// That grid never actually reached the shader: it was uploaded as raw 0/1 bytes
// in a gl.ALPHA texture, so a live cell arrived as 1/255 and every term it fed
// collapsed to a constant — the dye injection, the whole colour palette and the
// swirl eddies were multiplied by smoothstep(0.6, 1.0, 0.0039), i.e. by zero.
// What the sketch actually rendered is what is left here, with the three
// constants it was stuck on (swirl 0.012, ripple 0.4, speed 0.5) opened up as
// uniforms. Their defaults reproduce the original exactly.
export const timetunnelFrag = `
precision highp float;
varying vec2 vTexCoord;

uniform sampler2D u_prev;      // this world's previous feedback frame
uniform vec2 uResolution;
uniform float u_time;          // world-local age in seconds; resets with the world
uniform float u_speed;         // rotation and ripple rate
uniform float u_trail;         // feedback retention per frame
uniform float u_swirl;         // feedback displacement per unit radius
uniform float u_ripple;        // ripple intensity

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i),             hash(i + vec2(1, 0)), f.x),
    mix(hash(i + vec2(0,1)), hash(i + vec2(1, 1)), f.x),
    f.y
  );
}

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

// Map an angle onto a circle in noise space. atan() has a branch cut along the
// -x axis (it jumps +PI -> -PI there), so feeding an angle to fbm() as a plain
// linear coordinate tears the noise field along that ray — a seam running from
// the centre to the middle of the left edge. Walking a circle instead is
// continuous by construction, and a circle of this radius has the same
// arc length per radian as the old linear coordinate, so detail density
// is unchanged.
vec2 ring(float ang, float radius) { return vec2(cos(ang), sin(ang)) * radius; }

void main() {
  vec2 uv = vTexCoord;
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);

  // Spiral coordinates
  vec2 p = (uv - 0.5) * uResolution / min(uResolution.x, uResolution.y);
  float r = length(p);
  float a = atan(p.y, p.x);

  // Time-driven twist. The inner turns faster than the outer, and that shear
  // is what winds the feedback into arms.
  float twist = a + u_time * u_speed * 0.3 / (1.0 + r * 0.5);

  // Feedback sampling with swirl
  vec2 offset = vec2(cos(twist), sin(twist)) * u_swirl * r;

  // Multiple feedback passes for depth
  vec4 col = texture2D(u_prev, uv + offset * aspect) * u_trail;
  col += texture2D(u_prev, uv + offset * aspect * 0.5) * 0.04;
  col += texture2D(u_prev, uv - offset * aspect * 0.25) * 0.03;

  // Radial fade (tunnel depth)
  float fade = smoothstep(0.0, 1.2, r);
  col.rgb *= 1.0 - fade * fade * 0.7;

  // Ripples, phase-warped by fbm so the rings break into organic arms
  float n1 = fbm(ring(twist, 2.0) + vec2(0.0, r * 3.0 - u_time * u_speed * 0.4));
  float ripple1 = sin(r * 18.0 - u_time * u_speed * 2.0 + n1 * 4.0);
  float ripple2 = sin(r * 12.0 + a * 3.0 + u_time * u_speed * 1.5);
  float ripple = (ripple1 * 0.6 + ripple2 * 0.4) * 0.5 + 0.5;
  ripple = pow(ripple, 4.0) * u_ripple * 0.25;
  col.rgb += vec3(0.3, 0.5, 0.8) * ripple * smoothstep(0.8, 0.2, r);

  // Bright core
  float core = exp(-r * 3.0);
  col.rgb += vec3(0.15, 0.25, 0.5) * core * 0.5;

  // Subtle vignette
  col.rgb *= 1.0 - length(uv - 0.5) * 0.5;

  // Gamma
  col.rgb = pow(col.rgb, vec3(0.85));

  gl_FragColor = vec4(col.rgb, 1.0);
}
`;

// Cross-dissolves the two half-cycle-offset worlds onto the output.
export const timetunnelBlendFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform sampler2D tex1;
uniform float u_mix;

void main() {
  vec3 a = texture2D(tex0, vTexCoord).rgb;
  vec3 b = texture2D(tex1, vTexCoord).rgb;
  gl_FragColor = vec4(mix(a, b, u_mix), 1.0);
}
`;
