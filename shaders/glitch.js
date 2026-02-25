export const glitchFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform sampler2D tex1;
uniform float barsamount;
uniform float distortion;
uniform float vsync;
uniform float hsync;
uniform vec2 uResolution;

void main() {
  vec2 point = vTexCoord;

  vec4 bars = texture2D(tex1, vTexCoord);

  // scanlines (resolution = 2 pixels)
  float stripe = floor(mod(vTexCoord.y * uResolution.y, 2.0));
  stripe = clamp(stripe, 0.0, 1.0);
  float scanline = 2.0 - stripe;

  // rough luma-based distortion
  vec4 key = texture2D(tex0, vec2(point.y, point.y));
  key += texture2D(tex0, 1.0 - vec2(point.y, point.y));
  key -= bars.r;
  float d = (key.r + key.g + key.b) / 3.0;
  point.x -= d * distortion * 0.1;

  // sync offset
  vec2 texcoord = point + mod(vec2(hsync, vsync), 1.0);
  texcoord = mod(texcoord, 1.0);

  // output
  vec4 result = vec4(scanline) * texture2D(tex0, texcoord);
  gl_FragColor = mix(result, bars * result, barsamount);
}
`;
