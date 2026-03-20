export const spatialSliceFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float time;
uniform float sliceWidth;
uniform float sliceSpeed;
uniform float offsetAmount;
uniform float chromatic;

void main() {
  vec2 uv = vTexCoord;

  float slice = step(0.5, fract(uv.y * sliceWidth + time * sliceSpeed));
  float offset = sin(uv.y * 30.0 + time * 4.0) * offsetAmount * slice;

  vec2 slicedUv = uv;
  slicedUv.x = fract(slicedUv.x + offset);

  vec4 color = texture2D(tex0, slicedUv);

  // Chromatic aberration on slices
  vec4 colorR = texture2D(tex0, slicedUv + vec2(chromatic * 0.01, 0.0) * slice);
  vec4 colorB = texture2D(tex0, slicedUv - vec2(chromatic * 0.01, 0.0) * slice);

  gl_FragColor = vec4(colorR.r, color.g, colorB.b, 1.0);
}
`;
