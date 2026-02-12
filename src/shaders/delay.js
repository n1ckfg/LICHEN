export const delayFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform sampler2D tex1;
uniform float delaySpeed;
uniform float lumaThreshold;
uniform float alphaMax;
uniform float alphaMin;

float getLuminance(vec3 col) {
  return dot(col, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec3 texColor0 = texture2D(tex0, vTexCoord).rgb;
  vec3 texColor1 = texture2D(tex1, vTexCoord).rgb;

  vec3 diff = texColor0 - texColor1;
  vec3 result = texColor1 + diff * delaySpeed;

  float luma = getLuminance(texColor0);
  float alpha = luma < lumaThreshold ? alphaMin : alphaMax;

  gl_FragColor = vec4(result, alpha);
}
`;
