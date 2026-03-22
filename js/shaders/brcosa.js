export const brcosaFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float brightness;
uniform float contrast;
uniform float saturation;

void main() {
  vec4 col = texture2D(tex0, vTexCoord);
  vec3 rgb = col.rgb;

  // Brightness
  rgb += brightness;

  // Contrast
  rgb = (rgb - 0.5) * contrast + 0.5;

  // Saturation
  float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(vec3(luma), rgb, saturation);

  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), col.a);
}
`;
