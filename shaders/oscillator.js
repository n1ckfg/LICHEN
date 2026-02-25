export const oscillatorFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform float time;
uniform float frequency;
uniform float waveform;
uniform float direction;
uniform vec2 uResolution;

void main() {
  vec2 uv = vTexCoord;
  float t;

  if (direction < 0.5) {
    t = uv.x;
  } else if (direction < 1.5) {
    t = uv.y;
  } else {
    t = length(uv - 0.5) * 2.0;
  }

  float phase = t * frequency + time;
  float val;

  if (waveform < 0.5) {
    val = 0.5 + 0.5 * sin(phase * 6.28318530718);
  } else if (waveform < 1.5) {
    val = fract(phase) < 0.5 ? 1.0 : 0.0;
  } else if (waveform < 2.5) {
    val = abs(fract(phase) * 2.0 - 1.0);
  } else {
    val = fract(phase);
  }

  gl_FragColor = vec4(val, val, val, 1.0);
}
`;
