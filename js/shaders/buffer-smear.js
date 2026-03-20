export const bufferSmearFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform sampler2D tex1;
uniform float time;
uniform float smearAmount;
uniform float feedback;
uniform float zoomSpeed;

void main() {
  vec2 uv = vTexCoord;

  vec4 camColor = texture2D(tex0, uv);

  // Smearing displacement
  vec2 smearUv = uv;
  smearUv += vec2(
    sin(smearUv.y * 10.0 + time) * 0.005 * smearAmount,
    cos(smearUv.x * 10.0 + time) * 0.005 * smearAmount
  );

  // Slight zoom in for trail effect
  smearUv = (smearUv - 0.5) * (1.0 - zoomSpeed * 0.01) + 0.5;

  vec4 prevColor = texture2D(tex1, smearUv);

  // Mix camera and smeared feedback
  vec4 finalColor = max(camColor, prevColor * feedback);

  gl_FragColor = finalColor;
}
`;
