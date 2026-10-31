// Mesh: a glTF model drawn through the module's own orbit camera. The model is
// already in world space (readGLTF.js bakes in the node transforms), so uMVP is
// the camera's whole projection x view, in GL's convention, y up.
//
// glTF colours are linear: vertex colours, the base colour factor and the
// light are multiplied in linear light, and the result is encoded to sRGB.
// A base colour texture is sRGB already, so it is decoded first.
export const meshVert = `
precision highp float;

attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec4 aVertexColor;
attribute vec2 aTexCoord;

uniform mat4 uMVP;

varying vec3 vPosition;
varying vec3 vNormal;
varying vec4 vColor;
varying vec2 vTexCoord;

void main() {
  vPosition = aPosition;
  vNormal = aNormal;
  vColor = aVertexColor;
  vTexCoord = aTexCoord;
  gl_Position = uMVP * vec4(aPosition, 1.0);
  // Row 0 of a framebuffer is the top of the picture (see Framebuffer
  // Orientation in ARCHITECTURE.md), so clip y runs down
  gl_Position.y = -gl_Position.y;
}
`;

export const meshFrag = `
precision highp float;

uniform sampler2D uTexture;   // the base colour texture, or 1x1 white
uniform vec4 uBaseColor;
uniform vec3 uEye;
uniform vec3 uLightDir;       // towards the light, unit length
uniform float uLight;         // 0: unlit colour, 1: fully lit

varying vec3 vPosition;
varying vec3 vNormal;
varying vec4 vColor;
varying vec2 vTexCoord;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSRGB(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }

void main() {
  // glTF's default sampler repeats
  vec4 tex = texture2D(uTexture, fract(vTexCoord));
  vec3 albedo = vColor.rgb * uBaseColor.rgb * toLinear(tex.rgb);

  // Double-sided: a face seen from behind is lit as its front would be
  vec3 n = normalize(vNormal);
  if (dot(n, uEye - vPosition) < 0.0) n = -n;
  float lit = 0.2 + 0.8 * max(dot(n, uLightDir), 0.0);

  gl_FragColor = vec4(toSRGB(albedo * mix(1.0, lit, uLight)), 1.0);
}
`;
