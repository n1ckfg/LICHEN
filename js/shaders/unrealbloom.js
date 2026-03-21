export const unrealbloomHighPassFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform float threshold;

float getLuminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec3 color = texture2D(tex0, vTexCoord).rgb;
  float brightness = getLuminance(color);
  float soft = 0.1; // smoothness of threshold
  float contribution = smoothstep(threshold - soft, threshold + soft, brightness);
  gl_FragColor = vec4(color * contribution, 1.0);
}
`;

export const unrealbloomBlurFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 texelSize;
uniform vec2 direction;

void main() {
  vec2 uv = vTexCoord;
  vec3 result = vec3(0.0);
  
  // 9-tap Gaussian weights
  float weight[5];
  weight[0] = 0.227027;
  weight[1] = 0.194594;
  weight[2] = 0.121621;
  weight[3] = 0.054054;
  weight[4] = 0.016216;

  result += texture2D(tex0, uv).rgb * weight[0];
  for(int i = 1; i < 5; i++) {
    // We scale the offset slightly to improve blur spread without needing more taps
    vec2 offset = direction * texelSize * (float(i) * 1.5);
    result += texture2D(tex0, uv + offset).rgb * weight[i];
    result += texture2D(tex0, uv - offset).rgb * weight[i];
  }
  
  gl_FragColor = vec4(result, 1.0);
}
`;

export const unrealbloomCompositeFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0; // Original
uniform sampler2D blur1; // Mip 1
uniform sampler2D blur2; // Mip 2
uniform sampler2D blur3; // Mip 3
uniform sampler2D blur4; // Mip 4
uniform sampler2D blur5; // Mip 5

uniform float strength;
uniform float radius;

float lerpBloomFactor(float factor) {
  float mirrorFactor = 1.2 - factor;
  return mix(factor, mirrorFactor, radius);
}

void main() {
  vec3 original = texture2D(tex0, vTexCoord).rgb;

  // Typical bloom factors for the 5 mips
  float bloomFactors[5];
  bloomFactors[0] = 1.0;
  bloomFactors[1] = 0.8;
  bloomFactors[2] = 0.6;
  bloomFactors[3] = 0.4;
  bloomFactors[4] = 0.2;
  
  vec3 bloom = vec3(0.0);
  bloom += lerpBloomFactor(bloomFactors[0]) * texture2D(blur1, vTexCoord).rgb;
  bloom += lerpBloomFactor(bloomFactors[1]) * texture2D(blur2, vTexCoord).rgb;
  bloom += lerpBloomFactor(bloomFactors[2]) * texture2D(blur3, vTexCoord).rgb;
  bloom += lerpBloomFactor(bloomFactors[3]) * texture2D(blur4, vTexCoord).rgb;
  bloom += lerpBloomFactor(bloomFactors[4]) * texture2D(blur5, vTexCoord).rgb;

  // Composite: original + bloom * strength
  vec3 result = original + bloom * strength;

  // Soft clamp to prevent harsh clipping
  result = result / (1.0 + result * 0.2);

  gl_FragColor = vec4(result, 1.0);
}
`;
