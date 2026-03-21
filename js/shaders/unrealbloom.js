export const unrealbloomFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uResolution;
uniform float threshold;
uniform float strength;
uniform float radius;

// Extract luminance
float getLuminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

// Soft threshold - smooth transition around threshold value
vec3 thresholdColor(vec3 color, float thresh) {
  float brightness = getLuminance(color);
  float soft = 0.1; // smoothness of threshold
  float contribution = smoothstep(thresh - soft, thresh + soft, brightness);
  return color * contribution;
}

// Gaussian weight
float gaussian(float x, float sigma) {
  return exp(-(x * x) / (2.0 * sigma * sigma));
}

// Multi-tap blur for bloom
vec3 blur(sampler2D tex, vec2 uv, vec2 resolution, float size) {
  vec2 texelSize = 1.0 / resolution;
  vec3 result = vec3(0.0);
  float weightSum = 0.0;

  // 13-tap blur kernel
  const int SAMPLES = 6;
  float sigma = size * 0.5;

  for (int x = -SAMPLES; x <= SAMPLES; x++) {
    for (int y = -SAMPLES; y <= SAMPLES; y++) {
      vec2 offset = vec2(float(x), float(y)) * texelSize * size;
      float dist = length(vec2(float(x), float(y)));
      float weight = gaussian(dist, sigma);

      vec3 sampleColor = texture2D(tex, uv + offset).rgb;
      vec3 brightColor = thresholdColor(sampleColor, threshold);

      result += brightColor * weight;
      weightSum += weight;
    }
  }

  return result / weightSum;
}

void main() {
  vec3 original = texture2D(tex0, vTexCoord).rgb;

  // Get blurred bloom from bright areas
  vec3 bloom = blur(tex0, vTexCoord, uResolution, radius);

  // Composite: original + bloom * strength
  vec3 result = original + bloom * strength;

  // Soft clamp to prevent harsh clipping
  result = result / (1.0 + result * 0.2);

  gl_FragColor = vec4(result, 1.0);
}
`;
