// Protozoa - Watercolor bleed effect shaders
// Multi-pass system: color injection, diffusion, bleeding, feedback, banding, display

export const protozoaColorFrag = `
precision highp float;

uniform vec2 u_resolution;
uniform vec2 u_positions[50];
uniform vec3 u_rgbColors[50];
uniform float u_radii[50];
uniform int u_numColors;

varying vec2 vTexCoord;

void main() {
  vec2 uv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
  vec3 finalColor = vec3(0.0);

  for (int i = 0; i < 50; i++) {
    if (i >= u_numColors) break;

    vec2 center = u_positions[i];
    float radius = u_radii[i];

    if (center.x < 0.0) continue;

    float dist = length(uv - center);
    float gaussian = exp(-0.5 * pow(dist / max(radius * 0.5, 0.001), 2.0));
    finalColor += u_rgbColors[i] * gaussian;
  }

  gl_FragColor = vec4(finalColor, 1.0);
}`;

export const protozoaDiffuseFrag = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_texture;
uniform float u_diffusionRate;

varying vec2 vTexCoord;

void main() {
  vec2 uv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
  vec2 texel = 1.0 / u_resolution;

  vec4 center = texture2D(u_texture, uv);

  vec4 top = texture2D(u_texture, uv + vec2(0.0, texel.y));
  vec4 bottom = texture2D(u_texture, uv + vec2(0.0, -texel.y));
  vec4 left = texture2D(u_texture, uv + vec2(-texel.x, 0.0));
  vec4 right = texture2D(u_texture, uv + vec2(texel.x, 0.0));

  vec4 laplacian = (top + bottom + left + right - 4.0 * center) * 0.25;
  vec4 diffused = center + laplacian * u_diffusionRate;
  diffused.rgb = pow(diffused.rgb, vec3(0.95));

  gl_FragColor = diffused;
}`;

export const protozoaBleedFrag = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_texture;
uniform float u_bleedStrength;

varying vec2 vTexCoord;

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
  vec2 uv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
  vec2 texel = 1.0 / u_resolution;

  vec4 color = texture2D(u_texture, uv);

  float paper = fbm(uv * 800.0);
  paper = smoothstep(0.3, 0.7, paper);

  vec2 fiberDir = vec2(cos(paper * 6.28), sin(paper * 6.28));

  vec4 bleedSample1 = texture2D(u_texture, uv + fiberDir * texel * 2.0);
  vec4 bleedSample2 = texture2D(u_texture, uv - fiberDir * texel * 2.0);

  vec4 bled = (bleedSample1 + bleedSample2) * 0.5;

  float bleedMask = smoothstep(0.4, 0.6, paper) * u_bleedStrength;

  color.rgb = mix(color.rgb, bled.rgb, bleedMask);
  color.rgb *= (1.0 - paper * 0.1);

  float intensity = length(color.rgb);
  color.rgb *= 1.0 - intensity * 0.1;

  gl_FragColor = color;
}`;

export const protozoaFeedbackFrag = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_texture;
uniform float u_feedback;

varying vec2 vTexCoord;

void main() {
  vec2 uv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
  vec2 texel = 1.0 / u_resolution;

  vec4 current = texture2D(u_texture, uv);
  float intensity = length(current.rgb);

  float left = length(texture2D(u_texture, uv - vec2(texel.x, 0.0)).rgb);
  float right = length(texture2D(u_texture, uv + vec2(texel.x, 0.0)).rgb);
  float up = length(texture2D(u_texture, uv + vec2(0.0, texel.y)).rgb);
  float down = length(texture2D(u_texture, uv - vec2(0.0, texel.y)).rgb);

  vec2 gradient = vec2(right - left, up - down);

  float rippleFreq = 15.0;
  float rippleSpeed = 3.0;
  float ripplePhase = intensity * rippleFreq - u_time * rippleSpeed;
  float ripple = sin(ripplePhase) * 0.5 + 0.5;

  vec2 displacement = normalize(gradient + vec2(0.001)) * ripple * texel * 3.0 * intensity;

  vec4 rippled = texture2D(u_texture, uv - displacement);

  vec4 blended = mix(current, rippled, 0.3 * intensity);
  vec4 result = mix(blended, vec4(1.0), 1.0 - u_feedback);
  result.rgb *= 0.998;

  gl_FragColor = result;
}`;

export const protozoaBandingFrag = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_texture;
uniform float u_bandingStrength;

varying vec2 vTexCoord;

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
  vec2 uv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
  vec4 color = texture2D(u_texture, uv);

  float intensity = length(color.rgb);

  float bands = sin(uv.x * 50.0 + u_time * 2.0) * sin(uv.y * 50.0 + u_time * 1.5);
  bands += noise(uv * 30.0 + u_time * 0.5) * 0.5;

  float bandThreshold = 0.5 + intensity * 0.3;
  float bandMask = smoothstep(bandThreshold - 0.1, bandThreshold + 0.1, bands);

  vec3 separated = color.rgb;
  float shift = bandMask * u_bandingStrength * 0.02;

  separated.r = texture2D(u_texture, uv + vec2(shift, 0.0)).r;
  separated.g = texture2D(u_texture, uv + vec2(0.0, shift * 0.7)).g;
  separated.b = texture2D(u_texture, uv - vec2(shift * 0.5, shift * 0.5)).b;

  float bandEffect = 1.0 - bandMask * u_bandingStrength * 0.8;

  float maxBrightness = 0.9;
  separated = min(separated, vec3(maxBrightness));

  color.rgb = separated * bandEffect;
  color.rgb += (separated.rgb - color.rgb) * bandMask * 0.2;

  gl_FragColor = color;
}`;

export const protozoaDisplayFrag = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_texture;
uniform sampler2D u_previousTexture;

varying vec2 vTexCoord;

vec3 toneMap(vec3 color) {
  return color / (color + vec3(1.0));
}

vec3 gammaCorrect(vec3 color, float gamma) {
  return pow(color, vec3(1.0 / gamma));
}

void main() {
  vec2 uv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
  vec4 current = texture2D(u_texture, uv);

  vec2 offset = vec2(sin(uv.y * 10.0 + u_time * 0.5), cos(uv.x * 10.0 + u_time * 0.5)) * 0.001;
  vec4 previous = texture2D(u_previousTexture, uv + offset);

  vec4 result = mix(current, previous, 0.1);

  result.rgb = toneMap(result.rgb);
  result.rgb = gammaCorrect(result.rgb, 2.2);

  float dist = length(uv - 0.5) * 1.5;
  result.rgb *= 1.0 - dist * 0.1;

  gl_FragColor = result;
}`;
