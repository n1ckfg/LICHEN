export const passthroughFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;

void main() {
  gl_FragColor = texture2D(tex0, vTexCoord);
}
`;

// The passthrough flipped left to right, a program of its own so the plain
// passthrough stays exactly as it was
export const passthroughMirrorFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;

void main() {
  gl_FragColor = texture2D(tex0, vec2(1.0 - vTexCoord.x, vTexCoord.y));
}
`;
