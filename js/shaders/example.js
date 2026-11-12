export const exampleFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float brightness;

void main() {
  vec4 col = texture2D(tex0, vTexCoord);
  vec3 rgb = col.rgb;

  rgb += brightness;

  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), col.a);
}
`;
