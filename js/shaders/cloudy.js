export const cloudyFrag = `
precision highp float;

varying vec2 vTexCoord;

uniform float uTime;
uniform vec2 uResolution;
uniform float speed;
uniform float blobs;
uniform float smoothness;
uniform float noiseScale;
uniform float displace;
uniform float colorShift;
uniform float glow;
uniform float zoom;

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

// Polynomial smooth minimum: melts the spheres into one another
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.0 + vec3(0.13);
    a *= 0.5;
  }
  return v;
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 uv = (vTexCoord - 0.5) * vec2(aspect, 1.0) * zoom;

  // Camera ray through this pixel
  vec3 rd = normalize(vec3(uv, -1.0));

  float t = uTime * speed;

  // Orbiting spheres blended into a single morphing field
  float d = 1e10;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    if (fi >= blobs) break;

    float freq = 0.6 + 0.3 * sin(fi * 1.7 + t * 0.3);
    float radius = 0.25 + 0.15 * sin(fi * 2.3 + t * 0.5);

    float angle1 = fi * 0.9 + t * (0.15 + 0.05 * sin(fi * 0.5));
    float angle2 = fi * 1.3 + t * (0.1 + 0.07 * cos(fi * 0.7));
    float angle3 = fi * 0.7 + t * (0.08 + 0.04 * sin(fi * 1.1));

    vec3 center = vec3(
      sin(angle1) * freq * 0.8,
      sin(angle2) * freq * 0.6,
      cos(angle3) * freq * 0.5
    );

    d = smin(d, sdSphere(center, radius), smoothness);
  }

  // FBM displacement makes the field organic and view-dependent
  d += fbm(rd * d * noiseScale + t * 0.3) * displace;

  vec3 col = vec3(0.0);

  if (d < 2.0) {
    vec3 lightDir = normalize(vec3(1.0, 1.5, 2.0));

    // Normal from the gradient of the displacement noise
    vec3 basePos = rd * d;
    float eps = 0.002;
    vec3 normal = normalize(vec3(
      fbm((basePos + vec3(eps, 0.0, 0.0)) * noiseScale + t * 0.3) - fbm((basePos - vec3(eps, 0.0, 0.0)) * noiseScale + t * 0.3),
      fbm((basePos + vec3(0.0, eps, 0.0)) * noiseScale + t * 0.3) - fbm((basePos - vec3(0.0, eps, 0.0)) * noiseScale + t * 0.3),
      fbm((basePos + vec3(0.0, 0.0, eps)) * noiseScale + t * 0.3) - fbm((basePos - vec3(0.0, 0.0, eps)) * noiseScale + t * 0.3)
    ));

    float diff = max(dot(normal, lightDir), 0.0);
    float fresnel = pow(1.0 - max(dot(-rd, normal), 0.0), 3.0);

    vec3 baseColor = 0.5 + 0.5 * cos(colorShift + t * 0.5 + vec3(0.0, 0.6, 1.0));
    col = baseColor * (0.15 + 0.85 * diff) + fresnel * vec3(0.3, 0.5, 1.0) * 0.6;

    // Subsurface scattering approximation
    float sss = pow(max(dot(rd, lightDir), 0.0), 3.0) * 0.3;
    col += baseColor * sss;

    col += exp(-d * 1.5) * glow * vec3(0.4, 0.6, 1.0);
  }

  // Background gradient
  vec3 bgCol = mix(vec3(0.01, 0.01, 0.04), vec3(0.02, 0.01, 0.06), uv.y + 0.5);
  col = mix(bgCol, col, smoothstep(2.0, 0.0, d));

  // Tone mapping
  col = col / (col + 1.0);
  col = pow(col, vec3(0.4545));

  gl_FragColor = vec4(col, 1.0);
}
`;
