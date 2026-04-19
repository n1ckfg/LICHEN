export const atlasWriteFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D u_atlas;
uniform sampler2D u_input;
uniform vec2 u_tileSize;
uniform vec2 u_writeOrigin;

void main() {
  vec2 uv = vTexCoord;
  vec2 local = (uv - u_writeOrigin) / u_tileSize;
  vec4 atlasSample = texture2D(u_atlas, uv);
  vec4 inputSample = texture2D(u_input, clamp(local, 0.0, 1.0));
  float inside = (step(0.0, local.x) - step(1.0, local.x)) *
                 (step(0.0, local.y) - step(1.0, local.y));
  gl_FragColor = mix(atlasSample, inputSample, inside);
}
`;
