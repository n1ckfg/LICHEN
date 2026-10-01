export const transporterFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

void main() {
  // Transporter: moving objects in transporter beam
  vec2 uv = vTexCoord;

  // Moving object
  vec2 objPos = vec2(0.3 + sin(uTime) * 0.2, 0.5);
  float objDist = length(uv - objPos);
  float obj = 1.0 - smoothstep(0.0, 0.15, objDist);

  // Transporter beam effect - scan lines
  float scanLine = sin(uv.y * 100.0 - uTime * 20.0);
  float beam = smoothstep(0.5, 1.0, scanLine);

  // Source 2 shimmers in over source 1, strongest on the scan lines
  float transporter = obj * mix(0.3, 1.0, beam);

  vec3 color = mix(texture2D(texA, uv).rgb, texture2D(texB, uv).rgb, transporter);

  gl_FragColor = vec4(color, 1.0);
}
`;
