// InkMarkers (see InkMarkers Module in ARCHITECTURE.md), ported from the Ink
// Markers Studio sketch's shaders/. The tip and paper type are floats, not
// ints, and the stroke vertex shader places its vertices itself.

// Procedural paper: 0 smooth bristol, 1 cold press, 2 marker pad, 3 kraft
export const inkMarkersPaperFrag = `
precision highp float;

varying vec2 vTexCoord;
uniform vec2 uResolution;
uniform float uSeed;
uniform float uPaperType;

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// 2D noise after Morgan McGuire
float noise(in vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = random(i);
  float b = random(i + vec2(1.0, 0.0));
  float c = random(i + vec2(0.0, 1.0));
  float d = random(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(in vec2 st) {
  float value = 0.0;
  float amplitude = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 5; ++i) {
    value += amplitude * noise(st);
    st = rot * st * 2.0 + shift;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = vTexCoord;
  vec2 st = uv * uResolution * 0.1 + vec2(uSeed * 10.0);

  float grain = random(uv * 1000.0 + uSeed);
  float fibers = fbm(st * 0.5);
  float fibers2 = fbm(st * vec2(2.0, 0.5) + vec2(10.0));

  vec3 paperColor;
  float paperBase;

  if (uPaperType < 0.5) {
    // Smooth Bristol - minimal texture
    paperBase = 0.98 + 0.02 * fibers;
    paperBase -= 0.005 * grain;
    paperColor = vec3(0.98, 0.98, 0.98) * paperBase;
  } else if (uPaperType < 1.5) {
    // Cold Press - pronounced texture
    paperBase = 0.92 + 0.08 * fibers;
    paperBase -= 0.03 * grain;
    paperBase -= 0.02 * fibers2;
    paperColor = vec3(0.96, 0.95, 0.93) * paperBase;
  } else if (uPaperType < 2.5) {
    // Marker Pad - smooth with subtle fiber
    paperBase = 0.95 + 0.05 * fibers;
    paperBase -= 0.02 * grain;
    paperBase -= 0.01 * fibers2;
    paperColor = vec3(1.0, 0.98, 0.95) * paperBase;
  } else {
    // Kraft - brown with coarse fibers
    paperBase = 0.85 + 0.15 * fibers;
    paperBase -= 0.04 * grain;
    float speckle = step(0.995, random(uv * 500.0)) * 0.2;
    paperBase -= speckle;
    paperColor = vec3(0.76, 0.65, 0.49) * paperBase;
  }

  gl_FragColor = vec4(paperColor, 1.0);
}
`;

// A stroke's triangle strip, in frame pixels with y down. Row 0 of a
// framebuffer is the top of the picture as the UI shows it, so y = 0 goes to
// clip -1. aTexCoord.y runs -1..1 across the stroke.
export const inkMarkersStrokeVert = `
attribute vec3 aPosition;
attribute vec2 aTexCoord;
uniform vec2 uSize;
varying vec2 vTexCoord;

void main() {
  vTexCoord = aTexCoord;
  gl_Position = vec4(aPosition.xy / uSize * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Tip profiles across the stroke: 0 chisel, 1 bullet, 2 brush, 3 fine.
// Premultiplied, for p5's BLEND (ONE, ONE_MINUS_SRC_ALPHA), so a stroke that
// crosses itself builds up.
export const inkMarkersStrokeFrag = `
precision highp float;

varying vec2 vTexCoord;
uniform vec3 uColor;
uniform float uFlow;
uniform float uTipType;

void main() {
  float t = abs(vTexCoord.y);
  float alpha;

  if (uTipType < 0.5) {
    // Chisel - hard edge with slight softness
    alpha = 1.0 - smoothstep(0.7, 1.0, t);
  } else if (uTipType < 1.5) {
    // Bullet - round profile
    alpha = 1.0 - smoothstep(0.2, 1.0, t);
  } else if (uTipType < 2.5) {
    // Brush - very soft edges, slight texture
    alpha = 1.0 - smoothstep(0.1, 1.0, t);
    float n = fract(sin(dot(vTexCoord, vec2(12.9898, 78.233))) * 43758.5453);
    alpha *= 0.9 + n * 0.1;
  } else {
    // Fine - tight, precise
    alpha = 1.0 - smoothstep(0.0, 0.7, t);
  }

  alpha = clamp(alpha * uFlow, 0.0, 1.0);
  gl_FragColor = vec4(uColor * alpha, alpha);
}
`;

// The sheet so far (or bare paper) with the wet stroke over it: alcohol
// spread, a multiply layer that darkens where the stroke is dense, a blurred
// overlay layer for vibrancy, and pooling at the edges. Opaque.
export const inkMarkersBlendFrag = `
precision highp float;

varying vec2 vTexCoord;
uniform sampler2D uAccumulated;
uniform sampler2D uCurrentStroke;
uniform sampler2D uPaper;
uniform float uBleedAmount;
uniform vec2 uResolution;

vec4 sampleBlurred(sampler2D tex, vec2 uv, float radius) {
  vec2 pixel = 1.0 / uResolution;
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (float x = -1.0; x <= 1.0; x += 1.0) {
    for (float y = -1.0; y <= 1.0; y += 1.0) {
      float weight = 1.0 - length(vec2(x, y)) * 0.3;
      sum += texture2D(tex, uv + vec2(x, y) * pixel * radius) * weight;
      total += weight;
    }
  }
  return sum / total;
}

vec4 sampleWithSpread(sampler2D tex, vec2 uv, float spread) {
  vec2 pixel = 1.0 / uResolution;
  vec4 center = texture2D(tex, uv);
  if (spread < 0.01) return center;
  vec4 sum = center;
  float total = 1.0;
  for (float angle = 0.0; angle < 6.28; angle += 0.785) {
    vec2 dir = vec2(cos(angle), sin(angle));
    for (float dist = 1.0; dist <= 3.0; dist += 1.0) {
      float weight = (1.0 - dist / 4.0) * spread;
      sum += texture2D(tex, uv + dir * pixel * dist * spread * 8.0) * weight;
      total += weight;
    }
  }
  return sum / total;
}

void main() {
  vec2 uv = vTexCoord;

  vec4 acc = texture2D(uAccumulated, uv);
  vec4 paper = texture2D(uPaper, uv);
  vec4 stroke = sampleWithSpread(uCurrentStroke, uv, uBleedAmount);
  vec4 strokeBlurred = sampleBlurred(uCurrentStroke, uv, 6.0 + uBleedAmount * 10.0);

  vec3 base = acc.a > 0.01 ? acc.rgb : paper.rgb;

  if (stroke.a < 0.01 && strokeBlurred.a < 0.01) {
    gl_FragColor = vec4(base, 1.0);
    return;
  }

  float alpha = stroke.a;
  vec3 strokeColor = stroke.rgb / max(alpha, 0.001);
  vec3 strokeColorBlurred = strokeBlurred.rgb / max(strokeBlurred.a, 0.001);

  // Multiply, with 1-3 passes by density
  float multiplyPasses = 1.0 + alpha * 2.0;
  vec3 multiplied = base * pow(strokeColor, vec3(multiplyPasses));
  vec3 multiplyResult = mix(base, multiplied, alpha);

  // Blurred overlay
  vec3 lo = 2.0 * multiplyResult * strokeColorBlurred;
  vec3 hi = 1.0 - 2.0 * (1.0 - multiplyResult) * (1.0 - strokeColorBlurred);
  vec3 overlay = mix(lo, hi, step(0.5, multiplyResult));
  float overlayAlpha = min(strokeBlurred.a * 2.0, 1.0);
  vec3 result = mix(multiplyResult, overlay, overlayAlpha);

  // Ink pooling at stroke edges
  float edge = smoothstep(0.1, 0.35, alpha) - smoothstep(0.5, 0.85, alpha);
  result *= 1.0 - edge * 0.08;

  gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}
`;
