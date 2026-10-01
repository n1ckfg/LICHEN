export const trajectoryFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform sampler2D texA; // Source 1 (outgoing)
uniform sampler2D texB; // Source 2 (incoming)

void main() {
  // Trajectory: video squeezed and flies around screen
  vec2 uv = vTexCoord;

  // Flying path
  vec2 flyPos = vec2(
    0.5 + sin(uTime) * 0.4,
    0.5 + cos(uTime * 1.5) * 0.4
  );

  // Squeeze effect: shrink the frame around the flying position
  float squeeze = 0.3 + sin(uTime * 2.0) * 0.1; // 0.2 to 0.4
  vec2 squeezedUV = (uv - flyPos) / squeeze + 0.5;

  vec3 color;
  if (squeezedUV.x < 0.0 || squeezedUV.x > 1.0 || squeezedUV.y < 0.0 || squeezedUV.y > 1.0) {
    color = texture2D(texA, uv).rgb; // Outside (source 1)
  } else {
    color = texture2D(texB, squeezedUV).rgb; // Inside (source 2, squeezed)
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
