export const pixelvisionFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float gamma;
uniform float posterizeLevels;
uniform vec2 texelSize;

float getLuminance(vec3 col) {
  return dot(col, vec3(0.299, 0.587, 0.114));
}

float toneMapAces(float x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float mapRange(float s, float a1, float a2, float b1, float b2) {
  return b1 + (s - a1) * (b2 - b1) / (a2 - a1);
}

void main() {
  vec3 centerColor = texture2D(tex0, vTexCoord).rgb;
  vec3 leftColor = texture2D(tex0, vTexCoord - vec2(texelSize.x, 0.0)).rgb;
  vec3 rightColor = texture2D(tex0, vTexCoord + vec2(texelSize.x, 0.0)).rgb;
  vec3 topColor = texture2D(tex0, vTexCoord + vec2(0.0, texelSize.y)).rgb;
  vec3 bottomColor = texture2D(tex0, vTexCoord - vec2(0.0, texelSize.y)).rgb;

  vec3 blurredColor = topColor * 0.10 + leftColor * 0.20 + centerColor * 0.40 + rightColor * 0.20 + bottomColor * 0.10;
  vec3 sharpenedColor = blurredColor * 5.0 - (leftColor + rightColor + topColor + bottomColor);
  vec3 posterizedColor = floor(sharpenedColor * posterizeLevels) / posterizeLevels;

  float luminance0 = toneMapAces(getLuminance(posterizedColor));
  float luminance1 = pow(mapRange(luminance0, 0.05, 0.95, 0.0, 1.0), 1.0 / gamma);

  gl_FragColor = vec4(luminance1, luminance1, luminance1, 1.0);
}
`;
