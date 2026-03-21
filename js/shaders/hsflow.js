export const hsflowCalcFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;      // current frame
uniform sampler2D tex1;      // previous frame
uniform vec2 uResolution;
uniform float lambda;        // noise limiting
uniform float flowScale;     // scales the flow calculation result
uniform float offset;        // gradient sample distance

const vec3 lumcoeff = vec3(0.299, 0.587, 0.114);

float getLuma(vec3 c) {
  return dot(c, lumcoeff);
}

void main() {
  vec2 texel = 1.0 / uResolution;
  vec2 uv = vTexCoord;

  // Sample current and previous frames
  vec3 curr = texture2D(tex0, uv).rgb;
  vec3 prev = texture2D(tex1, uv).rgb;

  // Convert to luminance for flow calculation
  float currLuma = getLuma(curr);
  float prevLuma = getLuma(prev);

  // Temporal difference
  float dt = prevLuma - currLuma;

  // Calculate spatial gradients
  vec2 xOff = vec2(offset * texel.x, 0.0);
  vec2 yOff = vec2(0.0, offset * texel.y);

  // Gradient from both frames (averaged)
  float gradX = getLuma(texture2D(tex1, uv + xOff).rgb) - getLuma(texture2D(tex1, uv - xOff).rgb);
  gradX += getLuma(texture2D(tex0, uv + xOff).rgb) - getLuma(texture2D(tex0, uv - xOff).rgb);
  gradX *= 0.5;

  float gradY = getLuma(texture2D(tex1, uv + yOff).rgb) - getLuma(texture2D(tex1, uv - yOff).rgb);
  gradY += getLuma(texture2D(tex0, uv + yOff).rgb) - getLuma(texture2D(tex0, uv - yOff).rgb);
  gradY *= 0.5;

  // Gradient magnitude with lambda regularization
  float gradMag = sqrt(gradX * gradX + gradY * gradY + lambda);

  // Horn-Schunck optical flow
  float vx = dt * (gradX / gradMag) * flowScale;
  float vy = dt * (gradY / gradMag) * flowScale;

  // Encode flow into [0, 1] range for 8-bit texture support
  // Using 0.5 as the zero-point. A larger scale down prevents clipping.
  vec2 encodedFlow = vec2(vx, vy) * 0.5 + 0.5;
  
  gl_FragColor = vec4(encodedFlow, 0.0, 1.0);
}
`;

export const hsflowSlideFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0; // raw flow
uniform sampler2D tex1; // prev smoothed flow
uniform float slide;    // amount of temporal lag (0 to 1)

void main() {
  vec2 curr = texture2D(tex0, vTexCoord).rg;
  vec2 prev = texture2D(tex1, vTexCoord).rg;
  
  // slide represents how much of the previous frame to keep
  vec2 smoothed = mix(curr, prev, slide);
  
  gl_FragColor = vec4(smoothed, 0.0, 1.0);
}
`;

export const hsflowReposFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;      // image to distort (feedback FBO)
uniform sampler2D tex1;      // smoothed flow
uniform vec2 uResolution;
uniform float distortAmt;

void main() {
  vec2 uv = vTexCoord;
  
  // Decode flow from [0, 1] back to [-1, 1] (and scale back up)
  vec2 encodedFlow = texture2D(tex1, uv).rg;
  vec2 flow = (encodedFlow - 0.5) * 2.0;
  
  // Displacement amount
  vec2 texel = 1.0 / uResolution;
  vec2 flowOffset = flow * distortAmt * texel * 100.0;
  
  vec2 displacedUV = uv + flowOffset;
  
  // Clamp or wrap? Typically we clamp for feedback repos to avoid edge artifacts,
  // but texture2D handles this based on wrapping mode. Let's just sample.
  vec3 result = texture2D(tex0, displacedUV).rgb;
  
  gl_FragColor = vec4(result, 1.0);
}
`;

export const hsflowCompositeFrag = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;      // live video
uniform sampler2D tex1;      // distorted feedback
uniform float lumaThresh;
uniform float lumaTol;

const vec3 lumcoeff = vec3(0.299, 0.587, 0.114);

float getLuma(vec3 c) {
  return dot(c, lumcoeff);
}

void main() {
  vec3 live = texture2D(tex0, vTexCoord).rgb;
  vec3 feedback = texture2D(tex1, vTexCoord).rgb;
  
  float luma = getLuma(live);
  
  // Luma key: if live luma > threshold, show live. Otherwise, show feedback.
  // We use smoothstep for soft tolerance.
  // If tol is 0, smoothstep bounds might be equal, which is undefined, so we add a tiny epsilon.
  float minEdge = max(0.0, lumaThresh - lumaTol);
  float maxEdge = min(1.0, lumaThresh + lumaTol + 0.0001);
  
  float mixAmt = smoothstep(minEdge, maxEdge, luma);
  
  vec3 finalColor = mix(feedback, live, mixAmt);
  
  gl_FragColor = vec4(finalColor, 1.0);
}
`;
