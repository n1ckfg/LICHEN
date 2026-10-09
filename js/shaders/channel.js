// Channel: red from one input, green from another and blue from a third, each
// times its gain. A negative gain inverts its channel first, so -1 gives 1 - v
// and the knob runs through black at 0. An unplugged channel has a gain of 0,
// with another input bound in its place, since every sampler needs a texture.
export const channelFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D texR;
uniform sampler2D texG;
uniform sampler2D texB;
uniform vec3 uGain;

void main() {
  vec3 rgb = vec3(texture2D(texR, vTexCoord).r, texture2D(texG, vTexCoord).g, texture2D(texB, vTexCoord).b);
  vec3 inverted = vec3(lessThan(uGain, vec3(0.0)));
  gl_FragColor = vec4(clamp((rgb - inverted) * uGain, 0.0, 1.0), 1.0);
}
`;
