export const maelstromFrag = `
precision mediump float;

uniform sampler2D tex0;
uniform float uTime;
uniform vec2 uResolution;
uniform float waveFreq;
uniform float waveSpeed;
uniform float waveAmount;
uniform float radialStrength;
uniform float radialFreq;
uniform float radialSpeed;
uniform float chromaAmount;

varying vec2 vTexCoord;

void main() {
  vec2 uv = vTexCoord;

  // Sample original color to get brightness
  vec4 original = texture2D(tex0, uv);
  float brightness = dot(original.rgb, vec3(0.299, 0.587, 0.114));

  // Distortion amount based on brightness
  float distortAmount = brightness * waveAmount;

  // Create wave distortion based on brightness
  float waveX = sin(uv.y * waveFreq + uTime * waveSpeed) * distortAmount;
  float waveY = cos(uv.x * waveFreq + uTime * waveSpeed * 0.75) * distortAmount;

  // Radial distortion from center, stronger in bright areas
  vec2 center = vec2(0.5);
  vec2 toCenter = uv - center;
  float dist = length(toCenter);
  vec2 radialDistort = toCenter * brightness * radialStrength * sin(dist * radialFreq - uTime * radialSpeed);

  // Apply combined distortion
  vec2 distortedUV = uv + vec2(waveX, waveY) + radialDistort;
  distortedUV = clamp(distortedUV, 0.0, 1.0);

  // Sample with distorted coordinates
  vec4 color = texture2D(tex0, distortedUV);

  // Chromatic aberration based on brightness
  float chromaOffset = brightness * chromaAmount;
  float r = texture2D(tex0, distortedUV + vec2(chromaOffset, 0.0)).r;
  float g = color.g;
  float b = texture2D(tex0, distortedUV - vec2(chromaOffset, 0.0)).b;

  gl_FragColor = vec4(r, g, b, 1.0);
}
`;
